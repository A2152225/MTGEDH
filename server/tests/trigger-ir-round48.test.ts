import { describe, expect, it } from 'vitest';
import { queueParsedKeywordAction, queueParsedSubjectEvent } from '../src/state/modules/triggerEmissionFamilyUtils.js';
import { parseTriggerClause, triggerConditionMatches } from '../../rules-engine/src/triggerCondition/index.js';

const cond = (s: string) => parseTriggerClause(s)?.condition as any;
const src = (extra: Record<string, unknown> = {}) => ({ id: 'w', controllerId: 'p1', ...extra } as any);

function emitCtx(oracle: string) {
  const permanent = { id: 'w1', controller: 'p1', owner: 'p1', card: { name: 'Watcher', type_line: 'Creature', oracle_text: oracle } };
  const ctx: any = { gameId: 'r48', isReplaying: false, state: { battlefield: [permanent], stack: [], turnNumber: 1, players: [{ id: 'p1' }, { id: 'p2' }] } };
  return { ctx, permanent };
}

describe('round 48 uncovered families', () => {
  it('put into a library from anywhere queues once', () => {
    const c = cond('Whenever one or more cards are put into a library from anywhere, create two 1/1 white Bird creature tokens with flying.');
    expect(c?.event).toBe('put_into_library');
    expect(c?.fromZone).toBe('anywhere');
    const { ctx } = emitCtx('Whenever one or more cards are put into a library from anywhere, create two 1/1 white Bird creature tokens with flying.');
    const card = { id: 'c1', name: 'Island', type_line: 'Basic Land — Island' };
    const first = queueParsedSubjectEvent(ctx, {
      event: 'put_into_library',
      subjectPermanent: { id: 'c1', controller: 'p2', card },
      subjectControllerId: 'p2',
      triggerType: 'put_into_library',
      fromZone: 'graveyard',
    }).filter((q: any) => /bird/i.test(String(q.effect || '')));
    expect(first.length).toBe(1);
    expect(queueParsedSubjectEvent(ctx, {
      event: 'put_into_library',
      subjectPermanent: { id: 'c1', controller: 'p2', card },
      subjectControllerId: 'p2',
      triggerType: 'put_into_library',
      fromZone: 'graveyard',
    }).filter((q: any) => /bird/i.test(String(q.effect || ''))).length).toBe(0);
  });

  it('becomes plotted performs plot once', () => {
    expect(cond('When this card becomes plotted, it deals 2 damage to any target.')?.action).toBe('plot');
    const { ctx } = emitCtx('When this card becomes plotted, it deals 2 damage to any target.');
    expect(queueParsedKeywordAction(ctx, 'p1', 'plot').filter((q: any) => /2 damage/i.test(String(q.effect || ''))).length).toBe(1);
    expect(queueParsedKeywordAction(ctx, 'p1', 'plot').filter((q: any) => /2 damage/i.test(String(q.effect || ''))).length).toBe(0);
  });

  it('exile hand-or-battlefield OR matches either path', () => {
    const c = cond('Whenever one or more cards are put into exile from your hand or a spell or ability you control exiles one or more permanents from the battlefield, put that many +1/+1 counters on this creature.');
    expect(c?.event).toBe('exiled');
    expect(c?.fromZone).toBe('hand_or_battlefield');
    expect(c?.causedByYou).toBe(true);
    const permanent = { id: 'c1', typeLine: 'Creature', controllerId: 'p2' } as any;
    expect(triggerConditionMatches(c, permanent, src(), { fromZone: 'hand', zoneOwnerId: 'p1' } as any)).toBe(true);
    expect(triggerConditionMatches(c, permanent, src(), { fromZone: 'battlefield', exileControllerId: 'p1' } as any)).toBe(true);
    expect(triggerConditionMatches(c, permanent, src(), { fromZone: 'battlefield', exileControllerId: 'p2' } as any)).toBe(false);
    expect(triggerConditionMatches(c, permanent, src(), { fromZone: 'graveyard' } as any)).toBe(false);
  });

  it('last intervention counter + leave GY and/or + instant/sorcery card + noncreature, nonland', () => {
    expect(cond('When you remove the last intervention counter from this enchantment, the game is a draw.')?.event).toBe('last_counter_removed');
    expect(cond('When you remove the last intervention counter from this enchantment, the game is a draw.')?.placedCounter).toBe('intervention');
    const leave = cond('Whenever one or more artifact and/or creature cards leave your graveyard during your turn, put a +1/+1 counter on target creature you control.');
    expect(leave?.event).toBe('left_graveyard');
    expect(leave?.whoseTurn).toBe('you');
    expect(cond('Whenever a player casts an instant or sorcery card, exile it.')?.event).toBe('spell_cast');
    const enter = cond('Whenever one or more noncreature, nonland permanents you control enter, put a +1/+1 counter on target creature you control.');
    expect(enter?.event).toBe('enters');
    expect(enter?.quantity).toBe('one_or_more');
  });

  it('attack with opponent-owned creature + each other player draw + activate targeting', () => {
    const atk = cond('Whenever you attack with a creature an opponent owns, create a Treasure token.');
    expect(atk?.event).toBe('attacks');
    expect(atk?.alternatives[0].subject.owner).toBe('not_you');
    expect(cond("At the beginning of each other player's draw step, that player draws an additional card.")?.whoseTurn).toBe('each_other_player');
    expect(cond('Whenever you activate an ability that targets a creature or player, copy that ability.')?.action).toBe('activate_targeting');
  });
});