import { parseOracleTextToIR } from '../../rules-engine/src/oracleIRParser.js';
import { hasUnknownIRSteps, loadEffectIrParser } from './trigger-coverage-audit.ts';

await loadEffectIrParser();

const oracle = `{T}: Exile target instant or sorcery card from a graveyard. Roll a d20. Activate only as a sorcery.
1—9 | Copy that card. You may cast the copy.
10—19 | Copy that card. You may cast the copy by paying {1} rather than paying its mana cost.
20 | Copy each card exiled with this artifact. You may cast any number of the copies without paying their mana costs.`;

const gaps = hasUnknownIRSteps(oracle, "Wizard's Spellbook");
const ir = parseOracleTextToIR(oracle, "Wizard's Spellbook");
console.log('gaps:', gaps);
console.log(JSON.stringify(ir.abilities[0]?.steps, null, 2));
