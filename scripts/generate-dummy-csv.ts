import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const OUTPUT_FILE_NAME = "med9.csv";
const TARGET_SIZE_MB = 20;
const TARGET_SIZE_BYTES = TARGET_SIZE_MB * 1024 * 1024;
const COLUMNS = 1000;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.join(path.dirname(__filename), "out");

const OUTPUT_PATH = path.join(__dirname, OUTPUT_FILE_NAME);

fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
const stream = fs.createWriteStream(OUTPUT_PATH);

let bytesWritten = 0;
let rowIndex = 0;

let header = "id";
for (let i = 1; i <= COLUMNS; i++) {
  header += `,col${i}`;
}
header += "\n";
stream.write(header);
bytesWritten += Buffer.byteLength(header);

function generateRow(i: number): string {
  let row = `${i}`;
  for (let j = 1; j <= COLUMNS; j++) {
    row += `,${Math.random().toString(36).substring(2, 7)}`;
  }
  row += "\n";

  return row;
}

function writeChunk(): void {
  let canContinue = true;

  while (bytesWritten < TARGET_SIZE_BYTES && canContinue) {
    const row = generateRow(rowIndex++);
    bytesWritten += Buffer.byteLength(row);
    canContinue = stream.write(row);
  }

  if (bytesWritten >= TARGET_SIZE_BYTES) {
    stream.end(() => {
      console.log("✅ Done!");
      console.log(`File created: ${OUTPUT_PATH}`);
      console.log(`Size: ${(bytesWritten / 1024 / 1024).toFixed(2)} MB`);
      console.log(`Rows generated: ${rowIndex}`);
    });
  } else {
    stream.once("drain", writeChunk);
  }
}

writeChunk();
