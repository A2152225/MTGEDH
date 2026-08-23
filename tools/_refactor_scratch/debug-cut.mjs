import fs from 'node:fs';
const src = fs.readFileSync('D:/Git/MTGEDH/server/src/socket/resolution.ts', 'utf8').replace(/\r\n/g, '\n');
const name = 'isTrueLibrarySearchStep';
const p = new RegExp(`\\nfunction ${name}\\(`, 'm');
const m = p.exec(src);
const start = m.index + 1;
const openParen = src.indexOf('(', start);
const openBrace = src.indexOf('{', openParen);
console.log({ start, openParen, openBrace, snippet: src.slice(start, start + 80) });

let depth = 0, i = openBrace, inStr = null, inLineComment = false, inBlockComment = false, escape = false;
for (; i < src.length; i++) {
  const ch = src[i], next = src[i + 1];
  if (inLineComment) { if (ch === '\n') inLineComment = false; continue; }
  if (inBlockComment) { if (ch === '*' && next === '/') { inBlockComment = false; i++; } continue; }
  if (inStr) {
    if (escape) { escape = false; continue; }
    if (ch === '\\') { escape = true; continue; }
    if (ch === inStr) inStr = null;
    continue;
  }
  if (ch === '/' && next === '/') { inLineComment = true; i++; continue; }
  if (ch === '/' && next === '*') { inBlockComment = true; i++; continue; }
  if (ch === '"' || ch === "'" || ch === '`') { inStr = ch; continue; }
  if (ch === '{') depth++;
  else if (ch === '}') {
    depth--;
    if (depth === 0) { i++; break; }
  }
}
console.log({ end: i, bytes: i - start, endSnippet: src.slice(i - 20, i + 40), stillHasRegister: src.slice(0, start).includes('export function registerResolutionHandlers') + ' before, after cut region has ' + src.slice(i).includes('export function registerResolutionHandlers') });
