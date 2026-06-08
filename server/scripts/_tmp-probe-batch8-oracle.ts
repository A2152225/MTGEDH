import { readFileSync } from 'fs';

const audit = JSON.parse(readFileSync('scripts/out/trigger-coverage-audit.json', 'utf8'));
const cards = JSON.parse(readFileSync(audit.meta.oraclePath, 'utf8')) as Array<{
  name: string;
  oracle_text?: string;
  card_faces?: Array<{ oracle_text?: string }>;
}>;

const wants = [
  "Agatha's Soul Cauldron",
  'Cosima, God of the Voyage',
  'The Omenkeel',
  "Norn's Decree",
  'Avatar Roku, Firebender',
  'Tattered Ratter',
  'Simian Sling',
  'Setzer, Wandering Gambler',
  'Hidden Stag',
  'Jaws, Relentless Predator',
  'Curse of Hospitality',
  'Mirelurk Queen',
  'Because I Have Willed It',
];

for (const want of wants) {
  const card = cards.find((c) => c.name === want || c.name.startsWith(want));
  if (!card) {
    console.log(`MISSING ${want}`);
    continue;
  }
  const oracle = Array.isArray(card.card_faces) && card.card_faces.length
    ? card.card_faces.map((f) => f.oracle_text || '').filter(Boolean).join('\n---\n')
    : String(card.oracle_text || '');
  console.log(`\n=== ${card.name} ===\n${oracle}`);
}
