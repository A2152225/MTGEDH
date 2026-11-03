import { describe, expect, it, afterEach } from 'vitest';
import { isInterveningIfSatisfied, setUnknownInterveningIfPolicy } from '../src/state/modules/triggers/intervening-if.js';
import { recordTurnScoped } from '../src/state/modules/triggers/intervening-if-eval-round41-clauses.js';
import { propagateCastMetadataToEnteringPermanent } from '../src/state/modules/stackResolvePermanentCastMetadata.js';
import { permanentToTriggerMatch } from '../src/state/modules/triggers/triggerConditionFamilyMatch.js';
import { parseTriggerClause, triggerConditionMatches } from '../../rules-engine/src/triggerCondition/index.js';

const zone = () => ({ hand: [] as any[], graveyard: [] as any[], exile: [], library: [] });
const perm = (id: string, controller: string, type_line: string, extra: any = {}, cardExtra: any = {}) => ({ id, controller, owner: controller, tapped: false, counters: {}, ...extra, card: { id: id + '_c', name: id, type_line, oracle_text: '', ...cardExtra } });
const ctxOf = (battlefield: any[], extra: any = {}) => ({ gameId: 'r41', isReplaying: false, state: { battlefield, stack: [] as any[], turnNumber: 5, turnPlayer: 'p1', activePlayer: 'p1', players: [{ id: 'p1' }, { id: 'p2' }, { id: 'p3' }], zones: { p1: zone(), p2: zone(), p3: zone() }, ...extra } } as any);
const sat = (ctx: any, src: any, clause: string, refs?: any) => isInterveningIfSatisfied(ctx, 'p1', 'When this creature enters, ' + clause + ', draw a card.', src, refs);

describe('round 41 intervening-if: cast options', () => {
  afterEach(() => setUnknownInterveningIfPolicy('skip'));
  it('kicked / bargained flags propagate to the permanent and decide', () => {
    const p1 = perm('k', 'p1', 'Creature - Elf');
    propagateCastMetadataToEnteringPermanent({ type: 'spell', wasKicked: false, card: {} }, {}, p1, false);
    expect((p1 as any).castOptionsStamped).toBe(true);
    expect(sat(ctxOf([p1]), p1, 'if it was kicked')).toBe(false);
    expect(sat(ctxOf([p1]), p1, "if it wasn't kicked")).toBe(true);
    const p2 = perm('k2', 'p1', 'Creature - Elf');
    propagateCastMetadataToEnteringPermanent({ type: 'spell', wasKicked: true, kickerPaidCount: 1, card: {} }, {}, p2, false);
    expect(sat(ctxOf([p2]), p2, 'if it was kicked')).toBe(true);
    const p3 = perm('b', 'p1', 'Creature - Faerie');
    propagateCastMetadataToEnteringPermanent({ type: 'spell', wasBargained: true, bargainResolved: true, card: {} }, {}, p3, false);
    expect(sat(ctxOf([p3]), p3, 'if it was bargained')).toBe(true);
    const morph = perm('m', 'p1', 'Creature');
    propagateCastMetadataToEnteringPermanent({ type: 'spell', wasKicked: true, card: {} }, {}, morph, true);
    expect((morph as any).wasKicked).toBeUndefined();
  });
  it('evoked via alternateCostId; the triggering stack item wins over the source', () => {
    const p = perm('e', 'p1', 'Creature - Elemental', { alternateCostId: 'evoke' });
    expect(sat(ctxOf([p]), p, 'if it was evoked')).toBe(true);
    const src = perm('s', 'p1', 'Creature', { wasKicked: true });
    expect(sat(ctxOf([src]), src, 'if it was kicked', { stackItem: { wasKicked: false } })).toBe(false);
  });
});

