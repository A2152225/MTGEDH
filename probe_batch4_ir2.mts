import { parseOracleTextToIR } from './rules-engine/src/oracleIRParser.ts';
import { detectCastTrigger, extractSelfCastEffectClauses } from './rules-engine/src/cards/castTriggers.ts';

const depth = `Devoid (This card has no color.)
Kicker {C} (You may pay an additional {C} as you cast this spell.)
When you cast this spell, choose one. If it was kicked, choose both instead.
• Return target creature to its owner's hand.
• Target player draws two cards, then discards a card.`;

const mind = `Emerge {5}{B}{B} (You may cast this spell by sacrificing a creature and paying the emerge cost reduced by that creature's mana value.)
When you cast this spell, target opponent reveals their hand. You choose from it a nonland card with mana value 3 or less and a card with mana value 4 or greater. That player discards those cards.`;

const vortex = `When you cast this spell, counter it unless you sacrifice a land.
At the beginning of each player's upkeep, that player sacrifices a land of their choice.
When there are no lands on the battlefield, sacrifice this enchantment.`;

for (const [name, text] of [['Depth Defiler', depth], ['Distended Mindbender', mind], ['Mana Vortex', vortex]] as const) {
  const ir: any = parseOracleTextToIR(text, name);
  console.log('====', name, 'FULL ====');
  console.log(JSON.stringify(ir, null, 2).slice(0, 6000));
  console.log('--- cast clauses', extractSelfCastEffectClauses(text));
  console.log('--- detect', detectCastTrigger({ name, oracle_text: text } as any));
  console.log();
}
