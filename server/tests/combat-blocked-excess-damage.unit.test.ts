import { describe, expect, it } from 'vitest';
import type { PlayerID } from '../../shared/src/types.js';
import { createContext } from '../src/state/context.js';
import {
  applyDealCombatDamageAttackerLoop,
  type DealCombatDamageResult,
} from '../src/state/modules/turn-handlers/turnCombatDamageAttackerLoop.js';

function emptyResult(): DealCombatDamageResult {
  return {
    damageToPlayers: {},
    lifeGainForPlayers: {},
    creaturesDestroyed: [],
    attackersThatDealtDamage: {},
    attackerDamageToPlayers: {},
  };
}

function creature(id: string, name: string, power: number, toughness: number, extra: Record<string, unknown> = {}) {
  return {
    id,
    controller: 'p2',
    owner: 'p2',
    markedDamage: 0,
    effectivePower: power,
    effectiveToughness: toughness,
    basePower: power,
    baseToughness: toughness,
    card: {
      name,
      type_line: 'Creature',
      oracle_text: '',
      power: String(power),
      toughness: String(toughness),
    },
    ...extra,
  };
}

function deal(attacker: any, blockers: any[]) {
  const ctx = createContext('blocked_excess_damage');
  const p1 = 'p1' as PlayerID;
  const p2 = 'p2' as PlayerID;
  const battlefield = [attacker, ...blockers];
  (ctx as any).state = {
    ...(ctx.state as any),
    players: [
      { id: p1, name: 'P1', life: 40 },
      { id: p2, name: 'P2', life: 40 },
    ],
    life: { [p1]: 40, [p2]: 40 },
    startingLife: 40,
    battlefield,
  };
  ctx.life = { [p1]: 40, [p2]: 40 };
  const result = emptyResult();
  applyDealCombatDamageAttackerLoop(
    ctx,
    [attacker],
    battlefield,
    (ctx as any).state,
    ctx.life,
    40,
    result,
  );
  return { ctx, result, attacker, blockers };
}

describe('blocked combat damage assignment', () => {
  it('assigns all combat damage from a 7/7 to a single 1/1 blocker', () => {
    const blocker = creature('brash', 'Brash Taunter', 1, 1, { controller: 'p2', owner: 'p2' });
    const attacker = creature('morophon', 'Morophon, the Boundless', 7, 7, {
      controller: 'p1',
      owner: 'p1',
      attacking: 'p2',
      blockedBy: ['brash'],
    });
    const dealt = deal(attacker, [blocker]);
    expect(blocker.markedDamage).toBe(7);
    expect(dealt.result.damageToPlayers.p2 || 0).toBe(0);
  });

  it('assigns only lethal damage to blockers when the attacker has trample', () => {
    const blocker = creature('bear', 'Grizzly Bears', 2, 2);
    const attacker = creature('rhino', 'Rampaging Rhino', 7, 7, {
      controller: 'p1',
      owner: 'p1',
      attacking: 'p2',
      blockedBy: ['bear'],
      card: {
        name: 'Rampaging Rhino',
        type_line: 'Creature',
        oracle_text: 'Trample',
        power: '7',
        toughness: '7',
      },
    });
    const dealt = deal(attacker, [blocker]);
    expect(blocker.markedDamage).toBe(2);
    expect(dealt.result.damageToPlayers.p2).toBe(5);
  });

  it('gives a 1-power attacker no damage for a later blocker until the earlier one has lethal', () => {
    const baeloth = creature('baeloth', 'Baeloth Barrityl, Entertainer', 2, 5);
    const taunter = creature('taunter', 'Brash Taunter', 1, 1);
    const attacker = creature('human', 'Human', 1, 1, {
      controller: 'p1',
      owner: 'p1',
      attacking: 'p2',
      blockedBy: ['baeloth', 'taunter'],
    });
    deal(attacker, [baeloth, taunter]);
    expect(baeloth.markedDamage).toBe(1);
    expect(taunter.markedDamage || 0).toBe(0);
  });
});
