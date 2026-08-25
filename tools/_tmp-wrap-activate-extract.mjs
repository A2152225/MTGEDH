#!/usr/bin/env node
/**
 * Post-process a tryHandleActivate* leaf written by extract-ts-cluster:
 * CRLF -> LF, 2-space dedent of the moved body, bare `return;` -> `return true;`.
 *
 * Usage: node tools/_tmp-wrap-activate-extract.mjs <leaf.ts>
 */
import fs from 'node:fs';

const file = process.argv[2];
if (!file) {
  console.error('usage: node tools/_tmp-wrap-activate-extract.mjs <leaf.ts>');
  process.exit(1);
}

const original = fs.readFileSync(file);
let text = original.toString('utf8').replace(/\r\n/g, '\n').replace(/\r/g, '\n');

const ctxEnd = text.search(/\} = ctx;\n\n/);
if (ctxEnd < 0) {
  console.error('could not find `} = ctx;` followed by a blank line');
  process.exit(1);
}
const bodyStart = ctxEnd + '} = ctx;\n\n'.length;

const footerMatch = text.lastIndexOf('\n  return false;\n}');
if (footerMatch < 0 || footerMatch < bodyStart) {
  console.error('could not find trailing `return false;` footer');
  process.exit(1);
}

const header = text.slice(0, bodyStart);
let body = text.slice(bodyStart, footerMatch);
const footer = text.slice(footerMatch);

const bodyLines = body.split('\n');
for (let i = 0; i < bodyLines.length; i += 1) {
  const line = bodyLines[i];
  if (line.length === 0) continue;
  if (!line.startsWith('  ')) {
    console.error(`dedent assert failed at body line ${i + 1}: ${JSON.stringify(line.slice(0, 80))}`);
    process.exit(1);
  }
  bodyLines[i] = line.slice(2);
}

body = bodyLines.join('\n').replace(/^(\s*)return;/gm, '$1return true;');

let next = header + body + footer;
// Dynamic imports in the moved body were written relative to socket/interaction.ts.
next = next.replaceAll("await import('../", "await import('../../");
next = next.replaceAll('await import("../', 'await import("../../');
next = next.replaceAll("await import('./", "await import('../");
next = next.replaceAll('await import("./', 'await import("../');
const out = next.endsWith('\n') ? next : `${next}\n`;
fs.writeFileSync(file, out, 'utf8');
console.log(`wrapped ${file}: ${original.length} B -> ${Buffer.byteLength(out, 'utf8')} B (LF)`);
