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
const pageSizeSelect = document.getElementById(
  "page-size-select"
) as HTMLSelectElement;
const rowInfoEl = document.getElementById("row-info") as HTMLElement;

let PAGE_SIZE = 50;

// Virtual Grid Constants
const COL_WIDTH = 200;
const ROW_NUM_WIDTH = 50;
const ROW_HEIGHT_BASE = 38;
const ROW_HEIGHT_DIFF_ITEM = 20;

const files = new Map<string, File>();
let currentPage = 0;
let totalRows = 0;
let totalPages = 0;
let headers: string[] = [];
let isProcessing = false;

// Virtual Grid State
let currentRows: DiffRow[] = [];
let rowOffsets: number[] = [0];
let totalGridHeight = 0;
let totalGridWidth = 0;

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

  window.addEventListener("scroll", renderVirtualGrid, {
    capture: true,
    passive: true
  });
  window.addEventListener("resize", renderVirtualGrid, { passive: true });

  renderHeaders(headers);
  setupPagination();

  await loadPageAndUpdatePaginationUI(0);
}

initUI();

function updateStatus(
  text: string,
  state: "ready" | "processing" | "success" | "error"
) {
  statusEl.textContent = text;
  statusDotEl.className =
    "w-2.5 h-2.5 rounded-full transition-all duration-300";

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
      updateStatus(
        `Processed rows: ${msg.payload.processedRows}`,
        "processing"
      );

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
      updateStatus(
        `Done. Total compared: ${msg.payload.totalCompared}`,
        "success"
      );
      compareBtn.disabled = false;
      clearBtn.disabled = false;
      isProcessing = false;

      break;

    case "ERROR":
      updateStatus(`Error: ${msg.payload.message}`, "error");
      compareBtn.disabled = false;
      clearBtn.disabled = false;
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
  clearBtn.disabled = true;
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

function renderHeaders(newHeaders: string[]) {
  headers = newHeaders;
  totalGridWidth = ROW_NUM_WIDTH + headers.length * COL_WIDTH;

  const bodyContent = document.getElementById("diff-body-content");
  if (bodyContent) {
    bodyContent.style.width = `${totalGridWidth}px`;
  }

  renderVirtualGrid();
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
  currentRows = rows;
  rowOffsets = [0];
  let currentY = 0;

  for (const row of rows) {
    let hasDiff = false;
    let maxStackedItems = 0;

    for (const cell of row) {
      if (typeof cell !== "string") {
        hasDiff = true;
        let itemsCount = 0;
        for (const fileIndexes of Object.values(cell)) {
          itemsCount += (fileIndexes as number[]).length;
        }
        if (itemsCount > maxStackedItems) {
          maxStackedItems = itemsCount;
        }
      }
    }

    const h = hasDiff
      ? Math.max(ROW_HEIGHT_BASE, maxStackedItems * ROW_HEIGHT_DIFF_ITEM + 8)
      : ROW_HEIGHT_BASE;
    currentY += h;
    rowOffsets.push(currentY);
  }

  totalGridHeight = currentY;

  const bodyContent = document.getElementById("diff-body-content");
  // Total height includes the 32px header
  if (bodyContent) {
    bodyContent.style.height = `${totalGridHeight + 32}px`;
  }

  renderVirtualGrid();
}

function renderVirtualGrid() {
  const bodyContent = document.getElementById("diff-body-content");
  if (!bodyContent) return;

  const rect = bodyContent.getBoundingClientRect();
  const windowWidth = window.innerWidth;
  const windowHeight = window.innerHeight;

  // Horizontal Visibility
  const visibleLeft = Math.max(0, -rect.left);
  const visibleRight = visibleLeft + windowWidth;

  // Calculate visible columns
  const startCol = Math.max(
    0,
    Math.floor((visibleLeft - ROW_NUM_WIDTH) / COL_WIDTH)
  );
  const endCol = Math.min(
    Math.max(0, headers.length - 1),
    Math.ceil((visibleRight - ROW_NUM_WIDTH) / COL_WIDTH)
  );

  const startColBuffered = Math.max(0, startCol - 2);
  const endColBuffered = Math.min(Math.max(0, headers.length - 1), endCol + 2);

  // Vertical Visibility
  const visibleTop = Math.max(0, -rect.top);
  const visibleBottom = visibleTop + windowHeight;

  let startRow = 0;
  for (let i = 0; i < currentRows.length; i++) {
    if (rowOffsets[i + 1] > visibleTop - 32) {
      startRow = i;
      break;
    }
  }

  let endRow = currentRows.length - 1;
  for (let i = startRow; i < currentRows.length; i++) {
    if (rowOffsets[i] >= visibleBottom - 32) {
      endRow = i;
      break;
    }
  }

  const startRowBuffered = Math.max(0, startRow - 2);
  const endRowBuffered = Math.min(
    Math.max(0, currentRows.length - 1),
    endRow + 2
  );

  const parts: string[] = [];

  // 1. Render `#` Header
  if (headers.length > 0) {
    parts.push(
      `<div class="absolute top-0 left-0 border-l border-r border-b border-t px-2 py-1 text-sm text-center text-gray-600 font-bold bg-gray-100 select-none flex items-center justify-center z-10" style="width: ${ROW_NUM_WIDTH}px; height: 32px;">#</div>`
    );

    // 2. Render Column Headers
    for (let c = startColBuffered; c <= endColBuffered; c++) {
      if (c >= headers.length) break;
      const left = ROW_NUM_WIDTH + c * COL_WIDTH;
      parts.push(
        `<div class="absolute top-0 border-r border-t border-b px-2 py-1 text-sm bg-gray-100 text-gray-700 font-bold truncate flex items-center select-none z-10" style="left: ${left}px; width: ${COL_WIDTH}px; height: 32px;" title="${escapeHtml(headers[c])}">${escapeHtml(headers[c])}</div>`
      );
    }
  }

  // 3. Render Body
  const startRowNumber = currentPage * PAGE_SIZE + 1;
  for (let r = startRowBuffered; r <= endRowBuffered; r++) {
    if (r >= currentRows.length) break;
    const top = rowOffsets[r] + 32; // Offset by 32px for the header
    const height = rowOffsets[r + 1] - rowOffsets[r];
    const row = currentRows[r];

    // Row number cell
    parts.push(
      `<div class="absolute left-0 border-l border-b border-r px-2 py-1 text-sm text-center text-gray-600 font-mono bg-gray-50 select-none flex items-start justify-center pt-2" style="top: ${top}px; width: ${ROW_NUM_WIDTH}px; height: ${height}px;">${startRowNumber + r}</div>`
    );

    // Data cells
    for (let c = startColBuffered; c <= endColBuffered; c++) {
      if (c >= headers.length) break;
      const left = ROW_NUM_WIDTH + c * COL_WIDTH;
      const cell = row[c];

      if (typeof cell === "string") {
        parts.push(
          `<div class="absolute border-b border-r px-2 py-1 text-sm overflow-hidden flex items-start bg-white" data-cell-row="${r}" data-cell-col="${c}" style="top: ${top}px; left: ${left}px; width: ${COL_WIDTH}px; height: ${height}px;">` +
            `<div class="truncate w-full pt-1 pointer-events-none">${escapeHtml(cell)}</div>` +
            `</div>`
        );
      } else {
        let cellHtml = `<div class="absolute border-b border-r px-2 py-1 text-sm overflow-hidden bg-amber-50" data-cell-row="${r}" data-cell-col="${c}" style="top: ${top}px; left: ${left}px; width: ${COL_WIDTH}px; height: ${height}px;">`;
        cellHtml += `<div class="flex flex-col gap-1 py-0.5 pointer-events-none">`;

        const fileValues: { fileIndex: number; value: string }[] = [];
        for (const [value, fileIndexes] of Object.entries(cell)) {
          for (const fileIndex of fileIndexes as number[]) {
            fileValues.push({ fileIndex, value });
          }
        }
        fileValues.sort((a, b) => a.fileIndex - b.fileIndex);

        for (const { fileIndex, value } of fileValues) {
          const badgeClass = getFileBadgeClass(fileIndex);
          const valText = value === "" ? "(empty)" : escapeHtml(value);
          const valClass =
            value === "" ? "truncate text-gray-400 italic" : "truncate";

          cellHtml += `<div class="flex items-center gap-1.5 text-xs min-w-0">
            <span class="px-1 py-0.5 rounded text-[10px] font-bold border leading-none shrink-0 ${badgeClass}">F${fileIndex + 1}</span>
            <span class="${valClass}">${valText}</span>
          </div>`;
        }
        cellHtml += `</div></div>`;
        parts.push(cellHtml);
      }
    }
  }

  bodyContent.innerHTML = parts.join("");
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

  pageInput.addEventListener("keydown", e => {
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

// Custom Tooltip Logic
const tooltipEl = document.getElementById("custom-tooltip");
const bodyContentEl = document.getElementById("diff-body-content");

function hideTooltip() {
  if (tooltipEl) {
    tooltipEl.style.opacity = "0";
  }
}

if (bodyContentEl && tooltipEl) {
  bodyContentEl.addEventListener("mouseleave", hideTooltip);

  bodyContentEl.addEventListener("mousemove", e => {
    const target = e.target as HTMLElement;
    const cellEl = target.closest("[data-cell-row]");
    if (!cellEl) {
      hideTooltip();
      return;
    }

    const r = parseInt(cellEl.getAttribute("data-cell-row") || "", 10);
    const c = parseInt(cellEl.getAttribute("data-cell-col") || "", 10);

    if (isNaN(r) || isNaN(c) || !currentRows[r]) {
      hideTooltip();
      return;
    }

    const headerName = headers[c];
    const cell = currentRows[r][c];
    const globalRowNumber = currentPage * PAGE_SIZE + 1 + r;

    let html = `<div class="font-bold text-gray-700 mb-2 pb-1.5 border-b border-gray-200">${escapeHtml(headerName)} <span class="text-gray-400 font-normal ml-1">#${globalRowNumber}</span></div>`;

    if (typeof cell === "string") {
      const valText = cell === "" ? "(empty)" : escapeHtml(cell);
      const valClass = cell === "" ? "text-gray-400 italic" : "text-gray-800";

      html += `<div class="flex items-center gap-2 mb-1.5 mt-1">
         <span class="px-1.5 py-0.5 rounded text-[10px] font-bold border border-gray-200 bg-gray-100 text-gray-600">All Files</span>
      </div>`;
      html += `<div class="${valClass} whitespace-pre-wrap leading-relaxed">${valText}</div>`;
    } else {
      const fileValues: { fileIndex: number; value: string }[] = [];
      for (const [value, fileIndexes] of Object.entries(cell)) {
        for (const fileIndex of fileIndexes as number[]) {
          fileValues.push({ fileIndex, value });
        }
      }
      fileValues.sort((a, b) => a.fileIndex - b.fileIndex);

      const allFiles = Array.from(files.values());

      for (const { fileIndex, value } of fileValues) {
        const badgeClass = getFileBadgeClass(fileIndex);
        const valText = value === "" ? "(empty)" : escapeHtml(value);
        const valClass =
          value === "" ? "text-gray-400 italic" : "text-gray-800";
        const fileName = allFiles[fileIndex]?.name || `F${fileIndex + 1}`;

        html += `<div class="mb-3.5 last:mb-0 mt-1">`;
        html += `<div class="flex items-center gap-1.5 mb-1.5">
            <span class="px-1 py-0.5 rounded text-[10px] font-bold border leading-none shrink-0 ${badgeClass}">F${fileIndex + 1}</span>
            <span class="text-gray-500 font-medium text-xs truncate max-w-[200px]">${escapeHtml(fileName)}</span>
         </div>`;
        html += `<div class="${valClass} pl-0.5 whitespace-pre-wrap leading-relaxed">${valText}</div>`;
        html += `</div>`;
      }
    }

    tooltipEl.innerHTML = html;

    let x = e.clientX + 15;
    let y = e.clientY + 15;

    const rect = tooltipEl.getBoundingClientRect();
    if (x + rect.width > window.innerWidth) {
      x = e.clientX - rect.width - 15;
    }
    if (y + rect.height > window.innerHeight) {
      y = e.clientY - rect.height - 15;
    }

    tooltipEl.style.transform = `translate(${x}px, ${y}px)`;
    tooltipEl.style.opacity = "1";
  });
}
