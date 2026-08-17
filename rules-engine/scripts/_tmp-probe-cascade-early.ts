import { parseOracleText } from '../src/oracleTextParser.js';
import { parseAbilityToIRAbility } from '../src/oracleIRParser.js';

const text =
  "Cascade, cascade (When you cast this spell, exile cards from the top of your library until you exile a nonland card that costs less. You may cast it without paying its mana cost. Put the exiled cards on the bottom of your library in a random order. Then do it again.)";

const parsed = parseOracleText(text, 'Call Forth the Tempest');
console.log('parsed abilities:', parsed.abilities.length);
for (const a of parsed.abilities) {
  console.log('---');
  console.log('type', a.type, 'text', JSON.stringify(a.text || a.effectText || a));
}

// Try importing intermediate - just dump IR ability before postprocess
const irAbilities = parsed.abilities.map((ability) => parseAbilityToIRAbility(ability, 'Call Forth the Tempest'));
console.log('\nIR before postprocess:');
for (const a of irAbilities) {
  console.log(JSON.stringify({ type: a.type, text: a.text, steps: a.steps.map((s: any) => ({ kind: s.kind, raw: s.raw })) }, null, 2));
}
process.exit(0);
