import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { PlayerID } from '../../shared/src/index.js';
import { createInitialGameState } from '../src/state/gameState.js';
import { tryResolveSpellViaOracleIR } from '../src/state/modules/oracleIrSpellExecution.js';
import {
  getCurrentPowerToughness,
  withCurrentPowerToughnessHook,
} from '../src/state/modules/currentPowerToughness.js';
import { getActualPowerToughness } from '../src/state/utils.js';
import { getEffectivePower, getEffectiveToughness } from '../src/socket/util-handlers/getEffectivePowerToughness.js';
import { getEffectivePowerForMana } from '../src/state/modules/mana-abilities-handlers/manaAbilityColorRestrictionUtils.js';
import { tryCalculateManaProductionCreaturePower } from '../src/socket/util-handlers/tryCalculateManaProductionCreaturePower.js';
import { controlledCreaturePowers } from '../src/state/modules/spellSelfCreaturePowerCostReduction.js';
import { resolveEnteringCreatureDiscoverXValue } from '../src/state/modules/triggerEtbEntryEffects-handlers/triggerEtbTypedPermanentMatch.js';
import { planAttackWatcherQueue } from '../src/state/modules/triggers/attack-watcher-queue.js';
import { applyTriggerDoublers } from '../src/state/modules/triggers/trigger-doublers.js';
import { creatureDiesFromCombatDamage } from '../src/state/modules/combat-damage-processing.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';

// Follow-up to the fight/current-power fix: every remaining rules reader of "its power /
// toughness" uses the same current P/T as the battlefield badge.

const p1 = 'p1' as PlayerID;
const p2 = 'p2' as PlayerID;

function bear(extra: Record<string, unknown> = {}) {
  return {
    id: 'mine', controller: p1, owner: p1, tapped: false, counters: {},
    card: { id: 'mine_card', name: 'Grizzly Bears', type_line: 'Creature - Bear', oracle_text: '', power: '2', toughness: '2' },
    ...extra,
  };
}

function anthem() {
  return {
    id: 'anthem', controller: p1, owner: p1, tapped: false, counters: {},
    card: { id: 'anthem_card', name: 'Glorious Anthem', type_line: 'Enchantment', oracle_text: 'Creatures you control get +1/+1.' },
  };
}

function setup(gameId: string, battlefield: any[]) {
  const game = createInitialGameState(gameId);
  game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
  game.applyEvent!({ type: 'join', playerId: p2, name: 'P2' } as any);
  const state: any = game.state;
  state.turnNumber = 3;
  state.battlefield = battlefield;
  const ctx: any = game;
  ctx.gameId = gameId;
  ResolutionQueueManager.removeQueue(gameId);
  return ctx;
}

function perm(ctx: any, id: string): any {
  return (ctx.state.battlefield as any[]).find((entry) => entry.id === id);
}

const PUMP_MOD = { type: 'powerToughness', power: 2, toughness: 2, duration: 'end_of_turn', sourceId: 'giant-growth-1', sourceName: 'Giant Growth' };
const PUMP_MIRROR = { power: 2, toughness: 2, source: 'giant-growth-1', expiresAt: 'end_of_turn', turnApplied: 3 };

