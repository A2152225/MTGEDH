import { readFileSync } from 'fs';

const audit = JSON.parse(readFileSync('scripts/out/trigger-coverage-audit.json', 'utf8'));
const cards = JSON.parse(readFileSync(audit.meta.oraclePath, 'utf8'));

const wants = [
  'Overseer of Vault 76',
  'Night Dealings',
  'Subira, Tulzidi Caravanner',
  'Fire Nation Salvagers',
  'Mazzy, Truesword Paladin',
  "Xander's Wake",
  'Archivist of Gondor',
  'Fecund Greenshell',
  'Lavaleaper',
  'Lifeblood',
  'Kithkin Mourncaller',
  'Slagstone Refinery',
  'Keeper of Progenitus',
  'Moonshadow',
  'Arbaaz Mir',
  'Concealing Curtains',
  "Pharika's Spawn",
  'Lolth, Spider Queen Emblem',
  'Auntie Blyte, Bad Influence',
  'Ironsoul Enforcer',
  'Xathrid Necromancer',
  'Ognis, the Dragon\'s Lash',
  'Malfegor Avatar',
  'Zurzoth, Chaos Rider',
  'Wolfkin Outcast',
  'Athreos, God of Passage',
  'Leyline Phantom',
  'Kaust, Eyes of the Glade',
  'Inniaz, the Gale Force',
  "Vivien's Stampede",
  'Sonic the Hedgehog',
  'Twilight Drover',
  'Hired Heist',
  'Resolute Veggiesaur',
  'Ravenous Rotbelly',
  'Unnatural Summons',
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
