import fs from "node:fs";

// Chat H scratch: propose depth-1 split boundaries that cut a line range into N chunks of
// roughly equal byte size. Usage: node tools/_tmp-chatH-split-points.mjs <file> <from> <to> <n>
const [file, from, to, n] = [process.argv[2], Number(process.argv[3]), Number(process.argv[4]), Number(process.argv[5])];
const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);

const starts = [];
for (let i = from - 1; i < to; i++) {
  if (!/^  \S/.test(lines[i])) continue;
  if (/^  [)\]}]/.test(lines[i].trim() ? lines[i] : "  x")) continue;
  if (/^  \/\//.test(lines[i])) continue;
  starts.push(i + 1);
}

let total = 0;
const cum = new Map();
for (let i = from - 1; i < to; i++) {
  total += Buffer.byteLength(lines[i], "utf8") + 2;
  cum.set(i + 1, total);
}

const target = total / n;
const picks = [from];
for (let k = 1; k < n; k++) {
  const want = target * k;
  let best = starts[0];
  for (const s of starts) if (Math.abs(cum.get(s) - want) < Math.abs(cum.get(best) - want)) best = s;
  picks.push(best);
}
picks.push(to + 1);

for (let k = 0; k < n; k++) {
  const a = picks[k];
  const b = picks[k + 1] - 1;
  const bytes = cum.get(b) - (cum.get(a - 1) ?? cum.get(from - 1) ?? 0);
  console.log(`part ${k + 1}: ${a}-${b}  ${(bytes / 1024).toFixed(1)} KB   ${lines[a - 1].trim().slice(0, 90)}`);
}
console.log(`total ${(total / 1024).toFixed(1)} KB`);
