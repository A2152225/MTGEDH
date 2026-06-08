import { readFileSync } from 'fs';
import { parseTriggeredAbilitiesFromText } from '../../rules-engine/src/triggeredAbilitiesParsing.js';

const audit = JSON.parse(readFileSync('scripts/out/trigger-coverage-audit.json', 'utf8'));
const oraclePath = audit.meta.oraclePath;
const cards = JSON.parse(readFileSync(oraclePath, 'utf8'));
const cardByName = new Map(cards.map((c: any) => [String(c.name), c]));

// Import audit helpers dynamically - simpler: scan patterns from notDetectedByEvent
console.log('notDetectedByEvent:', JSON.stringify(audit.notDetectedByEvent, null, 2).slice(0, 2000));

const patterns = (audit.topPatterns || []).filter((p: any) =>
  Array.isArray(p.statuses) && p.statuses.includes('not_detected') ||
  (p.detectionRate !== undefined && p.detectionRate < 1)
);
console.log(`\npatterns with gaps: ${patterns.length}`);
for (const p of patterns.slice(0, 25)) {
  console.log(`[${p.event}] ${p.templateKey} count=${p.count} rate=${p.detectionRate} missing=${(p.notDetectedExamples || []).slice(0,3).join(', ')}`);
}
