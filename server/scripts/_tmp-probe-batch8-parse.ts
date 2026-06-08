import { readFileSync } from 'fs';
import { parseTriggeredAbilitiesFromText } from '../../rules-engine/src/triggeredAbilitiesParsing.ts';

const audit = JSON.parse(readFileSync('scripts/out/trigger-coverage-audit.json', 'utf8'));
const cards = JSON.parse(readFileSync(audit.meta.oraclePath, 'utf8')) as Array<{
  name: string;
  oracle_text?: string;
  card_faces?: Array<{ oracle_text?: string }>;
}>;

const wants = [
  'Willbreaker',
  'Skophos Maze-Warden',
  'Frie, Displaced in Time',
  "Agatha's Soul Cauldron",
  'Dirtcowl Wurm',
  'Cosima, God of the Voyage',
  'Gemcutter Buccaneer',
  'Firkraag, Cunning Instigator',
  "Norn's Decree",
  'Touch of the Horned God',
  'Erestor of the Council',
  'The Skullspore Nexus',
  'Tattered Ratter',
  'Suppressor Skyguard',
  'Scourge of Valkas',
  'Keral Keep Disciples',
  "Rowan's Talent",
  'Pangosaur',
];

function oracleOf(card: (typeof cards)[0]): string {
  const faces = card.card_faces;
  return Array.isArray(faces) && faces.length
    ? faces.map((f) => f.oracle_text || '').filter(Boolean).join('\n')
    : String(card.oracle_text || '');
}

for (const want of wants) {
  const card = cards.find((c) => c.name === want || c.name.startsWith(want));
  if (!card) {
    console.log(`MISSING ${want}`);
    continue;
  }
  const oracle = oracleOf(card);
  const parsed = parseTriggeredAbilitiesFromText(oracle, 'SRC', 'P1', card.name);
  console.log(`\n=== ${card.name} ===`);
  for (const line of oracle.split('\n').filter((l) => /when(?:ever)?|at the beginning|landfall/i.test(l))) {
    console.log('>', line.replace(/\s+/g, ' ').slice(0, 140));
  }
  for (const t of parsed.filter((x) => x.event)) {
    console.log(`  ${t.event} | ${t.condition || t.triggerFilter || '(empty)'}`);
  }
}
