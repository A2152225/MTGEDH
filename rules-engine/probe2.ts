import { parseOracleTextToIR } from './src/oracleIRParser.ts';
const cards = [
    { name: 'Flawless Forgery', text: 'Exile target instant or sorcery card from an opponent\'s graveyard. Copy it. You may cast the copy without paying its mana cost.' },
    { name: 'Chandra\'s Dragonmech', text: 'When Chandra\'s Dragonmech enters, exile the top five cards of your library. You may cast an instant or sorcery spell from among them without paying its mana cost. If you don\'t, put those cards into your hand.' },
    { name: 'Mysterious Stranger', text: 'When Mysterious Stranger enters, exile target instant or sorcery card from a graveyard. For each opponent, copy that card. You may cast the copies without paying their mana costs.' }
];
cards.forEach(c => {
    console.log('--- ' + c.name + ' ---');
    const ir = parseOracleTextToIR(c.text, c.name);
    console.log(JSON.stringify(ir.abilities, null, 2));
});
