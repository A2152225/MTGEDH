import { beforeEach, describe, expect, it } from 'vitest';

import type { PlayerID } from '../../shared/src';
import { createInitialGameState } from '../src/state/gameState.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';

function addPlayer(game: any, id: PlayerID, name: string) {
  game.applyEvent({ type: 'join', playerId: id, name });
}

function resetGame(gameId: string) {
  ResolutionQueueManager.removeQueue(gameId);
}

describe('pending-effect prompt replay semantics', () => {
  beforeEach(() => {
    for (const gameId of [
      't_pending_effect_prompt_replay_cascade',
      't_pending_effect_prompt_replay_ponder',
      't_pending_effect_prompt_replay_proliferate',
      't_pending_effect_prompt_replay_vault',
      't_pending_effect_prompt_replay_dance',
      't_pending_effect_prompt_replay_cast_from_exile_followup',
      't_pending_effect_prompt_replay_sacrifice_followup',
    ]) {
      resetGame(gameId);
    }
  });

  it('replays queued cascade prompts together with the consumed library snapshot', () => {
    const gameId = 't_pending_effect_prompt_replay_cascade';

    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    addPlayer(game, p1, 'P1');

    game.applyEvent({
      type: 'resolveTopOfStackPrompt',
      playerId: p1,
      sourceId: 'bloodbraid_elf',
      libraryAfter: [],
      pendingCascadeEntry: {
        sourceName: 'Bloodbraid Elf',
        sourceCardId: 'bloodbraid_elf',
        manaValue: 4,
        instance: 1,
        awaiting: true,
        effectId: 'cascade_1',
        hitCard: {
          id: 'lightning_bolt',
          name: 'Lightning Bolt',
          type_line: 'Instant',
          oracle_text: 'Deal 3 damage to any target.',
          mana_cost: '{R}',
          cmc: 1,
        },
        exiledCards: [
          { id: 'forest_1', name: 'Forest', type_line: 'Basic Land — Forest' },
          { id: 'lightning_bolt', name: 'Lightning Bolt', type_line: 'Instant', oracle_text: 'Deal 3 damage to any target.', mana_cost: '{R}', cmc: 1 },
        ],
      },
      queuedResolutionStep: {
        id: 'queued_pending_cascade_1',
        type: ResolutionStepType.CASCADE,
        playerId: p1,
        sourceId: 'bloodbraid_elf',
        sourceName: 'Bloodbraid Elf',
        description: 'Cascade - Cast Lightning Bolt?',
        mandatory: true,
        cascadeNumber: 1,
        totalCascades: 1,
        manaValue: 4,
        effectId: 'cascade_1',
        hitCard: {
          id: 'lightning_bolt',
          name: 'Lightning Bolt',
          type_line: 'Instant',
          oracle_text: 'Deal 3 damage to any target.',
          mana_cost: '{R}',
          cmc: 1,
        },
        exiledCards: [
          { id: 'forest_1', name: 'Forest', type_line: 'Basic Land — Forest' },
          { id: 'lightning_bolt', name: 'Lightning Bolt', type_line: 'Instant', oracle_text: 'Deal 3 damage to any target.', mana_cost: '{R}', cmc: 1 },
        ],
      },
    } as any);

    const queue = ResolutionQueueManager.getQueue(gameId);
    expect(queue.steps).toHaveLength(1);
    expect((queue.steps[0] as any)?.type).toBe(ResolutionStepType.CASCADE);
    expect(String((queue.steps[0] as any)?.effectId || '')).toBe('cascade_1');
    expect((game as any).libraries.get(p1)?.map((card: any) => card.id)).toEqual([]);
    expect((game.state as any).pendingCascade?.[p1]).toHaveLength(1);
    expect((game.state as any).pendingCascade[p1][0].awaiting).toBe(true);
    expect((game.state as any).pendingCascade[p1][0].hitCard?.id).toBe('lightning_bolt');
  });

  it('replays queued Ponder-style prompts', () => {
    const gameId = 't_pending_effect_prompt_replay_ponder';

    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    addPlayer(game, p1, 'P1');

    game.applyEvent({
      type: 'resolveTopOfStackPrompt',
      playerId: p1,
      sourceId: 'ponder_1',
      queuedResolutionStep: {
        id: 'queued_pending_ponder_1',
        type: ResolutionStepType.PONDER_EFFECT,
        playerId: p1,
        sourceId: 'ponder_1',
        sourceName: 'Ponder',
        description: 'Ponder: Ponder',
        cards: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }, { id: 'c', name: 'C' }],
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
    expect((queue.steps[0] as any)?.type).toBe(ResolutionStepType.PONDER_EFFECT);
    expect(String((queue.steps[0] as any)?.effectId || '')).toBe('ponder_1');
  });

  it('replays queued proliferate prompts', () => {
    const gameId = 't_pending_effect_prompt_replay_proliferate';

    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    addPlayer(game, p1, 'P1');

    game.applyEvent({
      type: 'resolveTopOfStackPrompt',
      playerId: p1,
      sourceId: 'source_proliferate_1',
      queuedResolutionStep: {
        id: 'queued_pending_proliferate_1',
        type: ResolutionStepType.PROLIFERATE,
        playerId: p1,
        sourceId: 'source_proliferate_1',
        sourceName: 'Proliferate Test',
        description: 'Choose permanents and/or players to proliferate',
        mandatory: false,
        proliferateId: 'proliferate_1',
        availableTargets: [
          { id: 'perm_1', name: 'Counter Creature', counters: { '+1/+1': 1 }, isPlayer: false },
          { id: p1, name: 'P1', counters: { energy: 2 }, isPlayer: true },
        ],
      },
    } as any);

    const queue = ResolutionQueueManager.getQueue(gameId);
    expect(queue.steps).toHaveLength(1);
    expect((queue.steps[0] as any)?.type).toBe(ResolutionStepType.PROLIFERATE);
    expect(String((queue.steps[0] as any)?.proliferateId || '')).toBe('proliferate_1');
  });

  it('replays queued Lim-Dul\'s Vault prompts', () => {
    const gameId = 't_pending_effect_prompt_replay_vault';

    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    addPlayer(game, p1, 'P1');

    game.applyEvent({
      type: 'resolveTopOfStackPrompt',
      playerId: p1,
      sourceId: 'vault_1',
      queuedResolutionStep: {
        id: 'queued_pending_vault_1',
        type: ResolutionStepType.LIM_DULS_VAULT,
        playerId: p1,
        sourceId: 'vault_1',
        sourceName: "Lim-Dûl's Vault",
        description: "Lim-Dul's Vault",
        mandatory: true,
        effectId: 'vault_1',
        cards: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }, { id: 'c', name: 'C' }, { id: 'd', name: 'D' }, { id: 'e', name: 'E' }],
        currentLife: 40,
        totalLifePaid: 0,
      },
    } as any);

    const queue = ResolutionQueueManager.getQueue(gameId);
    expect(queue.steps).toHaveLength(1);
    expect((queue.steps[0] as any)?.type).toBe(ResolutionStepType.LIM_DULS_VAULT);
    expect(String((queue.steps[0] as any)?.effectId || '')).toBe('vault_1');
  });

  it('replays queued initial Dance with Calamity prompts', () => {
    const gameId = 't_pending_effect_prompt_replay_dance';

    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    addPlayer(game, p1, 'P1');

    game.applyEvent({
      type: 'resolveTopOfStackPrompt',
      playerId: p1,
      sourceId: 'dance_1',
      queuedResolutionStep: {
        id: 'queued_pending_dance_1',
        type: ResolutionStepType.DANCE_WITH_CALAMITY,
        playerId: p1,
        sourceId: 'dance_1',
        sourceName: 'Dance with Calamity',
        description: 'Dance with Calamity: Exile the top card, or stop and cast spells from among the exiled cards.',
        mandatory: true,
        effectId: 'dance_1',
        exiledCards: [],
        totalManaValue: 0,
        canContinue: true,
      },
    } as any);

    const queue = ResolutionQueueManager.getQueue(gameId);
    expect(queue.steps).toHaveLength(1);
    expect((queue.steps[0] as any)?.type).toBe(ResolutionStepType.DANCE_WITH_CALAMITY);
    expect(String((queue.steps[0] as any)?.effectId || '')).toBe('dance_1');
  });

  it('replays queued follow-up cast-from-exile prompts created from option responses', () => {
    const gameId = 't_pending_effect_prompt_replay_cast_from_exile_followup';

    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    addPlayer(game, p1, 'P1');

    game.applyEvent({
      type: 'resolveTopOfStackPrompt',
      playerId: p1,
      sourceId: 'dance_source_1',
      queuedResolutionStep: {
        id: 'queued_cast_from_exile_followup_1',
        type: ResolutionStepType.OPTION_CHOICE,
        playerId: p1,
        sourceId: 'dance_source_1',
        sourceName: 'Dance with Calamity',
        description: 'Dance with Calamity: You may cast Spell B from exile without paying its mana cost.',
        mandatory: false,
        options: [
          { id: 'cast', label: 'Cast Spell B' },
          { id: 'decline', label: 'Decline' },
        ],
        minSelections: 1,
        maxSelections: 1,
        castFromExileCardId: 'spell_b',
        castFromExileCard: { id: 'spell_b', name: 'Spell B', type_line: 'Instant' },
        castFromExileDeclineDestination: 'exile',
        castFromExileQueueCardIds: ['spell_a', 'spell_b'],
        castFromExileQueueCards: [
          { id: 'spell_a', name: 'Spell A', type_line: 'Sorcery' },
          { id: 'spell_b', name: 'Spell B', type_line: 'Instant' },
        ],
        castFromExileQueueIndex: 1,
      },
    } as any);

    const queue = ResolutionQueueManager.getQueue(gameId);
    expect(queue.steps).toHaveLength(1);
    expect((queue.steps[0] as any)?.type).toBe(ResolutionStepType.OPTION_CHOICE);
    expect((queue.steps[0] as any)?.castFromExileCardId).toBe('spell_b');
  });

  it('replays queued sacrifice-for-benefit target prompts created from option responses', () => {
    const gameId = 't_pending_effect_prompt_replay_sacrifice_followup';

    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    addPlayer(game, p1, 'P1');

    game.applyEvent({
      type: 'resolveTopOfStackPrompt',
      playerId: p1,
      sourceId: 'source_perm',
      queuedResolutionStep: {
        id: 'queued_sacrifice_followup_1',
        type: ResolutionStepType.TARGET_SELECTION,
        playerId: p1,
        sourceId: 'source_perm',
        sourceName: 'Source Walker',
        description: 'Choose a permanent to sacrifice',
        mandatory: true,
        validTargets: [
          { id: 'other_perm', label: 'Treasure Token', description: 'Artifact' },
        ],
        targetTypes: ['sacrifice_target'],
        minTargets: 1,
        maxTargets: 1,
        targetDescription: 'a permanent you control',
        sacrificeAnotherPermanentForBenefitChoice: true,
        sacrificeAnotherPermanentForBenefitStage: 'select_sacrifice',
        sacrificeAnotherPermanentForBenefitController: p1,
        sacrificeAnotherPermanentForBenefitSourceName: 'Source Walker',
        sacrificeAnotherPermanentForBenefitSourcePermanentId: 'source_perm',
        sacrificeAnotherPermanentForBenefitLifeGain: 3,
        sacrificeAnotherPermanentForBenefitDrawCount: 1,
      },
    } as any);

    const queue = ResolutionQueueManager.getQueue(gameId);
    expect(queue.steps).toHaveLength(1);
    expect((queue.steps[0] as any)?.type).toBe(ResolutionStepType.TARGET_SELECTION);
    expect((queue.steps[0] as any)?.sacrificeAnotherPermanentForBenefitChoice).toBe(true);
    expect((queue.steps[0] as any)?.sacrificeAnotherPermanentForBenefitStage).toBe('select_sacrifice');
  });
});