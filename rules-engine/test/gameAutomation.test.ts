/**
 * Test suite for game automation modules
 */

import { describe, it, expect, beforeEach } from 'vitest';
import type { GameState } from '../../shared/src';
import { RulesEngineEvent } from '../src/core/events';
import {
  GamePhase,
  GameStep,
  getNextGameStep,
  doesStepReceivePriority,
  isMainPhase,
} from '../src/actions/gamePhases';
import {
  performStateBasedActions,
  checkWinConditions,
} from '../src/actions/stateBasedActionsHandler';
import {
  executeUntapStep,
  executeDrawStep,
  executeCleanupStep,
  executeTurnBasedAction,
} from '../src/actions/turnActions';
import {
  initializeGame,
  drawInitialHand,
  processMulligan,
} from '../src/actions/gameSetup';
import {
  advanceGame,
  passPriority,
} from '../src/actions/gameAdvance';
import { createEmblemFromPlaneswalker } from '../src/emblemSupport';
import { applyTemporaryCantLoseAndOpponentsCantWinEffect } from '../src/winEffectCards';

// Helper to create mock context
function createMockContext(gameStates: Map<string, GameState>) {
  const emittedEvents: any[] = [];
  return {
    getState: (gameId: string) => gameStates.get(gameId),
    setState: (gameId: string, state: GameState) => gameStates.set(gameId, state),
    emit: (event: any) => emittedEvents.push(event),
    gameId: 'test-game',
    getEmittedEvents: () => emittedEvents,
  };
}

describe('Game Phases', () => {
  it('should advance from untap to upkeep', () => {
    const { phase, step } = getNextGameStep(GamePhase.BEGINNING, GameStep.UNTAP);
    expect(phase).toBe(GamePhase.BEGINNING);
    expect(step).toBe(GameStep.UPKEEP);
  });

  it('should advance from draw to precombat main', () => {
    const { phase, step } = getNextGameStep(GamePhase.BEGINNING, GameStep.DRAW);
    expect(phase).toBe(GamePhase.PRECOMBAT_MAIN);
    expect(step).toBe(GameStep.MAIN1);
  });

  it('should advance from precombat main to combat', () => {
    const { phase, step } = getNextGameStep(GamePhase.PRECOMBAT_MAIN, GameStep.MAIN1);
    expect(phase).toBe(GamePhase.COMBAT);
    expect(step).toBe(GameStep.BEGIN_COMBAT);
  });

  it('should advance from cleanup to new turn', () => {
    const { phase, step, isNewTurn } = getNextGameStep(GamePhase.ENDING, GameStep.CLEANUP);
    expect(phase).toBe(GamePhase.BEGINNING);
    expect(step).toBe(GameStep.UNTAP);
    expect(isNewTurn).toBe(true);
  });

  it('should identify priority steps correctly', () => {
    expect(doesStepReceivePriority(GameStep.UPKEEP)).toBe(true);
    expect(doesStepReceivePriority(GameStep.MAIN1)).toBe(true);
    expect(doesStepReceivePriority(GameStep.UNTAP)).toBe(false);
    expect(doesStepReceivePriority(GameStep.CLEANUP)).toBe(false);
  });

  it('should identify main phases', () => {
    expect(isMainPhase(GamePhase.PRECOMBAT_MAIN)).toBe(true);
    expect(isMainPhase(GamePhase.POSTCOMBAT_MAIN)).toBe(true);
    expect(isMainPhase(GamePhase.COMBAT)).toBe(false);
  });
});

