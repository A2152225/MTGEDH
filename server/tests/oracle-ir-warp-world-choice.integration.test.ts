import { afterEach, describe, expect, it, vi } from 'vitest';

import type { GameState, PlayerID } from '../../shared/src/index.js';
import { applyOracleIRStepsToGameState, buildOracleIRExecutionContext } from '../../rules-engine/src/oracleIRExecutor.js';
import { createInitialGameState } from '../src/state/gameState.js';
import { collectOracleEffectSteps } from '../src/state/modules/trigger-runtime-wiring.js';
import {
  applyOracleIRStepsOnServer,
  maybeApplyOracleIrChoiceStepFromResolution,
  maybeResumeOracleIRStepsAfterResolution,
} from '../src/state/modules/oracleIrServerZoneSync.js';
import { persistUnqueuedPendingContinuationFromOracleIRResult } from '../src/state/modules/oracleIrServerZoneSync-handlers/oracleIrServerPendingContinuationAndCostReduction.js';
import { queueWarpWorldChoicePromptsFromOracleIRResult } from '../src/state/modules/oracleIrServerZoneSync-handlers/oracleIrServerWarpWorldChoicePrompts.js';
import { flushChaosResolutionZoneTriggers } from '../src/state/modules/oracleIrChaosResolutionTriggerHold.js';
import { WARP_WORLD_CHOICE_REMAINDER } from '../../rules-engine/src/oracleIRExecutorWarpWorldInteractive.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';

const WARP_WORLD_TEXT =
  "Each player shuffles all permanents they own into their library, then reveals that many cards from the top of their library. Each player puts all artifact, creature, and land cards revealed this way onto the battlefield, then does the same for enchantment cards, then puts all cards revealed this way that weren't put onto the battlefield on the bottom of their library.";

