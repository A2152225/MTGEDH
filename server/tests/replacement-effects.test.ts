import { describe, expect, it } from 'vitest';

import { createInitialGameState } from '../src/state/gameState.js';
import { replay as replayEvents } from '../src/state/modules/replay.js';
import { applyDamageToPermanentWithCounterEffects } from '../src/state/modules/counter-common-effects.js';
import { applyCounterModifications, createToken } from '../src/state/modules/counters_tokens.js';
import { drawCards } from '../src/state/modules/zones.js';
import { applyLifeGain } from '../src/state/utils.js';
import { evaluateBattlefieldEntryReplacementEvent, evaluateCounterPlacementReplacementEvent, evaluateDamageReplacementEvent, evaluateDrawReplacementEvent, evaluateLibrarySearchReplacementEvent, evaluateLifeGainReplacementEvent, evaluateReplacementEvent, evaluateTokenCreationReplacementEvent } from '../src/state/modules/replacement-effects.js';
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

  it('evaluates battlefield-entry tapped, counter, copy, transform, and face-down metadata', () => {
    const result = evaluateBattlefieldEntryReplacementEvent({
      state: { battlefield: [] },
      controllerId: 'p1',
      card: { id: 'entry_card_1', name: 'Entry Test', type_line: 'Creature', oracle_text: '' },
      entersTapped: true,
      entryCounters: { '+1/+1': 2, loyalty: 0 },
      entersTransformed: true,
      entersFaceDown: true,
      copySourceId: 'source_perm_1',
    });

    expect(result).toMatchObject({
      applied: true,
      eventType: 'battlefield-entry',
      effectId: 'battlefield-entry-modified',
      sourceName: 'Entry Test',
      reason: 'battlefield_entry_replacement',
      metadata: {
        controllerId: 'p1',
        entersTapped: true,
        entryCounters: { '+1/+1': 2 },
        entersTransformed: true,
        entersFaceDown: true,
        copySourceId: 'source_perm_1',
      },
    });
    expect((result.metadata as any).effects).toEqual(['entersTapped', 'entryCounters', 'entersTransformed', 'entersFaceDown', 'copy']);
  });

  it('evaluates damage prevention shields as blocked when damage cannot be prevented', () => {
    const permanent = {
      id: 'shielded_cant_prevent_perm_1',
      counters: { shield: 1 },
      card: { id: 'shielded_cant_prevent_card_1', name: 'Shielded Creature', type_line: 'Creature' },
    };
    const source = {
      id: 'cant_prevent_source_1',
      name: 'Banefire Test',
      oracle_text: "Damage can't be prevented.",
    };

    const result = evaluateDamageReplacementEvent({
      state: { battlefield: [] },
      amount: 4,
      source,
      sourceId: source.id,
      target: permanent,
      targetId: permanent.id,
    });

    expect(result).toMatchObject({
      applied: true,
      eventType: 'damage',
      effectId: 'damage-prevention-disallowed',
      originalAmount: 4,
      replacementAmount: 4,
      preventedAmount: 0,
      reason: 'source_damage_prevention_disallowed',
      metadata: { damageCanBePrevented: false, targetId: 'shielded_cant_prevent_perm_1' },
    });

    const damageResult = applyDamageToPermanentWithCounterEffects(permanent, 4, 'damageMarked', {
      state: { battlefield: [] },
      source,
      sourceId: source.id,
    });
    expect(damageResult).toEqual({ prevented: false, appliedAmount: 4 });
    expect(permanent.counters.shield).toBe(1);
    expect((permanent as any).damageMarked).toBe(4);
  });

  it('evaluates finite damage prevention effects and damage amount modifiers', () => {
    const preventionResult = evaluateDamageReplacementEvent({
      state: {
        turnNumber: 3,
        damagePreventionEffects: [
          { id: 'prevent_1', sourceName: 'Preventer', targetSourceId: '*', targetPermanentId: 'target_perm_1', remainingAmount: 2, expiresAtTurn: 3 },
        ],
      },
      amount: 5,
      source: { id: 'source_1', name: 'Source', colors: ['R'] },
      sourceId: 'source_1',
      target: { id: 'target_perm_1', card: { name: 'Target' } },
      targetId: 'target_perm_1',
    });

    expect(preventionResult).toMatchObject({
      applied: true,
      effectId: 'damage-prevented-by-effect',
      sourceName: 'Preventer',
      originalAmount: 5,
      replacementAmount: 3,
      preventedAmount: 2,
      reason: 'damage_prevention_effect',
    });

    const modifierResult = evaluateDamageReplacementEvent({
      amount: 3,
      metadata: {
        replacementEffects: [
          { type: 'double', source: 'Damage Doubler' },
          { type: 'add_flat', source: 'Bonus Damage', value: 1 },
        ],
      },
    });

    expect(modifierResult).toMatchObject({
      applied: true,
      effectId: 'damage-amount-modified',
      originalAmount: 3,
      replacementAmount: 7,
      preventedAmount: 0,
      reason: 'damage_amount_replacement',
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
            oracle_text: "At the beginning of each player's upkeep, Sulfuric Vortex deals 1 damage to that player. Players can't gain life.",
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
            oracle_text: 'If an opponent would gain life, that player loses that much life instead.',
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
              oracle_text:
                'Spells and abilities your opponents control can\'t cause their controller to search their library.\n−1: Target player mills four cards. Then exile each opponent\'s graveyard.',
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
          {
            id: 'aven_1',
            controller: 'p2',
            card: {
              id: 'aven_card_1',
              name: 'Aven Mindcensor',
              type_line: 'Creature',
              oracle_text:
                'Flash\nFlying\nIf an opponent would search a library, that player searches the top four cards of that library instead.',
            },
          },
          {
            id: 'ob_1',
            controller: 'p2',
            card: {
              id: 'ob_card_1',
              name: 'Ob Nixilis, Unshackled',
              type_line: 'Creature',
              oracle_text:
                'Flying, trample\nWhenever an opponent searches their library, that player sacrifices a creature of their choice and loses 10 life.\nWhenever another creature dies, put a +1/+1 counter on Ob Nixilis.',
            },
          },
          {
            id: 'opposition_agent_1',
            controller: 'p2',
            card: {
              id: 'opposition_agent_card_1',
              name: 'Opposition Agent',
              type_line: 'Creature',
              oracle_text:
                'Flash\nYou control your opponents while they\'re searching their libraries.\nWhile an opponent is searching their library, they exile each card they find. You may play those cards for as long as they remain exiled, and you may spend mana as though it were mana of any color to cast them.',
            },
          },
          {
            id: 'arbiter_1',
            controller: 'p1',
            card: {
              id: 'arbiter_card_1',
              name: 'Leonin Arbiter',
              type_line: 'Creature',
              oracle_text:
                'Players can\'t search libraries. Any player may pay {2} for that player to ignore this effect until end of turn.',
            },
          },
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
        card: { id: 'anointed_procession_card_1', name: 'Anointed Procession', type_line: 'Enchantment', oracle_text: 'If an effect would create one or more tokens under your control, it creates twice that many of those tokens instead.' },
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

  it('evaluates draw replacements and preserves Notion Thief live draw behavior', () => {
    const state = {
      zones: {
        p1: {
          hand: [],
          libraryCount: 5,
          graveyard: [
            { id: 'stinkweed_imp_1', name: 'Stinkweed Imp', oracle_text: 'Flying\nDredge 5' },
          ],
        },
      },
      battlefield: [
        {
          id: 'notion_thief_1',
          controller: 'p2',
          card: {
            id: 'notion_thief_card_1',
            name: 'Notion Thief',
            type_line: 'Creature',
            oracle_text: "If an opponent would draw a card except the first one they draw in each of their draw steps, instead you draw a card.",
          },
        },
      ],
    } as any;

    const dredgeChoice = evaluateDrawReplacementEvent({ state, playerId: 'p1', count: 1 });
    expect(dredgeChoice).toMatchObject({
      applied: false,
      choiceRequired: true,
      eventType: 'card-draw',
      effectId: 'dredge-draw-replacement-choice',
      replacementAmount: 0,
      reason: 'dredge_replacement_choice',
    });
    expect((dredgeChoice.metadata as any).dredgeOptions).toEqual([
      { cardId: 'stinkweed_imp_1', cardName: 'Stinkweed Imp', dredge: 5 },
    ]);

    const thiefReplacement = evaluateDrawReplacementEvent({
      state: { ...state, zones: { p1: { hand: [], libraryCount: 0, graveyard: [] } } },
      playerId: 'p1',
      count: 1,
    });
    expect(thiefReplacement).toMatchObject({
      applied: true,
      eventType: 'card-draw',
      effectId: 'draw-replaced-by-opponent',
      sourceName: 'Notion Thief',
      originalAmount: 1,
      replacementAmount: 0,
      reason: 'draw_replaced_by_opponent',
      metadata: { playerId: 'p1', replacementPlayerId: 'p2' },
    });

    const game = createInitialGameState('replacement_effect_draw_replacement');
    game.applyEvent({ type: 'join', playerId: 'p1', name: 'P1' } as any);
    game.applyEvent({ type: 'join', playerId: 'p2', name: 'P2' } as any);
    (game.state as any).battlefield = state.battlefield;
    (game.state as any).zones.p1.hand = [];
    (game.state as any).zones.p2.hand = [];
    game.libraries.set('p1' as any, [
      { id: 'p1_lib_1', name: 'P1 Card 1' } as any,
      { id: 'p1_lib_2', name: 'P1 Card 2' } as any,
    ]);
    game.libraries.set('p2' as any, [
      { id: 'p2_lib_1', name: 'P2 Card 1' } as any,
      { id: 'p2_lib_2', name: 'P2 Card 2' } as any,
    ]);

    const drawn = drawCards(game as any, 'p1' as any, 2);
    expect(drawn).toHaveLength(0);
    expect((game.state as any).zones.p1.hand).toHaveLength(0);
    expect((game.state as any).zones.p2.hand.map((card: any) => card.name)).toEqual(['P2 Card 1', 'P2 Card 2']);
    expect((game.state as any).cardsDrawnThisTurn.p2).toBe(2);
  });

  it('applies shared batch draw replacements through the live draw helper', () => {
    const game = createInitialGameState('replacement_effect_shared_draw_replacement');
    game.applyEvent({ type: 'join', playerId: 'p1', name: 'P1' } as any);
    game.applyEvent({ type: 'join', playerId: 'p2', name: 'P2' } as any);
    (game.state as any).battlefield = [
      {
        id: 'alms_collector_1',
        controller: 'p2',
        card: {
          id: 'alms_collector_card_1',
          name: 'Alms Collector',
          type_line: 'Creature',
          oracle_text: 'If an opponent would draw two or more cards, instead you and that player each draw a card.',
        },
      },
    ];
    game.libraries.set('p1' as any, [
      { id: 'p1_batch_lib_1', name: 'P1 Batch Card 1' } as any,
      { id: 'p1_batch_lib_2', name: 'P1 Batch Card 2' } as any,
      { id: 'p1_batch_lib_3', name: 'P1 Batch Card 3' } as any,
    ]);
    game.libraries.set('p2' as any, [
      { id: 'p2_batch_lib_1', name: 'P2 Batch Card 1' } as any,
    ]);

    const drawn = drawCards(game as any, 'p1' as any, 3);
    expect(drawn.map((card: any) => card.name)).toEqual(['P1 Batch Card 1']);
    expect((game.state as any).zones.p1.hand.map((card: any) => card.name)).toEqual(['P1 Batch Card 1']);
    expect((game.state as any).zones.p2.hand.map((card: any) => card.name)).toEqual(['P2 Batch Card 1']);
    expect((game.state as any).cardsDrawnThisTurn.p1).toBe(1);
    expect((game.state as any).cardsDrawnThisTurn.p2).toBe(1);
  });

  it('applies extra-draw replacements through the live draw helper', () => {
    const extraDrawOracle =
      'If you would draw a card except the first one you draw in each of your draw steps, draw two cards instead.';
    const game = createInitialGameState('replacement_effect_extra_draw');
    game.applyEvent({ type: 'join', playerId: 'p1', name: 'P1' } as any);
    game.applyEvent({ type: 'join', playerId: 'p2', name: 'P2' } as any);
    (game.state as any).battlefield = [
      {
        id: 'archive_1',
        controller: 'p1',
        card: {
          id: 'archive_card_1',
          name: 'Generic Extra Draw',
          type_line: 'Enchantment',
          oracle_text: extraDrawOracle,
        },
      },
      {
        id: 'opponent_archive',
        controller: 'p2',
        card: {
          id: 'opponent_archive_card',
          name: 'Opponent Extra Draw',
          type_line: 'Enchantment',
          oracle_text: extraDrawOracle,
        },
      },
    ];
    (game.state as any).step = 'DRAW';
    game.libraries.set('p1' as any, [
      { id: 'p1_lib_1', name: 'P1 Card 1' } as any,
      { id: 'p1_lib_2', name: 'P1 Card 2' } as any,
      { id: 'p1_lib_3', name: 'P1 Card 3' } as any,
      { id: 'p1_lib_4', name: 'P1 Card 4' } as any,
    ]);
    game.libraries.set('p2' as any, [
      { id: 'p2_lib_1', name: 'P2 Card 1' } as any,
    ]);

    const firstDrawStep = drawCards(game as any, 'p1' as any, 1);
    expect(firstDrawStep.map((card: any) => card.name)).toEqual(['P1 Card 1']);
    expect((game.state as any).zones.p1.hand.map((card: any) => card.name)).toEqual(['P1 Card 1']);

    const laterDraw = drawCards(game as any, 'p1' as any, 1);
    expect(laterDraw.map((card: any) => card.name)).toEqual(['P1 Card 2', 'P1 Card 3']);
    expect((game.state as any).zones.p1.hand.map((card: any) => card.name)).toEqual([
      'P1 Card 1',
      'P1 Card 2',
      'P1 Card 3',
    ]);

    const opponentDraw = drawCards(game as any, 'p2' as any, 1);
    expect(opponentDraw.map((card: any) => card.name)).toEqual(['P2 Card 1']);
  });

  it('replays draw replacements through the recorded drawCards event', () => {
    const game = createInitialGameState('replacement_effect_draw_replay');
    game.applyEvent({ type: 'join', playerId: 'p1', name: 'P1' } as any);
    game.applyEvent({ type: 'join', playerId: 'p2', name: 'P2' } as any);
    (game.state as any).battlefield = [
      {
        id: 'notion_thief_replay_1',
        controller: 'p2',
        card: {
          id: 'notion_thief_replay_card_1',
          name: 'Notion Thief',
          type_line: 'Creature',
          oracle_text: "If an opponent would draw a card except the first one they draw in each of their draw steps, instead you draw a card.",
        },
      },
    ];
    game.libraries.set('p1' as any, [
      { id: 'p1_replay_lib_1', name: 'P1 Replay Card 1' } as any,
      { id: 'p1_replay_lib_2', name: 'P1 Replay Card 2' } as any,
    ]);
    game.libraries.set('p2' as any, [
      { id: 'p2_replay_lib_1', name: 'P2 Replay Card 1' } as any,
      { id: 'p2_replay_lib_2', name: 'P2 Replay Card 2' } as any,
    ]);

    replayEvents(game as any, [{ type: 'drawCards', playerId: 'p1', count: 2 } as any]);

    expect((game.state as any).zones.p1.hand).toHaveLength(0);
    expect((game.state as any).zones.p2.hand.map((card: any) => card.name)).toEqual(['P2 Replay Card 1', 'P2 Replay Card 2']);
    expect((game.state as any).cardsDrawnThisTurn.p2).toBe(2);
  });

  it('replays token creation replacements through the recorded createToken event', () => {
    const game = createInitialGameState('replacement_effect_token_replay');
    game.applyEvent({ type: 'join', playerId: 'p1', name: 'P1' } as any);
    (game.state as any).battlefield = [
      {
        id: 'anointed_procession_replay_1',
        controller: 'p1',
        card: {
          id: 'anointed_procession_replay_card_1',
          name: 'Anointed Procession',
          type_line: 'Enchantment',
          oracle_text: 'If an effect would create one or more tokens under your control, it creates twice that many of those tokens instead.',
        },
      },
    ];

    replayEvents(game as any, [{ type: 'createToken', controller: 'p1', name: 'Soldier', count: 2, basePower: 1, baseToughness: 1 } as any]);

    const tokens = ((game.state as any).battlefield || []).filter((permanent: any) => permanent?.card?.name === 'Soldier');
    expect(tokens).toHaveLength(4);
    expect(tokens.every((permanent: any) => permanent.isToken === true && permanent.controller === 'p1')).toBe(true);
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
        card: {
          id: 'doubling_season_card_1',
          name: 'Doubling Season',
          type_line: 'Enchantment',
          oracle_text:
            'If an effect would create one or more tokens under your control, it creates twice that many of those tokens instead.\n'
            + 'If an effect would put one or more counters on a permanent you control, it puts twice that many of those counters on that permanent instead.',
        },
      },
      {
        id: 'hardened_scales_1',
        controller: 'p1',
        owner: 'p1',
        card: {
          id: 'hardened_scales_card_1',
          name: 'Hardened Scales',
          type_line: 'Enchantment',
          oracle_text:
            'If one or more +1/+1 counters would be put on a creature you control, that many plus one +1/+1 counters are put on it instead.',
        },
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