describe('State-Based Actions', () => {
  it('should detect player at 0 life', () => {
    const state: GameState = {
      players: [
        { id: 'player1', life: 0, battlefield: [], hand: [], library: [], graveyard: [] },
        { id: 'player2', life: 40, battlefield: [], hand: [], library: [], graveyard: [] },
      ],
      battlefield: [],
    } as any;

    const result = performStateBasedActions(state);
    expect(result.playerLost).toBe('player1');
    expect(result.actions).toContain('player1 loses (0 life)');
  });

  it('should detect player with 10 poison', () => {
    const state: GameState = {
      players: [
        { id: 'player1', life: 40, counters: { poison: 10 }, battlefield: [], hand: [], library: [], graveyard: [] },
      ],
      battlefield: [],
    } as any;

    const result = performStateBasedActions(state);
    expect(result.playerLost).toBe('player1');
  });

  it('should detect commander damage loss', () => {
    const state: GameState = {
      players: [
        { id: 'player1', life: 40, commanderDamage: { 'cmd1': 21 }, battlefield: [], hand: [], library: [], graveyard: [] },
      ],
      battlefield: [],
    } as any;

    const result = performStateBasedActions(state);
    expect(result.playerLost).toBe('player1');
  });

  it('should prevent state-based loss when player has a cannot-lose effect', () => {
    const state: GameState = {
      players: [
        { id: 'player1', life: 0, battlefield: [], hand: [], library: [], graveyard: [] },
      ],
      battlefield: [
        {
          id: 'angel1',
          controller: 'player1',
          owner: 'player1',
          card: {
            name: 'Platinum Angel',
            type_line: 'Artifact Creature — Angel',
            oracle_text: "You can't lose the game and your opponents can't win the game.",
          },
        },
      ],
    } as any;

    const result = performStateBasedActions(state);
    expect(result.playerLost).toBeUndefined();
    expect(result.actions.some(action => action.includes('would lose'))).toBe(true);
  });

  it("should prevent state-based loss when player has Gideon's emblem and controls a Gideon planeswalker", () => {
    const emblem = createEmblemFromPlaneswalker('player1', 'Gideon of the Trials')!.emblem;
    const state: GameState = {
      players: [
        { id: 'player1', life: 0, emblems: [emblem], battlefield: [], hand: [], library: [], graveyard: [] },
      ],
      battlefield: [
        {
          id: 'gideon1',
          controller: 'player1',
          owner: 'player1',
          counters: { loyalty: 3 },
          card: {
            name: 'Gideon of the Trials',
            type_line: 'Legendary Planeswalker — Gideon',
            oracle_text: '',
          },
        },
      ],
    } as any;

    const result = performStateBasedActions(state);
    expect(result.playerLost).toBeUndefined();
    expect(result.actions.some(action => action.includes("Gideon's Emblem"))).toBe(true);
  });

  it("should prevent state-based loss when player has a temporary can't-lose effect this turn", () => {
    const protectedState = applyTemporaryCantLoseAndOpponentsCantWinEffect(
      {
        players: [
          { id: 'player1', life: 0, battlefield: [], hand: [], library: [], graveyard: [] },
        ],
        battlefield: [],
      } as any,
      'angel-grace',
      "Angel's Grace",
      'player1',
      'player1',
      "You can't lose the game this turn and your opponents can't win the game this turn."
    ).state;

    const result = performStateBasedActions(protectedState as any);
    expect(result.playerLost).toBeUndefined();
    expect(result.actions.some(action => action.includes("Angel's Grace"))).toBe(true);
  });

  it('should keep creatures alive when an attached aura raises toughness above marked damage', () => {
    const state: GameState = {
      players: [
        { id: 'player1', life: 40, battlefield: [], hand: [], library: [], graveyard: [] },
      ],
      battlefield: [
        {
          id: 'creature1',
          controller: 'player1',
          owner: 'player1',
          counters: { damage: 2 },
          card: {
            name: 'Grizzly Bears',
            type_line: 'Creature — Bear',
            power: '2',
            toughness: '2',
            oracle_text: '',
          },
        },
        {
          id: 'aura1',
          controller: 'player1',
          owner: 'player1',
          attachedTo: 'creature1',
          card: {
            name: 'Shiny Impetus',
            type_line: 'Enchantment — Aura',
            oracle_text: 'Enchant creature\nEnchanted creature gets +2/+2 and is goaded.',
          },
        },
      ],
    } as any;

    const result = performStateBasedActions(state);
    expect(result.state.battlefield.some((perm: any) => perm.id === 'creature1')).toBe(true);
    expect(result.actions).not.toContain('Grizzly Bears dies (lethal damage)');
  });

  it('should treat effective creatures as creatures for state-based lethal damage', () => {
    const state: GameState = {
      players: [
        { id: 'player1', life: 40, battlefield: [], hand: [], library: [], graveyard: [] },
      ],
      battlefield: [
        {
          id: 'animated-relic',
          controller: 'player1',
          owner: 'player1',
          counters: { damage: 3 },
          effectiveTypes: ['Artifact', 'Creature'],
          effectiveToughness: 3,
          card: {
            name: 'Animated Relic',
            type_line: 'Artifact',
            power: '3',
            toughness: '3',
            oracle_text: '',
          },
        },
      ],
    } as any;

    const result = performStateBasedActions(state);
    expect(result.state.battlefield.some((perm: any) => perm.id === 'animated-relic')).toBe(false);
    expect(result.actions).toContain('Animated Relic dies (lethal damage)');
  });

  it('should use regeneration shields for state-based lethal damage', () => {
    const state: GameState = {
      players: [
        { id: 'player1', life: 40, battlefield: [], hand: [], library: [], graveyard: [] },
      ],
      battlefield: [
        {
          id: 'skeleton-1',
          controller: 'player1',
          owner: 'player1',
          tapped: false,
          attacking: 'player2',
          counters: { damage: 1 },
          markedDamage: 1,
          damageMarked: 1,
          card: {
            name: 'Drudge Skeletons',
            type_line: 'Creature - Skeleton',
            power: '1',
            toughness: '1',
            oracle_text: '',
          },
        },
      ],
      regenerationShields: [
        {
          id: 'regen-shield-skeleton-1',
          permanentId: 'skeleton-1',
          controllerId: 'player1',
          createdAt: 1,
          isUsed: false,
          expiresAtEndOfTurn: true,
        },
      ] as any,
    } as any;

    const result = performStateBasedActions(state);
    const creature = result.state.battlefield.find((perm: any) => perm.id === 'skeleton-1') as any;

    expect(creature).toBeTruthy();
    expect(creature.tapped).toBe(true);
    expect(creature.attacking).toBeUndefined();
    expect(creature.counters?.damage).toBe(0);
    expect(result.actions).toContain('Drudge Skeletons regenerates instead of dying');
    expect((result.state.players[0] as any).graveyard || []).toHaveLength(0);
    expect(((result.state as any).regenerationShields || [])[0]?.isUsed).toBe(true);
  });

  it('should destroy creatures with deathtouch damage during state-based actions', () => {
    const state: GameState = {
      players: [
        { id: 'player1', life: 40, battlefield: [], hand: [], library: [], graveyard: [] },
        { id: 'player2', life: 40, battlefield: [], hand: [], library: [], graveyard: [] },
      ],
      battlefield: [
        {
          id: 'deadly-attacker',
          controller: 'player2',
          owner: 'player2',
          card: {
            name: 'Deadly Recluse',
            type_line: 'Creature - Spider',
            power: '1',
            toughness: '2',
            oracle_text: 'Deathtouch, reach',
          },
        },
        {
          id: 'damaged-bear',
          controller: 'player1',
          owner: 'player1',
          counters: { damage: 1 },
          markedDamage: 1,
          damageMarked: 1,
          damageSourceIds: ['deadly-attacker'],
          card: {
            name: 'Grizzly Bears',
            type_line: 'Creature - Bear',
            power: '2',
            toughness: '2',
            oracle_text: '',
          },
        },
      ],
    } as any;

    const result = performStateBasedActions(state);
    expect(result.state.battlefield.some((perm: any) => perm.id === 'damaged-bear')).toBe(false);
    expect(result.actions).toContain('Grizzly Bears dies (deathtouch damage)');
  });

  it('should use regeneration shields for state-based deathtouch damage', () => {
    const state: GameState = {
      players: [
        { id: 'player1', life: 40, battlefield: [], hand: [], library: [], graveyard: [] },
        { id: 'player2', life: 40, battlefield: [], hand: [], library: [], graveyard: [] },
      ],
      battlefield: [
        {
          id: 'deadly-attacker',
          controller: 'player2',
          owner: 'player2',
          card: {
            name: 'Deadly Recluse',
            type_line: 'Creature - Spider',
            power: '1',
            toughness: '2',
            oracle_text: 'Deathtouch, reach',
          },
        },
        {
          id: 'skeleton-2',
          controller: 'player1',
          owner: 'player1',
          tapped: false,
          attacking: 'player2',
          counters: { damage: 1 },
          markedDamage: 1,
          damageMarked: 1,
          damageSourceIds: ['deadly-attacker'],
          card: {
            name: 'Drudge Skeletons',
            type_line: 'Creature - Skeleton',
            power: '1',
            toughness: '4',
            oracle_text: '',
          },
        },
      ],
      regenerationShields: [
        {
          id: 'regen-shield-skeleton-2',
          permanentId: 'skeleton-2',
          controllerId: 'player1',
          createdAt: 1,
          isUsed: false,
          expiresAtEndOfTurn: true,
        },
      ] as any,
    } as any;

    const result = performStateBasedActions(state);
    const creature = result.state.battlefield.find((perm: any) => perm.id === 'skeleton-2') as any;

    expect(creature).toBeTruthy();
    expect(creature.tapped).toBe(true);
    expect(creature.attacking).toBeUndefined();
    expect(creature.counters?.damage).toBe(0);
    expect(result.actions).toContain('Drudge Skeletons regenerates instead of dying');
    expect((result.state.players[0] as any).graveyard || []).toHaveLength(0);
    expect(((result.state as any).regenerationShields || [])[0]?.isUsed).toBe(true);
  });

  it('should treat effective planeswalkers as planeswalkers for zero-loyalty checks', () => {
    const state: GameState = {
      players: [
        { id: 'player1', life: 40, battlefield: [], hand: [], library: [], graveyard: [] },
      ],
      battlefield: [
        {
          id: 'awakened-walker',
          controller: 'player1',
          owner: 'player1',
          counters: { loyalty: 0 },
          effectiveTypes: ['Artifact', 'Planeswalker'],
          card: {
            name: 'Awakened Walker',
            type_line: 'Artifact',
            oracle_text: '',
          },
        },
      ],
    } as any;

    const result = performStateBasedActions(state);
    expect(result.state.battlefield.some((perm: any) => perm.id === 'awakened-walker')).toBe(false);
    expect(result.actions).toContain('Awakened Walker dies (0 loyalty)');
  });

  it('should detect last player standing', () => {
    const state: GameState = {
      players: [
        { id: 'player1', life: 40 },
      ],
    } as any;

    const result = checkWinConditions(state);
    expect(result.winner).toBe('player1');
  });

  it("should block last-player-standing wins when an opponent says opponents can't win", () => {
    const state: GameState = {
      players: [
        { id: 'player1', life: 40 },
        { id: 'player2', life: 0, hasLost: true },
      ],
      battlefield: [
        {
          id: 'angel1',
          controller: 'player2',
          owner: 'player2',
          card: {
            name: 'Platinum Angel',
            type_line: 'Artifact Creature — Angel',
            oracle_text: "You can't lose the game and your opponents can't win the game.",
          },
        },
      ],
    } as any;

    const result = checkWinConditions(state);
    expect(result.winner).toBeUndefined();
    expect(result.reason).toContain('Platinum Angel');
  });

  it("should block last-player-standing wins when an opponent has Gideon's emblem and controls a Gideon planeswalker", () => {
    const emblem = createEmblemFromPlaneswalker('player2', 'Gideon of the Trials')!.emblem;
    const state: GameState = {
      players: [
        { id: 'player1', life: 40 },
        { id: 'player2', life: 0, hasLost: true, emblems: [emblem] },
      ],
      battlefield: [
        {
          id: 'gideon2',
          controller: 'player2',
          owner: 'player2',
          counters: { loyalty: 3 },
          card: {
            name: 'Gideon of the Trials',
            type_line: 'Legendary Planeswalker — Gideon',
            oracle_text: '',
          },
        },
      ],
    } as any;

    const result = checkWinConditions(state);
    expect(result.winner).toBeUndefined();
    expect(result.reason).toContain("Gideon's Emblem");
  });
});