describe('round 41 intervening-if: turn trackers', () => {
  it('N or more spells last turn with per-player and total fallback', () => {
    const src = perm('s', 'p1', 'Creature');
    expect(sat(ctxOf([src], { spellsCastLastTurnByPlayerCounts: { p2: 2 }, spellsCastLastTurnCount: 2 }), src, 'if a player cast two or more spells last turn')).toBe(true);
    expect(sat(ctxOf([src], { spellsCastLastTurnByPlayerCounts: { p2: 2 }, spellsCastLastTurnCount: 2 }), src, 'if you cast two or more spells last turn')).toBe(false);
    expect(sat(ctxOf([src], { spellsCastLastTurnByPlayerCounts: { p2: 3 }, spellsCastLastTurnCount: 3 }), src, 'if an opponent cast three or more spells last turn')).toBe(true);
    expect(sat(ctxOf([src], { spellsCastLastTurnByPlayerCounts: null, spellsCastLastTurnCount: 1 }), src, 'if a player cast two or more spells last turn')).toBe(false);
  });
  it('cast a spell from anywhere other than your hand this turn', () => {
    const src = perm('s', 'p1', 'Creature');
    expect(sat(ctxOf([src], { spellsCastThisTurn: [{ casterId: 'p1', castSourceZone: 'graveyard' }] }), src, 'if you cast a spell from anywhere other than your hand this turn')).toBe(true);
    expect(sat(ctxOf([src], { spellsCastThisTurn: [{ casterId: 'p1' }], spellsCastFromHandThisTurn: { p1: 1 } }), src, 'if you cast a spell from anywhere other than your hand this turn')).toBe(false);
    expect(sat(ctxOf([src], { spellsCastThisTurn: [{ casterId: 'p2', castSourceZone: 'exile' }] }), src, 'if you cast a spell from anywhere other than your hand this turn')).toBe(false);
  });
  it('all opponents dealt combat damage this turn (turn-tagged)', () => {
    const src = perm('s', 'p1', 'Creature');
    const ctx = ctxOf([src]);
    recordTurnScoped(ctx.state, 'combatDamagedPlayersThisTurn', 'players', 'p2', 3);
    expect(sat(ctx, src, 'if all opponents were dealt combat damage this turn')).toBe(false);
    recordTurnScoped(ctx.state, 'combatDamagedPlayersThisTurn', 'players', 'p3', 1);
    expect(sat(ctx, src, 'if all opponents were dealt combat damage this turn')).toBe(true);
    ctx.state.turnNumber = 6;
    expect(sat(ctx, src, 'if all opponents were dealt combat damage this turn')).toBe(false);
  });
  it('a modified creature died under your control this turn', () => {
    const src = perm('s', 'p1', 'Creature');
    const ctx = ctxOf([src], { modifiedCreaturesDiedThisTurn: { turn: 5, byController: { p1: 1 } } });
    expect(sat(ctx, src, 'if a modified creature died under your control this turn')).toBe(true);
    ctx.state.turnNumber = 6;
    expect(sat(ctx, src, 'if a modified creature died under your control this turn')).toBe(false);
  });
});

describe('round 41 trigger parsing', () => {
  const cond = (s: string) => parseTriggerClause(s)?.condition as any;
  it('attacks a player / an opponent (singular and batched)', () => {
    expect(cond('Whenever a Demon you control attacks a player, you draw a card.')).toMatchObject({ event: 'attacks', attackedTargetType: 'player' });
    expect(cond('Whenever a Dragon you control attacks an opponent, draw a card.')).toMatchObject({ event: 'attacks', attackedPlayer: 'opponent' });
    expect(cond('Whenever one or more Demons you control attack a player, draw a card.')).toMatchObject({ event: 'attacks', quantity: 'one_or_more', attackedTargetType: 'player' });
  });
  it('counters on them / power greater than base / modified / nonlegendary / a counter on it', () => {
    const c1 = cond('Whenever one or more creatures you control with +1/+1 counters on them deal combat damage to a player, draw a card.');
    expect(c1).toMatchObject({ event: 'deals_combat_damage_to_player', quantity: 'one_or_more' });
    expect(c1.alternatives[0].subject.counters[0]).toMatchObject({ name: '+1/+1', minimum: 1 });
    const c2 = cond('Whenever one or more creatures you control each with power greater than its base power deals combat damage to a player, draw a card.');
    expect(c2.alternatives[0].subject.powerAboveBase).toBe(true);
    const c3 = cond('Whenever one or more modified creatures you control attack, untap them.');
    expect(c3.alternatives[0].subject.modified).toBe(true);
    expect(cond('Whenever you cast a nonlegendary creature spell, copy that spell.').alternatives[0].subject.excludedWords).toContain('legendary');
    expect(cond('Whenever a creature you control with a counter on it dies, draw a card.').alternatives[0].subject.counters[0]).toEqual({ minimum: 1 });
  });
  it('matches power above base and modified from live permanents', () => {
    const c = cond('Whenever a creature you control with power greater than its base power deals combat damage to a player, draw a card.');
    const src = { id: 'src', controllerId: 'p1' } as any;
    const pumped = permanentToTriggerMatch({ id: 'x', controller: 'p1', basePower: 2, power: 3, card: { type_line: 'Creature', power: '2' } }, 'p1');
    (pumped as any).power = 3;
    expect(triggerConditionMatches(c, pumped, src)).toBe(true);
    (pumped as any).power = 2;
    expect(triggerConditionMatches(c, pumped, src)).toBe(false);
    const m = cond('Whenever one or more modified creatures you control enter, draw a card.');
    const plain = permanentToTriggerMatch({ id: 'y', controller: 'p1', counters: {}, card: { type_line: 'Creature' } }, 'p1', { battlefield: [] });
    const withCounter = permanentToTriggerMatch({ id: 'z', controller: 'p1', counters: { '+1/+1': 1 }, card: { type_line: 'Creature' } }, 'p1', { battlefield: [] });
    expect(triggerConditionMatches(m, plain, src)).toBe(false);
    expect(triggerConditionMatches(m, withCounter, src)).toBe(true);
  });
});
