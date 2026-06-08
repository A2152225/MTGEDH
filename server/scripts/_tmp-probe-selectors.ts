import { collectStepsFromIrText, dryRunOracleSteps } from './executor-coverage-audit.ts';

const cases: Array<{ text: string; card: string; typeLine?: string }> = [
  { text: 'Return this card from your graveyard to the battlefield', card: "Kathari Bomber", typeLine: 'Creature — Bird Soldier' },
  { text: 'you may attach this aura to that creature', card: 'Prison Term' },
  { text: 'attach it to target legendary creature you control', card: 'Mithril Coat' },
  { text: 'Attach this permanent to target land you control', card: 'Darksteel Garrison' },
  { text: 'attach up to one target equipment you control to this permanent', card: 'Captain America, First Avenger' },
  { text: 'you may attach target equipment you control to target creature you control', card: 'Kor Outfitter' },
  { text: 'put a card from your hand on the bottom of your library', card: 'Errand-Rider of Gondor' },
  { text: 'exile them from your graveyard', card: 'Toluz, Clever Conductor' },
  { text: 'put the cards exiled with it into their owner\'s hand', card: 'Toluz, Clever Conductor' },
  { text: 'return up to two lands you control to their owner\'s hand', card: 'Kazandu Stomper' },
  { text: 'you may return one of them to its owner\'s hand', card: 'Kaito, Dancing Shadow' },
  { text: 'return that spell to its owner\'s hand', card: 'Krark, the Thumbless' },
  { text: 'put this card from exile onto the battlefield tapped', card: 'Torrent Elemental' },
  { text: 'exile a permanent card from your graveyard at random', card: "Sin, Spira's Punishment" },
  { text: 'you may exile a nonland card from it', card: 'Elite Spellbinder' },
];

for (const { text, card, typeLine } of cases) {
  const steps = collectStepsFromIrText(text, card);
  const result = dryRunOracleSteps(steps, card, [], typeLine ? { typeLine } : undefined);
  console.log(result.status, '|', card, '|', text);
  for (const step of steps) console.log(' ', JSON.stringify(step));
}