describe('Turn Actions', () => {
  it('should untap all permanents', () => {
    const state: GameState = {
      players: [
        {
          id: 'player1',
        },
      ],
      // Use centralized battlefield
      battlefield: [
        { id: 'perm1', controller: 'player1', tapped: true, card: { name: 'Forest' } },
        { id: 'perm2', controller: 'player1', tapped: true, card: { name: 'Mountain' } },
      ],
    } as any;

    const result = executeUntapStep(state, 'player1');
    // Check centralized battlefield - all player1's permanents should be untapped
    const player1Permanents = result.state.battlefield?.filter((p: any) => p.controller === 'player1');
    expect(player1Permanents?.every((p: any) => !p.tapped)).toBe(true);
  });

  it('should draw a card', () => {
    const gameStates = new Map<string, GameState>();
    const context = createMockContext(gameStates);
    
    const state: GameState = {
      players: [
        {
          id: 'player1',
          library: [{ id: 'card1', name: 'Forest' }, { id: 'card2', name: 'Island' }],
          hand: [],
        },
      ],
    } as any;

    const result = executeDrawStep(state, 'player1', context, 'test-game');
    const player = result.state.players.find(p => p.id === 'player1');
    expect(player?.hand?.length).toBe(1);
    expect(player?.library?.length).toBe(1);
  });

  it('should consume a pending skip-next-draw-step effect instead of drawing', () => {
    const gameStates = new Map<string, GameState>();
    const context = createMockContext(gameStates);

    const state: GameState = {
      players: [
        {
          id: 'player1',
          library: [{ id: 'card1', name: 'Forest' }, { id: 'card2', name: 'Island' }],
          hand: [],
        },
      ],
      skipNextDrawStepEffects: [
        {
          id: 'skip-draw-1',
          playerId: 'player1',
          sourceName: 'Molten Firebird',
          remainingSkips: 1,
        },
      ],
    } as any;

    const result = executeDrawStep(state, 'player1', context, 'test-game');
    const player = result.state.players.find(p => p.id === 'player1');

    expect(player?.hand?.length).toBe(0);
    expect(player?.library?.length).toBe(2);
    expect((result.state as any).skipNextDrawStepEffects || []).toEqual([]);
    expect(result.logs.some(log => log.includes('Molten Firebird'))).toBe(true);
  });

  it('should turn an empty-library draw into a win with Laboratory Maniac', () => {
    const gameStates = new Map<string, GameState>();
    const context = createMockContext(gameStates);

    const state: GameState = {
      players: [
        {
          id: 'player1',
          library: [],
          hand: [],
        },
      ],
      battlefield: [
        {
          id: 'labman1',
          controller: 'player1',
          owner: 'player1',
          card: {
            name: 'Laboratory Maniac',
            type_line: 'Creature — Human Wizard',
            oracle_text: 'If you would draw a card while your library has no cards in it, you win the game instead.',
          },
        },
      ],
    } as any;

    const result = executeDrawStep(state, 'player1', context, 'test-game');
    expect((result.state as any).winner).toBe('player1');
    expect((result.state as any).status).toBe('finished');
    expect(result.logs.some(log => log.includes('wins the game'))).toBe(true);
  });

  it('should remove damage in cleanup', () => {
    const state: GameState = {
      players: [
        {
          id: 'player1',
          hand: [],
        },
      ],
      // Use centralized battlefield
      battlefield: [
        { id: 'perm1', controller: 'player1', counters: { damage: 3 }, card: { name: 'Creature' } },
      ],
    } as any;

    const result = executeCleanupStep(state, 'player1');
    // Check centralized battlefield
    const perm = result.state.battlefield?.find((p: any) => p.id === 'perm1');
    expect(perm?.counters?.damage).toBe(0);
  });

  it('should clear regeneration shields in cleanup', () => {
    const state: GameState = {
      players: [
        {
          id: 'player1',
          hand: [],
        },
      ],
      battlefield: [],
      regenerationShields: [
        {
          id: 'regen-shield-1',
          permanentId: 'perm1',
          controllerId: 'player1',
          createdAt: 1,
          isUsed: false,
          expiresAtEndOfTurn: true,
        },
      ] as any,
    } as any;

    const result = executeCleanupStep(state, 'player1');
    expect((result.state as any).regenerationShields || []).toEqual([]);
  });

  it('should clear temporary win/loss effects in cleanup', () => {
    const state = applyTemporaryCantLoseAndOpponentsCantWinEffect(
      {
        players: [
          { id: 'player1', hand: [] },
        ],
        battlefield: [],
      } as any,
      'angel-grace',
      "Angel's Grace",
      'player1',
      'player1',
      "You can't lose the game this turn and your opponents can't win the game this turn."
    ).state;

    const result = executeCleanupStep(state as any, 'player1');
    expect(((result.state as any).winLossEffects || []).length).toBe(0);
  });

  it('should make Divine Intervention draw the game when the last counter is removed', () => {
    const state: GameState = {
      players: [
        { id: 'player1', life: 40, hand: [], library: [], graveyard: [] },
        { id: 'player2', life: 40, hand: [], library: [], graveyard: [] },
      ],
      activePlayerIndex: 0,
      step: GameStep.UPKEEP,
      phase: GamePhase.BEGINNING,
      battlefield: [
        {
          id: 'divine1',
          controller: 'player1',
          owner: 'player1',
          counters: { intervention: 1 },
          card: {
            name: 'Divine Intervention',
            type_line: 'Enchantment',
            oracle_text: 'At the beginning of your upkeep, remove an intervention counter from Divine Intervention. When you remove the last intervention counter from Divine Intervention, the game is a draw.',
          },
        },
      ],
    } as any;
    const context = createMockContext(new Map());

    const result = executeTurnBasedAction('test-game', state, context);
    expect((result.next as any).status).toBe('finished');
    expect((result.next as any).isDraw).toBe(true);
    expect((result.next as any).winReason).toBe('Divine Intervention');
  });

  it('should make the highest-life player win when Celestial Convergence reaches zero omen counters', () => {
    const state: GameState = {
      players: [
        { id: 'player1', life: 28, hand: [], library: [], graveyard: [] },
        { id: 'player2', life: 35, hand: [], library: [], graveyard: [] },
      ],
      activePlayerIndex: 0,
      step: GameStep.UPKEEP,
      phase: GamePhase.BEGINNING,
      battlefield: [
        {
          id: 'celestial1',
          controller: 'player1',
          owner: 'player1',
          counters: { omen: 1 },
          card: {
            name: 'Celestial Convergence',
            type_line: 'Enchantment',
            oracle_text: 'At the beginning of your upkeep, remove an omen counter from Celestial Convergence. If there are no omen counters on Celestial Convergence, the player with the highest life total wins the game. If two or more players are tied for highest life total, the game is a draw.',
          },
        },
      ],
    } as any;
    const context = createMockContext(new Map());

    const result = executeTurnBasedAction('test-game', state, context);
    expect((result.next as any).winner).toBe('player2');
    expect((result.next as any).winReason).toBe('Celestial Convergence');
  });

  it('should apply a temporary win/loss prevention effect when Angel\'s Grace resolves from the stack', () => {
    const gameStates = new Map<string, GameState>();
    const context = createMockContext(gameStates);
    const state: GameState = {
      players: [
        { id: 'player1', name: 'Player 1', life: 1, battlefield: [], hand: [], library: [], graveyard: [] },
        { id: 'player2', name: 'Player 2', life: 40, battlefield: [], hand: [], library: [], graveyard: [] },
      ],
      phase: GamePhase.MAIN1,
      step: GameStep.MAIN1,
      activePlayerIndex: 0,
      priorityPlayerIndex: 1,
      priorityPasses: 1,
      stack: [
        {
          id: 'angel-grace-spell',
          type: 'spell',
          controller: 'player1',
          card: {
            id: 'angel-grace-card',
            name: "Angel's Grace",
            type_line: 'Instant',
            oracle_text: "You can't lose the game this turn and your opponents can't win the game this turn.",
          },
        } as any,
      ],
      battlefield: [],
    } as any;
    gameStates.set('test-game', state);

    const result = passPriority('test-game', 'player2', context);
    expect(((result.next as any).winLossEffects || []).length).toBeGreaterThan(0);
    expect(result.log.some(log => log.includes('win/loss prevention effect'))).toBe(true);
  });
});

