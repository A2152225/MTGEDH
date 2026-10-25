import { describe, it, expect } from 'vitest';
import { getSpellCastTriggers } from '../src/state/modules/triggers/spell-cast-get-triggers';

const perm = (id: string, name: string, oracle_text: string, extra: any = {}) => ({ id, controller: 'p1', owner: 'p1', ...extra, card: { name, type_line: 'Artifact', oracle_text } });
const giant = { name: 'Bonecrusher Giant // Stomp', layout: 'adventure', type_line: 'Creature - Giant // Instant - Adventure', colors: ['R'],
  card_faces: [{ name: 'Bonecrusher Giant', type_line: 'Creature - Giant' }, { name: 'Stomp', type_line: 'Instant - Adventure' }] };
const fire = (spell: any, bf: any[]) => getSpellCastTriggers({ state: { battlefield: bf, players: [{ id: 'p1' }, { id: 'p2' }], activePlayer: 'p1', spellsCastThisTurn: [] } } as any, 'p1', spell).map((t) => t.cardName);

describe('round 25 spell-cast qualifiers (chosen type / adventure)', () => {
  it('creature spell of the chosen type only fires for that type', () => {
    const bf = [perm('b', "Vanquisher's Banner", 'As this artifact enters, choose a creature type.\nCreatures you control of the chosen type get +1/+1.\nWhenever you cast a creature spell of the chosen type, draw a card.', { chosenCreatureType: 'Elf' })];
    expect(fire({ name: 'Llanowar Elves', type_line: 'Creature - Elf Druid', colors: ['G'] }, bf)).toContain("Vanquisher's Banner");
    expect(fire({ name: 'Goblin Guide', type_line: 'Creature - Goblin', colors: ['R'] }, bf)).not.toContain("Vanquisher's Banner");
  });
  it('adventure qualifiers', () => {
    const bf = [
      perm('e', 'Edgewall Innkeeper', 'Whenever you cast a creature spell that has an Adventure, draw a card. (It doesn\'t need to have gone on the adventure first.)'),
      perm('s', 'Storyteller Pixie', 'Flying\nWhenever you cast an Adventure spell, draw a card.'),
      perm('l', 'Lucky Clover', 'Whenever you cast an Adventure instant or sorcery spell, copy it. You may choose new targets for the copy.'),
      perm('z', "Lozhan, Dragons' Legacy", "Flying\nWhenever you cast an Adventure or Dragon spell, Lozhan deals damage equal to that spell's mana value to any target that isn't a commander."),
    ];
    expect(fire(giant, bf).sort()).toEqual(['Edgewall Innkeeper']);
    expect(fire({ ...giant, castAsAdventure: true }, bf).sort()).toEqual(['Lozhan, Dragons\' Legacy', 'Lucky Clover', 'Storyteller Pixie']);
    expect(fire({ name: 'Shivan Dragon', type_line: 'Creature - Dragon', colors: ['R'] }, bf)).toEqual(['Lozhan, Dragons\' Legacy']);
    expect(fire({ name: 'Grizzly Bears', type_line: 'Creature - Bear', colors: ['G'] }, bf)).toEqual([]);
  });
});
