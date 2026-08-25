#!/usr/bin/env node
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

const [, , file, startArg, endArg] = process.argv;
const start = Number(startArg);
const end = Number(endArg);
const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
const body = lines.slice(start - 1, end).join('\n');
const bindings = spawnSync(process.execPath, ['tools/_extract_bw/app-bindings-fixed.mjs', file], {
  encoding: 'utf8',
}).stdout.trim().split('\n').filter(Boolean);

const used = [];
for (const name of bindings) {
  if (new RegExp(`\\b${name.replace(/\\$/g, '\\$')}\\b`).test(body)) used.push(name);
}
console.log(used.join('\n'));
console.error(`${used.length} used bindings`);