describe('Game Setup', () => {
  it('should initialize a game', () => {
    const gameStates = new Map<string, GameState>();
    const context = createMockContext(gameStates);

    const players = [
      { id: 'player1', name: 'Alice', deckCards: [{ id: 'c1' }, { id: 'c2' }] },
      { id: 'player2', name: 'Bob', deckCards: [{ id: 'c3' }, { id: 'c4' }] },
    ];

    const result = initializeGame('test-game', players, context);
    
    expect(result.next.players.length).toBe(2);
    expect(result.next.players[0].life).toBe(40);
    expect(result.next.phase).toBe(GamePhase.PRE_GAME);
  });

  it('should draw initial hand', () => {
    const gameStates = new Map<string, GameState>();
    const state: GameState = {
      players: [
        {
          id: 'player1',
          library: Array(60).fill(null).map((_, i) => ({ id: `card${i}` })),
          hand: [],
        },
      ],
    } as any;
    gameStates.set('test-game', state);
    const context = createMockContext(gameStates);

    const result = drawInitialHand('test-game', 'player1', 7, context);
    const player = result.next.players.find(p => p.id === 'player1');
    
    expect(player?.hand?.length).toBe(7);
    expect(player?.library?.length).toBe(53);
  });

  it('should process mulligan', () => {
    const gameStates = new Map<string, GameState>();
    const state: GameState = {
      players: [
        {
          id: 'player1',
          library: Array(53).fill(null).map((_, i) => ({ id: `lib${i}` })),
          hand: Array(7).fill(null).map((_, i) => ({ id: `hand${i}` })),
          mulliganCount: 0,
        },
      ],
    } as any;
    gameStates.set('test-game', state);
    const context = createMockContext(gameStates);

    const result = processMulligan('test-game', 'player1', false, context);
    const player = result.next.players.find(p => p.id === 'player1');
    
    expect(player?.hand?.length).toBe(6); // One less
    expect((player as any)?.mulliganCount).toBe(1);
  });
});

