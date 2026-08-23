import { parseOracleTextToIR } from './rules-engine/src/oracleIRParser.ts';
import { resolveCopySpellCount } from './rules-engine/src/oracleIRExecutorCopySpellSupport.ts';
import { resolveCommanderCastsFromCommandZoneThisGame } from './rules-engine/src/oracleIRExecutorCommanderCastCount.ts';

const text = "When you cast this spell, copy it for each time you've cast your commander from the command zone this game.\nWhen this creature enters, destroy up to one target artifact or enchantment.";
const ir = parseOracleTextToIR(text, 'Hatut Zeraze Strike Force');
for (const a of ir.abilities || []) {
  console.log('ability', a.kind, a.event || a.trigger || '');
  const effects = a.effects || a.steps || [];
  for (const e of effects) {
    console.log('  step', JSON.stringify(e));
  }
}
const state = { commandZone: { p1: { tax: 4, taxById: { c1: 4 } } } };
console.log('helper', resolveCommanderCastsFromCommandZoneThisGame(state as any, 'p1'));
const step = {
  kind: 'copy_spell',
  subject: 'this_spell',
  copies: { kind: 'reference_amount', raw: "for each time you've cast your commander from the command zone this game" },
  raw: "copy it for each time you've cast your commander from the command zone this game",
};
console.log('copyCount', resolveCopySpellCount(state as any, 'p1', step as any));
