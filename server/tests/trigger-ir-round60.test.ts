import { describe, expect, it } from 'vitest';
import { parseTriggerClause, triggerConditionMatches } from '../../rules-engine/src/triggerCondition/index.js';
import { queueNoncombatDealsDamageTriggers } from '../src/state/modules/triggers/noncombat-deals-damage.js';
import { getDiscardTriggers } from '../src/state/modules/triggers/discard.js';
import { getLifeLossTriggers } from '../src/state/modules/triggers/life-loss.js';
import { collectMatchingParsedEventLines } from '../src/state/modules/triggers/triggerConditionFamilyMatch.js';

const cond = (s: string, name?: string) => parseTriggerClause(s, name)?.condition as any;
const src = (extra: Record<string, unknown> = {}) => ({ id: 'w', controllerId: 'p1', ...extra } as any);

const perm = (id: string, controller: string, name: string, oracle: string, type = 'Creature') =>
  ({ id, controller, owner: controller, tapped: false, counters: {}, card: { id: `${id}_c`, name, type_line: type, oracle_text: oracle, power: '2', toughness: '2' } });
const ctxOf = (battlefield: any[], stack: any[] = []) => ({
  gameId: 'r60', isReplaying: false, bumpSeq() {},
  state: { players: [{ id: 'p1' }, { id: 'p2' }], activePlayer: 'p1', turnPlayer: 'p1', turnNumber: 3, battlefield, stack, zones: { p1: { hand: [], graveyard: [], exile: [], library: [] }, p2: { hand: [], graveyard: [], exile: [], library: [] } } },
}) as any;

describe('round 60 uncovered: parse shapes', () => {
  it('spend-this-mana Aura this turn, caused library exile, exact damage+life, discard at random', () => {
    const spend = cond('When you spend this mana to cast an Aura spell this turn, create a 1/1 red Gremlin creature token.');
    expect(spend?.event).toBe('spell_cast');
    expect(spend?.requiresSourceMana).toBe(true);
    expect(spend?.thisTurn || spend?.delayedRider).toBeTruthy();
    expect(spend?.legacyRuntimeOnly).toBeFalsy();

    const exile = cond("Whenever a spell or ability you control causes one or more cards to be exiled from an opponent's library, you may play those cards.");
    expect(exile?.event).toBe('exiled');
    expect(exile?.fromZone).toBe('library');
    expect(exile?.zoneOwner).toBe('not_you');
    expect(exile?.causedByYou).toBe(true);
    expect(exile?.quantity).toBe('one_or_more');
    expect(exile?.legacyRuntimeOnly).toBeFalsy();
    expect(triggerConditionMatches(exile, { id: 'c1', controllerId: 'p2', typeLine: 'Instant', anyObject: true } as any, src(), {
      fromZone: 'library', zoneOwnerId: 'p2', exileControllerId: 'p1', causeControllerId: 'p1',
    } as any)).toBe(true);
    expect(triggerConditionMatches(exile, { id: 'c1', controllerId: 'p2', typeLine: 'Instant', anyObject: true } as any, src(), {
      fromZone: 'library', zoneOwnerId: 'p1', exileControllerId: 'p1', causeControllerId: 'p1',
    } as any)).toBe(false);

    const sahir = cond('Whenever a source you control deals exactly 1 damage to you and whenever a spell or ability you control causes you to lose exactly 1 life, put a +1/+1 counter on Sahir.');
    expect(sahir?.event).toBe('deals_damage');
    expect(sahir?.pairedEvent).toBe('loses_life');
    expect(sahir?.exactDamage).toBe(true);
    expect(sahir?.minDamageAmount).toBe(1);
    expect(sahir?.exactLife).toBe(true);
    expect(sahir?.lifeAmount).toBe(1);
    expect(sahir?.damagedPlayer).toBe('you');
    expect(sahir?.legacyRuntimeOnly).toBeFalsy();
    expect(triggerConditionMatches(sahir, { id: 's1', controllerId: 'p1', typeLine: 'Creature', anyObject: true } as any, src(), {
      damagedPlayerId: 'p1', damageRecipientPlayerId: 'p1', damageAmount: 1,
    } as any)).toBe(true);
    expect(triggerConditionMatches(sahir, { id: 's1', controllerId: 'p1', typeLine: 'Creature', anyObject: true } as any, src(), {
      damagedPlayerId: 'p1', damageRecipientPlayerId: 'p1', damageAmount: 2,
    } as any)).toBe(false);
    expect(triggerConditionMatches(sahir, { id: 'p1', controllerId: 'p1', typeLine: '', anyObject: true } as any, src(), {
      lifeAmount: 1, causeControllerId: 'p1',
    } as any)).toBe(true);
    expect(triggerConditionMatches(sahir, { id: 'p1', controllerId: 'p1', typeLine: '', anyObject: true } as any, src(), {
      lifeAmount: 2, causeControllerId: 'p1',
    } as any)).toBe(false);

    const chira = cond('Whenever you discard one or more cards at random, select one or more targets at random, choose one or more modes at random, flip one or more coins, or roll one or more dice, put a +1/+1 counter on Chira and create a tapped Treasure token.');
    expect(chira?.event).toBe('discards');
    expect(chira?.atRandom).toBe(true);
    expect(chira?.quantity).toBe('one_or_more');
    expect(Array.isArray(chira?.orEvents) && chira.orEvents.length).toBeGreaterThan(0);
    expect(chira?.legacyRuntimeOnly).toBeFalsy();
    expect(triggerConditionMatches(chira, { id: 'c', controllerId: 'p1', typeLine: 'Card', anyObject: true } as any, src(), {
      atRandom: true,
    } as any)).toBe(true);
    expect(triggerConditionMatches(chira, { id: 'c', controllerId: 'p1', typeLine: 'Card', anyObject: true } as any, src(), {
      atRandom: false,
    } as any)).toBe(false);
  });
});

