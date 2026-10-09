const fs = require("node:fs");
const path = require("node:path");

const source = path.join(__dirname, "..", "node_modules", "pdfjs-dist", "legacy", "build", "pdf.worker.min.mjs");
const target = path.join(__dirname, "..", "public", "pdf.worker.min.mjs");

function validateWorker(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`PDF.js worker not found: ${filePath}`);
  }
  const size = fs.statSync(filePath).size;
  if (size < 100_000) {
    throw new Error(`PDF.js worker is unexpectedly small (${size} bytes): ${filePath}`);
  }
}

validateWorker(source);
fs.mkdirSync(path.dirname(target), { recursive: true });
fs.copyFileSync(source, target);
validateWorker(target);
console.log(`Copied PDF.js worker to ${path.relative(process.cwd(), target)}`);

module.exports = { validateWorker };
