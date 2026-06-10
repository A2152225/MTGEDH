import fs from 'fs';

const cards = JSON.parse(
  fs.readFileSync('D:/Git/MTGEDH/oracle-cards.json', 'utf8')
) as Array<{ name: string; type_line?: string }>;

const creatures = [
  'Merrow Reejerey',
  'Darting Merfolk',
  'Drowner of Secrets',
  'Stonybrook Banneret',
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
  "Tishana's Tidebinder",
  'Vodalian Hexcatcher',
  "Thassa's Oracle",
  'Deepfathom Echo',
  'Cryptoplasm',
  'Kozilek, Butcher of Truth',
  'Surgespanner',
  'Singer of Swift Rivers',
  'Topography Tracker',
  'Kalonian Hydra',
];

const commander = 'Adrix and Nev, Twincasters';
const throne = 'Roaming Throne';

function typeLine(name: string) {
  return cards.find((c) => c.name === name)?.type_line ?? 'MISSING';
}

const wizards: string[] = [];
const merfolkNotWizard: string[] = [];
const notMerfolk: string[] = [];

for (const name of [commander, ...creatures, throne]) {
  const tl = typeLine(name);
  const merfolk = /\bMerfolk\b/i.test(tl);
  const wizard = /\bWizard\b/i.test(tl);
  const line = `${name} — ${tl}`;
  if (wizard) wizards.push(line);
  else if (merfolk) merfolkNotWizard.push(line);
  else notMerfolk.push(line);
}

console.log(`WIZARDS (${wizards.length}):`);
wizards.forEach((l) => console.log(`  ${l}`));
console.log(`\nMERFOLK, NOT WIZARD (${merfolkNotWizard.length}):`);
merfolkNotWizard.forEach((l) => console.log(`  ${l}`));
console.log(`\nNOT MERFOLK (${notMerfolk.length}):`);
notMerfolk.forEach((l) => console.log(`  ${l}`));
console.log(`\nSage of Fables buffs "other Wizard creatures" — ${wizards.length - 1} targets in deck (excluding Sage if in deck; Sage is enchantment not creature)`);
