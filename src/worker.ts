import type {
  ColumnIndexMap,
  DiffCell,
  DiffCluster,
  DiffRow,
  MainToWorkerMessage,
  WorkerToMainMessage
} from "./types";
import { openDB } from "./utils";

const ROW_BATCH_SIZE = 2000;

let db: IDBDatabase | null = null;

self.postMessage({ type: "READY" } satisfies WorkerToMainMessage);

self.onmessage = async (event: MessageEvent<MainToWorkerMessage>) => {
  const msg = event.data;

  try {
    switch (msg.type) {
      case "INIT":
        handleInit(msg.payload);
        break;

      case "START":
        await handleStart(msg.payload.files);
        break;
    }
  } catch (err) {
    self.postMessage({
      type: "ERROR",
      payload: { message: (err as Error).message }
    } satisfies WorkerToMainMessage);
  }
};

async function handleInit(payload: { mode: "CSV_DIFF" }) {
  try {
    db = await openDB();

    const msg: WorkerToMainMessage = {
      type: "READY"
    };

    self.postMessage(msg);
  } catch (err) {
    const msg: WorkerToMainMessage = {
      type: "ERROR",
      payload: { message: String(err) }
    };

    self.postMessage(msg);
  }
}

async function handleStart(files: File[]) {
  if (!db) {
    throw new Error("Database not initialized");
  }

  const totalCompared = await compareFiles(files);

  const msg: WorkerToMainMessage = {
    type: "COMPLETE",
    payload: { totalCompared }
  };

  self.postMessage(msg);
}

async function* streamLines(file: File) {
  const reader = file.stream().pipeThrough(new TextDecoderStream()).getReader();

  let buffer = "";

  try {
    while (true) {
      const { value, done } = await reader.read();

      if (done) break;

      buffer += value;

      let newlineIndex;
      while ((newlineIndex = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newlineIndex);
        buffer = buffer.slice(newlineIndex + 1);
        yield line;
      }
    }

    // Emit remaining buffer as last line
    if (buffer.length > 0) {
      yield buffer;
    }
  } finally {
    reader.releaseLock();
  }
}

function buildColumnIndexMap(header: string[]): ColumnIndexMap {
  const map: ColumnIndexMap = {};

  header.forEach((column, index) => {
    map[column] = index;
  });

  return map;
}

function buildColumnIndexes(
  commonColumns: string[],
  columnMaps: ColumnIndexMap[]
) {
  return columnMaps.map(map => commonColumns.map(col => map[col]!));
}

function getCommonColumns(headers: string[][]): string[] {
  if (headers.length === 0) return [];

  const [firstHeader, ...otherHeaders] = headers;

  const otherSets = otherHeaders.map(header => new Set(header));

  return firstHeader.filter(column => otherSets.every(set => set.has(column)));
}

function buildRow(
  rows: string[][],
  columnIndexesPerFile: number[][]
): DiffCell[] {
  const fileCount = rows.length;
  const columnCount = columnIndexesPerFile[0].length;

  const result: DiffCell[] = new Array(columnCount);

  for (let col = 0; col < columnCount; col++) {
    // value from first file
    const firstValue = rows[0][columnIndexesPerFile[0][col]];

    let identical = true;

    // check if all files have same value
    for (let file = 1; file < fileCount; file++) {
      const value = rows[file][columnIndexesPerFile[file][col]];

      if (value !== firstValue) {
        identical = false;
        break;
      }
    }

    // fast path
    if (identical) {
      result[col] = firstValue;
      continue;
    }

    // build diff cluster
    const cluster: DiffCluster = {};

    for (let file = 0; file < fileCount; file++) {
      const value = rows[file][columnIndexesPerFile[file][col]];

      let indexes = cluster[value];

      if (!indexes) {
        indexes = [];
        cluster[value] = indexes;
      }

      indexes.push(file);
    }

    result[col] = cluster;
  }

  return result;
}

