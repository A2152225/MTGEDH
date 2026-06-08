import { readFileSync } from 'fs';

const audit = JSON.parse(readFileSync('scripts/out/trigger-coverage-audit.json', 'utf8'));
const patterns = (audit.topPatterns || []).filter((p: any) =>
  Array.isArray(p.notDetectedExamples) && p.notDetectedExamples.length > 0
);
console.log(`patterns with notDetectedExamples: ${patterns.length}`);
for (const p of patterns.slice(0, 40)) {
  console.log(`\n[${p.event}] ${p.templateKey} (${p.count}, rate=${p.detectionRate})`);
  console.log(`  missing: ${p.notDetectedExamples.slice(0, 5).join(', ')}`);
  console.log(`  sample: ${String(p.sampleEffect || '').slice(0, 90)}`);
}
