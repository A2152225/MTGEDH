import { describe, expect, it } from 'vitest';
import { parseTriggerClause } from '../../rules-engine/src/triggerCondition/index.js';
import { stripReminderParentheticals } from '../../rules-engine/src/oracleReminderText.js';
import { getAttackTriggersForCreatures } from '../src/state/modules/triggers/attack-triggers-for-creatures.js';
import { collectMatchingParsedEventLines } from '../src/state/modules/triggers/triggerConditionFamilyMatch.js';
import { queueParsedKeywordAction } from '../src/state/modules/triggerEmissionFamilyUtils.js';

const perm = (id: string, controller: string, name: string, oracle: string, type = 'Creature - Human') =>
  ({ id, controller, owner: controller, tapped: false, counters: {}, damage: 0, card: { id: `${id}_c`, name, type_line: type, oracle_text: oracle, power: '2', toughness: '5' } });
const ctxOf = (battlefield: any[], turnPlayer = 'p1') => ({
  gameId: 'unknown', isReplaying: false,
  state: { players: [{ id: 'p1', life: 40 }, { id: 'p2', life: 40 }, { id: 'p3', life: 40 }], life: { p1: 40, p2: 40, p3: 40 }, activePlayer: turnPlayer, turnPlayer, turnNumber: 4, battlefield, stack: [] },
}) as any;
const trig = (ctx: any, name: string) => ctx.state.stack.filter((s: any) => s.type === 'triggered_ability' && String(s.sourceName || '').includes(name));

describe('round 8 parses', () => {
  it.each([
    ['Whenever an enchantment you control enters and whenever you fully unlock a Room, put a +1/+1 counter on target creature.', 'enters'],
    ['When this creature is turned face up, draw a card.', 'turned_face_up'],
    ['Whenever a permanent you control is turned face up, draw a card.', 'turned_face_up'],
    ['When this Spacecraft enters, draw a card.', 'enters'],
    ['When this Class enters, draw a card.', 'enters'],
    ['When this Class becomes level 2, draw a card.', 'class_level'],
    ['Whenever enchanted land is tapped for mana, its controller adds an additional one mana of any color.', 'tapped_for_mana'],
    ['Whenever a player taps a land for mana, that player adds one mana of any type that land produced.', 'tapped_for_mana'],
    ['When you control no Islands, sacrifice this creature.', 'controls_none'],
    ['Whenever a creature attacks you or a planeswalker you control, investigate.', 'attacks'],
    ["Whenever you cast a spell during an opponent's turn, draw a card.", 'spell_cast'],
    ['Whenever this creature blocks a creature, draw a card.', 'blocks'],
    ['Whenever you scry or surveil, draw a card.', 'performs'],
    ['Whenever you cast an instant or sorcery spell from your hand, draw a card.', 'spell_cast'],
  ])('%s', (line, event) => { expect(parseTriggerClause(line, 'P')?.condition.event).toBe(event); });

  it('transforms into a face name keeps the epithet out of the effect', () => {
    const avacyn = parseTriggerClause('When this creature transforms into Avacyn, the Purifier, it deals 3 damage to each other creature and each opponent.', 'Archangel Avacyn // Avacyn, the Purifier');
    expect(avacyn?.condition.event).toBe('transforms');
    expect(avacyn?.effect).toMatch(/^it deals 3 damage/);
    const grub = parseTriggerClause('Whenever this creature enters or transforms into Grub, Storied Matriarch, return up to one target Goblin card from your graveyard to your hand.', 'Grub, Storied Matriarch // Grub, Notorious Auntie');
    expect(grub?.condition.event).toBe('enters');
    expect(grub?.condition.pairedEvent).toBe('transforms');
    expect(grub?.effect).toMatch(/^return up to one/);
  });

  it('class level and opponent-turn qualifiers are captured', () => {
    expect(parseTriggerClause('When this Class becomes level 3, draw a card.', 'P')?.condition.classLevel).toBe(3);
    expect(parseTriggerClause("Whenever you cast a spell during an opponent's turn, draw a card.", 'P')?.condition.whoseTurn).toBe('each_opponent');
    expect(parseTriggerClause('Whenever you cast an instant or sorcery spell from your hand, draw a card.', 'P')?.condition.castFromZone).toBe('hand');
  });

  it('decayed reminder is stripped and "creatures enter" stays unparsed', () => {
    expect(stripReminderParentheticals("Create a 2/2 black Zombie creature token with decayed. (It can't block. When it attacks, sacrifice it at end of combat.)")).not.toMatch(/when it attacks/i);
    expect(parseTriggerClause('Whenever creatures enter, draw a card.', 'P')).toBeNull();
  });
});

