# CSV Compare

**This README file is AI generated**

A high-performance, fully client-side web application designed to compare and highlight differences between multiple CSV files directly in the browser.

The application is built using **TypeScript**, **Vite**, **Tailwind CSS**, and **Vanilla DOM Manipulation** optimized for processing large datasets efficiently.

---

## 🚀 Key Features

- **Multi-File Comparison**: Compare 2 or more CSV files simultaneously.
- **Automatic Column Alignment**: Detects common columns across files and aligns data accordingly, ignoring differing column structures.
- **Interactive Difference Highlighting**: Color-coded badges point to differences and trace which value belongs to which file.
- **Dynamic Hover Tooltips**: Moving the cursor over cells reveals a detailed comparison tooltip listing the exact value for each file, especially useful for long text strings.
- **Client-Side & Private**: All file processing and calculations run locally on your machine. No data is sent to a server.

---

## ⚡ Performance Optimization Techniques

Comparing large datasets in a single browser tab often leads to UI lag, high memory consumption, or browser crashes (Out of Memory errors). To solve these issues, the project implements several key performance techniques:

### 1. Off-Thread Computation via Web Workers (`worker.ts`)

- **Problem**: Parsing and comparing files with hundreds of thousands of rows is CPU-intensive. Running it on the main thread blocks UI interaction, causing the page to freeze.
- **Solution**: The parsing and diffing algorithms run entirely inside a background **Web Worker**. The main thread remains idle and responsive, allowing smooth animations and progress spinner updates during calculations.

### 2. Stream-Based CSV Parsing

- **Problem**: Reading an entire file into memory using `FileReader.readAsText()` consumes RAM proportional to the file size (e.g., a 200MB CSV could consume upwards of 600MB of JavaScript heap).
- **Solution**: The application streams files chunk-by-chunk using `file.stream()` and `TextDecoderStream`. A custom character-based parser state machine processes the incoming stream on the fly and yields rows dynamically using generators (`yield`), capping memory usage to a small buffer.

### 3. Disk-Backed Persistence via IndexedDB

- **Problem**: Keeping millions of compared rows in JavaScript memory will crash the browser tab.
- **Solution**: After comparing rows in the Web Worker, results are written directly to a local **IndexedDB** database. The main thread then queries only the active page from IndexedDB. This disk-cached mechanism keeps memory usage exceptionally low even for huge comparison tasks.

### 4. Batched Database Writes

- **Problem**: Individual IndexedDB write operations (`put`) carry significant transaction overhead. Writing 100,000 rows one by one would take minutes.
- **Solution**: The worker collects parsed rows into memory batches up to **512KB** (`BATCH_SIZE_BYTES`) before committing them to IndexedDB in a single transaction block. This reduces database write times from minutes to a fraction of a second.

### 5. Custom Dynamic 2D Virtual Grid Rendering

- **Problem**: Rendering a table with thousands of rows and columns creates millions of DOM nodes, causing the browser layout engine to crawl.
- **Solution**: The application features a custom horizontal and vertical virtualizer.
  - It measures the scroll container's viewport bounds and calculates precisely which rows and columns are currently visible.
  - It buffers by `+/- 2` rows/columns to prevent scrolling flicker.
  - It computes **dynamic row heights** (diff rows are taller due to stacked badges; matching rows are single-height) using pre-calculated offsets.
  - Only the visible elements are rendered and absolutely positioned in the viewport. The DOM node count remains constant (~300 elements) regardless of the dataset size.

### 6. Index-Based Traversal Map

- **Problem**: Accessing cell values by string keys (e.g. `row["column_name"]`) during comparison causes slow string hashes inside loops.
- **Solution**: The app builds a column-index mapping structure during the header parse stage. Row comparisons are performed via direct array index accesses, accelerating the diff loop.
- **Fast-Path Comparison**: If all cell values across the files are identical, the engine returns the string immediately and skips allocating complex object clusters.

---

## 🛠️ Tech Stack & Setup

- **Build Tool**: Vite
- **Language**: TypeScript
- **Styling**: Tailwind CSS
- **Database**: IndexedDB (native browser storage)

### Getting Started

1. **Install Dependencies**:

   ```bash
   pnpm install
   ```

2. **Run Locally**:

   ```bash
   pnpm dev
   ```

3. **Build for Production**:
   ```bash
   pnpm build
   ```
