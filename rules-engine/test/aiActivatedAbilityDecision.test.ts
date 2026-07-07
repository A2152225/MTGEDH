import { describe, expect, it } from 'vitest';

import { AIEngine, AIStrategy, AIDecisionType, type AIPlayerConfig } from '../src/AIEngine';
import type { GameState, PlayerID } from '../../shared/src';

describe('AIEngine activated ability decisions', () => {
  it('does not crash when evaluating activated abilities during priority', async () => {
    const engine = new AIEngine();
    const playerId = 'p1' as PlayerID;
    const config: AIPlayerConfig = {
      playerId,
      strategy: AIStrategy.BASIC,
      difficulty: 0.5,
      thinkTime: 0,
    };
    engine.registerAI(config);

    const gameState = {
      id: 'g1',
      turnPlayer: playerId,
      phase: 'postcombatMain',
      step: 'main2',
      players: [{
        id: playerId,
        name: 'AI',
        life: 40,
        hand: [],
        manaPool: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
      }],
      life: { p1: 40 },
      battlefield: [{
        id: 'perm1',
        controller: playerId,
        tapped: false,
        card: {
          name: 'Llanowar Elves',
          type_line: 'Creature — Elf Druid',
          oracle_text: '{T}: Add {G}.',
        },
      }],
      stack: [],
    } as unknown as GameState;

    const decision = await engine.makeDecision({
      gameState,
      playerId,
      decisionType: AIDecisionType.ACTIVATE_ABILITY,
      options: [],
    });

    expect(decision.type).toBe(AIDecisionType.ACTIVATE_ABILITY);
    expect(decision.playerId).toBe(playerId);
  });
});
