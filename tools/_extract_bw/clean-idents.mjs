#!/usr/bin/env node
import { spawnSync } from 'node:child_process';

const skip = new Set([
  'if', 'for', 'const', 'let', 'return', 'else', 'type', 'function', 'class',
  'new', 'void', 'null', 'undefined', 'true', 'false', 'this', 'typeof',
  'action', 'amount', 'card', 'cards', 'count', 'effect', 'effects', 'filter',
  'format', 'gameId', 'index', 'label', 'message', 'mode', 'options', 'payment',
  'phase', 'playerId', 'reason', 'source', 'sourceId', 'sourceName', 'step',
  'targets', 'title', 'type_line', 'typeLine', 'window', 'socket', 'debug',
  'description', 'imageUrl', 'stepId', 'permanentId',
]);

const [, , file, start, end] = process.argv;
const r = spawnSync(process.execPath, ['tools/_extract_bw/list-idents.mjs', file, start, end], {
  encoding: 'utf8',
});
const names = [];
for (const line of r.stdout.split('\n')) {
  const m = /^\s+([A-Za-z_$][\w$]*)\s+\(decl/.exec(line);
  if (!m) continue;
  if (skip.has(m[1])) continue;
  names.push(m[1]);
}
console.log(names.join('\n'));
console.error(`${names.length} idents`);
