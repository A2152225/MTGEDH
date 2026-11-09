import { describe, expect, it } from 'vitest';
import { queueParsedKeywordAction } from '../src/state/modules/triggerEmissionFamilyUtils.js';
import { parseTriggerClause, triggerConditionMatches } from '../../rules-engine/src/triggerCondition/index.js';

const cond = (s: string) => parseTriggerClause(s)?.condition as any;
const src = (extra: Record<string, unknown> = {}) => ({ id: 'w', controllerId: 'p1', ...extra } as any);

function emitCtx(oracle: string) {
  const permanent = { id: 'w1', controller: 'p1', owner: 'p1', card: { name: 'Watcher', type_line: 'Creature', oracle_text: oracle } };
  const ctx: any = { gameId: 'r47', isReplaying: false, state: { battlefield: [permanent], stack: [], turnNumber: 1, players: [{ id: 'p1' }, { id: 'p2' }] } };
  return { ctx, permanent };
}

describe('round 47 uncovered families', () => {
  it('chosen color spell_cast matches source.chosenColor once', () => {
    const c = cond('Whenever a player casts a spell of the chosen color, you may gain 1 life.');
    expect(c?.event).toBe('spell_cast');
    expect(c.alternatives[0].subject.chosenColor).toBe(true);
    const plume = src({ chosenColor: 'red' });
    expect(triggerConditionMatches(c, { id: 'sp', typeLine: 'Instant', controllerId: 'p2', colors: ['r'] } as any, plume)).toBe(true);
    expect(triggerConditionMatches(c, { id: 'sp', typeLine: 'Instant', controllerId: 'p2', colors: ['u'] } as any, plume)).toBe(false);
  });

  it('blue or black spell parses colors and matches either', () => {
    const c = cond('Whenever an opponent casts a blue or black spell, create a 1/1 green Snake creature token.');
    expect(c?.alternatives[0].subject.colors).toEqual(['u', 'b']);
    expect(triggerConditionMatches(c, { id: 'sp', typeLine: 'Instant', controllerId: 'p2', colors: ['u'] } as any, src())).toBe(true);
    expect(triggerConditionMatches(c, { id: 'sp', typeLine: 'Instant', controllerId: 'p2', colors: ['r'] } as any, src())).toBe(false);
  });

  it('creature spell that has an Adventure requires hasAdventure', () => {
    const c = cond('Whenever you cast a creature spell that has an Adventure, create a Food token.');
    expect(c?.hasAdventure).toBe(true);
    expect(triggerConditionMatches(c, { id: 'sp', typeLine: 'Creature — Human', controllerId: 'p1', hasAdventure: true } as any, src())).toBe(true);
    expect(triggerConditionMatches(c, { id: 'sp', typeLine: 'Creature — Bear', controllerId: 'p1' } as any, src())).toBe(false);
  });

  it('activate loyalty queues once via activate_loyalty', () => {
    expect(cond('Whenever you activate a loyalty ability, copy that ability.')?.action).toBe('activate_loyalty');
    const { ctx } = emitCtx('Whenever you activate a loyalty ability, copy that ability.');
    expect(queueParsedKeywordAction(ctx, 'p1', 'activate_loyalty').filter((q: any) => /copy that ability/i.test(String(q.effect || ''))).length).toBe(1);
    expect(queueParsedKeywordAction(ctx, 'p1', 'activate_loyalty').filter((q: any) => /copy that ability/i.test(String(q.effect || ''))).length).toBe(0);
  });

  it('you or a permanent you control becomes the target', () => {
    const c = cond('Whenever you or a permanent you control becomes the target of a spell or ability an opponent controls, draw a card.');
    expect(c?.event).toBe('becomes_target');
    expect(c?.orControllerPlayer).toBe(true);
    expect(triggerConditionMatches(c, { id: 'perm', typeLine: 'Creature', controllerId: 'p1' } as any, src(), {
      targetingControllerId: 'p2', targetingKind: 'spell',
    } as any)).toBe(true);
    expect(triggerConditionMatches(c, { id: 'p1', typeLine: '', controllerId: 'p1' } as any, src(), {
      targetingControllerId: 'p2', targetingKind: 'spell', subjectIsPlayer: true,
    } as any)).toBe(true);
  });

  it('leave graveyard during your turn + -1/-1 counters + GY from library', () => {
    const leave = cond('Whenever one or more cards leave your graveyard during your turn, create a Treasure token.');
    expect(leave?.event).toBe('left_graveyard');
    expect(leave?.whoseTurn).toBe('you');
    const m1 = cond('Whenever one or more -1/-1 counters are put on a creature, draw a card.');
    expect(m1?.event).toBe('counter_placed');
    expect(m1?.placedCounter).toBe('-1/-1');
    const gy = cond("When this card is put into your graveyard from your library, shuffle this card into its owner's library.");
    expect(gy?.event).toBe('put_into_graveyard');
    expect(gy?.fromZone).toBe('library');
  });

  it('activate nonmana of artifact or creature + next cast flag', () => {
    expect(cond("Whenever you activate an ability of an artifact or creature that isn't a mana ability, copy that ability.")?.action).toBe('activate_nonmana');
    const next = cond('When you next cast a spell this turn, copy that spell.');
    expect(next?.nextSpellThisTurn).toBe(true);
    expect(next?.legacyRuntimeOnly).toBeFalsy();
  });
});