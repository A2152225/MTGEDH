import fs from 'node:fs';

const parentPath = 'server/src/socket/ai.ts';
const bodyPath = 'tools/_extract_ai/snapshot-body-restore.txt';
const parent = fs.readFileSync(parentPath);
const parentText = parent.toString('utf8');
const bodyLf = fs.readFileSync(bodyPath, 'utf8').replace(/\r\n/g, '\n');
const body = bodyLf.replace(/\n/g, '\r\n');
const marker = 'function didAIAbilityActivationProgress';
const idx = parentText.indexOf(marker);
if (idx < 0) {
  console.error('marker not found');
  process.exit(1);
}
const insert = body.endsWith('\r\n') ? body + '\r\n' : body + '\r\n';
const next = parentText.slice(0, idx) + insert + parentText.slice(idx);
fs.writeFileSync(parentPath, next);
console.log('restored snapshot body at', idx, 'new size', next.length);
