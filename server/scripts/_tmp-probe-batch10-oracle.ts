import { readFileSync } from 'fs';

const audit = JSON.parse(readFileSync('scripts/out/trigger-coverage-audit.json', 'utf8'));
const cards = JSON.parse(readFileSync(audit.meta.oraclePath, 'utf8'));
const wants = [
  'Bebop, Porcine Punk',
  'Kitt Kanto',
  'Jennifer Walters',
  'Sefris of the Hidden Ways',
  'Fynn, the Fangbearer',
  "The Raven's Warning",
  'Warbeast of Gorgoroth',
  'Glacial Dragonhunt',
  'Centaur Vinecrasher',
  "Puca's Covenant",
  'Pawn of Ulamog',
  'Malcolm, Keen-Eyed Navigator',
  'Vraan, Executioner Thane',
  'Greatbow Doyen',
  'Soul Servitude',
  'Vigorous Charge',
  'Flame Channeler',
];

for (const want of wants) {
  const c = cards.find((x: { name: string; layout?: string }) => (x.name === want || x.name.startsWith(want)) && x.layout !== 'art_series');
  if (!c) {
    console.log('MISS', want);
    continue;
  }
  const o = c.card_faces ? c.card_faces.map((f: { oracle_text?: string }) => f.oracle_text).filter(Boolean).join('\n') : c.oracle_text;
  console.log(`\n=== ${c.name} ===\n${o}\n`);
}
