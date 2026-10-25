import { describe, it, expect } from 'vitest';
import { getSpellCastTriggers } from '../src/state/modules/triggers/spell-cast-get-triggers';
import { getEndOfCombatTriggers } from '../src/state/modules/triggers/end-combat.js';
import { DelayedTriggerTiming, createDelayedTrigger, createDelayedTriggerRegistry, registerDelayedTrigger } from '../../rules-engine/src/delayedTriggeredAbilities.js';

const perm = (id: string, name: string, oracle_text: string) => ({ id, controller: 'p1', owner: 'p1', card: { name, type_line: 'Creature - Dragon', oracle_text } });
const giant = { name: 'Bonecrusher Giant // Stomp', layout: 'adventure', type_line: 'Creature - Giant // Instant - Adventure', colors: ['R'],
  card_faces: [{ name: 'Bonecrusher Giant', type_line: 'Creature - Giant' }, { name: 'Stomp', type_line: 'Instant - Adventure' }] };
const fire = (spell: any, bf: any[]) => getSpellCastTriggers({ state: { battlefield: bf, players: [{ id: 'p1' }, { id: 'p2' }], activePlayer: 'p1', spellsCastThisTurn: [] } } as any, 'p1', spell).map((t) => t.cardName);

describe('round 26: adventure cast face types', () => {
  it('noncreature / creature spell triggers use the face being cast', () => {
    const bf = [perm('w', 'Firespitter Whelp', 'Flying\nWhenever you cast a noncreature spell, Firespitter Whelp deals 1 damage to each opponent.'),
      perm('c', 'Creature Watcher', 'Whenever you cast a creature spell, draw a card.')];
    expect(fire(giant, bf)).toEqual(['Creature Watcher']);
    expect(fire({ ...giant, castAsAdventure: true }, bf)).toEqual(['Firespitter Whelp']);
  });
});

describe('round 26: next end of combat combat-history selectors', () => {
  const run = (effect: string, ref: string) => {
    let registry = createDelayedTriggerRegistry();
    registry = registerDelayedTrigger(registry, createDelayedTrigger('spell_1', 'Venomous Breath', 'p1', DelayedTriggerTiming.END_OF_COMBAT, effect, 1,
      { targets: [ref], eventDataSnapshot: { targetPermanentId: ref, chosenObjectIds: [ref] } }));
    const state: any = {
      battlefield: [
        { id: 'blk', controller: 'p1', blocking: 'att1', card: { name: 'Wall', type_line: 'Creature - Wall' } },
        { id: 'att1', controller: 'p2', blockedBy: ['blk'], card: { name: 'Bear', type_line: 'Creature - Bear' } },
        { id: 'att2', controller: 'p2', blockedBy: ['other'], card: { name: 'Bear', type_line: 'Creature - Bear' } },
        { id: 'other', controller: 'p1', blocking: 'att2', card: { name: 'Elf', type_line: 'Creature - Elf' } },
      ], stack: [], players: [{ id: 'p1' }, { id: 'p2' }], delayedTriggerRegistry: registry, turnNumber: 1,
    };
    return getEndOfCombatTriggers({ state, gameId: 'r26', bumpSeq: () => {}, isReplaying: false } as any, 'p1');
  };
  it('blocked or were blocked by it -> only the paired creature', () => {
    const [t] = run('Destroy all creatures that blocked or were blocked by it this turn.', 'blk') as any[];
    expect(t.effect).toBe('Destroy those creatures.');
    expect(t.stackItem.delayedAction).toBe('destroy');
    expect(t.stackItem.delayedPermanentIds).toEqual(['att1']);
  });
  it('were blocked by that creature (Glyph of Doom)', () => {
    const [t] = run('Destroy all creatures that were blocked by that creature this turn.', 'other') as any[];
    expect(t.stackItem.delayedPermanentIds).toEqual(['att2']);
  });
  it('no pairings -> nothing to destroy, reference creature untouched', () => {
    const [t] = run('Destroy all creatures that blocked or were blocked by it this turn.', 'nobody') as any[];
    expect(t.stackItem.delayedPermanentIds ?? []).toEqual([]);
  });
});
