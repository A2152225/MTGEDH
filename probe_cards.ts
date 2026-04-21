import { parseOracleTextToIR } from './rules-engine/src/oracleIRParser';

const cards = [
    { name: 'Seedship Agrarian', text: 'When Seedship Agrarian enters, you may search your library for a basic land card, reveal it, put it into your hand, then shuffle.' },
    { name: 'Lithobraking', text: 'Target creature an opponent controls gets -2/-0 until end of turn. It loses all abilities until end of turn.\\nBasic landcycling {2} ({2}, Discard this card: Search your library for a basic land card, reveal it, put it into your hand, then shuffle.)' },
    { name: 'Glacier Godmaw', text: 'Trample\\nBasic landcycling {2} ({2}, Discard this card: Search your library for a basic land card, reveal it, put it into your hand, then shuffle.)' },
    { name: 'Orbital Plunge', text: 'Look at the top five cards of your library. You may reveal a land card from among them and put it onto the battlefield tapped. Put the rest on the bottom of your library in a random order.\\nLandcycling {2} ({2}, Discard this card: Search your library for a land card, reveal it, put it into your hand, then shuffle.)' },
    { name: 'Kav Landseeker', text: 'When Kav Landseeker enters, search your library for up to two basic land cards, reveal them, put them into your hand, then shuffle.' }
];

cards.forEach(card => {
    console.log('--- ' + card.name + ' ---');
    console.log('Oracle Text:', card.text);
    const result = parseOracleTextToIR(card.text, card.name);
    console.log('Result:', JSON.stringify(result, null, 2));
    console.log('\\n');
});
