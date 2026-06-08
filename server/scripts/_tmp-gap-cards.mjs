import fs from 'node:fs';
const cards = JSON.parse(fs.readFileSync(new URL('../../oracle-cards.json', import.meta.url), 'utf8'));
const names = [
  'Phyrexian Atlas',
  'City of Brass',
  'Ember Swallower',
  'Grim Giganotosaurus',
  'Herd Baloth',
  'Evolution Witness',
  'Scythe of the Wretched',
  'Bushi Tenderfoot // Kenzo the Hardhearted',
];
for (const name of names) {
  const c = cards.find((x) => x.name === name);
  console.log('---', name, '---');
  console.log(c?.oracle_text || 'MISSING');
  if (c?.card_faces) {
    for (const f of c.card_faces) console.log('FACE', f.name, ':', f.oracle_text);
  }
}
