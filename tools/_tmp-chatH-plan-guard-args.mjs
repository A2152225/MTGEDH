import fs from "node:fs";

// Chat H scratch: for a guard range being lifted out of applyMoveZoneStep, list the outer
// names it reads, split into the two selector bundles vs. plain function locals.
// Usage: node tools/_tmp-chatH-plan-guard-args.mjs <fromLine> <toLine>
const FILE = "rules-engine/src/oracleIRExecutorMoveZoneStepHandlers.ts";
const from = Number(process.argv[2]);
const to = Number(process.argv[3]);
const lines = fs.readFileSync(FILE, "utf8").split(/\r?\n/);
const text = lines.slice(from - 1, to).join("\n");

const bundleNames = (file) => {
  const src = fs.readFileSync(file, "utf8").split(/\r?\n/);
  const at = src.findIndex((l) => l === "  return {");
  const out = [];
  for (let i = at + 1; i < src.length && src[i] !== "  };"; i++) out.push(src[i].trim().replace(/,$/, ""));
  return out;
};
const zone = bundleNames("rules-engine/src/oracleIRExecutorMoveZoneWhatParsersZoneQueries.ts");
const ref = bundleNames("rules-engine/src/oracleIRExecutorMoveZoneWhatParsersReferenceQueries.ts");

// Outer locals declared at depth 1 before the range.
const locals = [];
for (let i = 0; i < from - 1; i++) {
  const m = /^  (?:const|let)\s+([A-Za-z_$][\w$]*)/.exec(lines[i]);
  if (m) locals.push(m[1]);
}

const used = (n) => new RegExp(`\\b${n}\\b`).test(text);
const zoneUsed = zone.filter(used);
const refUsed = ref.filter(used);
const bundle = new Set([...zone, ...ref]);
const otherUsed = locals.filter((n) => !bundle.has(n) && used(n));

console.log(`zoneQueries (${zoneUsed.length}):\n  ${zoneUsed.join(", ")}\n`);
console.log(`referenceQueries (${refUsed.length}):\n  ${refUsed.join(", ")}\n`);
console.log(`other locals (${otherUsed.length}):\n  ${otherUsed.join(", ")}\n`);
for (const p of ["state", "step", "ctx", "runtime"]) console.log(`param ${p}: ${used(p)}`);
