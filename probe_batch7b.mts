import { parseOracleTextToIR } from './rules-engine/src/oracleIRParser.js';
import { inferTriggeredAbilityTargetMetadata } from './server/src/state/modules/inferTriggeredAbilityTargetMetadata.js';

const promised = "When you cast this spell, you gain control of target opponent during that player's next turn. After that turn, that player takes an extra turn.";
const world = 'When you cast this spell, gain control of all creatures target player controls.';
const lash = "When you cast this spell, you may put target nonland permanent on top of its owner's library.";

for (const [name, text] of [['Promised', promised], ['World', world], ['Lash', lash]]) {
  const ir = parseOracleTextToIR(text, name);
  const steps = ir.abilities.flatMap((a) => a.steps || []);
  console.log('\n====', name, '====');
  console.log(JSON.stringify(steps, null, 2).slice(0, 1200));
}
console.log('\nLash meta', inferTriggeredAbilityTargetMetadata("you may put target nonland permanent on top of its owner's library"));
