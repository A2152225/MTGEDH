#!/usr/bin/env node
import fs from 'node:fs';

const file = process.argv[2];
if (!file) process.exit(1);
let text = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
text = text.replace(/^([ \t]*)(export\s+)?function /gm, (full, indent, exp) => {
  if (exp) return full;
  return `${indent}export function `;
});
if (!text.endsWith('\n')) text += '\n';
fs.writeFileSync(file, text);
console.log(`exported functions + LF: ${file} ${Buffer.byteLength(text)} B`);
