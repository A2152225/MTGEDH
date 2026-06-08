import { readFileSync } from 'fs';

const audit = JSON.parse(readFileSync('scripts/out/trigger-coverage-audit.json', 'utf8'));
const cards = JSON.parse(readFileSync(audit.meta.oraclePath, 'utf8'));
const wants = [
  'Slaughter Singer',
  'Francisco, Fowl Marauder',
  'Essence Sliver',
  'Lazotep Sliver',
  'Treasure Nabber',
  'Jerren, Corrupted Bishop',
  'Ezio, Blade of Vengeance',
  'Grand Marshal Macie',
  'Burning Earth',
  'Lurking Skirge',
  'Salt Road Ambushers',
  'Eloren Wilds',
  'Soulcatcher',
  'Evie Frye',
  'Stensian Sanguinist',
  'Ajani, Nacatl Pariah',
  'Dungeon Crawler',
  "Valkyrie's Call",
  'Vengeful Dead',
  'Disa the Restless',
  'Luminous Broodmoth',
  'Adarkar Valkyrie',
  'Roots of Life',
  "Edgar's Awakening",
  'Dorothea, Vengeful Victim',
  'Sanctimony',
  'Kazarov, Sengir Pureblood',
  'The Master, Mesmerist',
  'Yarus, Roar of the Old Gods',
  'Prowess of the Fair',
  'Kutzil, Malamet Exemplar',
  'Argent Dais',
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
