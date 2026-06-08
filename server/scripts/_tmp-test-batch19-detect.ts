import { readFileSync } from 'fs';
import { serverDetectsTrigger } from './trigger-coverage-audit.js';
import { parseTriggeredAbilitiesFromText } from '../../rules-engine/src/triggeredAbilitiesParsing.js';

const audit = JSON.parse(readFileSync('scripts/out/trigger-coverage-audit.json', 'utf8'));
const cards = JSON.parse(readFileSync(audit.meta.oraclePath, 'utf8'));

const wants = [
  'Éomer, Marshal of Rohan',
  'Thopter Shop',
  'Summon: Leviathan',
  'Tadeas, Juniper Ascendant',
  'Thoughtleech',
  'Flayer of the Hatebound',
  'A-Skemfar Avenger',
  'Senu, Keen-Eyed Protector',
  'The Dragon-Kami Reborn',
  'Syr Carah, the Bold',
  'Dark Leo & Shredder',
  'Paliano',
  'Magnetic Web',
  'Ever-Watching Threshold',
  'Fumulus, the Infestation',
  'Keeper of Fables',
  'Alharu, Solemn Ritualist',
  'Curse of Obsession',
  'Ruby Collector',
  'Haunting Wind',
  'Soundwave, Sonic Spy',
  "Hunter's Insight",
  "Vraska, Swarm's Eminence",
  "War's Toll",
  'Warrior',
  'Tameshi, Reality Architect',
  'Turn Inside Out',
  'Acidic Dagger',
  'Devouring Tendrils',
  'Coffin Queen',
  'The Caffeinated Runner',
  'Sledge-Class Seedship',
  'A-Stitched Assistant',
  'Scalar Scholar',
];

for (const want of wants) {
  const matches = cards.filter(
    (x: { name: string; layout?: string }) =>
      x.name.toLowerCase().includes(want.toLowerCase()) && x.layout !== 'art_series',
  );
  const c = matches.find((x: { name: string }) => x.name === want) || matches[0];
  if (!c) {
    console.log('MISS', want);
    continue;
  }
  const o = c.card_faces
    ? c.card_faces.map((f: { oracle_text?: string }) => f.oracle_text).filter(Boolean).join('\n')
    : c.oracle_text;
  const parsed = parseTriggeredAbilitiesFromText(o, 'SRC', 'P1', c.name);
  const misses = parsed.filter((t) => !serverDetectsTrigger(c, t));
  if (misses.length) {
    console.log(`\n=== ${c.name} ===`);
    for (const m of misses) {
      console.log(' ', m.event, '|', (m.condition || m.triggerFilter || '').slice(0, 100));
    }
  }
}
