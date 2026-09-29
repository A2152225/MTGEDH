import { describe, expect, it } from 'vitest';
import type { PlayerID } from '../../shared/src/index.js';
import { createInitialGameState } from '../src/state/gameState.js';
import {
  computeCurrentPowerToughnessWithSources,
  getCurrentPowerToughness,
} from '../src/state/modules/currentPowerToughness.js';
import { getActualPowerToughness } from '../src/state/utils.js';
import { getEffectivePower, getEffectiveToughness } from '../src/socket/util-handlers/getEffectivePowerToughness.js';
import {
  expireEndOfCombatPtEffects,
  expireUntilNextTurnPtModifiers,
  recordEndOfCombatKeywordPtBonus,
  sumLongDurationPtModifiers,
} from '../src/state/modules/longDurationPtModifiers.js';
import { removeExpiredUntilNextTurnEffects } from '../src/state/modules/turn-handlers/turnExpiredUntilNextTurnEffects.js';
import { clearCombatState } from '../src/state/modules/turn-handlers/turnClearCombatState.js';
import { applyKeywordPTMod } from '../src/state/modules/keyword-handlers.js';
import { applyLayer7bSetBasePowerToughness } from '../src/state/modules/setBasePtTimestampResolution.js';
import { resolveOracleIrSetPowerToughness } from '../src/state/modules/oracleIrSetPowerToughness.js';

const p1 = 'p1' as PlayerID;
const p2 = 'p2' as PlayerID;

function bear(extra: Record<string, unknown> = {}) {
  return {
    id: 'mine', controller: p1, owner: p1, tapped: false, counters: {},
    card: { id: 'mine_card', name: 'Grizzly Bears', type_line: 'Creature - Bear', oracle_text: '', power: '2', toughness: '2' },
    ...extra,
  };
}

function frogAura(id: string, oracle = 'Enchanted creature loses all abilities and is a blue Frog creature with base power and toughness 1/1.') {
  return {
    id, controller: p1, owner: p1, attachedTo: 'mine', tapped: false, counters: {},
    card: { id: `${id}_card`, name: 'Frogify', type_line: 'Enchantment - Aura', oracle_text: `Enchant creature\n${oracle}` },
  };
}

function setup(gameId: string, battlefield: any[], turnNumber = 3, turnPlayer: PlayerID = p1) {
  const game = createInitialGameState(gameId);
  game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
  game.applyEvent!({ type: 'join', playerId: p2, name: 'P2' } as any);
  const state: any = game.state;
  state.turnNumber = turnNumber;
  state.turnPlayer = turnPlayer;
  state.battlefield = battlefield;
  const ctx: any = game;
  ctx.gameId = gameId;
  return ctx;
}

const perm = (ctx: any, id = 'mine'): any => (ctx.state.battlefield as any[]).find((entry) => entry.id === id);

const untilNext = (extra: Record<string, unknown> = {}) => ({
  type: 'powerToughness', power: -1, toughness: 0, duration: 'until_next_turn',
  expiresOnControllerTurn: 'p2', turnApplied: 3, sourceId: 'wasp', ...extra,
});

describe('item 2: pumps lasting longer than end of turn are counted by the shared calculation', () => {
  it('counts an until-your-next-turn pump in every reader', () => {
    const ctx = setup('lp_count_next', [bear({ modifiers: [untilNext({ power: 3, toughness: 1 })] })]);
    expect(getCurrentPowerToughness(perm(ctx), ctx.state)).toEqual({ power: 5, toughness: 3 });
    expect(getEffectivePower(perm(ctx), ctx.state)).toBe(5);
    expect(getEffectiveToughness(perm(ctx), ctx.state)).toBe(3);
    const sources = computeCurrentPowerToughnessWithSources(perm(ctx), ctx.state)!.sources;
    expect(sources.find((source) => source.name === 'Lasting effects')).toMatchObject({ power: 3, toughness: 1 });
  });

  it('counts end_of_combat, static and permanent pumps', () => {
    const ctx = setup('lp_count_kinds', [bear({
      modifiers: [
        { type: 'powerToughness', power: 2, toughness: 0, duration: 'end_of_combat', turnApplied: 3 },
        { type: 'powerToughness', power: 1, toughness: 1, duration: 'static' },
        { type: 'powerToughness', power: 1, toughness: 1, duration: 'permanent' },
      ],
    })]);
    expect(getCurrentPowerToughness(perm(ctx), ctx.state)).toEqual({ power: 6, toughness: 4 });
  });

  it('does not double count end-of-turn pumps (mirrored or not)', () => {
    const eot = { type: 'powerToughness', power: 2, toughness: 2, duration: 'end_of_turn', sourceId: 'gg' };
    const mirror = { power: 2, toughness: 2, source: 'gg', expiresAt: 'end_of_turn', turnApplied: 3 };
    const mirrored = setup('lp_eot_mirrored', [bear({ modifiers: [eot], temporaryPTMods: [mirror] })]);
    expect(getCurrentPowerToughness(perm(mirrored), mirrored.state)).toEqual({ power: 4, toughness: 4 });
    const unmirrored = setup('lp_eot_unmirrored', [bear({ modifiers: [eot] })]);
    expect(getCurrentPowerToughness(perm(unmirrored), unmirrored.state)).toEqual({ power: 4, toughness: 4 });
    expect(sumLongDurationPtModifiers(perm(unmirrored))).toEqual({ power: 0, toughness: 0 });
  });

  it('stops counting an until-your-next-turn pump once that player\'s next turn has begun', () => {
    // expires on p2's turn; applied turn 3 (p1); it is now turn 4, p2 active, cleanup not yet run
    const ctx = setup('lp_stop_counting', [bear({ modifiers: [untilNext({ power: -1 })] })], 4, p2);
    expect(getCurrentPowerToughness(perm(ctx), ctx.state)).toEqual({ power: 2, toughness: 2 });
    const opponentTurn = setup('lp_still_counting', [bear({ modifiers: [untilNext({ power: -1 })] })], 4, p1);
    expect(getCurrentPowerToughness(perm(opponentTurn), opponentTurn.state)).toEqual({ power: 1, toughness: 2 });
  });
});

