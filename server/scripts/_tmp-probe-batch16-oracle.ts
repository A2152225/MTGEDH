import { readFileSync } from 'fs';

const audit = JSON.parse(readFileSync('scripts/out/trigger-coverage-audit.json', 'utf8'));
const cards = JSON.parse(readFileSync(audit.meta.oraclePath, 'utf8'));

const wants = [
  'Math is for Blockers',
  'Soulcatchers\' Aerie',
  'Circle of Affliction',
  'Sumala Sentry',
  'Archfiend of Spite',
  'Savanti Romero, Temporal Rogue',
  'Predatory Sludge',
  'Game Knights Live',
  'Shield of the Righteous',
  'Sword of the Squeak',
  'Verdant Dread',
  'Ertai\'s Familiar',
  'Quest for Pure Flame',
  'Boomstacker',
  'Millicent, Restless Revenant',
  'SP//dr, Piloted by Peni',
  'Kassandra, Eagle Bearer',
  'Reckless Blaze',
  'Satoru, the Infiltrator',
  'Arashin War Beast',
  'Flummoxed Cyclops',
  'My Champion Stands Supreme',
  'Polukranos Reborn',
  'Edea, Possessed Sorceress',
  'Necrogen Rotpriest',
  'Martyr\'s Bond',
  'Nelly Borca, Impulsive Accuser',
  'Tiana, Ship\'s Caretaker',
  'Shelob, Child of Ungoliant',
  'Shipwreck Sifters',
  'Gandalf, Friend of the Shire',
  'Team-Up!',
  'GO TO JAIL',
  'Twists and Turns',
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