describe('Game Advancement', () => {
  it('should advance game phase', () => {
    const gameStates = new Map<string, GameState>();
    const state: GameState = {
      players: [
        { id: 'player1', life: 40, battlefield: [], library: [{ id: 'c1' }], hand: [] },
        { id: 'player2', life: 40, battlefield: [], library: [], hand: [] },
      ],
      phase: GamePhase.BEGINNING,
      step: GameStep.UPKEEP,
      activePlayerIndex: 0,
      turn: 1,
      stack: [],
      battlefield: [],
    } as any;
    gameStates.set('test-game', state);
    const context = createMockContext(gameStates);

    const result = advanceGame('test-game', context);
    
    expect(result.next.step).toBe(GameStep.DRAW);
  });

  it('should award upkeep alternate wins during game advancement', () => {
    const gameStates = new Map<string, GameState>();
    const context = createMockContext(gameStates);
    const state: GameState = {
      players: [
        {
          id: 'player1',
          life: 40,
          battlefield: [],
          library: Array(200).fill(null).map((_, i) => ({ id: `card${i}`, type_line: 'Instant' })),
          hand: [],
          graveyard: [],
        },
        {
          id: 'player2',
          life: 40,
          battlefield: [],
          library: [],
          hand: [],
          graveyard: [],
        },
      ],
      activePlayerIndex: 0,
      priorityPlayerIndex: 0,
      phase: GamePhase.BEGINNING,
      step: GameStep.UNTAP,
      battlefield: [
        {
          id: 'wits1',
          controller: 'player1',
          owner: 'player1',
          card: {
            name: 'Battle of Wits',
            type_line: 'Enchantment',
            oracle_text: 'At the beginning of your upkeep, if you have 200 or more cards in your library, you win the game.',
          },
        },
      ],
    } as any;
    gameStates.set('test-game', state);

    const result = advanceGame('test-game', context);
    expect(result.next.step).toBe(GameStep.UPKEEP);
    expect((result.next as any).winner).toBe('player1');
    expect(result.log.some(log => log.includes('wins the game'))).toBe(true);
  });

  it("should resolve Thassa's Oracle ETB win through the stack", () => {
    const gameStates = new Map<string, GameState>();
    const context = createMockContext(gameStates);
    const state: GameState = {
      players: [
        {
          id: 'player1',
          name: 'Player 1',
          life: 40,
          battlefield: [],
          library: Array(5).fill(null).map((_, i) => ({ id: `card${i}`, type_line: 'Instant' })),
          hand: [],
          graveyard: [],
        },
        {
          id: 'player2',
          name: 'Player 2',
          life: 40,
          battlefield: [],
          library: [],
          hand: [],
          graveyard: [],
        },
      ],
      phase: GamePhase.MAIN1,
      step: GameStep.MAIN1,
      activePlayerIndex: 0,
      priorityPlayerIndex: 1,
      priorityPasses: 1,
      stack: [
        {
          id: 'oracle-spell',
          type: 'spell',
          controller: 'player1',
          card: {
            id: 'oracle-card',
            name: "Thassa's Oracle",
            type_line: 'Creature — Merfolk Wizard',
            mana_cost: '{U}{U}',
            oracle_text: 'When Thassa\'s Oracle enters the battlefield, look at the top X cards of your library, where X is your devotion to blue. Put up to one of them on top of your library and the rest on the bottom of your library in a random order. If X is greater than or equal to the number of cards in your library, you win the game.',
          },
        } as any,
      ],
      battlefield: [
        {
          id: 'blue-perm',
          controller: 'player1',
          owner: 'player1',
          card: {
            id: 'blue-perm-card',
            name: 'Blue Permanent',
            type_line: 'Enchantment',
            mana_cost: '{U}{U}{U}',
            oracle_text: '',
          },
        },
      ],
    } as any;
    gameStates.set('test-game', state);

    const result = passPriority('test-game', 'player2', context);
    expect((result.next as any).winner).toBe('player1');
    expect((result.next as any).status).toBe('finished');
    expect(result.log.some(log => log.includes("Thassa's Oracle condition met"))).toBe(true);
  });

  it('should pass priority', () => {
    const gameStates = new Map<string, GameState>();
    const state: GameState = {
      players: [
        { id: 'player1' },
        { id: 'player2' },
      ],
      priorityPlayerIndex: 0,
      stack: [],
    } as any;
    gameStates.set('test-game', state);
    const context = createMockContext(gameStates);

    const result = passPriority('test-game', 'player1', context);
    
    expect(result.next.priorityPlayerIndex).toBe(1);
  });

  it('should reset priority to active player when advancing from draw step to main phase', () => {
    const gameStates = new Map<string, GameState>();
    const state: GameState = {
      players: [
        { id: 'player1', name: 'Player 1', life: 40, battlefield: [], library: [{ id: 'c1' }], hand: [] },
        { id: 'player2', name: 'Player 2', life: 40, battlefield: [], library: [], hand: [] },
        { id: 'player3', name: 'Player 3', life: 40, battlefield: [], library: [], hand: [] },
        { id: 'player4', name: 'Player 4', life: 40, battlefield: [], library: [], hand: [] },
      ],
      phase: GamePhase.BEGINNING,
      step: GameStep.DRAW,
      activePlayerIndex: 0,
      priorityPlayerIndex: 3, // Non-active player has priority (simulating all players passed)
      turn: 1,
      stack: [],
      battlefield: [],
    } as any;
    gameStates.set('test-game', state);
    const context = createMockContext(gameStates);

    // Advance from draw step - priority should be reset to active player
    const result = advanceGame('test-game', context);
    
    expect(result.next.phase).toBe(GamePhase.PRECOMBAT_MAIN);
    expect(result.next.step).toBe(GameStep.MAIN1);
    // Priority should be reset to active player (index 0) when entering main phase
    expect(result.next.priorityPlayerIndex).toBe(0);
    // Priority passes should be reset
    expect((result.next as any).priorityPasses).toBe(0);
  });

  it('should reset priority passes when entering any new step', () => {
    const gameStates = new Map<string, GameState>();
    const state: GameState = {
      players: [
        { id: 'player1', name: 'Player 1', life: 40, battlefield: [], library: [{ id: 'c1' }], hand: [] },
        { id: 'player2', name: 'Player 2', life: 40, battlefield: [], library: [], hand: [] },
      ],
      phase: GamePhase.BEGINNING,
      step: GameStep.UPKEEP,
      activePlayerIndex: 0,
      priorityPlayerIndex: 1,
      priorityPasses: 2, // Both players have passed
      turn: 1,
      stack: [],
      battlefield: [],
    } as any;
    gameStates.set('test-game', state);
    const context = createMockContext(gameStates);

    const result = advanceGame('test-game', context);
    
    expect(result.next.step).toBe(GameStep.DRAW);
    // Priority passes should be reset
    expect((result.next as any).priorityPasses).toBe(0);
    // Priority should be given to active player for draw step
    expect(result.next.priorityPlayerIndex).toBe(0);
  });

  it('should not grant priority for untap step', () => {
    const gameStates = new Map<string, GameState>();
    const state: GameState = {
      players: [
        { id: 'player1', name: 'Player 1', life: 40, battlefield: [], library: [{ id: 'c1' }], hand: [] },
        { id: 'player2', name: 'Player 2', life: 40, battlefield: [], library: [], hand: [] },
      ],
      phase: GamePhase.ENDING,
      step: GameStep.CLEANUP,
      activePlayerIndex: 0,
      priorityPlayerIndex: 1, // Some other player had priority
      turn: 1,
      stack: [],
      battlefield: [],
    } as any;
    gameStates.set('test-game', state);
    const context = createMockContext(gameStates);

    // Advance from cleanup to new turn (untap step)
    const result = advanceGame('test-game', context);
    
    expect(result.next.step).toBe(GameStep.UNTAP);
    // Priority should NOT be reset for untap step (no priority in untap step)
    expect(result.next.priorityPlayerIndex).toBe(1);
    // Priority passes should still be reset
    expect((result.next as any).priorityPasses).toBe(0);
  });

  it('should snapshot the battlefield when a new turn starts before untap actions run', () => {
    const gameStates = new Map<string, GameState>();
    const state: GameState = {
      players: [
        { id: 'player1', name: 'Player 1', life: 40, battlefield: [], library: [{ id: 'c1' }], hand: [] },
        { id: 'player2', name: 'Player 2', life: 40, battlefield: [], library: [], hand: [] },
      ],
      phase: GamePhase.ENDING,
      step: GameStep.CLEANUP,
      activePlayerIndex: 0,
      priorityPlayerIndex: 1,
      turn: 1,
      stack: [],
      battlefield: [
        { id: 'turnStartLand', ownerId: 'player2', controller: 'player2', name: 'Island', type_line: 'Basic Land — Island', tapped: true } as any,
      ],
    } as any;
    gameStates.set('test-game', state);
    const context = createMockContext(gameStates);

    const result = advanceGame('test-game', context);

    expect(result.next.step).toBe(GameStep.UNTAP);
    expect(((result.next as any).turnStartBattlefieldSnapshot || [])[0]?.id).toBe('turnStartLand');
    expect(((result.next as any).turnStartBattlefieldSnapshot || [])[0]?.tapped).toBe(true);
    expect(((result.next as any).battlefield || [])[0]?.tapped).toBe(false);
  });
});
