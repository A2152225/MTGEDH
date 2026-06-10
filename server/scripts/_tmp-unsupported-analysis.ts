import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const audit = JSON.parse(fs.readFileSync(path.join(__dirname, 'out/executor-coverage-audit.json'), 'utf8'));

const patterns = new Map<string, { count: number; examples: string[]; reasons: Record<string, number> }>();

for (const item of audit.items || []) {
  if (item.status !== 'unsupported') continue;
  const key = String(item.templateKey || item.sampleEffect || 'unknown').slice(0, 100);
  const entry = patterns.get(key) || { count: 0, examples: [], reasons: {} };
  entry.count += 1;
  if (entry.examples.length < 3) entry.examples.push(item.cardName);
  for (const [code, n] of Object.entries(item.reasonCodes || {})) {
    entry.reasons[code] = (entry.reasons[code] || 0) + Number(n);
  }
  patterns.set(key, entry);
}

const sorted = [...patterns.entries()].sort((a, b) => b[1].count - a[1].count);
console.log('unsupported items', (audit.items || []).filter((i: any) => i.status === 'unsupported').length);
console.log('unique patterns', sorted.length);
for (const [key, v] of sorted.slice(0, 40)) {
  console.log(`\n[${v.count}] ${key}`);
  console.log('  e.g.', v.examples.join(', '));
  console.log('  reasons', v.reasons);
}
