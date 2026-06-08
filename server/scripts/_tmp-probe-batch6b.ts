import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadEffectIrParser } from './trigger-coverage-audit.ts';
import { collectStepsFromIrText, dryRunOracleSteps } from './executor-coverage-audit.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
await loadEffectIrParser();

const cases: Array<{ text: string; card: string }> = [
  { text: 'you may exile all cards from your hand face down', card: 'Duplicity' },
  { text: 'put all other cards you own exiled with this enchantment into your hand', card: 'Duplicity' },
  { text: 'you may put any number of equipment cards from among them onto the battlefield. put the rest on the bottom of your library in a random order', card: 'Gilgamesh, Master-at-Arms' },
  { text: 'you may put a creature card with mana value less than that creature\'s mana value from your hand onto the battlefield tapped and attacking', card: 'Arni Metalbrow' },
  { text: 'put all creature cards milled this way onto the battlefield face down under your control', card: 'The Cyber-Controller' },
  { text: 'put all goblin creature cards with mana value 5 or less from among them onto the battlefield and the rest on the bottom of your library in a random order', card: 'Muxus, Goblin Grandee' },
  { text: 'put that card onto the battlefield or into your hand', card: 'Illuna, Apex of Wishes' },
  { text: 'you may put a creature card with mana value 3 or less from your hand or graveyard onto the battlefield', card: 'Swift Warkite' },
  { text: 'you may put a nonland permanent card with mana value x or less from among them onto the battlefield under your control', card: 'Lonis, Cryptozoologist' },
  { text: 'put target card with mana value x exiled with this creature into its owner\'s graveyard', card: 'Bronzebeak Foragers' },
  { text: 'return up to two other target nonland permanents to their owners\' hands', card: 'Marang River Regent // Coil and Catch' },
  { text: 'you may attach to it any number of auras on the battlefield and you may put onto the battlefield attached to it any number of aura cards that could enchant it from your graveyard and/or hand', card: 'Bruna, Light of Alabaster' },
];

for (const { text, card } of cases) {
  const steps = collectStepsFromIrText(text, card);
  const result = dryRunOracleSteps(steps, card, []);
  console.log('\n', result.status, '|', card);
  console.log(' text:', text.slice(0, 90));
  console.log(' steps:', JSON.stringify(steps));
  const gaps = (result as any).automationGaps?.filter((g: any) => g.reasonCode === 'unsupported_selector') || [];
  for (const g of gaps) console.log(' GAP:', g.raw);
}
