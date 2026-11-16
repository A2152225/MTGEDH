/**
 * P2-6 block planner: no needless chump, commander chump, trade with leader.
 */

import { describe, expect, it } from 'vitest';
import { AIDecisionType, type AIDecisionContext } from '../src/AIEngine.js';
import { planBlocks } from '../src/ai/blockPlanner.js';
import { createCombatCreature } from '../src/combatAutomation.js';
import { creature } from './fixtures/combatAiFixtures.js';

function evalBlocker(c: ReturnType<typeof creature>, extras: Partial<{ wantsToGetKilled: boolean; deathBenefit: number; baseValue: number }> = {}) {
  return {
    perm: c.permanent,
    creature: createCombatCreature(c.permanent as any, [c.permanent] as any),
    wantsToGetKilled: extras.wantsToGetKilled || false,
    deathBenefit: extras.deathBenefit || 0,
    baseValue: extras.baseValue ?? c.power + c.toughness,
    preserveBias: 0,
    attackBias: 0,
  };
}

function contextFor(args: {
  life: number;
  battlefield: any[];
  commanderDamage?: Record<string, Record<string, number>>;
  playersExtra?: any[];
}): AIDecisionContext {
  const players = [
    { id: 'ai-player', life: args.life, spectator: false },
    { id: 'attacker', life: 40, spectator: false },
    { id: 'bystander', life: 12, spectator: false },
    ...(args.playersExtra || []),
  ];
  return {
    gameState: {
      turn: 6,
      players,
      life: {
        'ai-player': args.life,
        attacker: 40,
        bystander: 12,
      },
      battlefield: args.battlefield,
      commanderDamage: args.commanderDamage || {},
      zones: {},
    } as any,
    playerId: 'ai-player',
    decisionType: AIDecisionType.DECLARE_BLOCKERS,
    options: [],
    constraints: {},
  };
}

describe('P2-6 planBlocks', () => {
  it('takes a first-strike win instead of eating damage', () => {
    const atk4 = creature('atk4', 4, 4, {}, { controllerId: 'attacker' });
    const atk3 = creature('atk3', 3, 3, {}, { controllerId: 'attacker' });
    const fs = creature('fs', 4, 4, { firstStrike: true }, {
      controllerId: 'ai-player',
      oracle: 'First strike',
    });
    const chump = creature('chump', 2, 2, {}, { controllerId: 'ai-player' });
    const battlefield = [atk4.permanent, atk3.permanent, fs.permanent, chump.permanent];
    (atk4.permanent as any).attacking = 'ai-player';
    (atk3.permanent as any).attacking = 'ai-player';
    const ctx = contextFor({ life: 40, battlefield });
    const out = planBlocks(
      ctx,
      [
        createCombatCreature(atk4.permanent as any, battlefield as any),
        createCombatCreature(atk3.permanent as any, battlefield as any),
      ],
      [evalBlocker(fs), evalBlocker(chump)],
    );
    expect(out.assignments).toEqual([{ blockerId: 'fs', attackerId: 'atk4' }]);
  });

  it('does not chump when damage is survivable', () => {
    const atk = creature('big', 6, 6, {}, { controllerId: 'attacker' });
    const token = creature('token', 2, 2, {}, { controllerId: 'ai-player' });
    const tiny = creature('tiny', 1, 1, {}, { controllerId: 'ai-player' });
    const ctx = contextFor({
      life: 40,
      battlefield: [atk.permanent, token.permanent, tiny.permanent],
    });
    const out = planBlocks(
      ctx,
      [createCombatCreature(atk.permanent as any, ctx.gameState.battlefield as any)],
      [evalBlocker(token), evalBlocker(tiny)],
    );
    expect(out.assignments).toEqual([]);
  });

  it('chumps when commander damage would reach 21', () => {
    const cmd = creature('cmd', 5, 5, {}, {
      controllerId: 'attacker',
      isCommander: true,
      cardId: 'cmd',
    });
    const token = creature('token', 2, 2, {}, { controllerId: 'ai-player' });
    const ctx = contextFor({
      life: 40,
      battlefield: [cmd.permanent, token.permanent],
      commanderDamage: { 'ai-player': { cmd: 17 } },
    });
    // Mark attacker permanent as attacking for realism.
    (cmd.permanent as any).attacking = 'ai-player';
    const out = planBlocks(
      ctx,
      [createCombatCreature(cmd.permanent as any, ctx.gameState.battlefield as any)],
      [evalBlocker(token)],
    );
    expect(out.assignments).toEqual([
      { blockerId: 'token', attackerId: 'cmd' },
    ]);
  });

  it('prefers trading with the leader over the trailer', () => {
    const aAtk = creature('a_atk', 3, 3, {}, { controllerId: 'attacker' });
    const bAtk = creature('b_atk', 3, 3, {}, { controllerId: 'bystander' });
    const mine = creature('mine', 3, 3, {}, { controllerId: 'ai-player' });
    // Pad attacker's board so they are the leader on board value.
    const leaderBoard = [1, 2, 3, 4, 5].map((n) =>
      creature(`lead${n}`, 2, 2, {}, { controllerId: 'attacker' }),
    );
    const battlefield = [
      aAtk.permanent,
      bAtk.permanent,
      mine.permanent,
      ...leaderBoard.map((c) => c.permanent),
    ];
    (aAtk.permanent as any).attacking = 'ai-player';
    (bAtk.permanent as any).attacking = 'ai-player';
    const ctx = contextFor({ life: 30, battlefield });
    const attackers = [
      createCombatCreature(aAtk.permanent as any, battlefield as any),
      createCombatCreature(bAtk.permanent as any, battlefield as any),
    ];
    const out = planBlocks(ctx, attackers, [evalBlocker(mine)]);
    expect(out.assignments).toEqual([
      { blockerId: 'mine', attackerId: 'a_atk' },
    ]);
  });

  it('runs under 50ms on a mid-size combat', () => {
    const attackers = Array.from({ length: 4 }, (_, i) =>
      creature(`a${i}`, 3, 3, {}, { controllerId: 'attacker' }),
    );
    const blockers = Array.from({ length: 4 }, (_, i) =>
      creature(`b${i}`, 2, 2, {}, { controllerId: 'ai-player' }),
    );
    const battlefield = [...attackers, ...blockers].map((c) => c.permanent);
    for (const a of attackers) (a.permanent as any).attacking = 'ai-player';
    const ctx = contextFor({ life: 25, battlefield });
    const atkC = attackers.map((a) =>
      createCombatCreature(a.permanent as any, battlefield as any),
    );
    const blkE = blockers.map((b) => evalBlocker(b));
    planBlocks(ctx, atkC, blkE);
    const samples: number[] = [];
    for (let i = 0; i < 15; i++) {
      samples.push(planBlocks(ctx, atkC, blkE).ms);
    }
    samples.sort((a, b) => a - b);
    expect(samples[Math.floor(samples.length * 0.95)]).toBeLessThan(50);
  });
});