describe('item 2: remaining power readers use current P/T', () => {
  it('"add {G} equal to this creature\'s power" counts anthems and pumps', () => {
    const mine = bear({
      card: { id: 'sage', name: 'Gyre Sage', type_line: 'Creature - Elf Druid', oracle_text: "{T}: Add {G} equal to Gyre Sage's power.", power: '2', toughness: '2' },
      temporaryPTMods: [PUMP_MIRROR],
    });
    const ctx = setup('mana_power_current', [mine, anthem()]);
    const result: any = { colors: [], baseAmount: 1, bonusMana: [], isDynamic: false };
    tryCalculateManaProductionCreaturePower({
      result, cardName: 'gyre sage', oracleText: "{t}: add {g} equal to gyre sage's power.",
      manaOracleText: "{t}: add {g} equal to gyre sage's power.", battlefield: ctx.state.battlefield,
      playerId: p1, permanent: perm(ctx, 'mine'), card: perm(ctx, 'mine').card, gameState: ctx.state, typeLine: 'creature',
    });
    expect(result.baseAmount).toBe(5);
    expect(getEffectivePowerForMana(perm(ctx, 'mine'), ctx.state)).toBe(5);
  });

  it('Vhal-style "mana equal to its toughness" uses current toughness', () => {
    const vhal = bear({ card: { id: 'vhal', name: 'Vhal, Candlekeep Researcher', type_line: 'Legendary Creature - Human Wizard', oracle_text: '', power: '2', toughness: '3' } });
    const ctx = setup('mana_toughness_current', [vhal, anthem()]);
    const result: any = { colors: [], baseAmount: 1, bonusMana: [], isDynamic: false };
    tryCalculateManaProductionCreaturePower({
      result, cardName: 'vhal, candlekeep researcher', oracleText: '', manaOracleText: '', battlefield: ctx.state.battlefield,
      playerId: p1, permanent: perm(ctx, 'mine'), card: perm(ctx, 'mine').card, gameState: ctx.state, typeLine: 'creature',
    });
    expect(result.baseAmount).toBe(4);
  });

  it('Ghalta-style cost reduction ("total power of creatures you control") counts anthems', () => {
    const ctx = setup('cost_reduction_current', [bear(), anthem()]);
    expect(controlledCreaturePowers(ctx.state.battlefield, p1, ctx.state)).toEqual([3]);
  });

  it('ETB "where X is that creature\'s power" uses current power', () => {
    const ctx = setup('etb_x_current', [bear({ counters: { '+1/+1': 1 } }), anthem()]);
    const x = resolveEnteringCreatureDiscoverXValue(
      { effect: "Discover X, where X is that creature's power." },
      perm(ctx, 'mine'),
      ctx.state,
    );
    expect(x).toBe(4);
  });

  it('attack watcher "power N or less" checks current power when given game state', () => {
    const ctx = setup('attack_watcher_current', [bear(), anthem()]);
    const trigger: any = { triggerType: 'low_power_creature_attacks', maxPower: 2, controllerId: p1 };
    const plan = (gameState?: any) => planAttackWatcherQueue(
      trigger, { id: 'watcher', controller: p1 }, [perm(ctx, 'mine')], p1, [p2],
      ctx.state.battlefield, () => p2, 3, gameState,
    );
    expect(plan(ctx.state)).toEqual({ kind: 'per_attacker', attackers: [] });
    // Without the anthem the printed 2/2 still qualifies.
    const bare = setup('attack_watcher_plain', [bear()]);
    const barePlan = planAttackWatcherQueue(
      trigger, { id: 'watcher', controller: p1 }, [perm(bare, 'mine')], p1, [p2],
      bare.state.battlefield, () => p2, 3, bare.state,
    );
    expect(barePlan.kind).toBe('per_attacker');
    expect((barePlan as any).attackers).toHaveLength(1);
  });

  it('trigger doubler "power 2 or less" source check uses current power', () => {
    const doublers: any[] = [{ permanentId: 'doubler', cardName: 'Doubler', controller: p1, sourceMaxPower: 2 }];
    const trigger: any = { permanentId: 'mine', cardName: 'Grizzly Bears', controllerId: p1, description: 'ETB', triggerType: 'etb' };
    const buffed = setup('doubler_current', [bear(), anthem()]);
    expect(applyTriggerDoublers([trigger], doublers, 'etb', perm(buffed, 'mine'), buffed.state.battlefield, { gameState: buffed.state })).toHaveLength(1);
    const plain = setup('doubler_plain', [bear()]);
    expect(applyTriggerDoublers([trigger], doublers, 'etb', perm(plain, 'mine'), plain.state.battlefield, { gameState: plain.state })).toHaveLength(2);
  });
});

describe('item 3: combat death check uses current toughness', () => {
  it('a 2/2 pumped +2/+2 survives 3 combat damage when combat passes no toughness', () => {
    const ctx = setup('combat_death_pump', [bear({ temporaryPTMods: [PUMP_MIRROR] })]);
    expect(creatureDiesFromCombatDamage(ctx, perm(ctx, 'mine'), 3, false, false)).toBe(false);
    expect(creatureDiesFromCombatDamage(ctx, perm(ctx, 'mine'), 4, false, false)).toBe(true);
  });

  it('-1/-1 counters: anthem keeps a 2/2 with two -1/-1 counters alive (toughness 1)', () => {
    const ctx = setup('combat_death_minus', [bear({ counters: { '-1/-1': 2 } }), anthem()]);
    expect(creatureDiesFromCombatDamage(ctx, perm(ctx, 'mine'), 0, false, true)).toBe(false);
  });
});

