import { describe, expect, it } from 'vitest';
import { parseTriggerClause, triggerConditionMatches } from '../../rules-engine/src/triggerCondition/index.js';

const cond = (s: string, name?: string) => parseTriggerClause(s, name)?.condition as any;
const src = (extra: Record<string, unknown> = {}) => ({ id: 'w', controllerId: 'p1', ...extra } as any);

describe('round 51 uncovered families', () => {
  it('keyword performs: forage / investigate first-time / gift / manifest dread / attractions', () => {
    expect(cond('Whenever you forage, draw a card.')?.action).toBe('forage');
    const inv = cond('Whenever you investigate for the first time each turn, investigate an additional time.');
    expect(inv?.action).toBe('investigate');
    expect(inv?.onceEachTurn).toBe(true);
    expect(cond('Whenever you give a gift, draw a card.')?.action).toBe('give_gift');
    expect(cond('Whenever you manifest dread, draw a card.')?.action).toBe('manifest_dread');
    expect(cond('Whenever you open an Attraction, draw a card.')?.action).toBe('open_attraction');
    expect(cond('Whenever you visit an Attraction, draw a card.')?.action).toBe('visit_attraction');
  });

  it('life/discard/target/cast/leave/play/counter near-misses fire once', () => {
    const life = cond('Whenever you gain life during your turn, draw a card.');
    expect(life?.event).toBe('gains_life');
    expect(life?.whoseTurn).toBe('you');
    const lifeSub = { id: 'p1', controllerId: 'p1', typeLine: 'Creature' } as any;
    expect(triggerConditionMatches(life, lifeSub, src(), { activePlayerId: 'p1' } as any)).toBe(true);
    expect(triggerConditionMatches(life, lifeSub, src(), { activePlayerId: 'p2' } as any)).toBe(false);

    const disc = cond('Whenever you discard one or more nonland cards for the first time each turn, draw a card.');
    expect(disc?.event).toBe('discards');
    expect(disc?.onceEachTurn).toBe(true);

    const andOr = cond('Whenever you and/or at least one permanent you control becomes the target of a spell or ability an opponent controls, draw a card.');
    expect(andOr?.event).toBe('becomes_target');
    expect(andOr?.orControllerPlayer).toBe(true);

    const plus = cond('Whenever a creature you control with a +1/+1 counter on it becomes the target of a spell or ability an opponent controls, draw a card.');
    expect(plus?.event).toBe('becomes_target');
    expect(plus?.alternatives?.[0]?.subject?.counters?.length).toBeGreaterThan(0);

    const cast = cond("Whenever you cast a spell that targets a creature you don't control, draw a card.");
    expect(cast?.event).toBe('spell_cast');
    expect(cast?.targets).toBe('creature_you_dont_control');
    const spellSub = { id: 'sp', controllerId: 'p1', typeLine: 'Instant' } as any;
    expect(triggerConditionMatches(cast, spellSub, src(), {
      targetPermanents: [{ typeLine: 'Creature', controllerId: 'p2' }],
    } as any)).toBe(true);
    expect(triggerConditionMatches(cast, spellSub, src(), {
      targetPermanents: [{ typeLine: 'Creature', controllerId: 'p1' }],
    } as any)).toBe(false);

    const leave = cond('Whenever one or more other creatures you control leave the battlefield without dying, draw a card.');
    expect(leave?.event).toBe('leaves_battlefield');
    expect(leave?.notDying).toBe(true);
    const leaveSub = { id: 'c1', controllerId: 'p1', typeLine: 'Creature' } as any;
    expect(triggerConditionMatches(leave, leaveSub, src(), { toZone: 'exile' } as any)).toBe(true);
    expect(triggerConditionMatches(leave, leaveSub, src(), { toZone: 'graveyard' } as any)).toBe(false);

    expect(cond('Whenever you play an Island, untap this creature.')?.event).toBe('plays_land');
    const put = cond('Whenever you put one or more time counters on a permanent you control, create a token.');
    expect(put?.event).toBe('counter_placed');
    expect(put?.placedCounter).toBe('time');
    expect(put?.causedByYou).toBe(true);
  });

  it('commander combat, enchanted land GY, excess damage, exploits, face-up/transforms', () => {
    expect(cond('Whenever your commander deals combat damage to a player, draw a card.')?.event).toBe('deals_combat_damage_to_player');
    expect(cond('When enchanted Plains is put into a graveyard, return this card.')?.event).toBe('dies');
    const excess = cond('Whenever a creature an opponent controls is dealt excess noncombat damage, create a token.');
    expect(excess?.event).toBe('dealt_damage');
    expect(excess?.requiresExcess).toBe(true);
    expect(excess?.damageKind).toBe('noncombat');
    const dmgSub = { id: 'c2', controllerId: 'p2', typeLine: 'Creature' } as any;
    expect(triggerConditionMatches(excess, dmgSub, src(), { damageKind: 'noncombat', excessDamage: true } as any)).toBe(true);
    expect(triggerConditionMatches(excess, dmgSub, src(), { damageKind: 'noncombat', excessDamage: false } as any)).toBe(false);

    expect(cond('Whenever a creature you control exploits a creature, draw a card.')?.action).toBe('exploit');
    expect(cond('Whenever you turn a permanent face up, draw a card.')?.event).toBe('turned_face_up');
    expect(cond('Whenever a permanent you control transforms into a Phyrexian, draw a card.')?.event).toBe('transforms');
  });

  it('opponents dealt combat damage during your turn', () => {
    const c = cond('When one or more of your opponents are dealt combat damage during your turn, draw a card.');
    expect(c?.event).toBe('dealt_damage');
    expect(c?.whoseTurn).toBe('you');
    expect(c?.quantity).toBe('one_or_more');
  });
});