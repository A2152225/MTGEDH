import { describe, expect, it } from 'vitest';
import { parseTriggerClause } from '../../rules-engine/src/triggerCondition/index.js';
import { resolvePlayerDamage } from '../src/state/modules/combat-damage-processing.js';
import { collectMatchingParsedEventLines } from '../src/state/modules/triggers/triggerConditionFamilyMatch.js';
import { detectLifegainTriggers } from '../src/state/modules/triggers/lifegain.js';

const perm = (id: string, controller: string, name: string, oracle: string, type: string, extra: any = {}) =>
  ({ id, controller, owner: controller, tapped: false, counters: {}, damage: 0, ...extra, card: { id: id + '_c', name, type_line: type, oracle_text: oracle } });
const ctxOf = (battlefield: any[]) => ({
  gameId: 'unknown', isReplaying: false,
  state: { players: [{ id: 'p1', life: 40 }, { id: 'p2', life: 40 }], life: { p1: 40, p2: 40 }, activePlayer: 'p1', turnPlayer: 'p1', turnNumber: 3, battlefield, stack: [] },
}) as any;
const trig = (ctx: any) => ctx.state.stack.filter((s: any) => s.type === 'triggered_ability');

describe("round 11: you're dealt noncombat damage", () => {
  const watcher = () => perm('w', 'p1', 'Pain Watcher', "Whenever you're dealt noncombat damage, draw a card.", 'Creature');
  it('fires once from the central noncombat hook', () => {
    const ctx = ctxOf([watcher()]);
    resolvePlayerDamage(ctx, { targetPlayerId: 'p1', amount: 3, isCombatDamage: false });
    expect(trig(ctx).length).toBe(1);
    expect(trig(ctx)[0].triggerType).toBe('you_are_dealt_damage');
  });
  it('does not fire for combat damage or damage to an opponent', () => {
    const ctx = ctxOf([watcher()]);
    resolvePlayerDamage(ctx, { targetPlayerId: 'p1', amount: 3, isCombatDamage: true });
    resolvePlayerDamage(ctx, { targetPlayerId: 'p2', amount: 3, isCombatDamage: false });
    expect(trig(ctx).length).toBe(0);
  });
  it('"you\'re dealt damage" also fires for noncombat damage', () => {
    const ctx = ctxOf([perm('w', 'p1', 'Any Watcher', "Whenever you're dealt damage, draw a card.", 'Creature')]);
    resolvePlayerDamage(ctx, { targetPlayerId: 'p1', amount: 2 });
    expect(trig(ctx).length).toBe(1);
  });
});

describe('round 11 parses', () => {
  it.each([
    ['Whenever this creature deals combat damage to a player or planeswalker, draw a card.', 'deals_combat_damage_to_player'],
    ['Whenever this creature deals combat damage to a player or battle, draw a card.', 'deals_combat_damage_to_player'],
    ['Whenever you attack a player, draw a card.', 'attacks'],
    ['When this land enters untapped, draw a card.', 'enters'],
    ['Whenever you gain life for the first time each turn, draw a card.', 'gains_life'],
  ])('%s', (text, event) => {
    expect(parseTriggerClause(text)?.condition.event).toBe(event);
  });
  it('dies or is put into exile pairs exiled', () => {
    const c: any = parseTriggerClause('When this creature dies or is put into exile from the battlefield, draw a card.')?.condition;
    expect(c.event).toBe('dies');
    expect(c.pairedEvent).toBe('exiled');
  });
});

describe('round 11 runtime', () => {
  it('enters untapped requires the land to be untapped', () => {
    const oracle = 'When this land enters untapped, draw a card.';
    const run = (tapped: boolean) => {
      const land = perm('l', 'p1', 'Sanctuary', oracle, 'Land', { tapped });
      return collectMatchingParsedEventLines({ ctx: ctxOf([land]), oracleText: oracle, event: 'enters' as any, subjectPermanent: land, subjectControllerId: 'p1', sourcePermanent: land } as any).length;
    };
    expect(run(false)).toBe(1);
    expect(run(true)).toBe(0);
  });
  it('first-time life gain IR line is skipped once fired this turn', () => {
    const p = perm('s', 'p1', 'Seraphish', 'Whenever you gain life for the first time each turn, scry 1.', 'Creature');
    const ctx = ctxOf([p]);
    expect(detectLifegainTriggers(ctx, 'p1', 2).length).toBe(1);
    ctx.state.lifegainTriggersFiredThisTurn = { ['seraphish_s']: true };
    expect(detectLifegainTriggers(ctx, 'p1', 2).length).toBe(0);
  });
});
