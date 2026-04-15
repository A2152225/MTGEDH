import { beforeEach, describe, expect, it } from 'vitest';

import { createInitialGameState } from '../src/state/gameState.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';
import type { PlayerID } from '../../shared/src';

function addPlayer(game: any, id: PlayerID, name: string) {
  game.applyEvent({ type: 'join', playerId: id, name });
}

function resetGame(gameId: string) {
  ResolutionQueueManager.removeQueue(gameId);
}

describe('resolveSpell prompt replay semantics', () => {
  beforeEach(() => {
    for (const gameId of [
      't_resolve_spell_prompt_replay_ponder',
      't_resolve_spell_prompt_replay_scry',
      't_resolve_spell_prompt_replay_surveil',
      't_resolve_spell_prompt_replay_blight_batch',
      't_resolve_spell_prompt_replay_genesis_wave',
    ]) {
      resetGame(gameId);
    }
  });

  it('replays queued Ponder-style prompts created during spell resolution', () => {
    const gameId = 't_resolve_spell_prompt_replay_ponder';

    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    addPlayer(game, p1, 'P1');

    game.applyEvent({
      type: 'resolveTopOfStackPrompt',
      playerId: p1,
      sourceId: 'ponder_1',
      queuedResolutionStep: {
        id: 'queued_spell_ponder_prompt_1',
        type: ResolutionStepType.PONDER_EFFECT,
        playerId: p1,
        sourceId: 'ponder_1',
        sourceName: 'Ponder',
        description: 'Ponder: Ponder',
        cards: [{ id: 'ponder_a', name: 'A' }, { id: 'ponder_b', name: 'B' }, { id: 'ponder_c', name: 'C' }],
        variant: 'ponder',
        cardCount: 3,
        drawAfter: true,
        mayShuffleAfter: true,
        targetPlayerId: p1,
        effectId: 'ponder_1',
      },
    } as any);

    const queue = ResolutionQueueManager.getQueue(gameId);
    expect(queue.steps).toHaveLength(1);
    expect(String((queue.steps[0] as any)?.id || '')).toBe('queued_spell_ponder_prompt_1');
    expect((queue.steps[0] as any)?.type).toBe(ResolutionStepType.PONDER_EFFECT);
    expect(String((queue.steps[0] as any)?.effectId || '')).toBe('ponder_1');
  });

  it('replays queued scry prompts created during spell resolution', () => {
    const gameId = 't_resolve_spell_prompt_replay_scry';

    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    addPlayer(game, p1, 'P1');

    game.applyEvent({
      type: 'resolveTopOfStackPrompt',
      playerId: p1,
      sourceId: 'spell_scry_stack_1',
      queuedResolutionStep: {
        id: 'queued_spell_scry_prompt_1',
        type: ResolutionStepType.SCRY,
        playerId: p1,
        sourceId: 'spell_scry_stack_1',
        sourceName: 'Serum Visions Test',
        description: 'Serum Visions Test: Scry 2',
        mandatory: true,
        scryCount: 2,
      },
    } as any);

    const queue = ResolutionQueueManager.getQueue(gameId);
    expect(queue.steps).toHaveLength(1);
    expect(String((queue.steps[0] as any)?.id || '')).toBe('queued_spell_scry_prompt_1');
    expect((queue.steps[0] as any)?.type).toBe(ResolutionStepType.SCRY);
    expect(Number((queue.steps[0] as any)?.scryCount || 0)).toBe(2);
  });

  it('replays queued surveil prompts created during spell resolution', () => {
    const gameId = 't_resolve_spell_prompt_replay_surveil';

    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    addPlayer(game, p1, 'P1');

    game.applyEvent({
      type: 'resolveTopOfStackPrompt',
      playerId: p1,
      sourceId: 'spell_surveil_stack_1',
      queuedResolutionStep: {
        id: 'queued_spell_surveil_prompt_1',
        type: ResolutionStepType.SURVEIL,
        playerId: p1,
        sourceId: 'spell_surveil_stack_1',
        sourceName: 'Consider Test',
        description: 'Consider Test: Surveil 2',
        mandatory: true,
        surveilCount: 2,
      },
    } as any);

    const queue = ResolutionQueueManager.getQueue(gameId);
    expect(queue.steps).toHaveLength(1);
    expect(String((queue.steps[0] as any)?.id || '')).toBe('queued_spell_surveil_prompt_1');
    expect((queue.steps[0] as any)?.type).toBe(ResolutionStepType.SURVEIL);
    expect(Number((queue.steps[0] as any)?.surveilCount || 0)).toBe(2);
  });

  it('replays queued APNAP blight prompt batches created during spell resolution', () => {
    const gameId = 't_resolve_spell_prompt_replay_blight_batch';

    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    const p3 = 'p3' as PlayerID;
    addPlayer(game, p1, 'P1');
    addPlayer(game, p2, 'P2');
    addPlayer(game, p3, 'P3');

    game.applyEvent({
      type: 'resolveTopOfStackPrompt',
      playerId: p2,
      sourceId: 'spell_blight_stack_1',
      queuedResolutionSteps: [
        {
          id: 'queued_spell_blight_prompt_p2',
          type: ResolutionStepType.TARGET_SELECTION,
          playerId: p2,
          sourceId: 'spell_blight_stack_1',
          sourceName: 'High Perfect Morcant Test',
          description: 'High Perfect Morcant Test: Blight 1 — choose a creature you control to put 1 -1/-1 counter on it.',
          mandatory: true,
          validTargets: [{ id: 'creature_p2', label: 'P2 Creature', description: 'Creature — Test' }],
          targetTypes: ['creature'],
          minTargets: 1,
          maxTargets: 1,
          targetDescription: 'creature you control',
          keywordBlight: true,
          keywordBlightStage: 'select_target',
          keywordBlightController: p2,
          keywordBlightN: 1,
          keywordBlightSourceName: 'High Perfect Morcant Test: Blight 1',
        },
        {
          id: 'queued_spell_blight_prompt_p3',
          type: ResolutionStepType.TARGET_SELECTION,
          playerId: p3,
          sourceId: 'spell_blight_stack_1',
          sourceName: 'High Perfect Morcant Test',
          description: 'High Perfect Morcant Test: Blight 1 — choose a creature you control to put 1 -1/-1 counter on it.',
          mandatory: true,
          validTargets: [{ id: 'creature_p3', label: 'P3 Creature', description: 'Creature — Test' }],
          targetTypes: ['creature'],
          minTargets: 1,
          maxTargets: 1,
          targetDescription: 'creature you control',
          keywordBlight: true,
          keywordBlightStage: 'select_target',
          keywordBlightController: p3,
          keywordBlightN: 1,
          keywordBlightSourceName: 'High Perfect Morcant Test: Blight 1',
        },
      ],
    } as any);

    const queue = ResolutionQueueManager.getQueue(gameId);
    expect(queue.steps).toHaveLength(2);
    expect(new Set(queue.steps.map((step: any) => String(step?.id || '')))).toEqual(
      new Set(['queued_spell_blight_prompt_p2', 'queued_spell_blight_prompt_p3'])
    );
    expect(new Set(queue.steps.map((step: any) => String(step?.playerId || '')))).toEqual(new Set([p2, p3]));
    expect((queue.steps as any[]).every((step: any) => step?.keywordBlight === true)).toBe(true);
    expect((queue.steps as any[]).every((step: any) => String(step?.sourceId || '') === 'spell_blight_stack_1')).toBe(true);
  });

  it('replays Genesis Wave library-search prompts created during spell resolution', () => {
    const gameId = 't_resolve_spell_prompt_replay_genesis_wave';

    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    addPlayer(game, p1, 'P1');

    game.applyEvent({
      type: 'resolveTopOfStackPrompt',
      playerId: p1,
      sourceId: 'spell_genesis_wave_stack_1',
      queuedResolutionStep: {
        id: 'queued_spell_genesis_wave_prompt_1',
        type: ResolutionStepType.LIBRARY_SEARCH,
        playerId: p1,
        sourceId: 'spell_genesis_wave_stack_1',
        sourceName: 'Genesis Wave',
        description: 'Genesis Wave (X=3): Choose any number of permanents to put onto the battlefield',
        mandatory: false,
        searchCriteria: 'Permanent cards with mana value 3 or less',
        minSelections: 0,
        maxSelections: 2,
        destination: 'battlefield',
        reveal: true,
        shuffleAfter: false,
        remainderDestination: 'graveyard',
        remainderRandomOrder: false,
        contextValue: 3,
        entersTapped: false,
        availableCards: [
          { id: 'wave_creature_1', name: 'Wave Creature', type_line: 'Creature — Test' },
          { id: 'wave_artifact_1', name: 'Wave Artifact', type_line: 'Artifact' },
        ],
        nonSelectableCards: [
          { id: 'wave_instant_1', name: 'Wave Instant', type_line: 'Instant' },
        ],
      },
    } as any);

    const queue = ResolutionQueueManager.getQueue(gameId);
    expect(queue.steps).toHaveLength(1);
    expect(String((queue.steps[0] as any)?.id || '')).toBe('queued_spell_genesis_wave_prompt_1');
    expect((queue.steps[0] as any)?.type).toBe(ResolutionStepType.LIBRARY_SEARCH);
    expect(((queue.steps[0] as any)?.availableCards || [])).toHaveLength(2);
    expect(((queue.steps[0] as any)?.nonSelectableCards || [])).toHaveLength(1);
  });
});