describe('round 60 uncovered: fires once', () => {
  it('Auntie/Sahir deals-exactly-1-to-you fires once, not for 2 damage or for the opponent', () => {
    const text = 'Whenever a source you control deals exactly 1 damage to you and whenever a spell or ability you control causes you to lose exactly 1 life, put a +1/+1 counter on Sahir.';
    const watcher = perm('w', 'p1', 'Sahir, Visitor in Darkness', text, 'Legendary Creature - Human Wizard');
    const pinger = perm('s', 'p1', 'Pinger', '', 'Creature');
    const ctx = ctxOf([watcher, pinger]);
    queueNoncombatDealsDamageTriggers(ctx, 's', { playerIds: ['p1'], permanentIds: [], legacyEffects: [], amount: 1 });
    const fromW = (c: any) => c.state.stack.filter((x: any) => x.type === 'triggered_ability' && String(x.permanentId || x.source || x.sourceId || '') === 'w');
    expect(fromW(ctx).length).toBe(1);

    const ctx2 = ctxOf([watcher, pinger]);
    queueNoncombatDealsDamageTriggers(ctx2, 's', { playerIds: ['p1'], permanentIds: [], legacyEffects: [], amount: 2 });
    expect(fromW(ctx2).length).toBe(0);

    const ctx3 = ctxOf([watcher, pinger]);
    queueNoncombatDealsDamageTriggers(ctx3, 's', { playerIds: ['p2'], permanentIds: [], legacyEffects: [], amount: 1 });
    expect(fromW(ctx3).length).toBe(0);
  });

  it('Sahir lose-exactly-1-life and Chira discard-at-random each fire once', () => {
    const sahirText = 'Whenever a source you control deals exactly 1 damage to you and whenever a spell or ability you control causes you to lose exactly 1 life, put a +1/+1 counter on Sahir.';
    const sahir = perm('w', 'p1', 'Sahir, Visitor in Darkness', sahirText, 'Legendary Creature - Human Wizard');
    const life = getLifeLossTriggers(ctxOf([sahir]), 'p1', { lifeAmount: 1, causeControllerId: 'p1' }).filter((t) => t.permanentId === 'w');
    expect(life.length).toBe(1);
    expect(getLifeLossTriggers(ctxOf([sahir]), 'p1', { lifeAmount: 2, causeControllerId: 'p1' }).filter((t) => t.permanentId === 'w').length).toBe(0);

    const chiraText = 'Whenever you discard one or more cards at random, select one or more targets at random, choose one or more modes at random, flip one or more coins, or roll one or more dice, put a +1/+1 counter on Chira and create a tapped Treasure token.';
    const chira = perm('w', 'p1', 'Chira, All In', chiraText, 'Legendary Creature - Human Rogue');
    expect(getDiscardTriggers(ctxOf([chira]), 'p1', { atRandom: true }).filter((t) => t.permanentId === 'w').length).toBe(1);
    expect(getDiscardTriggers(ctxOf([chira]), 'p1').filter((t) => t.permanentId === 'w').length).toBe(0);
  });

  it('Madcap Jester library-exile cause fires once via IR lines', () => {
    const text = "Whenever a spell or ability you control causes one or more cards to be exiled from an opponent's library, you may play those cards until the end of your next turn.";
    const watcher = perm('w', 'p1', 'The Madcap Jester', text, 'Legendary Creature - Clown Wizard');
    const lines = collectMatchingParsedEventLines({
      ctx: ctxOf([watcher]),
      oracleText: text,
      event: 'exiled',
      subjectPermanent: { id: 'c1', typeLine: 'Instant', controllerId: 'p2' },
      subjectControllerId: 'p2',
      sourcePermanent: watcher,
      fromZone: 'library',
      matchContext: { fromZone: 'library', zoneOwnerId: 'p2', exileControllerId: 'p1', causeControllerId: 'p1' },
    });
    expect(lines.length).toBe(1);
    const miss = collectMatchingParsedEventLines({
      ctx: ctxOf([watcher]),
      oracleText: text,
      event: 'exiled',
      subjectPermanent: { id: 'c1', typeLine: 'Instant', controllerId: 'p2' },
      subjectControllerId: 'p2',
      sourcePermanent: watcher,
      fromZone: 'hand',
      matchContext: { fromZone: 'hand', zoneOwnerId: 'p2', exileControllerId: 'p1', causeControllerId: 'p1' },
    });
    expect(miss.length).toBe(0);
  });
});
