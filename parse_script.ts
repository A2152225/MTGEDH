import { parseOracleTextToIR } from './rules-engine/src/index';

const cards = [
    {
        name: 'Abstruse Archaic',
        text: "{1}, {T}: Copy target activated or triggered ability you control from a colorless source. You may choose new targets for the copy. (Mana abilities can't be targeted.)"
    },
    {
        name: 'League Guildmage',
        text: "{X}, {T}: Copy target instant or sorcery spell you control with mana value X. You may choose new targets for the copy."
    },
    {
        name: 'Psychic Rebuttal',
        text: "Counter target instant or sorcery spell that targets you. If that spell is countered in this way, you may copy it. If you do, you may choose new targets for the copy."
    },
    {
        name: 'Melek, Izzet Paragon',
        text: "You may cast instant and sorcery spells from the top of your library. When you cast an instant or sorcery spell from your library, copy it. You may choose new targets for the copy."
    },
    {
        name: 'Ertha Jo, Frontier Mentor',
        text: "Whenever you activate an ability of a creature or land you control, if it isn't a mana ability, copy that ability. You may choose new targets for the copy."
    }
];

const results = cards.map(card => {
    const ir = parseOracleTextToIR(card.text);
    return {
        card: card.name,
        oracle_text: card.text,
        abilities: ir.abilities.map(a => ({
            text: a.text,
            steps: a.steps.map(s => ({ kind: s.kind, raw: s.raw }))
        }))
    };
});

console.log(JSON.stringify(results));
