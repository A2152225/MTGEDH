#!/usr/bin/env node
/**
 * Fix imports under server/src/state that point at local "types" folders.
 *
 * Usage:
 *   node server/scripts/FixImports.cjs
 *
 * Creates .bak of each changed file.
 */

const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();
const TARGET_DIR = path.join(ROOT, "server", "src", "state");
const SHARED_BARREL = path.join(ROOT, "shared", "src"); // will be converted to posix import

if (!fs.existsSync(TARGET_DIR)) {
  console.error("server/src/state directory not found. Run this from repo root.");
  process.exit(2);
}

function toPosix(p) {
  return p.split(path.sep).join("/");
}

function computeReplacementImport(filePath) {
  const dir = path.dirname(filePath);
  let rel = path.relative(dir, SHARED_BARREL);
  if (!rel) rel = ".";
  rel = toPosix(rel);
  if (!rel.startsWith(".")) rel = "./" + rel;
  return rel;
}

function processFile(filePath) {
  const orig = fs.readFileSync(filePath, "utf8");
  // match import ... from './types' or '../types' or '../foo/types' etc.
  const importRegex = /from\s+(['"])(\.\.?(?:\/[^'"]*)*\/types)(['"])/g;
  let changed = false;
  const newContent = orig.replace(importRegex, (m, q1, p, q3) => {
    const replacement = computeReplacementImport(filePath);
    const newSpec = `${q1}${replacement}${q3}`;
    if (m !== `from ${newSpec}`) changed = true;
    return `from ${newSpec}`;
  });

  if (changed) {
    const bak = filePath + ".bak";
    if (!fs.existsSync(bak)) fs.writeFileSync(bak, orig, "utf8");
    fs.writeFileSync(filePath, newContent, "utf8");
    return true;
  }
  return false;
}

function collectTsFiles(dir) {
  const out = [];
  const items = fs.readdirSync(dir, { withFileTypes: true });
  for (const it of items) {
    if (it.name === "node_modules") continue;
    const full = path.join(dir, it.name);
    if (it.isDirectory()) {
      out.push(...collectTsFiles(full));
    } else if (it.isFile() && full.endsWith(".ts")) {
      out.push(full);
    }
  }
  return out;
}

const files = collectTsFiles(TARGET_DIR);
console.log(`Scanning ${files.length} .ts files under ${TARGET_DIR} ...`);

const modified = [];
for (const f of files) {
  try {
    if (processFile(f)) modified.push(f);
  } catch (err) {
    console.error("Failed to process", f, err);
  }
}

console.log(`\nDone. Modified ${modified.length} files.`);
if (modified.length) {
  for (const m of modified) console.log("  CHANGED:", path.relative(ROOT, m));
  console.log("\nBackups saved as <file>.bak next to each modified file.");
  console.log("Now run: tsx watch src/index.ts (or your normal dev command).");
} else {
  console.log("No files needed changes (imports already referenced shared/src).");
}