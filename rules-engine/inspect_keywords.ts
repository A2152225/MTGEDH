import { parseOracleTextToIR } from './src/oracleIRParser';
import cards from '../oracle-cards.json';

const targetNames = ['War Elephant', 'Skullmulcher'];
const results = targetNames.map(name => {
    const card = cards.find(c => c.name === name);
    if (!card) return { name, error: 'Not found' };
    const ir = parseOracleTextToIR(card.oracle_text, card.name);
    
    // Check for "Banding" or "Devour" in keywords
    const keywordsFound = (ir.keywords || []).map(k => k.keyword || k);
    const hasBanding = keywordsFound.some(k => typeof k === 'string' && k.toLowerCase().includes('banding'));
    const hasDevour = keywordsFound.some(k => typeof k === 'string' && k.toLowerCase().includes('devour'));

    // Check for reminder text or the keyword remaining as an unknown static ability
    const unknownStaticAbilities = ir.abilities.filter(a => a.type === 'static' || !a.type);

    return {
        name,
        original: card.oracle_text,
        irKeywords: ir.keywords,
        hasKeyword: name === 'War Elephant' ? hasBanding : hasDevour,
        unknownAbilities: unknownStaticAbilities.map(a => a.text)
    };
});

console.log(JSON.stringify(results, null, 2));
