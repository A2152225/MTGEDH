import { afterEach, describe, expect, it } from 'vitest';

import { enterResolutionMode, exitResolutionMode, passPriority } from '../src/state/modules/priority.js';
import type { GameContext } from '../src/state/context.js';
import {
  ResolutionQueueManager,
  ResolutionStepType,
} from '../src/state/resolution/index.js';
import {
  bindCanonicalResolutionQueueGameId,
  collectResolutionQueueGameIdsFromContext,
  contextHasBlockingNonPaymentResolutionSteps,
} from '../src/state/resolution/resolutionQueueGameIds.js';
import { persistAndResolveTopOfStack } from '../src/socket/util.js';

const gameId = `cast_trigger_prompt_guard_${Date.now()}`;

function buildCtx(state: any, ctxGameId: string): GameContext {
  return {
    gameId: ctxGameId,
    state,
    libraries: new Map(),
    life: { p1: 40, p2: 40 },
    poison: {},
    experience: {},
    commandZone: {},
    joinedBySocket: new Map(),
    participantsList: [],
    tokenToPlayer: new Map(),
    playerToToken: new Map(),
    grants: new Map(),
    inactive: new Set(),
    spectatorNames: new Map(),
    pendingInitialDraw: new Set(),
    handVisibilityGrants: new Map(),
    rngSeed: null,
    rng: () => 0,
    seq: { value: 0 },
    bumpSeq: () => {},
    passesInRow: { value: 0 },
    landsPlayedThisTurn: {},
    maxLandsPerTurn: {},
    additionalDrawsPerTurn: {},
    manaPool: {},
  } as GameContext;
}

function queueCastTriggerModal(id: string) {
  return ResolutionQueueManager.addStep(id, {
    type: ResolutionStepType.MODAL_CHOICE,
    playerId: 'p1' as any,
    description: 'Whenever you cast: Choose one',
    mandatory: true,
    sourceName: 'Cast Trigger',
    options: [
      { id: 'option_1', label: 'That spell gains deathtouch and lifelink.' },
      { id: 'option_2', label: 'Create a token.' },
    ],
    minSelections: 1,
    maxSelections: 1,
  } as any);
}

describe('cast-trigger prompt vs Smart Pass stack drain', () => {
  afterEach(() => {
    ResolutionQueueManager.removeQueue(gameId);
    ResolutionQueueManager.removeQueue('unknown');
  });

  it('skips the unknown sentinel and finds the prompt on state.id', () => {
    const ctx = { gameId: 'unknown', state: { id: gameId } };
    expect(collectResolutionQueueGameIdsFromContext(ctx)).toEqual([gameId]);
    expect(bindCanonicalResolutionQueueGameId(ctx)).toBe(gameId);
    expect(ctx.gameId).toBe(gameId);
  });

  it('refuses to restore priority while a choose-one cast trigger is unanswered', () => {
    const state: any = {
      id: gameId,
      players: [
        { id: 'p1', name: 'You', seat: 0 },
        { id: 'p2', name: 'Opp', seat: 1 },
      ],
      stack: [{ id: 'spell_1', type: 'spell', controller: 'p1', card: { name: 'Reckless Blaze' } }],
      priority: 'p1',
      turnPlayer: 'p1',
      phase: 'precombatMain',
      step: 'MAIN1',
      turnDirection: 1,
    };
    const ctx = buildCtx(state, 'unknown');
    queueCastTriggerModal(gameId);
    enterResolutionMode(ctx);
    expect(state.priority).toBeNull();
    expect(contextHasBlockingNonPaymentResolutionSteps(ctx)).toBe(true);

    exitResolutionMode(ctx);
    expect(state.priority).toBeNull();
  });

  it('does not Smart-Pass the stacked spell while the cast-trigger prompt is open', () => {
    const state: any = {
      id: gameId,
      players: [
        { id: 'p1', name: 'You', seat: 0 },
        { id: 'p2', name: 'Opp', seat: 1 },
      ],
      stack: [{ id: 'spell_1', type: 'spell', controller: 'p1', card: { name: 'Reckless Blaze' } }],
      priority: 'p1',
      turnPlayer: 'p1',
      phase: 'precombatMain',
      step: 'MAIN1',
      turnDirection: 1,
      autoPassPlayers: new Set(['p1', 'p2']),
      priorityPassedBy: new Set(),
    };
    const ctx = buildCtx(state, 'unknown');
    queueCastTriggerModal(gameId);

    const result = passPriority(ctx, 'p1', true);
    expect(result.changed).toBe(false);
    expect(result.resolvedNow).toBe(false);
    expect(state.stack).toHaveLength(1);
  });

  it('refuses persistAndResolveTopOfStack while the cast-trigger prompt is open', () => {
    queueCastTriggerModal(gameId);
    let resolved = false;
    const game: any = {
      gameId,
      state: {
        id: gameId,
        stack: [{ id: 'spell_1', type: 'spell', controller: 'p1', card: { name: 'Reckless Blaze' } }],
      },
      seq: 0,
      applyEvent: () => {
        resolved = true;
      },
      resolveTopOfStack: () => {
        resolved = true;
      },
    };

    expect(persistAndResolveTopOfStack(game, gameId)).toBe(false);
    expect(resolved).toBe(false);
    expect(game.state.stack).toHaveLength(1);
  });
});
