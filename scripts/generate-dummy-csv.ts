import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const OUTPUT_FILE_NAME = "med2.csv";
const TARGET_SIZE_MB = 5;
const TARGET_SIZE_BYTES = TARGET_SIZE_MB * 1024 * 1024;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.join(path.dirname(__filename), "out");

const OUTPUT_PATH = path.join(__dirname, OUTPUT_FILE_NAME);

const stream = fs.createWriteStream(OUTPUT_PATH);

let bytesWritten = 0;
let rowIndex = 0;

const header = "id,name,email,amount,status\n";
stream.write(header);
bytesWritten += Buffer.byteLength(header);

function generateRow(i: number): string {
  return `${i},User_${i},user_${i}@example.com,${(Math.random() * 1000).toFixed(
    2
  )},${Math.random() > 0.5 ? "ACTIVE" : "INACTIVE"}\n`;
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