describe('oracle IR Warp World live choice adapter', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('queues commander 903.9a and resumes into the command zone', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.999);
    const gameId = 'oracle_ir_warp_world_commander';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);

    const player = (game.state as any).players.find((entry: any) => entry.id === p1);
    player.library = [{ id: 'card_cub', name: 'Bear Cub', type_line: 'Creature — Bear' }];
    player.commandZone = [];
    player.hand = [];
    player.graveyard = [];
    (game.state as any).commandZone = {
      [p1]: { commanderIds: ['card_cmd'], inCommandZone: [], commanderCards: [] },
    };
    (game.state as any).battlefield = [
      {
        id: 'perm_cmd',
        owner: p1,
        controller: p1,
        isCommander: true,
        card: { id: 'card_cmd', name: 'Command Bear', type_line: 'Legendary Creature — Bear', isCommander: true },
      },
    ];

    const ctx = game as any;
    ctx.gameId = gameId;
    ResolutionQueueManager.removeQueue(gameId);

    const steps = collectOracleEffectSteps(WARP_WORLD_TEXT, 'Warp World');
    applyOracleIRStepsOnServer(
      ctx,
      game.state as any,
      steps,
      buildOracleIRExecutionContext({
        controllerId: p1,
        sourceId: 'warp-world-1',
        sourceName: 'Warp World',
        sourceObjectType: 'spell',
      }),
      { allowOptional: true },
      { controller: p1 },
    );

    const optionStep = ResolutionQueueManager.getStepsForPlayer(gameId, p1)
      .find((step) => step.type === ResolutionStepType.OPTION_CHOICE);
    expect(optionStep).toBeTruthy();
    expect((optionStep as any)?.oracleIrWarpWorldChoice).toBe('commander_library');

    const completedStep = ResolutionQueueManager.completeStep(gameId, String(optionStep!.id), {
      stepId: String(optionStep!.id),
      playerId: p1,
      selections: ['command'],
      cancelled: false,
      timestamp: Date.now(),
    });
    maybeApplyOracleIrChoiceStepFromResolution(ctx, completedStep, completedStep!.response!);
    maybeResumeOracleIRStepsAfterResolution(ctx, completedStep);

    const nextPlayer = (game.state as any).players.find((entry: any) => entry.id === p1);
    expect((nextPlayer.commandZone || []).map((card: any) => card.name)).toEqual(['Command Bear']);
    expect((nextPlayer.library || []).map((card: any) => card.name)).not.toContain('Command Bear');
    expect(((game.state as any).commandZone?.[p1]?.inCommandZone || [])).toContain('card_cmd');
    expect(((game.state as any).battlefield || []).some((perm: any) => perm?.card?.name === 'Bear Cub')).toBe(true);
    ResolutionQueueManager.removeQueue(gameId);
  });

  it('keeps sequential 903.9a choices and still reveals that many for each player', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.999);
    const gameId = 'oracle_ir_warp_world_commander_apnap';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    game.applyEvent!({ type: 'join', playerId: p2, name: 'P2' } as any);

    const player1 = (game.state as any).players.find((entry: any) => entry.id === p1);
    const player2 = (game.state as any).players.find((entry: any) => entry.id === p2);
    player1.library = [{ id: 'card_cub1', name: 'Bear Cub', type_line: 'Creature — Bear' }];
    player1.commandZone = [];
    player1.hand = [];
    player1.graveyard = [];
    player2.library = [{ id: 'card_cub2', name: 'Wolf Cub', type_line: 'Creature — Wolf' }];
    player2.commandZone = [];
    player2.hand = [];
    player2.graveyard = [];
    (game.state as any).commandZone = {
      [p1]: { commanderIds: ['card_cmd1'], inCommandZone: [], commanderCards: [] },
      [p2]: { commanderIds: ['card_cmd2'], inCommandZone: [], commanderCards: [] },
    };
    (game.state as any).turnOrder = [p1, p2];
    (game.state as any).activePlayerIndex = 0;
    (game.state as any).battlefield = [
      {
        id: 'perm_cmd1',
        owner: p1,
        controller: p1,
        isCommander: true,
        card: { id: 'card_cmd1', name: 'Command Bear', type_line: 'Legendary Creature — Bear', isCommander: true },
      },
      {
        id: 'perm_cmd2',
        owner: p2,
        controller: p2,
        isCommander: true,
        card: { id: 'card_cmd2', name: 'Command Wolf', type_line: 'Legendary Creature — Wolf', isCommander: true },
      },
    ];

    const ctx = game as any;
    ctx.gameId = gameId;
    ResolutionQueueManager.removeQueue(gameId);

    applyOracleIRStepsOnServer(
      ctx,
      game.state as any,
      collectOracleEffectSteps(WARP_WORLD_TEXT, 'Warp World'),
      buildOracleIRExecutionContext({
        controllerId: p1,
        sourceId: 'warp-world-apnap',
        sourceName: 'Warp World',
        sourceObjectType: 'spell',
      }),
      { allowOptional: true },
      { controller: p1 },
    );

    const firstStep = (ResolutionQueueManager.getQueue(gameId)?.steps || [])
      .find((step: any) => String(step?.oracleIrWarpWorldChoice || '') === 'commander_library');
    expect(firstStep).toBeTruthy();
    const firstOwner = String((firstStep as any)?.playerId || '');
    const firstCompleted = ResolutionQueueManager.completeStep(gameId, String(firstStep!.id), {
      stepId: String(firstStep!.id),
      playerId: firstOwner as PlayerID,
      selections: ['command'],
      cancelled: false,
      timestamp: Date.now(),
    });
    maybeApplyOracleIrChoiceStepFromResolution(ctx, firstCompleted, firstCompleted!.response!);
    maybeResumeOracleIRStepsAfterResolution(ctx, firstCompleted);

    const secondStep = (ResolutionQueueManager.getQueue(gameId)?.steps || [])
      .find((step: any) => String(step?.oracleIrWarpWorldChoice || '') === 'commander_library');
    expect(secondStep).toBeTruthy();
    const secondOwner = String((secondStep as any)?.playerId || '');
    expect(secondOwner).not.toBe(firstOwner);
    const secondCompleted = ResolutionQueueManager.completeStep(gameId, String(secondStep!.id), {
      stepId: String(secondStep!.id),
      playerId: secondOwner as PlayerID,
      selections: ['command'],
      cancelled: false,
      timestamp: Date.now(),
    });
    maybeApplyOracleIrChoiceStepFromResolution(ctx, secondCompleted, secondCompleted!.response!);
    maybeResumeOracleIRStepsAfterResolution(ctx, secondCompleted);

    const names = ((game.state as any).battlefield || []).map((perm: any) => perm?.card?.name || perm?.name);
    expect(names).toEqual(expect.arrayContaining(['Bear Cub', 'Wolf Cub']));
    expect(((game.state as any).commandZone?.[p1]?.inCommandZone || [])).toContain('card_cmd1');
    expect(((game.state as any).commandZone?.[p2]?.inCommandZone || [])).toContain('card_cmd2');
    const nextP1 = (game.state as any).players.find((entry: any) => entry.id === p1);
    const nextP2 = (game.state as any).players.find((entry: any) => entry.id === p2);
    expect((nextP1.library || []).map((card: any) => card.name)).not.toContain('Command Bear');
    expect((nextP2.library || []).map((card: any) => card.name)).not.toContain('Command Wolf');
    ResolutionQueueManager.removeQueue(gameId);
  });

  it('puts each owner\'s shared-id cards after sequential 903.9a to the command zone', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.999);
    const gameId = 'oracle_ir_warp_world_shared_id_after_commander';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    const p3 = 'p3' as PlayerID;
    const sharedId = 'shared_mountain_id';
    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    game.applyEvent!({ type: 'join', playerId: p2, name: 'P2' } as any);
    game.applyEvent!({ type: 'join', playerId: p3, name: 'P3' } as any);

    const player1 = (game.state as any).players.find((entry: any) => entry.id === p1);
    const player2 = (game.state as any).players.find((entry: any) => entry.id === p2);
    const player3 = (game.state as any).players.find((entry: any) => entry.id === p3);
    player1.library = [{ id: sharedId, name: 'P1 Mountain', type_line: 'Basic Land — Mountain' }];
    player1.commandZone = [];
    player1.hand = [];
    player1.graveyard = [];
    player2.library = [{ id: sharedId, name: 'P2 Mountain', type_line: 'Basic Land — Mountain' }];
    player2.commandZone = [];
    player2.hand = [];
    player2.graveyard = [];
    player3.library = [{ id: sharedId, name: 'P3 Mountain', type_line: 'Basic Land — Mountain' }];
    player3.commandZone = [];
    player3.hand = [];
    player3.graveyard = [];
    (game.state as any).commandZone = {
      [p1]: { commanderIds: ['card_cmd1'], inCommandZone: [], commanderCards: [] },
      [p2]: { commanderIds: ['card_cmd2'], inCommandZone: [], commanderCards: [] },
      [p3]: { commanderIds: ['card_cmd3'], inCommandZone: [], commanderCards: [] },
    };
    (game.state as any).turnOrder = [p1, p2, p3];
    (game.state as any).activePlayerIndex = 0;
    (game.state as any).battlefield = [
      {
        id: 'perm_cmd1',
        owner: p1,
        controller: p1,
        isCommander: true,
        card: { id: 'card_cmd1', name: 'Command Bear', type_line: 'Legendary Creature — Bear', isCommander: true },
      },
      {
        id: 'perm_cmd2',
        owner: p2,
        controller: p2,
        isCommander: true,
        card: { id: 'card_cmd2', name: 'Command Wolf', type_line: 'Legendary Creature — Wolf', isCommander: true },
      },
      {
        id: 'perm_cmd3',
        owner: p3,
        controller: p3,
        isCommander: true,
        card: { id: 'card_cmd3', name: 'Command Elk', type_line: 'Legendary Creature — Elk', isCommander: true },
      },
    ];

    const ctx = game as any;
    ctx.gameId = gameId;
    ResolutionQueueManager.removeQueue(gameId);

    applyOracleIRStepsOnServer(
      ctx,
      game.state as any,
      collectOracleEffectSteps(WARP_WORLD_TEXT, 'Warp World'),
      buildOracleIRExecutionContext({
        controllerId: p1,
        sourceId: 'warp-world-shared-id',
        sourceName: 'Warp World',
        sourceObjectType: 'spell',
      }),
      { allowOptional: true },
      { controller: p1 },
    );

    const peekCommander = () => (ResolutionQueueManager.getQueue(gameId)?.steps || [])
      .find((step: any) => String(step?.oracleIrWarpWorldChoice || '') === 'commander_library');

    while (peekCommander()) {
      const commanderStep = peekCommander();
      const owner = String((commanderStep as any)?.playerId || '');
      const completed = ResolutionQueueManager.completeStep(gameId, String(commanderStep!.id), {
        stepId: String(commanderStep!.id),
        playerId: owner as PlayerID,
        selections: ['command'],
        cancelled: false,
        timestamp: Date.now(),
      });
      maybeApplyOracleIrChoiceStepFromResolution(ctx, completed, completed!.response!);
      maybeResumeOracleIRStepsAfterResolution(ctx, completed);
    }

    const battlefield = ((game.state as any).battlefield || []) as any[];
    expect(battlefield.filter((perm) => perm.owner === p1).map((perm) => perm.card?.name)).toEqual(['P1 Mountain']);
    expect(battlefield.filter((perm) => perm.owner === p2).map((perm) => perm.card?.name)).toEqual(['P2 Mountain']);
    expect(battlefield.filter((perm) => perm.owner === p3).map((perm) => perm.card?.name)).toEqual(['P3 Mountain']);
    ResolutionQueueManager.removeQueue(gameId);
  });

  it('shuffle-into-library 903.9a still resumes reveal/put/remainder (same continuation as command zone)', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.999);
    const gameId = 'oracle_ir_warp_world_commander_library';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    const p3 = 'p3' as PlayerID;
    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    game.applyEvent!({ type: 'join', playerId: p2, name: 'P2' } as any);
    game.applyEvent!({ type: 'join', playerId: p3, name: 'P3' } as any);

    const player1 = (game.state as any).players.find((entry: any) => entry.id === p1);
    const player2 = (game.state as any).players.find((entry: any) => entry.id === p2);
    const player3 = (game.state as any).players.find((entry: any) => entry.id === p3);
    const instants = (owner: string) => [
      { id: `card_bolt_${owner}`, name: 'Lightning Bolt', type_line: 'Instant' },
      { id: `card_shock_${owner}`, name: 'Shock', type_line: 'Instant' },
    ];
    player1.library = instants('p1');
    player1.commandZone = [];
    player1.hand = [];
    player1.graveyard = [];
    player2.library = instants('p2');
    player2.commandZone = [];
    player2.hand = [];
    player2.graveyard = [];
    player3.library = instants('p3');
    player3.commandZone = [];
    player3.hand = [];
    player3.graveyard = [];
    (game.state as any).commandZone = {
      [p1]: { commanderIds: ['card_cmd1'], inCommandZone: [], commanderCards: [] },
      [p2]: { commanderIds: ['card_cmd2'], inCommandZone: [], commanderCards: [] },
      [p3]: { commanderIds: ['card_cmd3'], inCommandZone: [], commanderCards: [] },
    };
    (game.state as any).turnOrder = [p1, p2, p3];
    (game.state as any).activePlayerIndex = 0;
    (game.state as any).battlefield = [
      {
        id: 'perm_cmd1',
        owner: p1,
        controller: p1,
        isCommander: true,
        card: { id: 'card_cmd1', name: 'Command Bear', type_line: 'Legendary Creature — Bear', isCommander: true },
      },
      {
        id: 'perm_forest1',
        owner: p1,
        controller: p1,
        card: { id: 'card_forest1', name: 'Forest', type_line: 'Basic Land — Forest' },
      },
      {
        id: 'perm_cmd2',
        owner: p2,
        controller: p2,
        isCommander: true,
        card: { id: 'card_cmd2', name: 'Command Wolf', type_line: 'Legendary Creature — Wolf', isCommander: true },
      },
      {
        id: 'perm_forest2',
        owner: p2,
        controller: p2,
        card: { id: 'card_forest2', name: 'Forest', type_line: 'Basic Land — Forest' },
      },
      {
        id: 'perm_cmd3',
        owner: p3,
        controller: p3,
        isCommander: true,
        card: { id: 'card_cmd3', name: 'Command Elk', type_line: 'Legendary Creature — Elk', isCommander: true },
      },
      {
        id: 'perm_forest3',
        owner: p3,
        controller: p3,
        card: { id: 'card_forest3', name: 'Forest', type_line: 'Basic Land — Forest' },
      },
    ];

    const ctx = game as any;
    ctx.gameId = gameId;
    ResolutionQueueManager.removeQueue(gameId);

    applyOracleIRStepsOnServer(
      ctx,
      game.state as any,
      collectOracleEffectSteps(WARP_WORLD_TEXT, 'Warp World'),
      buildOracleIRExecutionContext({
        controllerId: p1,
        sourceId: 'warp-world-library-choice',
        sourceName: 'Warp World',
        sourceObjectType: 'spell',
      }),
      { allowOptional: true },
      { controller: p1 },
    );

    const peekCommander = () => (ResolutionQueueManager.getQueue(gameId)?.steps || [])
      .find((step: any) => String(step?.oracleIrWarpWorldChoice || '') === 'commander_library');

    const answerCommander = (selection: 'library' | 'command') => {
      const commanderStep = peekCommander();
      expect(commanderStep).toBeTruthy();
      const owner = String((commanderStep as any)?.playerId || '');
      const completed = ResolutionQueueManager.completeStep(gameId, String(commanderStep!.id), {
        stepId: String(commanderStep!.id),
        playerId: owner as PlayerID,
        selections: [selection],
        cancelled: false,
        timestamp: Date.now(),
      });
      maybeApplyOracleIrChoiceStepFromResolution(ctx, completed, completed!.response!);
      maybeResumeOracleIRStepsAfterResolution(ctx, completed);
      return owner;
    };

    const firstOwner = String((peekCommander() as any)?.playerId || '');
    answerCommander(firstOwner === p1 ? 'library' : 'command');

    const secondPrompt = peekCommander();
    expect(secondPrompt).toBeTruthy();
    let secondChoiceKinds: string[] = [];
    try {
      const parsed = JSON.parse(String((secondPrompt as any)?.oracleIrChoiceStepJson || '[]'));
      secondChoiceKinds = Array.isArray(parsed) ? parsed.map((step: any) => String(step?.kind || '')) : [];
    } catch {
      secondChoiceKinds = [];
    }
    expect(secondChoiceKinds).toContain('reveal_top');
    expect(secondChoiceKinds.filter((kind) => kind === 'move_zone').length).toBeGreaterThanOrEqual(3);

    while (peekCommander()) {
      const owner = String((peekCommander() as any)?.playerId || '');
      answerCommander(owner === p1 ? 'library' : 'command');
    }

    const remainder = (ResolutionQueueManager.getQueue(gameId)?.steps || [])
      .find((step: any) => String(step?.oracleIrWarpWorldChoice || '') === 'remainder_any_order');
    expect(remainder).toBeTruthy();
    const nextP1 = (game.state as any).players.find((entry: any) => entry.id === p1);
    expect((nextP1.library || []).map((card: any) => card.name)).toContain('Command Bear');
    expect(((game.state as any).commandZone?.[p1]?.inCommandZone || [])).not.toContain('card_cmd1');
    ResolutionQueueManager.removeQueue(gameId);
    ResolutionQueueManager.removeQueue(gameId);
  });

  it('remainder after 903.9a does not re-run reveal/put and still prompts the next player', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.999);
    const gameId = 'oracle_ir_warp_world_remainder_after_commander';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    game.applyEvent!({ type: 'join', playerId: p2, name: 'P2' } as any);

    const player1 = (game.state as any).players.find((entry: any) => entry.id === p1);
    const player2 = (game.state as any).players.find((entry: any) => entry.id === p2);
    player1.library = [
      { id: 'card_bolt1', name: 'Lightning Bolt', type_line: 'Instant' },
      { id: 'card_shock1', name: 'Shock', type_line: 'Instant' },
    ];
    player1.commandZone = [];
    player1.hand = [];
    player1.graveyard = [];
    player2.library = [
      { id: 'card_bolt2', name: 'Lightning Bolt', type_line: 'Instant' },
      { id: 'card_shock2', name: 'Shock', type_line: 'Instant' },
    ];
    player2.commandZone = [];
    player2.hand = [];
    player2.graveyard = [];
    (game.state as any).commandZone = {
      [p1]: { commanderIds: ['card_cmd1'], inCommandZone: [], commanderCards: [] },
      [p2]: { commanderIds: ['card_cmd2'], inCommandZone: [], commanderCards: [] },
    };
    (game.state as any).turnOrder = [p1, p2];
    (game.state as any).activePlayerIndex = 0;
    (game.state as any).battlefield = [
      {
        id: 'perm_cmd1',
        owner: p1,
        controller: p1,
        isCommander: true,
        card: { id: 'card_cmd1', name: 'Command Bear', type_line: 'Legendary Creature — Bear', isCommander: true },
      },
      {
        id: 'perm_forest1',
        owner: p1,
        controller: p1,
        card: { id: 'card_forest1', name: 'Forest', type_line: 'Basic Land — Forest' },
      },
      {
        id: 'perm_cmd2',
        owner: p2,
        controller: p2,
        isCommander: true,
        card: { id: 'card_cmd2', name: 'Command Wolf', type_line: 'Legendary Creature — Wolf', isCommander: true },
      },
      {
        id: 'perm_forest2',
        owner: p2,
        controller: p2,
        card: { id: 'card_forest2', name: 'Forest', type_line: 'Basic Land — Forest' },
      },
    ];

    const ctx = game as any;
    ctx.gameId = gameId;
    ResolutionQueueManager.removeQueue(gameId);

    applyOracleIRStepsOnServer(
      ctx,
      game.state as any,
      collectOracleEffectSteps(WARP_WORLD_TEXT, 'Warp World'),
      buildOracleIRExecutionContext({
        controllerId: p1,
        sourceId: 'warp-world-remainder-after-cz',
        sourceName: 'Warp World',
        sourceObjectType: 'spell',
      }),
      { allowOptional: true },
      { controller: p1 },
    );

    for (let i = 0; i < 4; i += 1) {
      const commanderStep = (ResolutionQueueManager.getQueue(gameId)?.steps || [])
        .find((step: any) => String(step?.oracleIrWarpWorldChoice || '') === 'commander_library');
      if (!commanderStep) break;
      const owner = String((commanderStep as any)?.playerId || '');
      const completed = ResolutionQueueManager.completeStep(gameId, String(commanderStep.id), {
        stepId: String(commanderStep.id),
        playerId: owner as PlayerID,
        selections: ['command'],
        cancelled: false,
        timestamp: Date.now(),
      });
      maybeApplyOracleIrChoiceStepFromResolution(ctx, completed, completed!.response!);
      maybeResumeOracleIRStepsAfterResolution(ctx, completed);
    }

    const firstRemainder = (ResolutionQueueManager.getQueue(gameId)?.steps || [])
      .find((step: any) => String(step?.oracleIrWarpWorldChoice || '') === 'remainder_any_order');
    expect(firstRemainder).toBeTruthy();
    let remainderChoiceSteps: Array<{ kind?: string }> = [];
    try {
      const parsed = JSON.parse(String((firstRemainder as any)?.oracleIrChoiceStepJson || '[]'));
      remainderChoiceSteps = Array.isArray(parsed) ? parsed : [];
    } catch {
      remainderChoiceSteps = [];
    }
    expect(remainderChoiceSteps.some((step) => String(step?.kind || '') === 'reveal_top')).toBe(false);
    expect(remainderChoiceSteps.filter((step) => String(step?.kind || '') === 'move_zone').length).toBe(1);
    let remainderMoved: Array<{ name?: string }> = [];
    try {
      const parsed = JSON.parse(String((firstRemainder as any)?.oracleIrLastMovedCardsJson || '[]'));
      remainderMoved = Array.isArray(parsed) ? parsed : [];
    } catch {
      remainderMoved = [];
    }
    expect(remainderMoved.some((card) => card.name === 'Lightning Bolt' || card.name === 'Shock')).toBe(true);
    expect(remainderMoved.every((card) => card.name !== 'Forest')).toBe(true);

    const firstOwner = String((firstRemainder as any)?.playerId || '');
    const firstCards = ((firstRemainder as any)?.cards || []) as Array<{ id?: string }>;
    const firstIds = firstCards.map((card) => String(card?.id || '')).filter(Boolean);
    expect(firstIds.length).toBeGreaterThanOrEqual(2);
    const firstCompleted = ResolutionQueueManager.completeStep(gameId, String(firstRemainder!.id), {
      stepId: String(firstRemainder!.id),
      playerId: firstOwner as PlayerID,
      selections: firstIds,
      cancelled: false,
      timestamp: Date.now(),
    });
    maybeApplyOracleIrChoiceStepFromResolution(ctx, firstCompleted, firstCompleted!.response!);
    maybeResumeOracleIRStepsAfterResolution(ctx, firstCompleted);

    const secondRemainder = (ResolutionQueueManager.getQueue(gameId)?.steps || [])
      .find((step: any) => String(step?.oracleIrWarpWorldChoice || '') === 'remainder_any_order');
    expect(secondRemainder).toBeTruthy();
    expect(String((secondRemainder as any)?.playerId || '')).not.toBe(firstOwner);
    const battlefieldNames = ((game.state as any).battlefield || [])
      .map((perm: any) => String(perm?.card?.name || perm?.name || ''));
    expect(battlefieldNames).not.toContain('Forest');
    ResolutionQueueManager.removeQueue(gameId);
  });

  it('queues Aura-host TARGET_SELECTION and attaches to the chosen host', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.999);
    const gameId = 'oracle_ir_warp_world_aura';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);

    const seedState = {
      players: [
        {
          id: p1,
          hand: [],
          graveyard: [],
          library: [
            { id: 'card_bear', name: 'Bear', type_line: 'Creature — Bear' },
            { id: 'card_wolf', name: 'Wolf', type_line: 'Creature — Wolf' },
            { id: 'card_pac', name: 'Pacifism', type_line: 'Enchantment — Aura', oracle_text: 'Enchant creature' },
          ],
        },
      ],
      battlefield: [
        { id: 'perm_a', owner: p1, controller: p1, card: { id: 'card_a', name: 'Forest', type_line: 'Land — Forest' } },
        { id: 'perm_b', owner: p1, controller: p1, card: { id: 'card_b', name: 'Island', type_line: 'Land — Island' } },
        { id: 'perm_c', owner: p1, controller: p1, card: { id: 'card_c', name: 'Mountain', type_line: 'Land — Mountain' } },
      ],
      life: { [p1]: 40 },
    } as unknown as GameState;

    const irCtx = buildOracleIRExecutionContext({
      controllerId: p1,
      sourceId: 'warp-world-2',
      sourceName: 'Warp World',
      sourceObjectType: 'spell',
      interactivePlayerChoices: true,
    });
    const skipped = applyOracleIRStepsToGameState(
      seedState,
      collectOracleEffectSteps(WARP_WORLD_TEXT, 'Warp World'),
      irCtx,
      { allowOptional: true, haltOnPlayerChoiceRequired: true },
    );
    expect((skipped.automationGaps || []).some((gap) => gap.metadata?.warpWorldChoice === 'aura_attach')).toBe(true);

    const ctx = game as any;
    ctx.gameId = gameId;
    Object.assign(game.state as any, skipped.state);
    ResolutionQueueManager.removeQueue(gameId);
    queueWarpWorldChoicePromptsFromOracleIRResult(ctx, game.state, skipped, {
      controller: p1,
      sourceName: 'Warp World',
      sourceId: 'warp-world-2',
      irCtx,
    });

    const queueSteps = ResolutionQueueManager.getQueue(gameId)?.steps || [];
    const auraStep = queueSteps.find((step: any) => String(step?.oracleIrWarpWorldChoice || '') === 'aura_attach')
      || queueSteps.find((step) => step.type === ResolutionStepType.TARGET_SELECTION);
    expect(auraStep).toBeTruthy();
    expect((auraStep as any)?.oracleIrWarpWorldChoice).toBe('aura_attach');
    const hostId = String((auraStep as any)?.validTargets?.[1]?.id || (auraStep as any)?.validTargets?.[0]?.id || '');
    expect(hostId).toBeTruthy();

    const completedStep = ResolutionQueueManager.completeStep(gameId, String(auraStep!.id), {
      stepId: String(auraStep!.id),
      playerId: p1,
      selections: [hostId],
      cancelled: false,
      timestamp: Date.now(),
    });
    maybeApplyOracleIrChoiceStepFromResolution(ctx, completedStep, completedStep!.response!);
    maybeResumeOracleIRStepsAfterResolution(ctx, completedStep);

    const aura = ((game.state as any).battlefield || []).find(
      (perm: any) => perm.card?.name === 'Pacifism' || perm.name === 'Pacifism',
    );
    expect(aura).toBeTruthy();
    expect(aura?.attachedTo).toBe(hostId);
    ResolutionQueueManager.removeQueue(gameId);
  });

  it('queues remainder BOTTOM_ORDER and applies the chosen order', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.999);
    const gameId = 'oracle_ir_warp_world_remainder';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);

    const player = (game.state as any).players.find((entry: any) => entry.id === p1);
    player.library = [
      { id: 'card_bolt', name: 'Lightning Bolt', type_line: 'Instant' },
      { id: 'card_shock', name: 'Shock', type_line: 'Instant' },
      { id: 'card_cancel', name: 'Cancel', type_line: 'Instant' },
    ];
    player.hand = [];
    player.graveyard = [];
    (game.state as any).battlefield = [
      { id: 'perm_a', owner: p1, controller: p1, card: { id: 'card_a', name: 'Forest', type_line: 'Land — Forest' } },
      { id: 'perm_b', owner: p1, controller: p1, card: { id: 'card_b', name: 'Island', type_line: 'Land — Island' } },
    ];

    const ctx = game as any;
    ctx.gameId = gameId;
    ResolutionQueueManager.removeQueue(gameId);

    applyOracleIRStepsOnServer(
      ctx,
      game.state as any,
      collectOracleEffectSteps(WARP_WORLD_TEXT, 'Warp World'),
      buildOracleIRExecutionContext({
        controllerId: p1,
        sourceId: 'warp-world-3',
        sourceName: 'Warp World',
        sourceObjectType: 'spell',
      }),
      { allowOptional: true },
      { controller: p1 },
    );

    const bottomStep = ResolutionQueueManager.getStepsForPlayer(gameId, p1)
      .find((step) => step.type === ResolutionStepType.BOTTOM_ORDER);
    expect(bottomStep).toBeTruthy();
    expect((bottomStep as any)?.oracleIrWarpWorldChoice).toBe('remainder_any_order');
    const promptCards = ((bottomStep as any)?.cards || []) as Array<{ id?: string; name?: string }>;
    expect(promptCards.length).toBeGreaterThanOrEqual(2);
    for (const card of promptCards) {
      expect(String(card.name || '')).not.toBe(String(card.id || ''));
      expect(['Lightning Bolt', 'Shock', 'Cancel']).toContain(String(card.name));
    }

    const completedStep = ResolutionQueueManager.completeStep(gameId, String(bottomStep!.id), {
      stepId: String(bottomStep!.id),
      playerId: p1,
      selections: ['card_shock', 'card_bolt'],
      cancelled: false,
      timestamp: Date.now(),
    });
    maybeApplyOracleIrChoiceStepFromResolution(ctx, completedStep, completedStep!.response!);
    maybeResumeOracleIRStepsAfterResolution(ctx, completedStep);

    const names = ((game.state as any).players.find((entry: any) => entry.id === p1)?.library || [])
      .map((card: any) => card.name);
    const shockIdx = names.lastIndexOf('Shock');
    const boltIdx = names.lastIndexOf('Lightning Bolt');
    expect(shockIdx).toBeGreaterThanOrEqual(0);
    expect(boltIdx).toBeGreaterThan(shockIdx);
    ResolutionQueueManager.removeQueue(gameId);
  });

  it('remainder BOTTOM_ORDER cards resolve names and images instead of instance ids', () => {
    const gameId = 'oracle_ir_warp_world_remainder_hydrate';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);

    const remainderA = '021fa322-f38c-4d94-8122-5b13425106d9_mtdz0wj7_2m_41c1c7e3';
    const remainderB = '7d733d2928-instance-b';
    const player = (game.state as any).players.find((entry: any) => entry.id === p1);
    player.library = [{ id: remainderA }, { id: remainderB }];
    player.hand = [];
    player.graveyard = [];

    const ctx = game as any;
    ctx.gameId = gameId;
    ctx.libraries = new Map([[p1, [{ id: remainderA }, { id: remainderB }]]]);
    ResolutionQueueManager.removeQueue(gameId);

    const remainderRaw =
      "then puts all cards revealed this way that weren't put onto the battlefield on the bottom of their library";
    queueWarpWorldChoicePromptsFromOracleIRResult(
      ctx,
      game.state as any,
      {
        state: game.state as any,
        log: [],
        appliedSteps: [],
        skippedSteps: [{
          kind: 'move_zone',
          what: 'all other cards revealed this way',
          from: 'library',
          to: 'library',
          order: 'any',
          where: 'bottom',
          raw: remainderRaw,
        } as any],
        pendingOptionalSteps: [],
        pendingContinuationSteps: [],
        automationGaps: [{
          reasonCode: 'player_choice_required',
          stepKind: 'move_zone',
          raw: remainderRaw,
          metadata: {
            warpWorldChoice: WARP_WORLD_CHOICE_REMAINDER,
            pendingRemainderPlayerId: p1,
            remainderCardIds: [remainderA, remainderB],
            remainderCardsJson: JSON.stringify([
              {
                id: remainderA,
                name: 'Shock',
                type_line: 'Instant',
                image_uris: { small: 'https://example.com/shock.jpg' },
              },
              { id: remainderB, name: 'Cancel', type_line: 'Instant' },
            ]),
          },
        } as any],
        lastMovedCards: [],
      },
      {
        controller: p1,
        sourceName: 'Warp World',
        sourceId: 'warp-world-hydrate',
        irCtx: buildOracleIRExecutionContext({
          controllerId: p1,
          sourceId: 'warp-world-hydrate',
          sourceName: 'Warp World',
          sourceObjectType: 'spell',
        }),
      },
    );

    const bottomStep = ResolutionQueueManager.getStepsForPlayer(gameId, p1)
      .find((step) => step.type === ResolutionStepType.BOTTOM_ORDER);
    expect(bottomStep).toBeTruthy();
    const promptCards = ((bottomStep as any)?.cards || []) as Array<{
      id?: string;
      name?: string;
      image_uris?: { small?: string };
    }>;
    expect(promptCards).toHaveLength(2);
    expect(promptCards[0]?.id).toBe(remainderA);
    expect(promptCards[0]?.name).toBe('Shock');
    expect(promptCards[0]?.name).not.toBe(remainderA);
    expect(promptCards[0]?.image_uris?.small).toBe('https://example.com/shock.jpg');
    expect(promptCards[1]?.id).toBe(remainderB);
    expect(promptCards[1]?.name).toBe('Cancel');
    expect(promptCards[1]?.name).not.toBe(remainderB);
    ResolutionQueueManager.removeQueue(gameId);
  });

  it('reveals that many after shuffle when no commander is on the battlefield', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.999);
    const gameId = 'oracle_ir_warp_world_no_commander';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    game.applyEvent!({ type: 'join', playerId: p2, name: 'P2' } as any);

    const player1 = (game.state as any).players.find((entry: any) => entry.id === p1);
    const player2 = (game.state as any).players.find((entry: any) => entry.id === p2);
    player1.library = [];
    player1.commandZone = [];
    player1.hand = [];
    player1.graveyard = [];
    player2.library = [];
    player2.commandZone = [];
    player2.hand = [];
    player2.graveyard = [];
    (game.state as any).commandZone = {
      [p1]: { commanderIds: [], inCommandZone: [], commanderCards: [] },
      [p2]: { commanderIds: [], inCommandZone: [], commanderCards: [] },
    };
    (game.state as any).battlefield = [
      {
        id: 'perm_bear',
        owner: p1,
        controller: p1,
        card: { id: 'card_bear', name: 'Bear Cub', type_line: 'Creature — Bear', power: '2', toughness: '2' },
      },
      {
        id: 'perm_forest',
        owner: p1,
        controller: p1,
        card: { id: 'card_forest', name: 'Forest', type_line: 'Basic Land — Forest' },
      },
      {
        id: 'perm_island',
        owner: p2,
        controller: p2,
        card: { id: 'card_island', name: 'Island', type_line: 'Basic Land — Island' },
      },
    ];

    const ctx = game as any;
    ctx.gameId = gameId;
    ResolutionQueueManager.removeQueue(gameId);

    const result = applyOracleIRStepsOnServer(
      ctx,
      game.state as any,
      collectOracleEffectSteps(WARP_WORLD_TEXT, 'Warp World'),
      buildOracleIRExecutionContext({
        controllerId: p1,
        sourceId: 'warp-world-no-cmd',
        sourceName: 'Warp World',
        sourceObjectType: 'spell',
      }),
      { allowOptional: true },
      { controller: p1 },
    );

    expect(result.skippedSteps?.map((step) => step.kind)).not.toContain('reveal_top');
    expect(result.appliedSteps?.map((step) => step.kind)).toContain('reveal_top');
    expect(result.log?.some((line) => /reveals /i.test(String(line || '')))).toBe(true);
    const battlefield = ((game.state as any).battlefield || []) as any[];
    expect(battlefield.some((perm) => perm?.card?.name === 'Bear Cub')).toBe(true);
    expect(battlefield.some((perm) => perm?.card?.name === 'Forest')).toBe(true);
    expect(battlefield.some((perm) => perm?.card?.name === 'Island')).toBe(true);
    ResolutionQueueManager.removeQueue(gameId);
  });

  it('queues shock-land pay-2-life while Warp World remainder is still pending', () => {
    const gameId = 'oracle_ir_warp_world_shock_land';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);

    const steamOracle =
      "As Steam Vents enters, you may pay 2 life. If you don't, it enters tapped.\n{T}: Add {U} or {R}.";
    const player = (game.state as any).players.find((entry: any) => entry.id === p1);
    player.library = [];
    player.hand = [];
    player.graveyard = [];
    (game.state as any).battlefield = [
      {
        id: 'perm_steam',
        owner: p1,
        controller: p1,
        card: {
          id: 'card_steam',
          name: 'Steam Vents',
          type_line: 'Land — Island Mountain',
          oracle_text: steamOracle,
        },
      },
    ];
    (game.state as any).life = { [p1]: 40 };

    const ctx = game as any;
    ctx.gameId = gameId;
    ctx.state = game.state;
    ResolutionQueueManager.removeQueue(gameId);
    ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.BOTTOM_ORDER,
      playerId: p1,
      oracleIrWarpWorldChoice: WARP_WORLD_CHOICE_REMAINDER,
      cards: [
        { id: 'card_shock', name: 'Shock' },
        { id: 'card_bolt', name: 'Lightning Bolt' },
      ],
      mandatory: true,
    } as any);

    applyOracleIRStepsOnServer(
      ctx,
      game.state as any,
      collectOracleEffectSteps(WARP_WORLD_TEXT, 'Warp World'),
      buildOracleIRExecutionContext({
        controllerId: p1,
        sourceId: 'warp-world-shock',
        sourceName: 'Warp World',
        sourceObjectType: 'spell',
      }),
      { allowOptional: true },
      { controller: p1 },
    );

    const steam = ((game.state as any).battlefield || []).find(
      (perm: any) => String(perm?.card?.name || perm?.name || '') === 'Steam Vents',
    );
    expect(steam).toBeTruthy();
    expect(steam.tapped).toBe(true);
    expect(
      ResolutionQueueManager.getStepsForPlayer(gameId, p1)
        .some((step: any) => step?.shockLandChoice === true),
    ).toBe(true);
    ResolutionQueueManager.removeQueue(gameId);
  });

  it('flushes many held Warp World ETB watchers without hanging', () => {
    const gameId = 'oracle_ir_warp_world_etb_flush_many';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    const battlefield = Array.from({ length: 24 }, (_, index) => ({
      id: `perm_${index}`,
      owner: p1,
      controller: p1,
      card: {
        id: `card_${index}`,
        name: index === 0 ? 'Soul Warden' : `Bear ${index}`,
        type_line: 'Creature — Human Cleric',
        oracle_text: 'Whenever another creature enters the battlefield, you gain 1 life.',
      },
    }));
    (game.state as any).battlefield = battlefield;
    (game.state as any).oracleIrHeldChaosZoneTriggers = {
      ltb: battlefield.map((perm) => ({
        id: perm.id,
        controller: p1,
        owner: p1,
        isToken: false,
        card: perm.card,
        type_line: perm.card.type_line,
      })),
      enteredIds: battlefield.map((perm) => perm.id),
    };
    const ctx = game as any;
    ctx.gameId = gameId;
    flushChaosResolutionZoneTriggers(ctx);
    expect((game.state as any).oracleIrHeldChaosZoneTriggers).toBeUndefined();
    ResolutionQueueManager.removeQueue(gameId);
  });

  it('persists leftover Warp World put/remainder when a shock-land prompt grew the queue', () => {
    const gameId = 'oracle_ir_warp_world_persist_after_shock';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    const ctx = game as any;
    ctx.gameId = gameId;
    ResolutionQueueManager.removeQueue(gameId);
    ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.OPTION_CHOICE,
      playerId: p1,
      shockLandChoice: true,
      permanentId: 'perm_steam',
      mandatory: true,
    } as any);

    persistUnqueuedPendingContinuationFromOracleIRResult(
      ctx,
      game.state as any,
      {
        state: game.state as any,
        log: [],
        appliedSteps: [],
        skippedSteps: [],
        pendingOptionalSteps: [],
        pendingContinuationSteps: [
          { kind: 'move_zone', what: 'all enchantment cards revealed this way', from: 'library', to: 'battlefield' },
          {
            kind: 'move_zone',
            what: 'all other cards revealed this way',
            from: 'library',
            to: 'library',
            order: 'any',
            where: 'bottom',
          },
        ],
        automationGaps: [],
        lastMovedCards: [],
      } as any,
      {
        controller: p1,
        sourceName: 'Warp World',
        sourceId: 'warp-world-persist-shock',
        resolutionQueueStepsBefore: 0,
        resolutionQueueStepsAfter: 1,
      },
    );

    const pending = JSON.parse(String((game.state as any).oracleIrPendingResumeStepsJson || '[]'));
    expect(pending).toHaveLength(2);
    expect(pending.map((step: { kind?: string }) => step.kind)).toEqual(['move_zone', 'move_zone']);
    ResolutionQueueManager.removeQueue(gameId);
  });

  it('does not persist leftover Warp World steps when a remainder prompt already owns them', () => {
    const gameId = 'oracle_ir_warp_world_persist_skip_remainder';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    const ctx = game as any;
    ctx.gameId = gameId;
    ResolutionQueueManager.removeQueue(gameId);
    ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.BOTTOM_ORDER,
      playerId: p1,
      oracleIrWarpWorldChoice: WARP_WORLD_CHOICE_REMAINDER,
      oracleIrChoiceStepJson: JSON.stringify([
        { kind: 'move_zone', what: 'all other cards revealed this way' },
      ]),
      cards: [{ id: 'card_shock', name: 'Shock' }],
      mandatory: true,
    } as any);

    persistUnqueuedPendingContinuationFromOracleIRResult(
      ctx,
      game.state as any,
      {
        state: game.state as any,
        log: [],
        appliedSteps: [],
        skippedSteps: [],
        pendingOptionalSteps: [],
        pendingContinuationSteps: [
          { kind: 'move_zone', what: 'all other cards revealed this way', from: 'library', to: 'library' },
        ],
        automationGaps: [],
        lastMovedCards: [],
      } as any,
      {
        controller: p1,
        sourceName: 'Warp World',
        sourceId: 'warp-world-persist-skip',
        resolutionQueueStepsBefore: 0,
        resolutionQueueStepsAfter: 1,
      },
    );

    expect(String((game.state as any).oracleIrPendingResumeStepsJson || '').trim()).toBe('');
    ResolutionQueueManager.removeQueue(gameId);
  });
});