describe('attacks you or a planeswalker you control', () => {
  const premises = () => perm('w', 'p1', 'Premises', 'Whenever a creature attacks you or a planeswalker you control, investigate.', 'Enchantment');
  it('fires once for an attack on you or your planeswalker, not on another player', () => {
    const w = premises();
    const pw = perm('pw', 'p1', 'Walker', '', 'Legendary Planeswalker - Jace');
    const a = { ...perm('a', 'p2', 'A', ''), attacking: 'p1' };
    const b = { ...perm('b', 'p2', 'B', ''), attacking: 'pw' };
    const c = { ...perm('c', 'p2', 'C', ''), attacking: 'p3' };
    const ctx = ctxOf([w, pw, a, b, c], 'p2');
    expect(getAttackTriggersForCreatures(ctx, [a], 'p2', 'p1').filter((t: any) => t.permanentId === 'w')).toHaveLength(1);
    expect(getAttackTriggersForCreatures(ctx, [b], 'p2', 'p1').filter((t: any) => t.permanentId === 'w')).toHaveLength(1);
    expect(getAttackTriggersForCreatures(ctx, [c], 'p2', 'p3').filter((t: any) => t.permanentId === 'w')).toHaveLength(0);
  });
});

describe('scry or surveil', () => {
  it('fires on either action by you, not on others or opponents', () => {
    const w = perm('w', 'p1', 'Proft', 'Whenever you scry or surveil, draw a card.');
    const ctx = ctxOf([w]);
    queueParsedKeywordAction(ctx, 'p1', 'scry');
    expect(trig(ctx, 'Proft')).toHaveLength(1);
    queueParsedKeywordAction(ctx, 'p1', 'surveil');
    expect(trig(ctx, 'Proft').length).toBeGreaterThanOrEqual(1);
    const before = trig(ctx, 'Proft').length;
    queueParsedKeywordAction(ctx, 'p1', 'explore');
    queueParsedKeywordAction(ctx, 'p2', 'scry');
    expect(trig(ctx, 'Proft')).toHaveLength(before);
  });
});

describe('cast qualifiers', () => {
  const spell = (zone: string) => ({ id: 'sp', controller: 'p1', castSourceZone: zone, card: { name: 'Bolt', type_line: 'Instant', oracle_text: '' }, type_line: 'Instant', name: 'Bolt' });
  const lines = (ctx: any, src: any, zone: string) => collectMatchingParsedEventLines({ ctx, oracleText: src.card.oracle_text, event: 'spell_cast', subjectPermanent: spell(zone), subjectControllerId: 'p1', sourcePermanent: src, castFromZone: zone });
  it("during an opponent's turn uses the turn player", () => {
    const w = perm('w', 'p1', 'Spoilers', "Whenever you cast a spell during an opponent's turn, draw a card.");
    expect(lines(ctxOf([w], 'p2'), w, 'hand')).toHaveLength(1);
    expect(lines(ctxOf([w], 'p1'), w, 'hand')).toHaveLength(0);
  });
  it('from your hand requires the hand zone', () => {
    const w = perm('w', 'p1', 'Pursuit', 'Whenever you cast an instant or sorcery spell from your hand, draw a card.');
    expect(lines(ctxOf([w]), w, 'hand')).toHaveLength(1);
    expect(lines(ctxOf([w]), w, 'graveyard')).toHaveLength(0);
  });
});
