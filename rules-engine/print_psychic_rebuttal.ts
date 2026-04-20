import { parseOracleTextToIR } from './src/oracleIRParser';

const oracleText = "Counter target instant or sorcery spell that targets you.\nSpell mastery — If there are two or more instant and/or sorcery cards in your graveyard, you may copy the spell countered this way. You may choose new targets for the copy.";

try {
    const ir = parseOracleTextToIR(oracleText);
    console.log(JSON.stringify(ir, null, 2));
} catch (e) {
    console.error(e);
}
