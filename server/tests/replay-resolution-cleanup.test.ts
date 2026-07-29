import { describe, expect, it } from 'vitest';

import { ResolutionQueueManager } from '../src/state/resolution/ResolutionQueueManager.js';
import { ResolutionStepStatus, ResolutionStepType } from '../src/state/resolution/types.js';
import { pruneObsoleteResolutionQueueAfterReplay } from '../src/state/resolution/replayCleanup.js';

describe('pruneObsoleteResolutionQueueAfterReplay', () => {
  it('removes replayed mana color prompts and stale spell-cast steps', () => {
    const gameId = 'game_replay_cleanup_test';
    const state: any = {
      players: [{ id: 'p1' }],
      turnPlayer: 'p1',
      priority: 'p1',
      step: 'MAIN1',
      phase: 'precombatMain',
      stack: [],
      zones: { p1: { hand: [] } },
      manaPool: { p1: { white: 0, blue: 1, black: 0, red: 0, green: 1, colorless: 0 } },
      pendingSpellCasts: {
        stale_cast: { cardId: 'old_spell', playerId: 'p1', fromZone: 'hand' },
      },
    };

    ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.MANA_COLOR_SELECTION,
      playerId: 'p1' as any,
      description: 'Choose a color',
      mandatory: true,
      permanentId: 'land_1',
      cardName: 'Temple Garden',
      amount: 1,
    } as any);

    ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.MANA_PAYMENT_CHOICE,
      playerId: 'p1' as any,
      description: 'Pay for spell',
      mandatory: true,
      spellPaymentRequired: true,
      spellCastContext: { effectId: 'stale_cast', cardId: 'old_spell' },
    } as any);

    pruneObsoleteResolutionQueueAfterReplay(gameId, state);

    const queue = ResolutionQueueManager.getQueue(gameId);
    const pending = queue.steps.filter((step) => step.status === ResolutionStepStatus.PENDING);
    expect(pending).toHaveLength(0);
    expect(state.pendingSpellCasts.stale_cast).toBeUndefined();
  });

  it('removes payment prompts when the spell is already on the stack after castSpell replay', () => {
    const gameId = 'game_replay_cleanup_completed_cast';
    const state: any = {
      players: [{ id: 'p1' }],
      turnPlayer: 'p1',
      priority: 'p1',
      step: 'MAIN1',
      phase: 'precombatMain',
      stack: [{
        id: 'stack_divination_1',
        type: 'spell',
        cardId: 'divination_1',
        card: { id: 'divination_1', name: 'Divination' },
        controller: 'p1',
      }],
      zones: { p1: { hand: [] } },
      pendingSpellCasts: {
        cast_divination_1: { cardId: 'divination_1', playerId: 'p1', fromZone: 'hand' },
      },
    };

    ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.MANA_PAYMENT_CHOICE,
      playerId: 'p1' as any,
      description: 'Pay costs to cast Divination.',
      mandatory: true,
      spellPaymentRequired: true,
      cardId: 'divination_1',
      effectId: 'cast_divination_1',
      spellCastContext: { effectId: 'cast_divination_1', cardId: 'divination_1' },
    } as any);

    pruneObsoleteResolutionQueueAfterReplay(gameId, state);

    const queue = ResolutionQueueManager.getQueue(gameId);
    const pending = queue.steps.filter((step) => step.status === ResolutionStepStatus.PENDING);
    expect(pending).toHaveLength(0);
    expect(state.pendingSpellCasts.cast_divination_1).toBeUndefined();
  });

  it('keeps in-progress cast payment prompts when the card is still in hand', () => {
    const gameId = 'game_replay_cleanup_in_progress_cast';
    const state: any = {
      players: [{ id: 'p1' }],
      turnPlayer: 'p1',
      priority: 'p1',
      step: 'MAIN1',
      phase: 'precombatMain',
      stack: [],
      zones: {
        p1: {
          hand: [{ id: 'divination_1', name: 'Divination' }],
        },
      },
      pendingSpellCasts: {
        cast_divination_1: { cardId: 'divination_1', playerId: 'p1', fromZone: 'hand' },
      },
    };

    ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.MANA_PAYMENT_CHOICE,
      playerId: 'p1' as any,
      description: 'Pay costs to cast Divination.',
      mandatory: true,
      spellPaymentRequired: true,
      cardId: 'divination_1',
      effectId: 'cast_divination_1',
      spellCastContext: { effectId: 'cast_divination_1', cardId: 'divination_1' },
    } as any);

    pruneObsoleteResolutionQueueAfterReplay(gameId, state);

    const queue = ResolutionQueueManager.getQueue(gameId);
    const pending = queue.steps.filter((step) => step.status === ResolutionStepStatus.PENDING);
    expect(pending).toHaveLength(1);
    expect(pending[0].type).toBe(ResolutionStepType.MANA_PAYMENT_CHOICE);
    expect(state.pendingSpellCasts.cast_divination_1?.cardId).toBe('divination_1');
  });

  it('keeps library-origin payment prompts when the card remains in the authoritative libraries map', () => {
    const gameId = 'game_replay_cleanup_library_cast';
    const topCard = {
      id: 'drowner_top',
      name: 'Drowner of Secrets',
      type_line: 'Creature — Merfolk Wizard',
      mana_cost: '{2}{U}',
    };
    const state: any = {
      players: [{ id: 'p1' }],
      turnPlayer: 'p1',
      priority: 'p1',
      step: 'MAIN1',
      phase: 'precombatMain',
      stack: [],
      // zones.library is intentionally empty — live games keep cards in game.libraries.
      zones: {
        p1: {
          hand: [],
          library: [],
          libraryCount: 1,
        },
      },
      pendingSpellCasts: {
        cast_drowner_library: {
          cardId: 'drowner_top',
          playerId: 'p1',
          fromZone: 'library',
        },
      },
    };
    const libraries = new Map<string, any[]>([['p1', [topCard]]]);

    ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.MANA_PAYMENT_CHOICE,
      playerId: 'p1' as any,
      description: 'Pay costs to cast Drowner of Secrets.',
      mandatory: true,
      spellPaymentRequired: true,
      cardId: 'drowner_top',
      effectId: 'cast_drowner_library',
      fromZone: 'library',
      spellCastContext: { effectId: 'cast_drowner_library', cardId: 'drowner_top' },
    } as any);

    pruneObsoleteResolutionQueueAfterReplay(gameId, state, libraries);

    const queue = ResolutionQueueManager.getQueue(gameId);
    const pending = queue.steps.filter((step) => step.status === ResolutionStepStatus.PENDING);
    expect(pending).toHaveLength(1);
    expect(pending[0].type).toBe(ResolutionStepType.MANA_PAYMENT_CHOICE);
    expect(state.pendingSpellCasts.cast_drowner_library?.cardId).toBe('drowner_top');
  });

  it('prunes library-origin payment prompts once the spell is already on the stack', () => {
    const gameId = 'game_replay_cleanup_library_cast_completed';
    const state: any = {
      players: [{ id: 'p1' }],
      turnPlayer: 'p1',
      priority: 'p1',
      step: 'MAIN1',
      phase: 'precombatMain',
      stack: [{
        id: 'stack_drowner_1',
        type: 'spell',
        cardId: 'drowner_top',
        card: { id: 'drowner_top', name: 'Drowner of Secrets' },
        controller: 'p1',
        fromZone: 'library',
      }],
      zones: { p1: { hand: [], library: [] } },
      pendingSpellCasts: {
        cast_drowner_library: {
          cardId: 'drowner_top',
          playerId: 'p1',
          fromZone: 'library',
        },
      },
    };
    const libraries = new Map<string, any[]>([['p1', []]]);

    ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.MANA_PAYMENT_CHOICE,
      playerId: 'p1' as any,
      description: 'Pay costs to cast Drowner of Secrets.',
      mandatory: true,
      spellPaymentRequired: true,
      cardId: 'drowner_top',
      effectId: 'cast_drowner_library',
      fromZone: 'library',
      spellCastContext: { effectId: 'cast_drowner_library', cardId: 'drowner_top' },
    } as any);

    pruneObsoleteResolutionQueueAfterReplay(gameId, state, libraries);

    const queue = ResolutionQueueManager.getQueue(gameId);
    const pending = queue.steps.filter((step) => step.status === ResolutionStepStatus.PENDING);
    expect(pending).toHaveLength(0);
    expect(state.pendingSpellCasts.cast_drowner_library).toBeUndefined();
  });

  it('removes replayed battlefield activation payment prompts when the ability is already on the stack', () => {
    const gameId = 'game_replay_battlefield_activation_cleanup';
    const state: any = {
      players: [{ id: 'p1' }],
      turnPlayer: 'p1',
      priority: 'p1',
      step: 'MAIN1',
      phase: 'precombatMain',
      stack: [{
        id: 'ability_1',
        type: 'ability',
        controller: 'p1',
        source: 'tanuki_1',
        sourceName: 'Tanuki Transplanter',
        abilityType: 'reconfigure_attach',
      }],
      battlefield: [{
        id: 'tanuki_1',
        controller: 'p1',
        card: { name: 'Tanuki Transplanter', type_line: 'Artifact Creature — Dog Equipment', oracle_text: 'Reconfigure {3}' },
      }],
    };

    ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.MANA_PAYMENT_CHOICE,
      playerId: 'p1' as any,
      sourceId: 'tanuki_1',
      permanentId: 'tanuki_1',
      description: 'Choose how to pay {3} for Tanuki Transplanter.',
      mandatory: true,
      activationPaymentChoice: true,
      activationPaymentContext: 'battlefield_targeted',
      manaCost: '{3}',
      abilityId: 'tanuki_card_1-reconfigure-attach-0',
      abilityType: 'reconfigure_attach',
    } as any);

    pruneObsoleteResolutionQueueAfterReplay(gameId, state);

    const queue = ResolutionQueueManager.getQueue(gameId);
    const pending = queue.steps.filter((step) => step.status === ResolutionStepStatus.PENDING);
    expect(pending).toHaveLength(0);
  });
});
