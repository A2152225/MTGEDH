import { describe, expect, it } from 'vitest';
import type { BattlefieldPermanent, GameState, KnownCardRef } from '../../shared/src';
import { DecisionManager } from '../src/DecisionManager';
import { DecisionType, type PendingDecision } from '../src/AutomationService';

function createCreature(
  id: string,
  name: string,
  controller: string,
  oracleText: string = '',
  options: Partial<BattlefieldPermanent> = {}
): BattlefieldPermanent {
  return {
    id,
    controller,
    owner: controller,
    tapped: false,
    summoningSickness: false,
    counters: {},
    attachments: [],
    modifiers: [],
    card: {
      id,
      name,
      type_line: 'Creature',
      oracle_text: oracleText,
      power: '2',
      toughness: '2',
      colors: [],
    } as KnownCardRef,
    ...options,
  };
}

function createGameState(battlefield: BattlefieldPermanent[]): GameState {
  return {
    id: 'test-game',
    format: 'commander',
    players: [
      { id: 'player1', name: 'Player 1', seat: 0 },
      { id: 'player2', name: 'Player 2', seat: 1 },
    ],
    startingLife: 40,
    life: { player1: 40, player2: 40 },
    battlefield,
    stack: [],
    commandZone: {},
    activePlayerIndex: 0,
    phase: 'combat' as any,
    active: true,
  } as GameState;
}

function createDecision(type: DecisionType, playerId: string): PendingDecision {
  return {
    id: `decision-${type}`,
    type,
    playerId,
    description: 'Test decision',
    mandatory: true,
    createdAt: Date.now(),
  };
}

describe('DecisionManager combat validation', () => {
  it('accepts attackers with equipment-granted haste', () => {
    const manager = new DecisionManager();
    manager.initGame('test-game');

    const creature = createCreature('bear1', 'Grizzly Bears', 'player1', '', {
      summoningSickness: true,
      attachedEquipment: ['boots1'],
    });
    const boots = {
      id: 'boots1',
      controller: 'player1',
      owner: 'player1',
      attachedTo: 'bear1',
      tapped: false,
      card: {
        id: 'boots1',
        name: 'Swiftfoot Boots',
        type_line: 'Artifact — Equipment',
        oracle_text: 'Equipped creature has hexproof and haste.',
      } as KnownCardRef,
    } as BattlefieldPermanent;

    const gameState = createGameState([creature, boots]);
    const decision = createDecision(DecisionType.SELECT_ATTACKERS, 'player1');
    manager.addDecision('test-game', decision);

    const { result } = manager.processResponse(
      'test-game',
      {
        decisionId: decision.id,
        playerId: 'player1',
        selection: [{ attackerId: 'bear1', defendingPlayer: 'player2' }],
        timestamp: Date.now(),
      },
      gameState
    );

    expect(result.valid).toBe(true);
  });

  it('accepts blockers with equipment-granted flying against a flying attacker', () => {
    const manager = new DecisionManager();
    manager.initGame('test-game');

    const attacker = createCreature('drake1', 'Wind Drake', 'player1', 'Flying', {
      attacking: true,
    });
    const blocker = createCreature('bear1', 'Grizzly Bears', 'player2', '', {
      attachedEquipment: ['kitesail1'],
    });
    const kitesail = {
      id: 'kitesail1',
      controller: 'player2',
      owner: 'player2',
      attachedTo: 'bear1',
      tapped: false,
      card: {
        id: 'kitesail1',
        name: 'Cliffhaven Kitesail',
        type_line: 'Artifact — Equipment',
        oracle_text: 'Equipped creature has flying.',
      } as KnownCardRef,
    } as BattlefieldPermanent;

    const gameState = createGameState([attacker, blocker, kitesail]);
    const decision = createDecision(DecisionType.SELECT_BLOCKERS, 'player2');
    manager.addDecision('test-game', decision);

    const { result } = manager.processResponse(
      'test-game',
      {
        decisionId: decision.id,
        playerId: 'player2',
        selection: [{ blockerId: 'bear1', attackerId: 'drake1' }],
        timestamp: Date.now(),
      },
      gameState
    );

    expect(result.valid).toBe(true);
  });
});