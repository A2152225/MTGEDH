import fs from 'fs';

const cards = JSON.parse(fs.readFileSync('D:/Git/MTGEDH/oracle-cards.json', 'utf8')) as any[];

function get(name: string) {
  const c = cards.find(
    (x) => x.name === name || x.card_faces?.some((f: any) => f.name === name)
  );
  if (!c) return null;
  if (c.card_faces) {
    const f = c.card_faces.find((f: any) => f.name === name) ?? c.card_faces[0];
    return { name: f.name ?? c.name, mana: f.mana_cost, type: f.type_line, text: f.oracle_text };
  }
  return { name: c.name, mana: c.mana_cost, type: c.type_line, text: c.oracle_text };
}

const key = [
  'Merrow Commerce',
  'Seafloor Oracle',
  'Lullmage Mentor',
  'Sage of Fables',
  'Merfolk Mistbinder',
  'Eldrazi Monument',
  'Reflections of Littjara',
  'Deeproot Pilgrimage',
  'Growing Rites of Itlimoc',
  'Itlimoc, Cradle of the Sun',
  'Elven Chorus',
  'Vodalian Hexcatcher',
  'Wild Growth',
  'Thrasios, Triton Hero',
  'Silvergill Adept',
  'Prime Speaker Zegana',
  'Chronicle of Victory',
  'The Earth Crystal',
  'The Water Crystal',
  'Uthros, Titanic Godcore',
  'Evendo, Waking Haven',
  'Kozilek, Butcher of Truth',
  "Folio of Fancies",
  "Venser's Journal",
  'Aquatic Incursion',
  'Kindred Summons',
  'Inspiring Call',
  'Counterspell',
  'Hakbal of the Surging Soul',
  'Namor the Sub-Mariner',
  'Adrix and Nev, Twincasters',
  'Roaming Throne',
  'Door of Destinies',
  'White Lotus Tile',
  'Helm of the Host',
  'Cryptoplasm',
  'Deepfathom Echo',
  'Singer of Swift Rivers',
  'Surgespanner',
  'Drowner of Secrets',
  'Merrow Reejerey',
  'Darting Merfolk',
  'Stonybrook Banneret',
  'Bruvac the Grandiloquent',
  'Propaganda',
  'Asceticism',
  'Kindred Discovery',
  'Deeproot Waters',
  'Branching Evolution',
  "Kodama's Reach",
];

for (const n of key) {
  const g = get(n);
  if (!g) {
    console.log('MISSING', n);
    continue;
  }
  console.log(`--- ${g.name}`);
  console.log(`${g.mana ?? ''} | ${g.type}`);
  console.log((g.text ?? '').replace(/\n/g, ' // '));
  console.log('');
}