describe('item 4: getEffectivePower does not double-count Oracle IR pumps', () => {
  it('IR modifier mirrored into temporaryPTMods counts once (4/4, not 6/6)', () => {
    const ctx = setup('effective_power_mirror', [bear({ modifiers: [PUMP_MOD], temporaryPTMods: [PUMP_MIRROR] })]);
    expect(getEffectivePower(perm(ctx, 'mine'), ctx.state)).toBe(4);
    expect(getEffectiveToughness(perm(ctx, 'mine'), ctx.state)).toBe(4);
    // No-state path too.
    const raw = bear({ modifiers: [PUMP_MOD], temporaryPTMods: [PUMP_MIRROR] });
    expect(getEffectivePower(raw)).toBe(4);
    expect(getEffectiveToughness(raw)).toBe(4);
  });

  it('a not-yet-mirrored IR pump is still counted', () => {
    const raw = bear({ modifiers: [PUMP_MOD] });
    expect(getEffectivePower(raw)).toBe(4);
    const ctx = setup('effective_power_unmirrored', [bear({ modifiers: [PUMP_MOD] })]);
    expect(getEffectivePower(perm(ctx, 'mine'), ctx.state)).toBe(4);
  });
});

describe('item 5: rules-engine setPowerToughness is honored (layer 7b before counters/pumps)', () => {
  const setter = { type: 'setPowerToughness', setPower: 0, setToughness: 1, sourceId: 'turn-to-frog', duration: 'end_of_turn' };

  it('set 0/1 then two +1/+1 counters = 2/3', () => {
    const ctx = setup('set_pt_counters', [bear({ modifiers: [setter], counters: { '+1/+1': 2 } })]);
    expect(getCurrentPowerToughness(perm(ctx, 'mine'), ctx.state)).toEqual({ power: 2, toughness: 3 });
    expect(getActualPowerToughness(perm(ctx, 'mine'), ctx.state)).toEqual({ power: 2, toughness: 3 });
    expect(getEffectivePower(perm(ctx, 'mine'), ctx.state)).toBe(2);
  });

  it('set 0/1 plus an anthem and a mirrored pump = 3/4; the last setter wins', () => {
    const later = { ...setter, setPower: 4, setToughness: 4, sourceId: 'later' };
    const ctx = setup('set_pt_anthem', [
      bear({ modifiers: [setter, PUMP_MOD], temporaryPTMods: [PUMP_MIRROR] }),
      anthem(),
    ]);
    expect(getCurrentPowerToughness(perm(ctx, 'mine'), ctx.state)).toEqual({ power: 3, toughness: 4 });
    const ctx2 = setup('set_pt_last_wins', [bear({ modifiers: [setter, later] })]);
    expect(getCurrentPowerToughness(perm(ctx2, 'mine'), ctx2.state)).toEqual({ power: 4, toughness: 4 });
  });
});

describe('item 6: a pump spell is stored once', () => {
  const previousPrimary = process.env.ORACLE_IR_SPELL_PRIMARY;
  afterEach(() => {
    if (previousPrimary === undefined) delete process.env.ORACLE_IR_SPELL_PRIMARY;
    else process.env.ORACLE_IR_SPELL_PRIMARY = previousPrimary;
  });

  it('"gets +2/+2 until end of turn. Draw a card." leaves one modifier and one temporaryPTMods entry', () => {
    process.env.ORACLE_IR_SPELL_PRIMARY = '1';
    const ctx = setup('pump_stored_once', [bear()]);
    const outcome = tryResolveSpellViaOracleIR(ctx, {
      controller: p1,
      spellName: 'Pump Draw',
      oracleText: 'Target creature you control gets +2/+2 until end of turn. Draw a card.',
      sourceId: 'pump-draw-1',
      targets: ['mine'],
    } as any);
    expect(outcome.handled).toBe(true);
    const mine = perm(ctx, 'mine');
    const ptModifiers = (mine.modifiers || []).filter((entry: any) => entry?.type === 'powerToughness');
    expect(ptModifiers).toHaveLength(1);
    expect(mine.temporaryPTMods || []).toHaveLength(1);
    expect(getCurrentPowerToughness(mine, ctx.state)).toEqual({ power: 4, toughness: 4 });
    expect(getEffectivePower(mine, ctx.state)).toBe(4);
  });
});

describe('item 7: optional ("you may") spell steps get the current-P/T hook', () => {
  it('withCurrentPowerToughnessHook adds a resolver returning current P/T', () => {
    const ctx = setup('hook_builder', [bear({ counters: { '+1/+1': 1 } }), anthem()]);
    const irCtx = withCurrentPowerToughnessHook({ controllerId: p1, sourceId: 's' });
    expect(irCtx.controllerId).toBe(p1);
    expect(irCtx.resolveCurrentPowerToughness(ctx.state, perm(ctx, 'mine'))).toEqual({ power: 4, toughness: 4 });
  });

  it('gameActionsSpellCastLock builds its IR context with the hook', () => {
    const source = readFileSync(
      fileURLToPath(new URL('../src/socket/game-actions-handlers/gameActionsSpellCastLock.ts', import.meta.url)),
      'utf8',
    );
    expect(source).toMatch(/const ctx = withCurrentPowerToughnessHook\(\{/);
  });
});