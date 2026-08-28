import { describe, expect, it } from 'vitest';
import { AIEngine, AIStrategy, AIDecisionType, type AIDecisionContext } from '../src/AIEngine';
import type { BattlefieldPermanent, GameState } from '../../shared/src/types';
import { GameStep } from '../../shared/src/types';

function makeBlockContext(args: {
  strategy?: AIStrategy;
  life: number;
  attackers: BattlefieldPermanent[];
  blockers: BattlefieldPermanent[];
  otherPermanents?: BattlefieldPermanent[];
  constraintsAttackers?: BattlefieldPermanent[] | 'omit';
}): { engine: AIEngine; context: AIDecisionContext } {
  const engine = new AIEngine();
  engine.registerAI({
    playerId: 'ai-player',
    strategy: args.strategy ?? AIStrategy.BASIC,
    difficulty: 0.8,
  });

  const battlefield: BattlefieldPermanent[] = [
    ...args.attackers,
    ...args.blockers,
    ...(args.otherPermanents || []),
  ];

  const gameState: GameState = {
    turn: 5,
    step: GameStep.DECLARE_BLOCKERS,
    activePlayerIndex: 0,
    battlefield,
    life: { 'ai-player': args.life, attacker: 40, bystander: 40 },
    players: [
      { id: 'ai-player', life: args.life, battlefield } as any,
      { id: 'attacker', life: 40, battlefield: [] } as any,
      { id: 'bystander', life: 40, battlefield: [] } as any,
    ],
  } as GameState;

  const context: AIDecisionContext = {
    gameState,
    playerId: 'ai-player',
    decisionType: AIDecisionType.DECLARE_BLOCKERS,
    options: [],
    constraints: args.constraintsAttackers === 'omit'
      ? {}
      : { attackers: args.constraintsAttackers ?? args.attackers },
  };

  return { engine, context };
}

function creature(
  id: string,
  controller: string,
  extras: Partial<BattlefieldPermanent> & { power?: string; toughness?: string; attacking?: unknown } = {},
): BattlefieldPermanent {
  const { power = '2', toughness = '2', attacking, ...rest } = extras;
  return {
    id,
    controller,
    owner: controller,
    tapped: false,
    card: {
      name: id,
      type_line: 'Creature',
      power,
      toughness,
    },
    ...(attacking !== undefined ? { attacking } : {}),
    ...rest,
  } as BattlefieldPermanent;
}

describe('AI block decisions', () => {
  it('chump-blocks a lethal attacker stored as defending-player id, not boolean true', async () => {
    const attacker = creature('big-attacker', 'attacker', {
      power: '8',
      toughness: '8',
      attacking: 'ai-player',
    });
    const blocker = creature('chump', 'ai-player', { power: '1', toughness: '1' });
    const { engine, context } = makeBlockContext({
      life: 6,
      attackers: [attacker],
      blockers: [blocker],
    });

    const decision = await engine.makeDecision(context);
    expect(decision.action.blockers).toEqual([
      { blockerId: 'chump', attackerId: 'big-attacker' },
    ]);
  });

  it('finds attackers from the battlefield when constraints omit them', async () => {
    const attacker = creature('big-attacker', 'attacker', {
      power: '8',
      toughness: '8',
      attacking: 'ai-player',
    });
    const blocker = creature('chump', 'ai-player', { power: '2', toughness: '2' });
    const { engine, context } = makeBlockContext({
      life: 5,
      attackers: [attacker],
      blockers: [blocker],
      constraintsAttackers: 'omit',
    });

    const decision = await engine.makeDecision(context);
    expect(decision.action.blockers.map((b: any) => b.attackerId)).toContain('big-attacker');
  });

  it('does not block an attacker aimed at another player', async () => {
    const attacker = creature('other-attack', 'attacker', {
      power: '8',
      toughness: '8',
      attacking: 'bystander',
    });
    const blocker = creature('chump', 'ai-player', { power: '2', toughness: '2' });
    const { engine, context } = makeBlockContext({
      life: 4,
      attackers: [attacker],
      blockers: [blocker],
    });

    const decision = await engine.makeDecision(context);
    expect(decision.action.blockers || []).toEqual([]);
  });

  it('CONTROL strategy still chump-blocks when the attack is lethal', async () => {
    const attacker = creature('big-attacker', 'attacker', {
      power: '7',
      toughness: '7',
      attacking: 'ai-player',
    });
    const blocker = creature('chump', 'ai-player', { power: '1', toughness: '1' });
    const { engine, context } = makeBlockContext({
      strategy: AIStrategy.CONTROL,
      life: 6,
      attackers: [attacker],
      blockers: [blocker],
    });

    const decision = await engine.makeDecision(context);
    expect(decision.action.blockers).toEqual([
      { blockerId: 'chump', attackerId: 'big-attacker' },
    ]);
  });
});
