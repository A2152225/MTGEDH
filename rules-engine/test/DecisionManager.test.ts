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

function createGameState(battlefield: BattlefieldPermanent[], overrides: Partial<GameState> = {}): GameState {
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
    ...overrides,
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

describe('DecisionManager target validation', () => {
  it('accepts animated noncreatures as creature targets', () => {
    const manager = new DecisionManager();
    manager.initGame('test-game');

    const animatedArtifact = {
      id: 'artifact-1',
      controller: 'player2',
      owner: 'player2',
      isCreature: true,
      card: {
        id: 'artifact-1',
        name: 'Animated Relic',
        type_line: 'Artifact',
        oracle_text: '',
      } as KnownCardRef,
    } as BattlefieldPermanent;

    const gameState = createGameState([animatedArtifact]);
    const decision = {
      ...createDecision(DecisionType.SELECT_TARGETS, 'player1'),
      targetTypes: ['creature'],
    } as PendingDecision;
    manager.addDecision('test-game', decision);

    const { result } = manager.processResponse(
      'test-game',
      {
        decisionId: decision.id,
        playerId: 'player1',
        selection: 'artifact-1',
        timestamp: Date.now(),
      },
      gameState,
    );

    expect(result.valid).toBe(true);
  });

  it('rejects permanents that no longer count as creatures', () => {
    const manager = new DecisionManager();
    manager.initGame('test-game');

    const moonedCreature = {
      id: 'creature-1',
      controller: 'player2',
      owner: 'player2',
      effectiveTypes: ['Land'],
      card: {
        id: 'creature-1',
        name: 'Moon-Bound Bear',
        type_line: 'Creature — Bear',
        oracle_text: '',
      } as KnownCardRef,
    } as BattlefieldPermanent;

    const gameState = createGameState([moonedCreature]);
    const decision = {
      ...createDecision(DecisionType.SELECT_TARGETS, 'player1'),
      targetTypes: ['creature'],
    } as PendingDecision;
    manager.addDecision('test-game', decision);

    const { result } = manager.processResponse(
      'test-game',
      {
        decisionId: decision.id,
        playerId: 'player1',
        selection: 'creature-1',
        timestamp: Date.now(),
      },
      gameState,
    );

    expect(result.valid).toBe(false);
    expect(result.error).toContain('Target must be: creature');
  });

  it('rejects targeting an opponent with hexproof when the decision source is a battlefield ability', () => {
    const manager = new DecisionManager();
    manager.initGame('test-game');

    const pinger = createCreature('pinger-1', 'Prodigal Pyromancer', 'player1', '', {
      card: {
        id: 'pinger-1',
        name: 'Prodigal Pyromancer',
        type_line: 'Creature — Human Wizard',
        oracle_text: '{T}: Prodigal Pyromancer deals 1 damage to any target.',
        mana_cost: '{2}{R}',
        colors: ['R'],
      } as KnownCardRef,
    });
    const leyline = {
      id: 'leyline-1',
      controller: 'player2',
      owner: 'player2',
      tapped: false,
      card: {
        id: 'leyline-1',
        name: 'Leyline of Sanctity',
        type_line: 'Enchantment',
        oracle_text: 'You have hexproof.',
      } as KnownCardRef,
    } as BattlefieldPermanent;

    const gameState = createGameState([pinger, leyline]);
    const decision = {
      ...createDecision(DecisionType.SELECT_TARGETS, 'player1'),
      sourceId: 'pinger-1',
      targetTypes: ['player'],
    } as PendingDecision;
    manager.addDecision('test-game', decision);

    const { result } = manager.processResponse(
      'test-game',
      {
        decisionId: decision.id,
        playerId: 'player1',
        selection: 'player2',
        timestamp: Date.now(),
      },
      gameState,
    );

    expect(result.valid).toBe(false);
    expect(result.error).toContain('hexproof');
  });

  it('rejects a blue spell choosing a creature with protection from blue', () => {
    const manager = new DecisionManager();
    manager.initGame('test-game');

    const protectedCreature = createCreature('silver-knight', 'Silver Knight', 'player2', 'Protection from blue');
    const gameState = createGameState(
      [protectedCreature],
      {
        stack: [
          {
            id: 'blue-doom',
            type: 'spell',
            controller: 'player1',
            owner: 'player1',
            card: {
              id: 'blue-doom-card',
              name: 'Blue Doom',
              type_line: 'Instant',
              oracle_text: 'Destroy target creature.',
              mana_cost: '{U}',
              colors: ['U'],
            },
            targets: [],
          } as any,
        ],
      }
    );
    const decision = {
      ...createDecision(DecisionType.SELECT_TARGETS, 'player1'),
      sourceId: 'blue-doom',
      targetTypes: ['creature'],
    } as PendingDecision;
    manager.addDecision('test-game', decision);

    const { result } = manager.processResponse(
      'test-game',
      {
        decisionId: decision.id,
        playerId: 'player1',
        selection: 'silver-knight',
        timestamp: Date.now(),
      },
      gameState,
    );

    expect(result.valid).toBe(false);
    expect(result.error).toContain('protection');
  });

  it('rejects a target that was not offered in decision options', () => {
    const manager = new DecisionManager();
    manager.initGame('test-game');

    const legalCreature = createCreature('creature-1', 'Legal Bear', 'player2');
    const unofferedCreature = createCreature('creature-2', 'Unoffered Bear', 'player2');
    const gameState = createGameState([legalCreature, unofferedCreature]);
    const decision = {
      ...createDecision(DecisionType.SELECT_TARGETS, 'player1'),
      targetTypes: ['creature'],
      options: [{ id: 'creature-1', label: 'Legal Bear' }],
    } as PendingDecision;
    manager.addDecision('test-game', decision);

    const { result } = manager.processResponse(
      'test-game',
      {
        decisionId: decision.id,
        playerId: 'player1',
        selection: 'creature-2',
        timestamp: Date.now(),
      },
      gameState,
    );

    expect(result.valid).toBe(false);
    expect(result.error).toContain('not offered');
  });

  it('rejects multi-target selections containing an unoffered target option', () => {
    const manager = new DecisionManager();
    manager.initGame('test-game');

    const firstCreature = createCreature('creature-1', 'First Bear', 'player2');
    const secondCreature = createCreature('creature-2', 'Second Bear', 'player2');
    const thirdCreature = createCreature('creature-3', 'Third Bear', 'player2');
    const gameState = createGameState([firstCreature, secondCreature, thirdCreature]);
    const decision = {
      ...createDecision(DecisionType.SELECT_TARGETS, 'player1'),
      targetTypes: ['creature'],
      minSelections: 2,
      maxSelections: 2,
      options: [
        { id: 'creature-1', label: 'First Bear' },
        { id: 'creature-2', label: 'Second Bear' },
      ],
    } as PendingDecision;
    manager.addDecision('test-game', decision);

    const { result } = manager.processResponse(
      'test-game',
      {
        decisionId: decision.id,
        playerId: 'player1',
        selection: ['creature-1', 'creature-3'],
        timestamp: Date.now(),
      },
      gameState,
    );

    expect(result.valid).toBe(false);
    expect(result.error).toContain('not offered');
  });

  it('rejects a previously offered target when live state no longer satisfies controller filters', () => {
    const manager = new DecisionManager();
    manager.initGame('test-game');

    const formerSelfCreature = createCreature('creature-1', 'Borrowed Bear', 'player2');
    const gameState = createGameState([formerSelfCreature]);
    const decision = {
      ...createDecision(DecisionType.SELECT_TARGETS, 'player1'),
      targetTypes: ['creature'],
      options: [{ id: 'creature-1', label: 'Borrowed Bear' }],
      filters: [{ type: 'controller', value: 'self' }],
    } as PendingDecision;
    manager.addDecision('test-game', decision);

    const { result } = manager.processResponse(
      'test-game',
      {
        decisionId: decision.id,
        playerId: 'player1',
        selection: 'creature-1',
        timestamp: Date.now(),
      },
      gameState,
    );

    expect(result.valid).toBe(false);
    expect(result.error).toContain('controlled by you');
  });

  it('rejects a previously offered target when live state no longer satisfies nonland filters', () => {
    const manager = new DecisionManager();
    manager.initGame('test-game');

    const landTarget = {
      id: 'land-1',
      controller: 'player2',
      owner: 'player2',
      tapped: false,
      card: {
        id: 'land-1',
        name: 'Forest',
        type_line: 'Basic Land — Forest',
        oracle_text: '',
      } as KnownCardRef,
    } as BattlefieldPermanent;
    const gameState = createGameState([landTarget]);
    const decision = {
      ...createDecision(DecisionType.SELECT_TARGETS, 'player1'),
      targetTypes: ['permanent'],
      options: [{ id: 'land-1', label: 'Forest' }],
      filters: [{ type: 'custom', value: 'nonland' }],
    } as PendingDecision;
    manager.addDecision('test-game', decision);

    const { result } = manager.processResponse(
      'test-game',
      {
        decisionId: decision.id,
        playerId: 'player1',
        selection: 'land-1',
        timestamp: Date.now(),
      },
      gameState,
    );

    expect(result.valid).toBe(false);
    expect(result.error).toContain('cannot be a land');
  });

  it('accepts a graveyard creature card target when the card still matches zone and type constraints', () => {
    const manager = new DecisionManager();
    manager.initGame('test-game');

    const gameState = createGameState([], {
      players: [
        {
          id: 'player1',
          name: 'Player 1',
          seat: 0,
          graveyard: [],
          hand: [],
          exile: [],
          library: [],
        },
        {
          id: 'player2',
          name: 'Player 2',
          seat: 1,
          graveyard: [
            {
              id: 'dead-bear',
              name: 'Grizzly Bears',
              type_line: 'Creature — Bear',
              oracle_text: '',
            },
          ],
          hand: [],
          exile: [],
          library: [],
        },
      ] as any,
    });
    const decision = {
      ...createDecision(DecisionType.SELECT_TARGETS, 'player1'),
      targetTypes: ['creature'],
      options: [{ id: 'dead-bear', label: 'Grizzly Bears' }],
      filters: [{ type: 'zone', value: 'graveyard' }],
    } as PendingDecision;
    manager.addDecision('test-game', decision);

    const { result } = manager.processResponse(
      'test-game',
      {
        decisionId: decision.id,
        playerId: 'player1',
        selection: 'dead-bear',
        timestamp: Date.now(),
      },
      gameState,
    );

    expect(result.valid).toBe(true);
  });

  it('rejects a previously offered graveyard target when the card moved out of the graveyard', () => {
    const manager = new DecisionManager();
    manager.initGame('test-game');

    const gameState = createGameState([], {
      players: [
        {
          id: 'player1',
          name: 'Player 1',
          seat: 0,
          graveyard: [],
          hand: [],
          exile: [],
          library: [],
        },
        {
          id: 'player2',
          name: 'Player 2',
          seat: 1,
          graveyard: [],
          hand: [
            {
              id: 'dead-bear',
              name: 'Grizzly Bears',
              type_line: 'Creature — Bear',
              oracle_text: '',
            },
          ],
          exile: [],
          library: [],
        },
      ] as any,
    });
    const decision = {
      ...createDecision(DecisionType.SELECT_TARGETS, 'player1'),
      targetTypes: ['creature'],
      options: [{ id: 'dead-bear', label: 'Grizzly Bears' }],
      filters: [{ type: 'zone', value: 'graveyard' }],
    } as PendingDecision;
    manager.addDecision('test-game', decision);

    const { result } = manager.processResponse(
      'test-game',
      {
        decisionId: decision.id,
        playerId: 'player1',
        selection: 'dead-bear',
        timestamp: Date.now(),
      },
      gameState,
    );

    expect(result.valid).toBe(false);
    expect(result.error).toContain('graveyard');
  });

  it('rejects a previously offered attacker target when the permanent is no longer attacking', () => {
    const manager = new DecisionManager();
    manager.initGame('test-game');

    const formerAttacker = createCreature('attacker-1', 'Former Attacker', 'player2', '', {
      attacking: undefined,
      blockedBy: [],
    });
    const gameState = createGameState([formerAttacker]);
    const decision = {
      ...createDecision(DecisionType.SELECT_TARGETS, 'player1'),
      targetTypes: ['creature'],
      options: [{ id: 'attacker-1', label: 'Former Attacker' }],
      filters: [{ type: 'custom', value: 'attacking' }],
    } as PendingDecision;
    manager.addDecision('test-game', decision);

    const { result } = manager.processResponse(
      'test-game',
      {
        decisionId: decision.id,
        playerId: 'player1',
        selection: 'attacker-1',
        timestamp: Date.now(),
      },
      gameState,
    );

    expect(result.valid).toBe(false);
    expect(result.error).toContain('attacking');
  });
});