function waitTx(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

async function compareFiles(files: File[]) {
  const tx = db!.transaction(["baseRows", "meta"], "readwrite");

  tx.objectStore("baseRows").clear();
  tx.objectStore("meta").clear();

  await waitTx(tx);

  const fileSizes = files.map(f => f.size);
  const bytesRead = new Array(files.length).fill(0);

  const iterators = files.map(file =>
    streamLines(file)[Symbol.asyncIterator]()
  );

  // --- read headers ---
  const headers: string[][] = [];

  for (const it of iterators) {
    const { value, done } = await it.next();

    if (done) {
      throw new Error("File has no header row");
    }

    headers.push(value.split(","));
  }

  console.log("headers:", headers);

  // --- build column maps ---
  const columnMaps = headers.map(buildColumnIndexMap);

  console.log("columnMaps:", columnMaps);

  // --- find common columns ---
  const commonColumns = getCommonColumns(headers);
  const columnIndexesPerFile = buildColumnIndexes(commonColumns, columnMaps);

  console.log("commonColumns:", commonColumns);

  let rowIndex = 0;

  const rows: string[][] = new Array(files.length);

  const baseBatch: DiffRow[] = [];

  // --- streaming loop ---
  while (true) {
    const nextRows = await Promise.all(iterators.map(it => it.next()));

    // stop when any file ends
    if (nextRows.some(r => r.done)) {
      console.log("stream ended");
      break;
    }

    for (let i = 0; i < nextRows.length; i++) {
      // TODO: modify to handle quoted CSV values with commas, newlines, etc.
      const value = nextRows[i].value as string;
      rows[i] = value.split(",");
      bytesRead[i] += value.length;
    }

    // --- build base row ---
    const baseRow = buildRow(rows, columnIndexesPerFile);

    // console.log("STORE baseRow:", rowIndex, baseRow);
    baseBatch.push(baseRow);

    // --- build diff record ---
    // const diffRecord = buildDiffRecord(
    //   rowIndex,
    //   rows,
    //   columnMaps,
    //   commonColumns
    // );

    // if (diffRecord) {
    //   // console.log("STORE diffRow:", diffRecord);
    //   diffBatch.push(diffRecord);
    // }

    rowIndex++;

    if (baseBatch.length >= ROW_BATCH_SIZE) {
      await flushBatch(rowIndex, baseBatch);

      // send progress update
      const progress = Math.max(...bytesRead.map((b, i) => b / fileSizes[i]));

      const msg: WorkerToMainMessage = {
        type: "PROGRESS",
        payload: { processedRows: rowIndex, progress }
      };

      self.postMessage(msg);
    }
  }

  if (baseBatch.length > 0) {
    await flushBatch(rowIndex, baseBatch);
  }

  // send progress update
  const progress = Math.max(...bytesRead.map((b, i) => b / fileSizes[i]));

  const msg: WorkerToMainMessage = {
    type: "PROGRESS",
    payload: { processedRows: rowIndex, progress }
  };

  self.postMessage(msg);

  // write metadata
  const metaTx = db!.transaction(["meta"], "readwrite");
  const metaStore = metaTx.objectStore("meta");

  const meta = {
    fileCount: files.length,
    commonColumns,
    comparedRows: rowIndex
  };

  metaStore.put(meta, "session");

  metaTx.commit();
  await waitTx(metaTx);

  await Promise.all(iterators.map(it => it.return?.()));

  console.log("comparison finished");

  // placeholder for:
  // await metaStore.put(...)

  return rowIndex;
}

async function flushBatch(rowIndex: number, baseBatch: DiffRow[]) {
  const tx = db!.transaction(["baseRows"], "readwrite");

  const baseStore = tx.objectStore("baseRows");

  const start = rowIndex - baseBatch.length;

  for (let i = 0; i < baseBatch.length; i++) {
    baseStore.put(baseBatch[i], start + i);
  }

  tx.commit();
  await waitTx(tx);

  baseBatch.length = 0;
}
