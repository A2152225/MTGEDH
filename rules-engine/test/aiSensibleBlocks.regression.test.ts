import { describe, expect, it } from 'vitest';
import { AIEngine, AIStrategy, AIDecisionType, type AIDecisionContext } from '../src/AIEngine';
import type { BattlefieldPermanent, GameState } from '../../shared/src/types';
import { GameStep } from '../../shared/src/types';

const AI = 'ai-player';

function creature(id: string, controller: string, p: string, t: string, extra: Record<string, any> = {}): BattlefieldPermanent {
  const { oracle_text = '', ...rest } = extra;
  return {
    id, controller, owner: controller, tapped: false, counters: {},
    card: { id: `card-${id}`, name: id, type_line: 'Creature', power: p, toughness: t, oracle_text },
    ...rest,
  } as any;
}

async function blocks(args: { life: number; attackers: BattlefieldPermanent[]; blockers: BattlefieldPermanent[]; extraState?: any }) {
  const engine = new AIEngine();
  engine.registerAI({ playerId: AI, strategy: AIStrategy.BASIC, difficulty: 0.8 });
  const battlefield = [...args.attackers, ...args.blockers];
  const gameState = {
    turn: 5, step: GameStep.DECLARE_BLOCKERS, activePlayerIndex: 0, battlefield,
    life: { [AI]: args.life, opp: 40 },
    players: [{ id: AI, life: args.life } as any, { id: 'opp', life: 40 } as any],
    ...(args.extraState || {}),
  } as GameState;
  const context: AIDecisionContext = {
    gameState, playerId: AI, decisionType: AIDecisionType.DECLARE_BLOCKERS, options: [],
    constraints: { attackers: args.attackers },
  };
  const decision = await engine.makeDecision(context);
  return (decision.action?.blockers || []) as Array<{ blockerId: string; attackerId: string }>;
}

describe('AI block decisions (sensible blocks)', () => {
  it('free block: a 1/4 wall blocks a 3/3 at healthy life', async () => {
    const result = await blocks({
      life: 40,
      attackers: [creature('bear3', 'opp', '3', '3', { attacking: AI })],
      blockers: [creature('wall', AI, '1', '4')],
    });
    expect(result).toEqual([{ blockerId: 'wall', attackerId: 'bear3' }]);
  });

  it('kills the attacker and survives: 4/4 blocks a 3/2', async () => {
    const result = await blocks({
      life: 40,
      attackers: [creature('raider', 'opp', '3', '2', { attacking: AI })],
      blockers: [creature('ogre', AI, '4', '4')],
    });
    expect(result).toEqual([{ blockerId: 'ogre', attackerId: 'raider' }]);
  });

  it('good trade: a 2/2 trades with a 5/2 attacker', async () => {
    const result = await blocks({
      life: 40,
      attackers: [creature('glass', 'opp', '5', '2', { attacking: AI })],
      blockers: [creature('bear', AI, '2', '2')],
    });
    expect(result).toEqual([{ blockerId: 'bear', attackerId: 'glass' }]);
  });

  it('chumps when the attack is lethal, with the cheapest creature', async () => {
    const result = await blocks({
      life: 6,
      attackers: [creature('giant', 'opp', '8', '8', { attacking: AI })],
      blockers: [creature('token', AI, '1', '1'), creature('knight', AI, '3', '3')],
    });
    expect(result).toEqual([{ blockerId: 'token', attackerId: 'giant' }]);
  });

  it('chumps a commander that would deal lethal commander damage (server keys by card id)', async () => {
    const commander = creature('cmdr', 'opp', '6', '6', { attacking: AI, isCommander: true });
    const result = await blocks({
      life: 40,
      attackers: [commander],
      blockers: [creature('token', AI, '1', '1')],
      extraState: { commanderDamage: { [AI]: { 'card-cmdr': 16 } } },
    });
    expect(result).toEqual([{ blockerId: 'token', attackerId: 'cmdr' }]);
  });

  it('no pointless chump at healthy life', async () => {
    const result = await blocks({
      life: 40,
      attackers: [creature('giant', 'opp', '8', '8', { attacking: AI, oracle_text: 'Trample, deathtouch' })],
      blockers: [creature('token', AI, '1', '1')],
    });
    expect(result).toEqual([]);
  });

  it('only chumps as many attackers as needed to survive', async () => {
    const result = await blocks({
      life: 7,
      attackers: [creature('a5', 'opp', '5', '5', { attacking: AI }), creature('a3', 'opp', '3', '3', { attacking: AI })],
      blockers: [creature('t1', AI, '1', '1'), creature('t2', AI, '1', '1')],
    });
    expect(result).toEqual([expect.objectContaining({ attackerId: 'a5' })]);
  });

  it('a ground-only blocker never blocks a flyer (even when lethal)', async () => {
    const result = await blocks({
      life: 3,
      attackers: [creature('drake', 'opp', '4', '4', { attacking: AI, oracle_text: 'Flying' })],
      blockers: [creature('wall', AI, '0', '6')],
    });
    expect(result).toEqual([]);
  });

  it('reach can block a flyer for free', async () => {
    const result = await blocks({
      life: 40,
      attackers: [creature('drake', 'opp', '2', '2', { attacking: AI, oracle_text: 'Flying' })],
      blockers: [creature('spider', AI, '1', '4', { oracle_text: 'Reach' })],
    });
    expect(result).toEqual([{ blockerId: 'spider', attackerId: 'drake' }]);
  });

  it('menace: never a single blocker; double-blocks when lethal', async () => {
    const menace = creature('brute', 'opp', '4', '4', { attacking: AI, oracle_text: 'Menace' });
    const single = await blocks({ life: 3, attackers: [menace], blockers: [creature('t1', AI, '1', '1')] });
    expect(single).toEqual([]);
    const pair = await blocks({ life: 3, attackers: [menace], blockers: [creature('t1', AI, '1', '1'), creature('t2', AI, '1', '1')] });
    expect(pair.map((b) => b.blockerId).sort()).toEqual(['t1', 't2']);
  });

  it('double-blocks a big attacker when two blockers kill it and it can only take one', async () => {
    const result = await blocks({
      life: 40,
      attackers: [creature('titan', 'opp', '3', '6', { attacking: AI })],
      blockers: [creature('b1', AI, '3', '3'), creature('b2', AI, '3', '3')],
    });
    expect(result.map((b) => b.blockerId).sort()).toEqual(['b1', 'b2']);
  });

  it('respects "can\'t block"', async () => {
    const result = await blocks({
      life: 3,
      attackers: [creature('giant', 'opp', '8', '8', { attacking: AI })],
      blockers: [creature('coward', AI, '1', '1', { oracle_text: "This creature can't block." })],
    });
    expect(result).toEqual([]);
  });
});
