import { readFileSync } from 'fs';

const audit = JSON.parse(readFileSync('scripts/out/trigger-coverage-audit.json', 'utf8'));
const cards = JSON.parse(readFileSync(audit.meta.oraclePath, 'utf8'));
const wants = [
  'Curse of the Restless Dead',
  'Shadow the Hedgehog',
  "G'raha Tia",
  'Donna Noble',
  'Voidwing Hybrid',
  'Indoraptor, the Perfect Hybrid',
  'Skola Grovedancer',
  'Talon of Pain',
  'Ratatwotwo',
  'The Clone Saga',
  'Zurgo Stormrender',
  'Niv-Mizzet Reborn',
  'Jaws, Relentless Predator',
  'Dross Scorpion',
  'Tamanoa',
  'Oskar, Rubbish Reclaimer',
  'Ramses, Assassin Lord',
  'Quartzwood Crasher',
  'Wrathful Red Dragon',
  "Ajani's Last Stand",
  'Omnath, Locus of Rage',
  'Anje, Maid of Dishonor',
  'Vela the Night-Clad',
  'Lobelia Sackville-Baggins',
  'Judge Magister Gabranth',
  'Tahngarth, First Mate',
  'Wooden Stake',
  'Mavren Fein, Dusk Apostle',
  'Wrathful Raptors',
  'Calix, Guided by Fate',
  'Guardian of the Ages',
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
