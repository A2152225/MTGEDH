import fs from 'fs';
import path from 'path';

const oraclePath = path.join(process.cwd(), '..', 'oracle-cards.json');
const cards = JSON.parse(fs.readFileSync(oraclePath, 'utf8')) as Array<{
  name: string;
  type_line?: string;
  oracle_text?: string;
  mana_cost?: string;
  cmc?: number;
  colors?: string[];
  color_identity?: string[];
  layout?: string;
  card_faces?: Array<{ name: string; type_line?: string; oracle_text?: string; mana_cost?: string }>;
}>;

const byName = new Map<string, typeof cards[0]>();
for (const c of cards) {
  byName.set(c.name.toLowerCase(), c);
  if (c.card_faces) {
    for (const f of c.card_faces) {
      byName.set(f.name.toLowerCase(), { ...c, ...f, name: f.name });
    }
  }
}

const deck = [
  'Adrix and Nev, Twincasters',
  'Merrow Reejerey',
  'Darting Merfolk',
  'Drowner of Secrets',
  'Stonybrook Banneret',
  'Seafloor Oracle',
  'Sage of Fables',
  'Bruvac the Grandiloquent',
  'Lord of Atlantis',
  'Master of the Pearl Trident',
  'Merfolk Mistbinder',
  'Merfolk Sovereign',
  'Svyelun of Sea and Sky',
  'Attuma, Atlantean Warlord',
  'Kopala, Warden of Waves',
  'Namor the Sub-Mariner',
  'Hakbal of the Surging Soul',
  'Kumena, Tyrant of Orazca',
  'Herald of Secret Streams',
  'Wake Thrasher',
  'Lullmage Mentor',
  'Seahunter',
  'Prime Speaker Zegana',
  'Silvergill Adept',
  'Thrasios, Triton Hero',
  'Disruptor of Currents',
  "Tishana's Tidebinder",
  'Vodalian Hexcatcher',
  "Thassa's Oracle",
  'Deepfathom Echo',
  'Cryptoplasm',
  'Kozilek, Butcher of Truth',
  'Surgespanner',
  'Singer of Swift Rivers',
  'Roaming Throne',
  'Asceticism',
  'Chronicle of Victory',
  'Deeproot Waters',
  'Deeproot Pilgrimage',
  'Kindred Discovery',
  'Reflections of Littjara',
  'Branching Evolution',
  'Wild Growth',
  'Growing Rites of Itlimoc',
  'Elven Chorus',
  'Propaganda',
  'Merrow Commerce',
  'Sol Ring',
  'Arcane Signet',
  "Herald's Horn",
  'Metallic Mimic',
  'Helm of the Host',
  'Door of Destinies',
  'Eldrazi Monument',
  'White Lotus Tile',
  'The Water Crystal',
  'The Earth Crystal',
  'Folio of Fancies',
  "Venser's Journal",
  'Counterspell',
  'Swan Song',
  'Inspiring Call',
  'Aquatic Incursion',
  "Aquitect's Will",
  "Kodama's Reach",
  'Distant Melody',
  'Kindred Summons',
  'Nykthos, Shrine to Nyx',
  'Cavern of Souls',
  'Unclaimed Territory',
  'Eclipsed Realms',
  'Three Tree City',
  'Breeding Pool',
  'Command Tower',
  'Hinterland Harbor',
  'Dreamroot Cascade',
  'Yavimaya Coast',
  'Botanical Sanctum',
  'Path of Ancestry',
  'Temple of Mystery',
  'Reliquary Tower',
  "Alchemist's Refuge",
  'Rejuvenating Springs',
  'Academy Ruins',
  'Buried Ruin',
  'Uthros, Titanic Godcore',
  'Evendo, Waking Haven',
  'Island',
  'Forest',
];

const missing: string[] = [];
const lines: string[] = [];

for (const name of deck) {
  if (name === 'Island' || name === 'Forest') continue;
  const c = byName.get(name.toLowerCase());
  if (!c) {
    missing.push(name);
    continue;
  }
  const text = c.oracle_text ?? '(no oracle text)';
  lines.push(`=== ${c.name} ===`);
  lines.push(`${c.mana_cost ?? ''} | ${c.type_line ?? '?'}`);
  lines.push(text.replace(/\n/g, ' // '));
  lines.push('');
}

console.log(`Deck unique cards queried: ${deck.filter((n) => n !== 'Island' && n !== 'Forest').length}`);
console.log(`Missing: ${missing.length}`);
if (missing.length) console.log(missing.join('\n'));
console.log('\n' + lines.join('\n'));
