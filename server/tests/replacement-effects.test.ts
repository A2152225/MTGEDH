import { describe, expect, it } from 'vitest';

import { createInitialGameState } from '../src/state/gameState.js';
import { applyDamageToPermanentWithCounterEffects } from '../src/state/modules/counter-common-effects.js';
import { applyCounterModifications, createToken } from '../src/state/modules/counters_tokens.js';
import { applyLifeGain } from '../src/state/utils.js';
import { evaluateCounterPlacementReplacementEvent, evaluateDamageReplacementEvent, evaluateLibrarySearchReplacementEvent, evaluateLifeGainReplacementEvent, evaluateReplacementEvent, evaluateTokenCreationReplacementEvent } from '../src/state/modules/replacement-effects.js';
import { shouldExileStackCardInsteadOfGraveyard } from '../src/state/modules/stack-zone-replacements.js';

describe('replacement effect evaluator', () => {
  it('evaluates flashback-style stack-to-graveyard replacement as exile', () => {
    const stackItem = {
      id: 'flashback_stack_1',
      controller: 'p1',
      card: {
        id: 'flashback_card_1',
        name: 'Think Twice',
        type_line: 'Instant',
        castWithAbility: 'flashback',
      },
    };

    const result = evaluateReplacementEvent({
      type: 'zone-change',
      object: stackItem,
      objectId: stackItem.id,
      sourceZone: 'stack',
      destinationZone: 'graveyard',
      controller: 'p1',
      cause: 'spell_resolution',
    });

    expect(result).toMatchObject({
      applied: true,
      eventType: 'zone-change',
      effectId: 'stack-ability-exile-after-resolution',
      sourceName: 'Think Twice',
      originalDestination: 'graveyard',
      replacementDestination: 'exile',
      reason: 'cast_with_ability_exiles_after_resolution',
      metadata: { castWithAbility: 'flashback' },
    });
    expect(shouldExileStackCardInsteadOfGraveyard(stackItem)).toBe(true);
  });

  it('evaluates explicit exile-after-resolution stack markers as exile', () => {
    const stackItem = {
      id: 'permission_stack_1',
      controller: 'p1',
      card: {
        id: 'permission_card_1',
        name: 'Borrowed Spell',
        type_line: 'Sorcery',
        exileAfterResolution: true,
      },
    };

    const result = evaluateReplacementEvent({
      type: 'zone-change',
      object: stackItem,
      objectId: stackItem.id,
      sourceZone: 'stack',
      destinationZone: 'graveyard',
      controller: 'p1',
      cause: 'spell_resolution',
    });

    expect(result).toMatchObject({
      applied: true,
      eventType: 'zone-change',
      effectId: 'stack-exile-after-resolution',
      originalDestination: 'graveyard',
      replacementDestination: 'exile',
      reason: 'exile_after_resolution',
    });
    expect(shouldExileStackCardInsteadOfGraveyard(stackItem)).toBe(true);
  });

  it('leaves ordinary stack-to-graveyard cleanup unchanged', () => {
    const stackItem = {
      id: 'ordinary_stack_1',
      controller: 'p1',
      card: {
        id: 'ordinary_card_1',
        name: 'Divination',
        type_line: 'Sorcery',
      },
    };

    const result = evaluateReplacementEvent({
      type: 'zone-change',
      object: stackItem,
      objectId: stackItem.id,
      sourceZone: 'stack',
      destinationZone: 'graveyard',
      controller: 'p1',
      cause: 'spell_resolution',
    });

    expect(result).toMatchObject({
      applied: false,
      eventType: 'zone-change',
      originalDestination: 'graveyard',
      replacementDestination: 'graveyard',
    });
    expect(shouldExileStackCardInsteadOfGraveyard(stackItem)).toBe(false);
  });

  it('evaluates commander zone replacement as a choice opportunity', () => {
    const commanderPermanent = {
      id: 'commander_perm_1',
      controller: 'p1',
      owner: 'p1',
      isCommander: true,
      card: {
        id: 'commander_card_1',
        name: 'Test Commander',
        type_line: 'Legendary Creature',
      },
    };

    const result = evaluateReplacementEvent({
      type: 'zone-change',
      object: commanderPermanent,
      objectId: commanderPermanent.id,
      sourceZone: 'battlefield',
      destinationZone: 'graveyard',
      controller: 'p1',
      owner: 'p1',
      cause: 'destroy',
    });

    expect(result).toMatchObject({
      applied: false,
      choiceRequired: true,
      eventType: 'zone-change',
      effectId: 'commander-zone-replacement-choice',
      sourceName: 'Test Commander',
      originalDestination: 'graveyard',
      replacementDestination: 'graveyard',
      replacementOptions: ['command', 'graveyard'],
      reason: 'commander_zone_replacement_choice',
      metadata: { commandZoneChoice: true, commanderId: 'commander_card_1' },
    });
  });

  it('recognizes commander replacement choices from command-zone metadata', () => {
    const commanderPermanent = {
      id: 'metadata_commander_perm_1',
      controller: 'p1',
      owner: 'p1',
      card: {
        id: 'metadata_commander_card_1',
        name: 'Metadata Commander',
        type_line: 'Legendary Creature',
      },
    };

    const result = evaluateReplacementEvent({
      type: 'zone-change',
      object: commanderPermanent,
      objectId: commanderPermanent.id,
      sourceZone: 'battlefield',
      destinationZone: 'hand',
      controller: 'p1',
      owner: 'p1',
      metadata: { commanderIds: ['metadata_commander_card_1'] },
    });

    expect(result).toMatchObject({
      applied: false,
      choiceRequired: true,
      effectId: 'commander-zone-replacement-choice',
      originalDestination: 'hand',
      replacementDestination: 'hand',
      replacementOptions: ['command', 'hand'],
      metadata: { commandZoneChoice: true, commanderId: 'metadata_commander_card_1' },
    });
  });

  it('evaluates shield counters as damage prevention and leaves mutation to the live helper', () => {
    const permanent = {
      id: 'shielded_perm_1',
      counters: { shield: 1 },
      card: {
        id: 'shielded_card_1',
        name: 'Shielded Creature',
        type_line: 'Creature',
      },
    };

    const result = evaluateDamageReplacementEvent({
      amount: 4,
      target: permanent,
      targetId: permanent.id,
      cause: 'damage',
    });

    expect(result).toMatchObject({
      applied: true,
      eventType: 'damage',
      effectId: 'shield-counter-prevent-damage',
      sourceName: 'Shielded Creature',
      originalAmount: 4,
      replacementAmount: 0,
      preventedAmount: 4,
      reason: 'shield_counter',
      metadata: { targetId: 'shielded_perm_1' },
    });
    expect(permanent.counters.shield).toBe(1);

    const damageResult = applyDamageToPermanentWithCounterEffects(permanent, 4);

    expect(damageResult).toEqual({ prevented: true, appliedAmount: 0 });
    expect(permanent.counters).toBeUndefined();
    expect((permanent as any).damageMarked || 0).toBe(0);
  });

  it('evaluates ordinary damage as not replaced', () => {
    const permanent = {
      id: 'ordinary_damage_perm_1',
      counters: {},
      card: {
        id: 'ordinary_damage_card_1',
        name: 'Ordinary Creature',
        type_line: 'Creature',
      },
    };

    const result = evaluateDamageReplacementEvent({
      amount: 3,
      target: permanent,
      targetId: permanent.id,
    });

    expect(result).toMatchObject({
      applied: false,
      eventType: 'damage',
      originalAmount: 3,
      replacementAmount: 3,
      preventedAmount: 0,
    });
  });

  it('evaluates static life gain prevention and preserves applyLifeGain behavior', () => {
    const state = {
      startingLife: 40,
      life: { p1: 30, p2: 40 },
      players: [{ id: 'p1', life: 30 }, { id: 'p2', life: 40 }],
      battlefield: [
        {
          id: 'sulfuric_vortex_1',
          controller: 'p2',
          card: {
            id: 'sulfuric_vortex_card_1',
            name: 'Sulfuric Vortex',
            type_line: 'Enchantment',
          },
        },
      ],
    } as any;

    const result = evaluateLifeGainReplacementEvent({ state, playerId: 'p1', amount: 3 });

    expect(result).toMatchObject({
      applied: true,
      eventType: 'life-gain',
      effectId: 'life-gain-prevented',
      sourceName: 'Sulfuric Vortex',
      originalAmount: 3,
      replacementAmount: 0,
      preventedAmount: 3,
      reason: 'life_gain_prevented',
      metadata: { playerId: 'p1' },
    });

    const lifeGain = applyLifeGain(state, 'p1', 3, 'test');
    expect(lifeGain.actualChange).toBe(0);
    expect(lifeGain.message).toBe('Life gain prevented by Sulfuric Vortex');
    expect(state.life.p1).toBe(30);
  });

  it('evaluates life gain reversal and preserves applyLifeGain behavior', () => {
    const state = {
      startingLife: 40,
      life: { p1: 30, p2: 40 },
      players: [{ id: 'p1', life: 30 }, { id: 'p2', life: 40 }],
      battlefield: [
        {
          id: 'tainted_remedy_1',
          controller: 'p2',
          card: {
            id: 'tainted_remedy_card_1',
            name: 'Tainted Remedy',
            type_line: 'Enchantment',
          },
        },
      ],
    } as any;

    const result = evaluateLifeGainReplacementEvent({ state, playerId: 'p1', amount: 4 });

    expect(result).toMatchObject({
      applied: true,
      eventType: 'life-gain',
      effectId: 'life-gain-reversed-to-loss',
      sourceName: 'Tainted Remedy',
      originalAmount: 4,
      replacementAmount: -4,
      preventedAmount: 0,
      reason: 'life_gain_reversed_to_loss',
      metadata: { playerId: 'p1', reversedToLoss: true },
    });

    const lifeGain = applyLifeGain(state, 'p1', 4, 'test');
    expect(lifeGain.actualChange).toBe(-4);
    expect(lifeGain.message).toBe('Life gain reversed to 4 life loss by Tainted Remedy');
    expect(state.life.p1).toBe(26);
    expect(state.players[0].life).toBe(26);
  });

  it('evaluates library search prevention effects', () => {
    const game = {
      state: {
        battlefield: [
          {
            id: 'ashiok_1',
            controller: 'p2',
            card: {
              id: 'ashiok_card_1',
              name: 'Ashiok, Dream Render',
              type_line: 'Legendary Planeswalker',
            },
          },
        ],
      },
    } as any;

    const result = evaluateLibrarySearchReplacementEvent({ game, searchingPlayerId: 'p1' });

    expect(result).toMatchObject({
      applied: true,
      eventType: 'library-search',
      effectId: 'library-search-prevented',
      reason: 'Ashiok, Dream Render prevents library searching',
      metadata: {
        canSearch: false,
        reason: 'Ashiok, Dream Render prevents library searching',
        triggerEffects: [],
      },
    });
  });

  it('evaluates library search limits, triggers, control, and payment restrictions', () => {
    const game = {
      state: {
        battlefield: [
          { id: 'aven_1', controller: 'p2', card: { id: 'aven_card_1', name: 'Aven Mindcensor', type_line: 'Creature' } },
          { id: 'ob_1', controller: 'p2', card: { id: 'ob_card_1', name: 'Ob Nixilis, Unshackled', type_line: 'Creature' } },
          { id: 'opposition_agent_1', controller: 'p2', card: { id: 'opposition_agent_card_1', name: 'Opposition Agent', type_line: 'Creature' } },
          { id: 'arbiter_1', controller: 'p1', card: { id: 'arbiter_card_1', name: 'Leonin Arbiter', type_line: 'Creature' } },
        ],
      },
    } as any;

    const result = evaluateLibrarySearchReplacementEvent({ game, searchingPlayerId: 'p1' });

    expect(result).toMatchObject({
      applied: true,
      eventType: 'library-search',
      effectId: 'library-search-limited',
      metadata: {
        canSearch: true,
        limitToTop: 4,
        controlledBy: 'p2',
        paymentRequired: { cardName: 'Leonin Arbiter', amount: '{2}' },
      },
    });
    expect((result.metadata as any).triggerEffects).toEqual([
      { cardName: 'Ob Nixilis, Unshackled', effect: 'Sacrifice a creature and lose 10 life', controllerId: 'p2' },
    ]);
  });

  it('evaluates token creation multipliers and preserves createToken behavior', () => {
    const game = createInitialGameState('replacement_effect_token_creation');
    game.applyEvent({ type: 'join', playerId: 'p1', name: 'P1' } as any);
    game.applyEvent({ type: 'join', playerId: 'p2', name: 'P2' } as any);
    (game.state as any).battlefield = [
      {
        id: 'anointed_procession_1',
        controller: 'p1',
        owner: 'p1',
        card: { id: 'anointed_procession_card_1', name: 'Anointed Procession', type_line: 'Enchantment', oracle_text: '' },
      },
      {
        id: 'primal_vigor_1',
        controller: 'p2',
        owner: 'p2',
        card: { id: 'primal_vigor_card_1', name: 'Primal Vigor', type_line: 'Enchantment', oracle_text: 'If one or more tokens would be created, twice that many are created instead.' },
      },
    ];

    const result = evaluateTokenCreationReplacementEvent({
      state: game.state,
      controllerId: 'p1',
      count: 2,
      tokenName: 'Soldier',
    });

    expect(result).toMatchObject({
      applied: true,
      eventType: 'token-creation',
      effectId: 'token-creation-multiplied',
      originalAmount: 2,
      replacementAmount: 8,
      reason: 'token_creation_replacement',
      metadata: {
        controllerId: 'p1',
        multiplier: 4,
        tokenName: 'Soldier',
      },
    });
    expect((result.metadata as any).sources).toEqual(['Anointed Procession', 'Primal Vigor']);

    const createdIds = createToken(game as any, 'p1' as any, 'Soldier', 2, 1, 1, { typeLine: 'Token Creature - Soldier' }, true);
    expect(createdIds).toHaveLength(8);
  });

  it('evaluates counter placement replacement metadata around existing counter ordering', () => {
    const game = createInitialGameState('replacement_effect_counter_placement');
    game.applyEvent({ type: 'join', playerId: 'p1', name: 'P1' } as any);
    (game.state as any).battlefield = [
      {
        id: 'counter_target_1',
        controller: 'p1',
        owner: 'p1',
        card: { id: 'counter_target_card_1', name: 'Counter Target', type_line: 'Creature', oracle_text: '' },
      },
      {
        id: 'doubling_season_1',
        controller: 'p1',
        owner: 'p1',
        card: { id: 'doubling_season_card_1', name: 'Doubling Season', type_line: 'Enchantment', oracle_text: '' },
      },
      {
        id: 'hardened_scales_1',
        controller: 'p1',
        owner: 'p1',
        card: { id: 'hardened_scales_card_1', name: 'Hardened Scales', type_line: 'Enchantment', oracle_text: '' },
      },
    ];

    const modifiedDeltas = applyCounterModifications(game.state, 'counter_target_1', { '+1/+1': 2 });
    expect(modifiedDeltas).toEqual({ '+1/+1': 6 });

    const result = evaluateCounterPlacementReplacementEvent({
      state: game.state,
      targetPermanentId: 'counter_target_1',
      controllerId: 'p1',
      deltas: { '+1/+1': 2 },
      modifiedDeltas,
    });

    expect(result).toMatchObject({
      applied: true,
      eventType: 'counter-placement',
      effectId: 'counter-placement-modified',
      originalAmount: 2,
      replacementAmount: 6,
      reason: 'counter_placement_replacement',
      metadata: {
        targetPermanentId: 'counter_target_1',
        controllerId: 'p1',
        originalDeltas: { '+1/+1': 2 },
        modifiedDeltas: { '+1/+1': 6 },
      },
    });
  });
});