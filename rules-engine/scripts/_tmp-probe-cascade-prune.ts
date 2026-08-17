import { parseOracleTextToIR } from '../src/oracleIRParser.js';
import { pruneCascadeReminderAbilities } from '../src/oracleIRParserPostprocess.js';
import { normalizeOracleText } from '../src/oracleIRParserUtils.js';

const text =
  "Cascade, cascade (When you cast this spell, exile cards from the top of your library until you exile a nonland card that costs less. You may cast it without paying its mana cost. Put the exiled cards on the bottom of your library in a random order. Then do it again.)";

const ir = parseOracleTextToIR(text, 'Call Forth the Tempest');
const abilityText = String(ir.abilities[0]?.text || '');
const normalizedText = normalizeOracleText(abilityText).replace(/\s+/g, ' ').trim().toLowerCase();
console.log('abilityText:', JSON.stringify(abilityText));
console.log('normalized:', JSON.stringify(normalizedText));
console.log('match double:', /^cascade\s*,\s*cascade\s*\([^)]*\)[.)]*$/i.test(normalizedText));
console.log('len ability vs source', abilityText.length, text.length);

const synthetic = pruneCascadeReminderAbilities([
  { type: 'static', text, effectText: text, steps: [] } as any,
]);
console.log('synthetic prune:', JSON.stringify(synthetic, null, 2));
process.exit(0);