describe('item 2: long pumps expire correctly', () => {
  it('removeExpiredUntilNextTurnEffects drops the pump only at the controller\'s next turn', () => {
    const ctx = setup('lp_expire_next', [bear({ modifiers: [untilNext(), { type: 'powerToughness', power: 1, toughness: 1, duration: 'static' }] })]);
    // opponent (p1) turn starts: the p2-controlled pump stays
    removeExpiredUntilNextTurnEffects(ctx, p1, 4);
    expect(perm(ctx).modifiers).toHaveLength(2);
    // p2's next turn starts: the pump goes, the permanent one stays
    removeExpiredUntilNextTurnEffects(ctx, p2, 4);
    expect(perm(ctx).modifiers).toHaveLength(1);
    expect(perm(ctx).modifiers[0].duration).toBe('static');
    expect(getCurrentPowerToughness(perm(ctx), ctx.state)).toEqual({ power: 3, toughness: 3 });
  });

  it('does not expire a pump applied this very turn', () => {
    const ctx = setup('lp_same_turn', [bear({ modifiers: [untilNext({ turnApplied: 4 })] })], 4, p2);
    removeExpiredUntilNextTurnEffects(ctx, p2, 4);
    expect(perm(ctx).modifiers).toHaveLength(1);
  });

  it('expireUntilNextTurnPtModifiers reports how many were removed and clears cached stats', () => {
    const permanent: any = bear({ effectivePower: 9, modifiers: [untilNext()] });
    expect(expireUntilNextTurnPtModifiers([permanent], 'p2', 4)).toBe(1);
    expect(permanent.modifiers).toBeUndefined();
    expect(permanent.effectivePower).toBeUndefined();
  });

  it('clearCombatState removes end_of_combat pumps but keeps end_of_turn and permanent ones', () => {
    const ctx = setup('lp_expire_combat', [bear({
      modifiers: [
        { type: 'powerToughness', power: 2, toughness: 0, duration: 'end_of_combat' },
        { type: 'powerToughness', power: 1, toughness: 1, duration: 'end_of_turn', sourceId: 'gg' },
        { type: 'powerToughness', power: 1, toughness: 1, duration: 'permanent' },
      ],
      temporaryPTMods: [{ power: 3, toughness: 3, expiresAt: 'end_of_combat' }, { power: 1, toughness: 1, expiresAt: 'end_of_turn', source: 'gg' }],
    })]);
    // base 2 + end_of_combat 2 + permanent 1 + mirrored end-of-turn 1 (the unmirrored duplicate is not double counted)
    expect(getCurrentPowerToughness(perm(ctx), ctx.state)).toEqual({ power: 6, toughness: 4 });
    clearCombatState(ctx);
    expect(perm(ctx).modifiers.map((m: any) => m.duration)).toEqual(['end_of_turn', 'permanent']);
    expect(perm(ctx).temporaryPTMods).toHaveLength(1);
    expect(getCurrentPowerToughness(perm(ctx), ctx.state)).toEqual({ power: 4, toughness: 4 });
  });

  it('a keyword end-of-combat pump (e.g. "gets +2/+0 until end of combat") ends with combat, an end-of-turn one does not', () => {
    const permanent: any = bear();
    applyKeywordPTMod(permanent, { ptModification: { power: 1, toughness: 1, duration: 'end_of_turn' } } as any);
    applyKeywordPTMod(permanent, { ptModification: { power: 2, toughness: 0, duration: 'end_of_combat' } } as any);
    expect(permanent.temporaryPowerBoost).toBe(3);
    expect(expireEndOfCombatPtEffects([permanent])).toBeGreaterThan(0);
    expect(permanent.temporaryPowerBoost).toBe(1);
    expect(permanent.tempPowerBonus).toBe(1);
    expect(permanent.temporaryToughnessBoost).toBe(1);
    expect(permanent.tempBonusExpires).toBeUndefined();
    const solo: any = bear();
    recordEndOfCombatKeywordPtBonus(solo, 2, 0);
    solo.temporaryPowerBoost = 2;
    expireEndOfCombatPtEffects([solo]);
    expect(solo.temporaryPowerBoost).toBeUndefined();
  });
});

