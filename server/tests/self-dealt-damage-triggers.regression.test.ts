import { afterEach, describe, expect, it } from 'vitest';
import type { PlayerID } from '../../shared/src/types.js';
import { createContext } from '../src/state/context.js';
import { createInitialGameState } from '../src/state/gameState.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';
import { processDamageReceivedTriggers } from '../src/state/modules/triggers/damage-received.js';
import {
  applyDealCombatDamageAttackerLoop,
  type DealCombatDamageResult,
} from '../src/state/modules/turn-handlers/turnCombatDamageAttackerLoop.js';

// Self "is dealt damage" triggers (Enrage and friends) must fire exactly once per damage
// event, from the card's own or granted rules text, for combat, noncombat and fight damage.

const AEGISAUR_TEXT = 'Enrage \u2014 Whenever this creature is dealt damage, put a +1/+1 counter on each other creature you control.';
const TAUNTER_TEXT = 'Indestructible\nWhenever this creature is dealt damage, it deals that much damage to target opponent.\n{2}{R}, {T}: Brash Taunter fights another target creature.';

function creature(id: string, name: string, oracle: string, power: number, toughness: number, extra: Record<string, unknown> = {}) {
  return {
    id,
    controller: 'p1',
    owner: 'p1',
    markedDamage: 0,
    counters: {},
    effectivePower: power,
    effectiveToughness: toughness,
    basePower: power,
    baseToughness: toughness,
    card: { id: `${id}_card`, name, type_line: 'Creature \u2014 Test', oracle_text: oracle, power: String(power), toughness: String(toughness) },
    ...extra,
  };
}

function makeCtx(gameId: string, battlefield: any[]) {
  const ctx = createContext(gameId);
  (ctx as any).state = {
    ...(ctx.state as any),
    players: [{ id: 'p1', name: 'P1', life: 40 }, { id: 'p2', name: 'P2', life: 40 }],
    life: { p1: 40, p2: 40 },
    startingLife: 40,
    battlefield,
    stack: [],
  };
  ctx.life = { p1: 40, p2: 40 };
  return ctx;
}

function stackFrom(ctx: any, sourceId: string): any[] {
  return ((ctx.state.stack || []) as any[]).filter((item) => String(item?.source || item?.permanentId || '') === sourceId);
}

function emptyResult(): DealCombatDamageResult {
  return { damageToPlayers: {}, lifeGainForPlayers: {}, creaturesDestroyed: [], attackersThatDealtDamage: {}, attackerDamageToPlayers: {} };
}

const gameIds: string[] = [];
afterEach(() => {
  for (const id of gameIds.splice(0)) ResolutionQueueManager.removeQueue(id);
});

