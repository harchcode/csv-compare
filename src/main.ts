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

async function initUI() {
  const meta = await getMeta();

  totalRows = meta.comparedRows;

  totalPages = Math.ceil(totalRows / PAGE_SIZE);

  const table = document.getElementById("diff-table")!;
  table.innerHTML = `
    <thead class="sticky top-px bg-white z-10 shadow-[0_-1px_0_rgba(0,0,0,1),0_1px_0_rgba(0,0,0,1)]">
      <tr>
        <th class="border px-2 py-1 text-sm">Column 1</th>
        <th class="border px-2 py-1 text-sm">Column 2</th>
        <th class="border px-2 py-1 text-sm">Column 2</th>
        <th class="border px-2 py-1 text-sm">Column 2</th>
        <th class="border px-2 py-1 text-sm">Column 2</th>
      </tr>
    </thead>
    <tbody></tbody>`;

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

      break;

    case "ERROR":
      statusEl.textContent = `Error: ${msg.payload.message}`;
      compareBtn.disabled = false;

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
  const startMessage: MainToWorkerMessage = {
    type: "START",
    payload: {
      files: Array.from(files.values())
    }
  };
  worker.postMessage(startMessage);
});

function renderRows(rows: DiffRow[]) {
  const tbody = document.querySelector("#diff-table tbody")!;
  tbody.innerHTML = "";

  for (const row of rows) {
    const tr = document.createElement("tr");

    for (const cell of row) {
      const td = document.createElement("td");
      td.className = "border px-2 py-1 text-sm max-w-[240px] truncate";

      if (typeof cell === "string") {
        td.textContent = cell;
      } else {
        td.textContent = Object.entries(cell)
          .map(([v, f]) => `${v} (${f.join(",")})`)
          .join(" | ");
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
  const rows = await getPage(page);

  currentPage = page;

  renderRows(rows);

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
  fileList.innerHTML = "";

  for (const [id, file] of files) {
    const li = document.createElement("li");
    li.className = "flex items-center justify-between py-2";

    const name = document.createElement("span");
    name.textContent = file.name;

    const remove = document.createElement("button");
    remove.textContent = "remove";
    remove.className = "text-red-500 text-xs";

    remove.onclick = () => {
      files.delete(id);
      renderFiles();
    };

    li.appendChild(name);
    li.appendChild(remove);

    fileList.appendChild(li);
  }
}
