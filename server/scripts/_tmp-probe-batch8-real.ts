import { readFileSync } from 'fs';
import { parseTriggeredAbilitiesFromText } from '../../rules-engine/src/triggeredAbilitiesParsing.ts';

const audit = JSON.parse(readFileSync('scripts/out/trigger-coverage-audit.json', 'utf8'));
const cards = JSON.parse(readFileSync(audit.meta.oraclePath, 'utf8')) as Array<{
  name: string;
  layout?: string;
  oracle_text?: string;
  card_faces?: Array<{ name?: string; oracle_text?: string }>;
}>;

const wants = [
  "Agatha's Soul Cauldron",
  'Cosima, God of the Voyage',
  "Norn's Decree",
  'Tattered Ratter',
  'Evin, Waterdeep Opportunist',
];

for (const want of wants) {
  const matches = cards.filter((c) => c.name.includes(want) && c.layout !== 'art_series');
  console.log(`\n=== matches for ${want}: ${matches.length} ===`);
  for (const card of matches.slice(0, 3)) {
    const oracle = card.card_faces?.map((f) => f.oracle_text || '').filter(Boolean).join('\n') || card.oracle_text || '';
    console.log(card.name, card.layout);
    console.log(oracle.slice(0, 400));
    for (const t of parseTriggeredAbilitiesFromText(oracle, 'S', 'P', card.name).filter((x) => x.event)) {
      console.log(' ', t.event, '|', t.condition || t.triggerFilter || '(empty)');
    }
  }
}
