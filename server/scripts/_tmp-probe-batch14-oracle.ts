import { readFileSync } from 'fs';

const audit = JSON.parse(readFileSync('scripts/out/trigger-coverage-audit.json', 'utf8'));
const cards = JSON.parse(readFileSync(audit.meta.oraclePath, 'utf8'));
const wants = [
  'Rising Populace',
  'Hooded Blightfang',
  'The Serpent Society',
  'Undercity // The Initiative',
  'Bladehold Cleaver',
  'The Belligerent and Useless Island',
  'Semblance Scanner',
  'Stensia',
  "Nadier's Nightblade",
  'Ghoulish Procession',
  'Bubbling Muck',
  'Saradoc, Master of Buckland',
  'Arnyn, Deathbloom Botanist',
  'The Council of Four',
  'Kraven the Hunter',
  'Sokka, Lateral Strategist',
  'Archangel Avacyn // Avacyn, the Purifier',
  'Yomiji, Who Bars the Way',
  'Al Bhed Salvagers',
  'Vodalian Tide Mage',
  'Compost',
  'Rinoa, Angel Wing',
  'Skemfar Avenger',
  'Aang and Katara',
  'Hordewing Skaab',
  'Hythonia the Cruel',
  "April O'Neil, Live on the Scene",
  'The Roaring Toeclaws',
  'Knucklebone Witch',
  'Grievous Wound',
  'Avalanche of Sector 7',
  "Adriana's Valor",
  'Mary Read and Anne Bonny',
  'Species Specialist',
  'Favored Enemy',
  'Math is for Blockers',
  'Crude Abattoir',
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
