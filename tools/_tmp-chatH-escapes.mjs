import fs from "node:fs";

// Chat H scratch: within a run, show which depth-1 declarations are still referenced after
// the run ends, so an extraction range can be chosen that avoids them.
// Usage: node tools/_tmp-chatH-escapes.mjs <file> <from> <to>
const [file, from, to] = [process.argv[2], Number(process.argv[3]), Number(process.argv[4])];
const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
const after = lines.slice(to).join("\n");
for (let i = from - 1; i < to; i++) {
  const m = /^  (?:const|let)\s+([A-Za-z_$][\w$]*)/.exec(lines[i]);
  if (!m) continue;
  if (new RegExp(`\\b${m[1]}\\b`).test(after)) console.log(`${i + 1}  ${m[1]}`);
}
