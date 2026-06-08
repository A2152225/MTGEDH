import { readFileSync } from 'fs';

const audit = JSON.parse(readFileSync('scripts/out/trigger-coverage-audit.json', 'utf8'));
const cards = JSON.parse(readFileSync(audit.meta.oraclePath, 'utf8'));

const wants = [
  'Game Knights Live',
  'Bureaucracy',
  'Base Race',
  'Unnatural Summons',
  'Overseer of Vault 76',
  "Benefactor's Draught",
  'Sage of the Falls',
  'Goro-Goro and Satoru',
  'Kothophed, Soul Hoarder',
  'Cryoshatter',
  'Shadow Urchin',
  'Powerleech',
  'Etrata, Deadly Fugitive',
  'Tajic, Blade of the Legion',
  'Dance of Flame',
  'Torrent Sculptor',
  'Thrasher Brute',
  'Karai, Shadow Warrior',
  'Slinza, the Spiked Stampede',
  'Stone Haven Outfitter',
  'Shredder, Foot Clan Overlord',
  'True Identity',
  'Mob Mentality',
  "Norn's Decree",
  'Blaze Commando',
  'Swallow the Hero Whole',
  'Oasis of Renewal',
  "Curse of Fool's Wisdom",
  'The Pandorica',
  'Toxin Sliver',
  'Aang, at the Crossroads',
  'Soulmates',
  'The Countering Runner',
  'Paired Tactician',
  'Planar Void',
  'Boggart Shenanigans',
  'Calim, Djinn Emperor',
  'Valentin, Dean of the Vein',
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
