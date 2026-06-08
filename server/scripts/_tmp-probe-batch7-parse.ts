import { readFileSync } from 'fs';
import { parseTriggeredAbilitiesFromText } from '../../rules-engine/src/triggeredAbilitiesParsing.ts';

const audit = JSON.parse(readFileSync('scripts/out/trigger-coverage-audit.json', 'utf8'));
const cards = JSON.parse(readFileSync(audit.meta.oraclePath, 'utf8')) as Array<{
  name: string;
  oracle_text?: string;
  card_faces?: Array<{ oracle_text?: string }>;
}>;

const wants = [
  'Surrak, Elusive Hunter',
  'Imprison This Insolent Wretch',
  'Soul Shredder',
  'Warped Devotion',
  'Wax-Wane Witness',
  'Voltaic Visionary',
  'Unleash the Flux',
  'Optimus Prime, Hero',
  'Hold the Perimeter',
  "Captain's Hook",
  'Ellie, Brick Master',
  'Cry of Contrition',
  'Veteran Motorist',
  'Kheru Bloodsucker',
  'Nest of Scarabs',
  'Tamiyo, Inquisitive Student',
  'Icewrought Sentry',
  'Azra Oddsmaker',
  'Stormfront Riders',
  'Ray Fillet, Wave Warrior',
  'Chainsaw',
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
  console.log(oracle.split('\n').find((l) => /when(?:ever)?|at the beginning/i.test(l)) || oracle.slice(0, 200));
  for (const t of parsed.filter((x) => x.event)) {
    console.log(`  ${t.event} | ${t.condition || t.triggerFilter || '(empty)'}`);
  }
}
