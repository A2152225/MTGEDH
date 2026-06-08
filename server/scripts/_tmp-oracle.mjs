import fs from 'fs';
const cards = JSON.parse(fs.readFileSync('../oracle-cards.json', 'utf8'));
const names = [
  "Kaya, Spirits' Justice",
  'Psychogenic Probe',
  'Necropolis of Azar',
  'Genju of the Realm',
  'Deeproot Pilgrimage',
  'Pedantic Learning',
  'Mana Max, Afterburner',
  'Opal Avenger',
  'Erebos\'s Titan',
  'Tom, Bert, and William',
];
for (const n of names) {
  const card = cards.find((x) => x.name === n);
  if (!card) { console.log('MISSING', n); continue; }
  const text = [card.oracle_text, ...(card.card_faces || []).map((f) => f.oracle_text)].filter(Boolean).join('\n');
  console.log('---', n);
  const triggers = text.match(/(?:when|whenever|at the beginning)[^.]+/gi);
  console.log(triggers?.join('\n') || text.slice(0, 300));
}