describe('self dealt-damage triggers fire exactly once', () => {
  const selfVariants: Array<[string, string, string]> = [
    ['Enrage prefix, "this creature" (Bellowing Aegisaur)', 'Bellowing Aegisaur', AEGISAUR_TEXT],
    ['no prefix, CARDNAME', 'Test Hydra', 'Whenever Test Hydra is dealt damage, put a +1/+1 counter on each other creature you control.'],
    ['"this permanent"', 'Test Construct', 'Whenever this permanent is dealt damage, put a +1/+1 counter on each other creature you control.'],
  ];
  for (const [label, name, oracle] of selfVariants) {
    it(`noncombat damage: ${label}`, () => {
      const self = creature('self_1', name, oracle, 3, 5);
      const ctx = makeCtx(`t_self_dd_${name.replace(/\W/g, '')}`, [self, creature('ally_1', 'Ally', '', 1, 1)]);
      let callbacks = 0;
      processDamageReceivedTriggers(ctx as any, self, 2, () => { callbacks += 1; });
      expect(stackFrom(ctx, 'self_1').length + callbacks).toBe(1);
    });
  }

  it('granted variant: a granted "Whenever this creature is dealt damage" line fires once', () => {
    const self = creature('granted_1', 'Plain Bear', '', 2, 2, {
      grantedAbilities: ['Whenever this creature is dealt damage, you gain 1 life.'],
    });
    const ctx = makeCtx('t_self_dd_granted', [self]);
    processDamageReceivedTriggers(ctx as any, self, 2, () => {});
    expect(stackFrom(ctx, 'granted_1')).toHaveLength(1);
  });

  it('Brash Taunter: one target-opponent trigger carrying the damage amount', () => {
    const taunter = creature('taunter_1', 'Brash Taunter', TAUNTER_TEXT, 1, 1);
    const ctx = makeCtx('t_self_dd_taunter', [taunter]);
    const hits: any[] = [];
    processDamageReceivedTriggers(ctx as any, taunter, 4, (info) => { hits.push(info); });
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ sourceId: 'taunter_1', damageAmount: 4, targetType: 'opponent' });
    expect(stackFrom(ctx, 'taunter_1')).toHaveLength(0);
  });

  it('combat: an attacker blocked by two creatures triggers once with the total (rule 510.2)', () => {
    const aegisaur = creature('aeg_1', 'Bellowing Aegisaur', AEGISAUR_TEXT, 3, 5, { attacking: 'p2', blockedBy: ['b1', 'b2'] });
    const b1 = creature('b1', 'Bear One', '', 2, 2, { controller: 'p2', owner: 'p2', blocking: ['aeg_1'] });
    const b2 = creature('b2', 'Bear Two', '', 2, 2, { controller: 'p2', owner: 'p2', blocking: ['aeg_1'] });
    const ctx = makeCtx('t_self_dd_combat_aeg', [aegisaur, b1, b2]);
    applyDealCombatDamageAttackerLoop(ctx, [aegisaur], (ctx as any).state.battlefield, (ctx as any).state, ctx.life, 40, emptyResult());
    expect(aegisaur.markedDamage).toBe(4);
    const items = stackFrom(ctx, 'aeg_1');
    expect(items).toHaveLength(1);
  });

  it('combat: Brash Taunter blocked by two creatures gets one trigger for the total damage', () => {
    const gameId = 't_self_dd_combat_taunter';
    gameIds.push(gameId);
    ResolutionQueueManager.removeQueue(gameId);
    const taunter = creature('taunter_1', 'Brash Taunter', TAUNTER_TEXT, 1, 1, { attacking: 'p2', blockedBy: ['b1', 'b2'] });
    const b1 = creature('b1', 'Bear One', '', 2, 2, { controller: 'p2', owner: 'p2', blocking: ['taunter_1'] });
    const b2 = creature('b2', 'Bear Two', '', 3, 3, { controller: 'p2', owner: 'p2', blocking: ['taunter_1'] });
    const ctx = makeCtx(gameId, [taunter, b1, b2]);
    applyDealCombatDamageAttackerLoop(ctx, [taunter], (ctx as any).state.battlefield, (ctx as any).state, ctx.life, 40, emptyResult());
    const steps = ResolutionQueueManager.getQueue(gameId).steps.filter((s: any) => s?.damageReceivedTrigger === true);
    const pending = Object.values(((ctx as any).state.pendingDamageTriggers || {}) as Record<string, any>);
    const all = [...steps.map((s: any) => s.damageTrigger), ...pending];
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ sourceId: 'taunter_1', damageAmount: 5 });
  });

  it('fight: Brash Taunter fighting with its own ability triggers once with the damage dealt to it', () => {
    const gameId = 't_self_dd_fight_taunter';
    gameIds.push(gameId);
    ResolutionQueueManager.removeQueue(gameId);
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    game.applyEvent({ type: 'join', playerId: p1, name: 'P1' });
    game.applyEvent({ type: 'join', playerId: p2, name: 'P2' });
    const taunter = creature('taunter_1', 'Brash Taunter', TAUNTER_TEXT, 1, 1);
    const ogre = creature('ogre_1', 'Ogre', '', 3, 3, { controller: p2, owner: p2 });
    (game.state as any).battlefield = [taunter, ogre];
    game.applyEvent({ type: 'fight', playerId: p1, sourceId: 'taunter_1', targetId: 'ogre_1', sourcePower: 1, targetPower: 3 } as any);
    const steps = ResolutionQueueManager.getQueue(gameId).steps.filter((s: any) => s?.type === ResolutionStepType.TARGET_SELECTION && s?.damageReceivedTrigger === true);
    expect(steps).toHaveLength(1);
    expect((steps[0] as any).damageTrigger).toMatchObject({ damageAmount: 3, targetType: 'opponent' });
  });

  it('fight: Bellowing Aegisaur fighting triggers once', () => {
    const game = createInitialGameState('t_self_dd_fight_aeg');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    game.applyEvent({ type: 'join', playerId: p1, name: 'P1' });
    game.applyEvent({ type: 'join', playerId: p2, name: 'P2' });
    const aegisaur = creature('aeg_1', 'Bellowing Aegisaur', AEGISAUR_TEXT, 3, 5);
    const ogre = creature('ogre_1', 'Ogre', '', 3, 3, { controller: p2, owner: p2 });
    (game.state as any).battlefield = [aegisaur, ogre];
    game.applyEvent({ type: 'fight', playerId: p1, sourceId: 'aeg_1', targetId: 'ogre_1', sourcePower: 3, targetPower: 3 } as any);
    expect(stackFrom(game, 'aeg_1')).toHaveLength(1);
  });
});
