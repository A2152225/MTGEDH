import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const report = JSON.parse(
  fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'out/executor-coverage-audit.json'), 'utf8'),
);

for (const p of report.topGapPatterns || []) {
  if (!p.statuses?.includes('partial')) continue;
  console.log('\n---', p.count, p.exampleCards?.join(', '));
  console.log(p.sampleEffect?.slice(0, 140));
}
