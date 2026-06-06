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
const clearBtn = document.getElementById("clearBtn") as HTMLButtonElement;
const statusEl = document.getElementById("status") as HTMLElement;
const statusDotEl = document.getElementById("status-dot") as HTMLElement;

// Pagination elements
const firstBtn = document.getElementById("first-btn") as HTMLButtonElement;
const prevBtn = document.getElementById("prev-btn") as HTMLButtonElement;
const nextBtn = document.getElementById("next-btn") as HTMLButtonElement;
const lastBtn = document.getElementById("last-btn") as HTMLButtonElement;
const pageInput = document.getElementById("page-input") as HTMLInputElement;
const totalPagesSpan = document.getElementById("total-pages") as HTMLElement;
const pageSizeSelect = document.getElementById("page-size-select") as HTMLSelectElement;
const rowInfoEl = document.getElementById("row-info") as HTMLElement;

let PAGE_SIZE = 50;

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
  PAGE_SIZE = parseInt(pageSizeSelect.value, 10) || 50;
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

function updateStatus(text: string, state: "ready" | "processing" | "success" | "error") {
  statusEl.textContent = text;
  statusDotEl.className = "w-2.5 h-2.5 rounded-full transition-all duration-300";
  
  if (state === "ready") {
    statusDotEl.classList.add("bg-gray-300");
  } else if (state === "processing") {
    statusDotEl.classList.add("bg-blue-500", "animate-pulse");
  } else if (state === "success") {
    statusDotEl.classList.add("bg-emerald-500");
  } else if (state === "error") {
    statusDotEl.classList.add("bg-rose-500");
  }
}

const worker = new Worker(new URL("./worker.ts", import.meta.url), {
  type: "module"
});

worker.onmessage = (event: MessageEvent<WorkerToMainMessage>) => {
  const msg = event.data;

  switch (msg.type) {
    case "READY":
      updateStatus("Worker ready.", "ready");
      break;

    case "HEADER": {
      headers = msg.payload.headers;
      renderHeaders(headers);

      break;
    }

    case "PROGRESS": {
      console.log("Progress:", msg.payload);
      updateStatus(`Processed rows: ${msg.payload.processedRows}`, "processing");

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
      updateStatus(`Done. Total compared: ${msg.payload.totalCompared}`, "success");
      compareBtn.disabled = false;
      isProcessing = false;

      break;

    case "ERROR":
      updateStatus(`Error: ${msg.payload.message}`, "error");
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
  updateStatus("Comparing files...", "processing");
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

  // Row number header
  const thNum = document.createElement("th");
  thNum.className =
    "border px-2 py-1 text-sm w-12 text-center text-gray-600 font-bold bg-gray-100 select-none";
  thNum.textContent = "#";
  headerRow.appendChild(thNum);

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

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function renderRows(rows: DiffRow[]) {
  const tbody = document.querySelector("#diff-table tbody")!;
  const startRowNumber = currentPage * PAGE_SIZE + 1;
  const htmlParts: string[] = [];

  rows.forEach((row, rowIndex) => {
    htmlParts.push("<tr>");

    // Row number cell
    htmlParts.push(
      `<td class="border px-2 py-1 text-sm text-center text-gray-600 font-mono bg-gray-100 select-none w-12">${startRowNumber + rowIndex}</td>`
    );

    for (const cell of row) {
      if (typeof cell === "string") {
        htmlParts.push(
          `<td class="border px-2 py-1 text-sm max-w-[240px] truncate">${escapeHtml(cell)}</td>`
        );
      } else {
        htmlParts.push(
          `<td class="border px-2 py-1 text-sm max-w-[240px] bg-amber-50 align-top">`
        );
        htmlParts.push(`<div class="flex flex-col gap-1 py-0.5">`);

        const fileValues: { fileIndex: number; value: string }[] = [];
        for (const [value, fileIndexes] of Object.entries(cell)) {
          for (const fileIndex of fileIndexes) {
            fileValues.push({ fileIndex, value });
          }
        }
        fileValues.sort((a, b) => a.fileIndex - b.fileIndex);

        for (const { fileIndex, value } of fileValues) {
          const badgeClass = getFileBadgeClass(fileIndex);
          const valText = value === "" ? "(empty)" : escapeHtml(value);
          const valClass = value === "" ? "truncate text-gray-400 italic" : "truncate";

          htmlParts.push(
            `<div class="flex items-center gap-1.5 text-xs min-w-0">` +
              `<span class="px-1 py-0.5 rounded text-[10px] font-bold border leading-none shrink-0 ${badgeClass}">F${fileIndex + 1}</span>` +
              `<span class="${valClass}">${valText}</span>` +
            `</div>`
          );
        }

        htmlParts.push(`</div></td>`);
      }
    }
    htmlParts.push("</tr>");
  });

  tbody.innerHTML = htmlParts.join("");
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
  const displayPages = totalPages || 1;
  totalPagesSpan.textContent = String(displayPages);
  pageInput.value = String(currentPage + 1);
  pageInput.max = String(displayPages);

  firstBtn.disabled = currentPage === 0;
  prevBtn.disabled = currentPage === 0;
  nextBtn.disabled = currentPage >= totalPages - 1;
  lastBtn.disabled = currentPage >= totalPages - 1;

  if (totalRows > 0) {
    rowInfoEl.textContent = `Total compared: ${totalRows.toLocaleString()} rows`;
  } else {
    rowInfoEl.textContent = "";
  }
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
  firstBtn.addEventListener("click", () => {
    if (currentPage > 0) {
      loadPageAndUpdatePaginationUI(0);
    }
  });

  prevBtn.addEventListener("click", () => {
    if (currentPage > 0) {
      loadPageAndUpdatePaginationUI(currentPage - 1);
    }
  });

  nextBtn.addEventListener("click", () => {
    if (currentPage < totalPages - 1) {
      loadPageAndUpdatePaginationUI(currentPage + 1);
    }
  });

  lastBtn.addEventListener("click", () => {
    if (currentPage < totalPages - 1) {
      loadPageAndUpdatePaginationUI(totalPages - 1);
    }
  });

  pageInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      pageInput.blur();
    }
  });

  pageInput.addEventListener("change", () => {
    const val = parseInt(pageInput.value, 10);
    if (!isNaN(val) && val >= 1 && val <= totalPages) {
      loadPageAndUpdatePaginationUI(val - 1);
    } else {
      pageInput.value = String(currentPage + 1);
    }
  });

  pageSizeSelect.addEventListener("change", () => {
    PAGE_SIZE = parseInt(pageSizeSelect.value, 10) || 50;
    totalPages = Math.ceil(totalRows / PAGE_SIZE);
    
    if (currentPage >= totalPages) {
      currentPage = Math.max(0, totalPages - 1);
    }
    
    loadPageAndUpdatePaginationUI(currentPage);
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

clearBtn.addEventListener("click", async () => {
  if (isProcessing) {
    alert("Cannot clear results while comparison is in progress.");
    return;
  }
  
  if (confirm("Are you sure you want to clear all compared results?")) {
    await clearDB();
    
    // Reset state variables
    currentPage = 0;
    totalRows = 0;
    totalPages = 0;
    headers = [];
    files.clear();
    
    // Reset status and UI
    updateStatus("Data cleared.", "ready");
    renderLegend(undefined);
    renderHeaders([]);
    renderRows([]);
    renderFiles();
    updatePaginationUI();
  }
});
