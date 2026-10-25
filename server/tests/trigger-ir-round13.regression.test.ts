import { describe, expect, it } from 'vitest';
import { parseTriggerClause } from '../../rules-engine/src/triggerCondition/index.js';
import { applyCreatureCombatDamageFromSource } from '../src/state/modules/combat-damage-processing.js';
import { collectRecipientVariantCombatDamageTriggers } from '../src/state/modules/turn-handlers/turnCombatDamageRecipientVariantTriggers.js';
import { parsedEventLinesFor } from '../src/state/modules/triggers/triggerConditionFamilyMatch.js';

const perm = (id: string, controller: string, name: string, oracle: string, type: string, extra: any = {}) =>
  ({ id, controller, owner: controller, tapped: false, counters: {}, damage: 0, ...extra, card: { id: id + '_c', name, type_line: type, oracle_text: oracle } });
const ctxOf = (battlefield: any[]) => ({
  gameId: 'unknown', isReplaying: false,
  state: { players: [{ id: 'p1', life: 40 }, { id: 'p2', life: 40 }], life: { p1: 40, p2: 40 }, activePlayer: 'p1', turnPlayer: 'p1', turnNumber: 3, battlefield, stack: [] },
}) as any;

describe('round 13: blocker combat damage (Jitte on a blocker)', () => {
  const setup = () => {
    const attacker = perm('a', 'p1', 'Attacker', '', 'Creature', { power: 2, toughness: 5, card: { id: 'a_c', name: 'Attacker', type_line: 'Creature', oracle_text: '', power: '2', toughness: '5' } });
    const blocker = perm('b', 'p2', 'Blocker', '', 'Creature', { attachments: ['j'], power: 2, toughness: 2, card: { id: 'b_c', name: 'Blocker', type_line: 'Creature', oracle_text: '', power: '2', toughness: '2' } });
    const jitte = perm('j', 'p2', 'Jitte', 'Whenever equipped creature deals combat damage, put two charge counters on this Equipment.', 'Artifact - Equipment', { attachedTo: 'b' });
    return { attacker, blocker, jitte, bf: [attacker, blocker, jitte] };
  };
  it('a blocker that deals combat damage fires its Jitte exactly once', () => {
    const { attacker, blocker, bf } = setup();
    const ctx = ctxOf(bf);
    applyCreatureCombatDamageFromSource(ctx, blocker, attacker, 2);
    applyCreatureCombatDamageFromSource(ctx, blocker, attacker, 0);
    const out: any[] = [];
    collectRecipientVariantCombatDamageTriggers(ctx, bf, {}, out, false);
    expect(out.length).toBe(1);
    expect(out[0].stackItem.permanentId).toBe('j');
    const again: any[] = [];
    collectRecipientVariantCombatDamageTriggers(ctx, bf, {}, again, false);
    expect(again.length).toBe(0);
  });
  it('a blocker with "deals combat damage to a creature" fires', () => {
    const { attacker, bf } = setup();
    const blocker = perm('b2', 'p2', 'Biter', 'Whenever this creature deals combat damage to a creature, draw a card.', 'Creature', { power: 1, toughness: 1 });
    const ctx = ctxOf([...bf, blocker]);
    applyCreatureCombatDamageFromSource(ctx, blocker, attacker, 1);
    const out: any[] = [];
    collectRecipientVariantCombatDamageTriggers(ctx, [...bf, blocker], {}, out, false);
    expect(out.some((o) => o.stackItem.permanentId === 'b2')).toBe(true);
  });
});

const cond = (text: string) => (parseTriggerClause(text) as any)?.condition;

describe('round 13: census wordings parse', () => {
  it('enters or is put into a graveyard from the battlefield', () => {
    expect(cond('When this artifact enters or is put into a graveyard from the battlefield, draw a card.')).toMatchObject({ event: 'enters', pairedEvent: 'put_into_graveyard' });
  });
  it('enters or leaves the battlefield / enters or is turned face up', () => {
    expect(cond('When this artifact enters or leaves the battlefield, draw a card.')).toMatchObject({ event: 'enters', pairedEvent: 'leaves_battlefield' });
    expect(cond('When this creature enters or is turned face up, draw a card.')).toMatchObject({ event: 'enters', pairedEvent: 'turned_face_up' });
  });
  it('Sojourner cycle-or-dies', () => {
    expect(cond('When you cycle this card and when this creature dies, draw a card.')).toMatchObject({ event: 'dies', pairedEvent: 'cycles' });
  });
  it('enchanted creature attacks or blocks', () => {
    expect(cond('Whenever enchanted creature attacks or blocks, draw a card.')).toMatchObject({ event: 'attacks', pairedEvent: 'blocks' });
  });
  it('legacy-runtime wordings parse but fail closed', () => {
    for (const t of [
      'When you pay this cost one or more times, draw a card.',
      "At the beginning of that turn's end step, draw a card.",
      'When you discard a card this way, draw a card.',
      'Whenever enchanted player is attacked, draw a card.',
    ]) expect(cond(t)).toMatchObject({ legacyRuntimeOnly: true });
  });
  it('paired lines match both events', () => {
    const oracle = 'When this creature enters or is turned face up, draw a card.';
    expect(parsedEventLinesFor(oracle, ['turned_face_up']).length).toBe(1);
    expect(parsedEventLinesFor(oracle, ['enters']).length).toBe(1);
  });
});
