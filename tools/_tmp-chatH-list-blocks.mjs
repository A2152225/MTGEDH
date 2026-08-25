import fs from "node:fs";

// Chat H scratch: list depth-1 statement heads in a line range of a function body.
// Usage: node tools/_tmp-chatH-list-blocks.mjs <file> <fromLine> <toLine>
const [file, from, to] = [process.argv[2], Number(process.argv[3]), Number(process.argv[4])];
const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
for (let i = from - 1; i < to; i++) {
  const m = /^(\s*)(\S)/.exec(lines[i]);
  if (!m || m[1].length !== 2) continue;
  if (/^[)\]}]/.test(lines[i].trim())) continue;
  console.log(`${String(i + 1).padStart(6)}  ${lines[i].trim().slice(0, 130)}`);
}
