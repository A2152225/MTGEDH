import { parseOracleTextToIR } from './src/oracleIRParser.ts';
const cards = [
    { name: 'Hurl into History', text: 'Counter target artifact or creature spell. Discover X, where X is that spell\\'s mana value. (Exile cards from the top of your library until you exile a nonland card with that mana value or less. Cast it without paying its mana cost or put it into your hand. Put the rest on the bottom in a random order.)' },
    { name: 'Hidden Nursery', text: 'Hidden Nursery enters the battlefield tapped.\n{T}: Add {G}.\n{4}{G}, {T}, Sacrifice Hidden Nursery: Discover 4. Activate only as a sorcery. (Exile cards from the top of your library until you exile a nonland card with mana value 4 or less. Cast it without paying its mana cost or put it into your hand. Put the rest on the bottom in a random order.)' },
    { name: 'Buried Treasure', text: '{T}, Sacrifice Buried Treasure: Add one mana of any color.\n{2}, Sacrifice Buried Treasure: Draw a card.\nWhen Buried Treasure is put into a graveyard from the battlefield, you may pay {R}. If you do, discover 5. (Exile cards from the top of your library until you exile a nonland card with mana value 5 or less. Cast it without paying its mana cost or put it into your hand. Put the rest on the bottom in a random order.)' }
];

cards.forEach(card => {
    console.log('--- ' + card.name + ' ---');
    const ir = parseOracleTextToIR(card.text, card.name);
    console.log(JSON.stringify(ir.abilities, null, 2));
});
