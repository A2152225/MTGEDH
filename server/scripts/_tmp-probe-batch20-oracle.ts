import { readFileSync } from 'fs';

const audit = JSON.parse(readFileSync('scripts/out/trigger-coverage-audit.json', 'utf8'));
const cards = JSON.parse(readFileSync(audit.meta.oraclePath, 'utf8'));

const wants = [
  'Curse of Clinging Webs',
  'Goldbug, Humanity',
  'Reyav, Master Smith',
  'Psychic Possession',
  'Trophy Hunter',
  'Cunning',
  'Imodane, the Pyrohammer',
  'Night Shift of the Living Dead',
  'Kediss, Emberclaw Familiar',
  'Calibrated Blast',
  'Rat King, Pale Piper',
  'Paradox Haze',
  'Doran, Besieged by Time',
  'Godsend',
  'The Ghoul, Gunslinger',
  'Task Mage Assembly',
  'Carth the Lion',
  'Bounty Board',
  'Chicken à la King',
  'Confusion in the Ranks',
  "Winter's Night",
  'Daru Spiritualist',
  "Fire Giant's Fury",
  "Dollmaker's Shop",
  'Havengul Laboratory',
  'Vaultborn Tyrant',
  'Alluring Suitor',
  'The Swarmlord',
  'Ward of Lights',
  'River Kelpie',
  'Spawning Kraken',
  'Earth Rumble',
  'Gorilla Tactics',
  'Tenuous Truce',
  'A-Stitched Assistant',
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
  console.log(`\n=== ${c.name} ===\n${o}\n`);
}
