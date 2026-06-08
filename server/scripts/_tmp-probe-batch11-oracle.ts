import { readFileSync } from 'fs';

const audit = JSON.parse(readFileSync('scripts/out/trigger-coverage-audit.json', 'utf8'));
const cards = JSON.parse(readFileSync(audit.meta.oraclePath, 'utf8'));
const wants = [
  'Silverfur Partisan',
  'Fugitive Druid',
  'Extraplanar Lens',
  'Search the City',
  'Alibou, Ancient Witness',
  'Aloy, Savior of Meridian',
  'Ink-Eyes, Servant of Oni Avatar',
  'Seshiro the Anointed Avatar',
  'One with the Kami',
  'Tyranid Harridan',
  'Don & Raph, Hard Science',
  'Jareth, Leonine Titan',
  'Fangorn, Tree Shepherd',
  'Efteekay, Flame of the Kav',
  'Perimeter Captain',
  'The Dogronmaster',
  'Rhuk, Hexgold Nabber',
  'Costume Closet',
  'Nyssa of Traken',
  'War Elemental',
  'The Zassacre Zirl',
  'Phage the Untouchable',
  'Alrund, God of the Cosmos',
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