describe('item 3: layer 7b set-base effects resolve last-timestamp-wins', () => {
  const setter = (setPower: number, setToughness: number, timestamp: number, extra: Record<string, unknown> = {}) => ({
    type: 'setPowerToughness', setPower, setToughness, timestamp, duration: 'end_of_turn', sourceId: `s${timestamp}`, ...extra,
  });

  it('two Oracle IR setters: the highest timestamp wins even when it comes first in the array', () => {
    const ctx = setup('ts_two', [bear({ modifiers: [setter(5, 5, 9), setter(1, 1, 2)] })]);
    expect(getCurrentPowerToughness(perm(ctx), ctx.state)).toEqual({ power: 5, toughness: 5 });
    expect(getActualPowerToughness(perm(ctx), ctx.state)).toEqual({ power: 5, toughness: 5 });
    expect(resolveOracleIrSetPowerToughness(perm(ctx))).toEqual({ power: 5, toughness: 5 });
  });

  it('legacy setters without a timestamp keep array order (last wins)', () => {
    const legacy = (p: number) => ({ type: 'setPowerToughness', setPower: p, setToughness: p, duration: 'end_of_turn' });
    const ctx = setup('ts_legacy', [bear({ modifiers: [legacy(3), legacy(1)] })]);
    expect(getCurrentPowerToughness(perm(ctx), ctx.state)).toEqual({ power: 1, toughness: 1 });
  });

  it('a power-only later setter keeps the earlier toughness', () => {
    const ctx = setup('ts_partial', [bear({ modifiers: [setter(4, 6, 1), { type: 'setPowerToughness', setPower: 0, timestamp: 2 }] })]);
    expect(getCurrentPowerToughness(perm(ctx), ctx.state)).toEqual({ power: 0, toughness: 6 });
  });

  it('an Oracle IR setter created after an Aura beats it', () => {
    const battlefield = [bear({ modifiers: [setter(4, 4, 1, { battlefieldPosition: 2, battlefieldAnchorId: 'frog' })] }), frogAura('frog')];
    const ctx = setup('ts_after_aura', battlefield);
    // battlefield: [mine, frog]; setter recorded with position 2 (after frog)
    expect(getCurrentPowerToughness(perm(ctx), ctx.state)).toEqual({ power: 4, toughness: 4 });
  });

  it('an Aura that entered after the Oracle IR setter beats it', () => {
    const battlefield = [
      bear({ modifiers: [setter(4, 4, 1, { battlefieldPosition: 1, battlefieldAnchorId: 'mine' })] }),
      frogAura('frog'),
    ];
    const ctx = setup('ts_before_aura', battlefield);
    expect(getCurrentPowerToughness(perm(ctx), ctx.state)).toEqual({ power: 1, toughness: 1 });
    expect(getActualPowerToughness(perm(ctx), ctx.state)).toEqual({ power: 1, toughness: 1 });
  });

  it('with two Auras the later Aura wins, and a setter between them beats only the earlier one', () => {
    const lignify = frogAura('lignify', 'Enchanted creature is a Treefolk with base power and toughness 0/4 and loses all abilities.');
    const frog = frogAura('frog');
    const battlefield = [
      bear({ modifiers: [setter(7, 7, 1, { battlefieldPosition: 2, battlefieldAnchorId: 'frog' })] }),
      frog,
      lignify,
    ];
    const ctx = setup('ts_between', battlefield);
    // frog (index 1) < setter (position 2 => after frog) < lignify (index 2): lignify wins
    expect(getCurrentPowerToughness(perm(ctx), ctx.state)).toEqual({ power: 0, toughness: 4 });
    const setterLast = [
      bear({ modifiers: [setter(7, 7, 1, { battlefieldPosition: 3, battlefieldAnchorId: 'lignify' })] }),
      frog,
      lignify,
    ];
    const ctx2 = setup('ts_last', setterLast);
    expect(getCurrentPowerToughness(perm(ctx2), ctx2.state)).toEqual({ power: 7, toughness: 7 });
  });

  it('without any setter the previous Aura-based result is unchanged', () => {
    const ctx = setup('ts_none', [bear(), frogAura('frog')]);
    expect(applyLayer7bSetBasePowerToughness(perm(ctx), ctx.state, { power: 2, toughness: 2 })).toEqual({ power: 1, toughness: 1 });
    expect(getCurrentPowerToughness(perm(ctx), ctx.state)).toEqual({ power: 1, toughness: 1 });
  });

  it('a newer setter still lets counters and pumps apply on top', () => {
    const ctx = setup('ts_pumps', [bear({
      counters: { '+1/+1': 1 },
      modifiers: [setter(0, 1, 1), setter(3, 3, 2), { type: 'powerToughness', power: 1, toughness: 1, duration: 'until_next_turn', expiresOnControllerTurn: 'p2', turnApplied: 3 }],
    })]);
    expect(getCurrentPowerToughness(perm(ctx), ctx.state)).toEqual({ power: 5, toughness: 5 });
  });
});