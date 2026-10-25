import { describe, expect, it } from 'vitest';
import { parseTriggerClause } from '../../rules-engine/src/triggerCondition/index.js';
import { collectMatchingParsedEventLines } from '../src/state/modules/triggers/triggerConditionFamilyMatch.js';
import { getPostcombatMainTriggers } from '../src/state/modules/triggers/turn-phases.js';

const perm = (id: string, controller: string, name: string, oracle: string, type: string) =>
  ({ id, controller, owner: controller, tapped: false, counters: {}, damage: 0, card: { id: id + '_c', name, type_line: type, oracle_text: oracle } });
const ctxOf = (battlefield: any[]) => ({
  gameId: 'unknown', isReplaying: false,
  state: { players: [{ id: 'p1', life: 40 }, { id: 'p2', life: 40 }], life: { p1: 40, p2: 40 }, activePlayer: 'p1', turnPlayer: 'p1', turnNumber: 3, battlefield, stack: [] },
}) as any;

describe('round 10 parses', () => {
  it('spell that targets a creature', () => {
    const c: any = parseTriggerClause('Whenever you cast an instant or sorcery spell that targets a creature, draw a card.')?.condition;
    expect(c.event).toBe('spell_cast');
    expect(c.targets).toBe('creature');
  });
  it('spell that targets a creature you control', () => {
    expect((parseTriggerClause('Whenever you cast a spell that targets a creature you control, draw a card.')?.condition as any).targets).toBe('creature_you_control');
  });
  it("you're dealt damage", () => {
    const a: any = parseTriggerClause('Whenever you are dealt damage, draw a card.')?.condition;
    expect(a.event).toBe('dealt_damage');
    expect(a.playerSubject).toBe(true);
    expect((parseTriggerClause("Whenever you're dealt combat damage, draw a card.")?.condition as any).damageKind).toBe('combat');
  });
  it('enchanted creature is dealt damage', () => {
    const c: any = parseTriggerClause('Whenever enchanted creature is dealt damage, you gain that much life.')?.condition;
    expect(c.event).toBe('dealt_damage');
    expect(c.alternatives[0].source).toBe('enchanted');
  });
  it('each of your postcombat main phases', () => {
    expect(parseTriggerClause('At the beginning of each of your postcombat main phases, draw a card.')?.condition.event).toBe('beginning_of_postcombat_main');
  });
});

describe('round 10 matching', () => {
  const oracle = 'Whenever you cast a spell that targets a creature you control, draw a card.';
  const watcher = perm('w', 'p1', 'Watcher', oracle, 'Creature');
  const run = (targetPermanents: any) => collectMatchingParsedEventLines({
    ctx: ctxOf([watcher]), oracleText: oracle, event: 'spell_cast' as any,
    subjectPermanent: { id: 's', controller: 'p1', card: { type_line: 'Instant' } } as any,
    subjectControllerId: 'p1', sourcePermanent: watcher as any,
    ...(targetPermanents ? { matchContext: { targetPermanents } } : {}),
  } as any);
  it('fires for own creature target', () => {
    expect(run([{ typeLine: 'Creature - Elf', controllerId: 'p1' }]).length).toBe(1);
  });
  it('does not fire for opponent creature or missing targets', () => {
    expect(run([{ typeLine: 'Creature - Elf', controllerId: 'p2' }]).length).toBe(0);
    expect(run(null).length).toBe(0);
  });
  it('postcombat IR skips Tymna-style no-op pay life', () => {
    const t = perm('t', 'p1', 'Tymnalike', 'At the beginning of each of your postcombat main phases, you may pay X life, where X is the number of opponents that were dealt combat damage this turn. If you do, draw X cards.', 'Creature');
    expect(getPostcombatMainTriggers(ctxOf([t]), 'p1').length).toBe(0);
  });
});
