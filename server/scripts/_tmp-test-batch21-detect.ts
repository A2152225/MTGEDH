import { readFileSync } from 'fs';
import { serverDetectsTrigger } from './trigger-coverage-audit.js';
import { parseTriggeredAbilitiesFromText } from '../../rules-engine/src/triggeredAbilitiesParsing.js';

const audit = JSON.parse(readFileSync('scripts/out/trigger-coverage-audit.json', 'utf8'));
const cards = JSON.parse(readFileSync(audit.meta.oraclePath, 'utf8'));

const wants = [
  'Sapphire Charm',
  'Bladehold Cleaver',
  'Emet-Selch of the Third Seat',
  'Library of Lat-Nam',
  'Hawkeye, Master Marksman',
  'Valentin, Dean of the Vein',
  'Unnatural Summons',
  "Sorin's Remastered Manor",
  'Cunning',
  'Earth Rumble',
  'Sleuth Instructor',
  'Belbe, Corrupted Observer',
  'Leatherhead, Sewer Gator',
  'Mechtitan Core',
  'Desperate Measures',
  'Fludge, Gunk Guardian',
  'Wake Thrasher',
  'Ambiguity',
  "Beastmaster's Magemark",
  'Unblinking Bleb',
  'Rewrite History',
  'Sliver Queen Avatar',
  'Caught in the Brights',
  'Illicit Masquerade',
  'Death Tyrant',
  'Energy Field',
  "Thassa's Emissary",
  'Pest',
  'Spiteful Banditry',
  'Rainbow Dash',
  'Harsh Justice',
  'Invader Parasite',
  'Master Symmetrist',
  'Dread Tiller',
  "Freyalise's Winds",
  'Firesong and Sunspeaker',
];

for (const want of wants) {
  const c = cards.find(
    (x: { name: string; layout?: string }) =>
      (x.name === want || x.name.startsWith(want)) && x.layout !== 'art_series',
  );
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
