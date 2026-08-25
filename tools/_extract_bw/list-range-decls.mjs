#!/usr/bin/env node
import fs from 'node:fs';

const [, , file, startArg, endArg] = process.argv;
const start = Number(startArg);
const end = Number(endArg);
const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
const names = [];
for (let i = start - 1; i < end && i < lines.length; i += 1) {
  const line = lines[i];
  const fn = /^  const ([A-Za-z_$][\w$]*)\s*=/.exec(line);
  if (fn) names.push(fn[1]);
  const state = /^  const \[([^\]]+)\]\s*=/.exec(line);
  if (state) {
    for (const raw of state[1].split(',')) {
      const name = raw.trim();
      if (name) names.push(name);
    }
  }
}
console.log(names.join('\n'));
console.error(`${names.length} decls`);
