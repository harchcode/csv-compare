import "./style.css";
import type {
  DiffMeta,
  DiffRow,
  MainToWorkerMessage,
  WorkerToMainMessage
} from "./types";
import { openDB } from "./utils";

const addBtn = document.getElementById("add-files-btn") as HTMLButtonElement;
const fileInput = document.getElementById("file-input") as HTMLInputElement;
const fileList = document.getElementById("file-list") as HTMLUListElement;

const compareBtn = document.getElementById("compareBtn") as HTMLButtonElement;
const statusEl = document.getElementById("status") as HTMLPreElement;

const PAGE_SIZE = 200;

const files = new Map<string, File>();
let currentPage = 0;
let totalRows = 0;
let totalPages = 0;
let headers: string[] = [];
let isProcessing = false;

async function clearDB() {
  const db = await openDB();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(["baseRows", "meta"], "readwrite");
    tx.objectStore("baseRows").clear();
    tx.objectStore("meta").clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

async function initUI() {
  const meta = await getMeta();

  if (!meta) {
    await clearDB();
    headers = [];
    totalRows = 0;
    totalPages = 0;
    renderLegend(undefined);
  } else {
    headers = meta.commonColumns ?? [];
    totalRows = meta.comparedRows ?? 0;
    totalPages = Math.ceil(totalRows / PAGE_SIZE);
    renderLegend(meta.fileNames);
  }

  const table = document.getElementById("diff-table")!;
  table.innerHTML = `
    <thead class="sticky top-px bg-white z-10 shadow-[0_-1px_0_rgba(0,0,0,1),0_1px_0_rgba(0,0,0,1)]"></thead>
    <tbody></tbody>`;

  renderHeaders(headers);
  setupPagination();

  await loadPageAndUpdatePaginationUI(0);
}

initUI();

const worker = new Worker(new URL("./worker.ts", import.meta.url), {
  type: "module"
});

worker.onmessage = (event: MessageEvent<WorkerToMainMessage>) => {
  const msg = event.data;

  switch (msg.type) {
    case "READY":
      statusEl.textContent = "Worker ready.";
      break;

    case "HEADER": {
      headers = msg.payload.headers;
      renderHeaders(headers);

      break;
    }

    case "PROGRESS": {
      console.log("Progress:", msg.payload);
      statusEl.textContent = `Processed rows: ${msg.payload.processedRows}`;

      if (msg.payload.processedRows === 0) {
        renderRows([]);
      }

      const newTotalPages = Math.ceil(msg.payload.processedRows / PAGE_SIZE);

      if (currentPage >= totalPages - 1 && currentPage < newTotalPages) {
        loadPage(currentPage);
      }

      totalRows = msg.payload.processedRows;
      totalPages = newTotalPages;
      updatePaginationUI();

      break;
    }

    case "COMPLETE":
      statusEl.textContent = `Done. Total compared: ${msg.payload.totalCompared}`;
      compareBtn.disabled = false;
      isProcessing = false;

      break;

    case "ERROR":
      statusEl.textContent = `Error: ${msg.payload.message}`;
      compareBtn.disabled = false;
      isProcessing = false;

      break;
  }
};

// Initialize worker
const initMessage: MainToWorkerMessage = {
  type: "INIT",
  payload: {
    mode: "CSV_DIFF"
  }
};

worker.postMessage(initMessage);

compareBtn.addEventListener("click", () => {
  if (files.size < 2) {
    alert("Please select at least 2 files.");
    return;
  }

  compareBtn.disabled = true;
  isProcessing = true;
  const selectedFiles = Array.from(files.values());
  renderLegend(selectedFiles.map(f => f.name));
  const startMessage: MainToWorkerMessage = {
    type: "START",
    payload: {
      files: selectedFiles
    }
  };
  worker.postMessage(startMessage);
});

function renderHeaders(headers: string[]) {
  const thead = document.querySelector("#diff-table thead")!;

  const headerRow = document.createElement("tr");

  for (const header of headers) {
    const th = document.createElement("th");
    th.className = "border px-2 py-1 text-sm";
    th.textContent = header;
    headerRow.appendChild(th);
  }

  thead.replaceChildren(headerRow);
}

function getFileBadgeClass(index: number): string {
  const classes = [
    "bg-blue-100 text-blue-800 border-blue-200",
    "bg-rose-100 text-rose-800 border-rose-200",
    "bg-emerald-100 text-emerald-800 border-emerald-200",
    "bg-purple-100 text-purple-800 border-purple-200",
    "bg-amber-100 text-amber-800 border-amber-200"
  ];
  return classes[index % classes.length];
}

function renderLegend(fileNames: string[] | undefined) {
  const legendContainer = document.getElementById("diff-legend")!;
  if (!fileNames || fileNames.length === 0) {
    legendContainer.replaceChildren();
    legendContainer.classList.add("hidden");
    return;
  }

  legendContainer.classList.remove("hidden");
  legendContainer.replaceChildren();

  fileNames.forEach((name, index) => {
    const item = document.createElement("div");
    item.className =
      "flex items-center gap-1.5 bg-gray-50 border px-2 py-1 rounded text-xs font-medium";

    const badge = document.createElement("span");
    badge.className = `px-1 py-0.5 rounded text-[10px] font-bold border leading-none shrink-0 ${getFileBadgeClass(index)}`;
    badge.textContent = `F${index + 1}`;

    const fileNameSpan = document.createElement("span");
    fileNameSpan.className = "truncate max-w-[180px]";
    fileNameSpan.textContent = name;
    fileNameSpan.title = name;

    item.appendChild(badge);
    item.appendChild(fileNameSpan);
    legendContainer.appendChild(item);
  });
}

function renderRows(rows: DiffRow[]) {
  const tbody = document.querySelector("#diff-table tbody")!;
  tbody.replaceChildren();

  for (const row of rows) {
    const tr = document.createElement("tr");

    for (const cell of row) {
      const td = document.createElement("td");

      if (typeof cell === "string") {
        td.className = "border px-2 py-1 text-sm max-w-[240px] truncate";
        td.textContent = cell;
      } else {
        td.className =
          "border px-2 py-1 text-sm max-w-[240px] bg-amber-50 align-top";

        const container = document.createElement("div");
        container.className = "flex flex-col gap-1 py-0.5";

        const fileValues: { fileIndex: number; value: string }[] = [];
        for (const [value, fileIndexes] of Object.entries(cell)) {
          for (const fileIndex of fileIndexes) {
            fileValues.push({ fileIndex, value });
          }
        }
        fileValues.sort((a, b) => a.fileIndex - b.fileIndex);

        for (const { fileIndex, value } of fileValues) {
          const rowDiv = document.createElement("div");
          rowDiv.className = "flex items-center gap-1.5 text-xs min-w-0";

          const badge = document.createElement("span");
          badge.className = `px-1 py-0.5 rounded text-[10px] font-bold border leading-none shrink-0 ${getFileBadgeClass(fileIndex)}`;
          badge.textContent = `F${fileIndex + 1}`;

          const valSpan = document.createElement("span");
          valSpan.className = "truncate";
          valSpan.textContent = value === "" ? "(empty)" : value;
          if (value === "") {
            valSpan.className += " text-gray-400 italic";
          }

          rowDiv.appendChild(badge);
          rowDiv.appendChild(valSpan);
          container.appendChild(rowDiv);
        }

        td.appendChild(container);
      }

      tr.appendChild(td);
    }

    tbody.appendChild(tr);
  }
}

async function getMeta() {
  const db = await openDB();

  return new Promise<DiffMeta>((resolve, reject) => {
    const tx = db.transaction("meta", "readonly");
    const store = tx.objectStore("meta");

    const req = store.get("session");

    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function getPage(page: number): Promise<DiffRow[]> {
  const start = page * PAGE_SIZE;

  const db = await openDB();

  return new Promise((resolve, reject) => {
    const tx = db.transaction("baseRows", "readonly");
    const store = tx.objectStore("baseRows");

    const req = store.openCursor(IDBKeyRange.lowerBound(start));

    const rows: DiffRow[] = [];

    req.onsuccess = () => {
      const cursor = req.result;

      if (!cursor) {
        resolve(rows);
        return;
      }

      rows.push(cursor.value);

      if (rows.length >= PAGE_SIZE) {
        resolve(rows);
        return;
      }

      cursor.continue();
    };

    req.onerror = () => reject(req.error);
  });
}

function updatePaginationUI() {
  const info = document.getElementById("page-info")!;

  info.textContent = `Page ${currentPage + 1} / ${totalPages}`;
  (document.getElementById("prev-btn") as HTMLButtonElement).disabled =
    currentPage === 0;
  (document.getElementById("next-btn") as HTMLButtonElement).disabled =
    currentPage >= totalPages - 1;
}

async function loadPage(page: number) {
  const rows = await getPage(page);
  currentPage = page;

  renderRows(rows);
}

async function loadPageAndUpdatePaginationUI(page: number) {
  await loadPage(page);

  updatePaginationUI();
}

function setupPagination() {
  document.getElementById("prev-btn")!.addEventListener("click", () => {
    if (currentPage > 0) {
      loadPageAndUpdatePaginationUI(currentPage - 1);
    }
  });

  document.getElementById("next-btn")!.addEventListener("click", () => {
    if (currentPage < totalPages - 1) {
      loadPageAndUpdatePaginationUI(currentPage + 1);
    }
  });
}

function fileId(file: File) {
  return `${file.name}_${file.size}_${file.lastModified}`;
}

addBtn.addEventListener("click", () => {
  fileInput.click();
});

fileInput.addEventListener("change", () => {
  const selected = fileInput.files;
  if (!selected) return;

  for (const file of selected) {
    const id = fileId(file);

    if (!files.has(id)) {
      files.set(id, file);
    }
  }

  renderFiles();

  // allow selecting same file again later
  fileInput.value = "";
});

function renderFiles() {
  fileList.replaceChildren();

  for (const [id, file] of files) {
    const li = document.createElement("li");
    li.className = "flex items-center justify-between py-2";

    const name = document.createElement("span");
    name.textContent = file.name;

    const remove = document.createElement("button");
    remove.textContent = "remove";
    remove.className = "text-red-500 text-xs";
    remove.dataset.removeFileId = id;

    li.appendChild(name);
    li.appendChild(remove);

    fileList.appendChild(li);
  }
}

fileList.addEventListener("click", e => {
  const target = e.target as HTMLElement;
  // Use a data attribute to find the button and its associated file ID
  if (target.matches("button[data-remove-file-id]")) {
    const fileId = target.dataset.removeFileId;
    if (fileId) {
      files.delete(fileId);
      target.parentElement?.remove();
    }
  }
});

window.addEventListener("beforeunload", event => {
  if (isProcessing) {
    event.preventDefault();
    return "";
  }
});
