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

describe('castSpellContinuation replay semantics', () => {
  beforeEach(() => {
    for (const gameId of [
      't_cast_spell_continuation_life_replay',
      't_cast_spell_continuation_bargain_replay',
      't_cast_spell_continuation_force_replay',
      't_cast_spell_continuation_clear_flags_replay',
      't_cast_spell_continuation_target_prompt_replay',
      't_cast_spell_continuation_gift_prompt_replay',
      't_cast_spell_continuation_x_prompt_replay',
      't_cast_spell_continuation_mode_prompt_replay',
      't_cast_spell_continuation_mutate_mode_prompt_replay',
      't_cast_spell_continuation_mutate_target_prompt_replay',
      't_cast_spell_continuation_multi_target_prompt_replay',
      't_cast_spell_continuation_payment_prompt_replay',
      't_cast_spell_continuation_targeted_payment_prompt_replay',
      't_cast_spell_continuation_mutate_payment_prompt_replay',
      't_cast_spell_continuation_blight_prompt_replay',
    ]) {
      resetGame(gameId);
    }
  });

  it('replays life payment and in-hand spell updates', () => {
    const game = createInitialGameState('t_cast_spell_continuation_life_replay');
    const p1 = 'p1' as PlayerID;
    addPlayer(game, p1, 'P1');

    (game.state as any).life = { [p1]: 40 };
    const player = ((game.state as any).players || []).find((entry: any) => entry?.id === p1);
    if (player) player.life = 40;

    const zones = (game.state as any).zones[p1];
    zones.hand = [
      {
        id: 'spell_1',
        name: 'Necrologia',
        type_line: 'Instant',
        oracle_text: 'As an additional cost to cast this spell, pay X life.',
        zone: 'hand',
      },
    ];
    zones.handCount = zones.hand.length;

    game.applyEvent({
      type: 'castSpellContinuation',
      playerId: p1,
      cardId: 'spell_1',
      lifePaid: 5,
      cardUpdates: {
        lifePaymentAmount: 5,
      },
    } as any);

    expect((game.state as any).life[p1]).toBe(35);
    expect(player?.life).toBe(35);
    expect((game.state as any).lifeLostThisTurn[p1]).toBe(5);
    expect((zones.hand[0] as any).lifePaymentAmount).toBe(5);
  });

  it('replays discarded cards, sacrificed permanents, and bargain flags', () => {
    const game = createInitialGameState('t_cast_spell_continuation_bargain_replay');
    const p1 = 'p1' as PlayerID;
    addPlayer(game, p1, 'P1');

    const zones = (game.state as any).zones[p1];
    zones.hand = [
      {
        id: 'spell_1',
        name: 'Beseech the Mirror',
        type_line: 'Sorcery',
        oracle_text: 'Bargain',
        zone: 'hand',
      },
      {
        id: 'discard_1',
        name: 'Spare Card',
        type_line: 'Instant',
        oracle_text: '',
        zone: 'hand',
      },
    ];
    zones.handCount = zones.hand.length;
    zones.graveyard = [];
    zones.graveyardCount = 0;

    (game.state as any).battlefield = [
      {
        id: 'treasure_perm_1',
        controller: p1,
        owner: p1,
        tapped: false,
        counters: {},
        card: {
          id: 'treasure_card_1',
          name: 'Treasure',
          type_line: 'Token Artifact - Treasure',
          oracle_text: '{T}, Sacrifice this artifact: Add one mana of any color.',
          zone: 'battlefield',
        },
      },
    ];

    game.applyEvent({
      type: 'castSpellContinuation',
      playerId: p1,
      cardId: 'spell_1',
      moveHandCards: [
        {
          cardId: 'discard_1',
          destination: 'graveyard',
        },
      ],
      sacrificedPermanentIds: ['treasure_perm_1'],
      cardUpdates: {
        bargainResolved: true,
        wasBargained: true,
      },
    } as any);

    expect(zones.hand.map((card: any) => card.id)).toEqual(['spell_1']);
    expect(zones.handCount).toBe(1);
    expect(zones.graveyardCount).toBe(2);
    expect((game.state as any).battlefield).toHaveLength(0);

    const graveyardIds = (zones.graveyard as any[]).map((card: any) => card.id).sort();
    expect(graveyardIds).toEqual(['discard_1', 'treasure_card_1']);
    expect((zones.hand[0] as any).bargainResolved).toBe(true);
    expect((zones.hand[0] as any).wasBargained).toBe(true);
  });

  it('replays alternate-cost exiles and spell flags', () => {
    const game = createInitialGameState('t_cast_spell_continuation_force_replay');
    const p1 = 'p1' as PlayerID;
    addPlayer(game, p1, 'P1');

    (game.state as any).life = { [p1]: 40 };
    const player = ((game.state as any).players || []).find((entry: any) => entry?.id === p1);
    if (player) player.life = 40;

    const zones = (game.state as any).zones[p1];
    zones.hand = [
      {
        id: 'spell_1',
        name: 'Force of Will',
        type_line: 'Instant',
        oracle_text: '',
        zone: 'hand',
      },
      {
        id: 'blue_1',
        name: 'Ponder',
        type_line: 'Sorcery',
        oracle_text: '',
        colors: ['U'],
        zone: 'hand',
      },
    ];
    zones.handCount = zones.hand.length;
    zones.exile = [];
    zones.exileCount = 0;

    game.applyEvent({
      type: 'castSpellContinuation',
      playerId: p1,
      cardId: 'spell_1',
      lifePaid: 1,
      moveHandCards: [
        {
          cardId: 'blue_1',
          destination: 'exile',
          cardUpdates: {
            exiledForAlternateCost: true,
            exiledForSpellCardId: 'spell_1',
          },
        },
      ],
      cardUpdates: {
        forceAltCostPaid: true,
        forceAltCostExiledCardId: 'blue_1',
        lifePaymentAmount: 1,
      },
    } as any);

    expect((game.state as any).life[p1]).toBe(39);
    expect(player?.life).toBe(39);
    expect(zones.handCount).toBe(1);
    expect(zones.exileCount).toBe(1);
    expect((zones.exile[0] as any).id).toBe('blue_1');
    expect((zones.exile[0] as any).zone).toBe('exile');
    expect((zones.exile[0] as any).exiledForAlternateCost).toBe(true);
    expect((zones.exile[0] as any).exiledForSpellCardId).toBe('spell_1');
    expect((zones.hand[0] as any).forceAltCostPaid).toBe(true);
    expect((zones.hand[0] as any).forceAltCostExiledCardId).toBe('blue_1');
    expect((zones.hand[0] as any).lifePaymentAmount).toBe(1);
  });

  it('replays null card updates by clearing transient spell flags', () => {
    const game = createInitialGameState('t_cast_spell_continuation_clear_flags_replay');
    const p1 = 'p1' as PlayerID;
    addPlayer(game, p1, 'P1');

    const zones = (game.state as any).zones[p1];
    zones.hand = [
      {
        id: 'spell_1',
        name: 'Miracle Spell',
        type_line: 'Instant',
        oracle_text: '',
        zone: 'hand',
        isFirstDrawnThisTurn: true,
        drawnAt: 123,
      },
    ];
    zones.handCount = zones.hand.length;

    game.applyEvent({
      type: 'castSpellContinuation',
      playerId: p1,
      cardId: 'spell_1',
      cardUpdates: {
        isFirstDrawnThisTurn: null,
        drawnAt: null,
      },
    } as any);

    expect('isFirstDrawnThisTurn' in (zones.hand[0] as any)).toBe(false);
    expect('drawnAt' in (zones.hand[0] as any)).toBe(false);
  });

  it('replays queued spell target-selection prompts before the spell is cast', () => {
    const gameId = 't_cast_spell_continuation_target_prompt_replay';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    addPlayer(game, p1, 'P1');

    const zones = (game.state as any).zones[p1];
    zones.hand = [
      {
        id: 'counterspell_1',
        name: 'Counterspell',
        type_line: 'Instant',
        mana_cost: '{U}{U}',
        oracle_text: 'Counter target spell.',
        zone: 'hand',
        image_uris: { small: 'https://example.com/counterspell.jpg' },
      },
    ];
    zones.handCount = 1;
    (game.state as any).stack = [
      {
        id: 'stack_spell_1',
        type: 'spell',
        controller: 'p2',
        card: {
          name: 'Lightning Bolt',
          type_line: 'Instant',
          image_uris: { small: 'https://example.com/lightning-bolt.jpg' },
        },
      },
    ];

    game.applyEvent({
      type: 'castSpellContinuation',
      playerId: p1,
      cardId: 'counterspell_1',
      effectId: 'cast_counterspell_1_replay',
      pendingSpellCast: {
        effectId: 'cast_counterspell_1_replay',
        cardId: 'counterspell_1',
        cardName: 'Counterspell',
        manaCost: '{U}{U}',
        rawManaCost: '{U}{U}',
        fromZone: 'hand',
        playerId: p1,
        validTargetIds: ['stack_spell_1'],
        card: {
          id: 'counterspell_1',
          name: 'Counterspell',
          type_line: 'Instant',
          mana_cost: '{U}{U}',
          oracle_text: 'Counter target spell.',
          zone: 'hand',
        },
      },
      queuedResolutionStep: {
        id: 'queued_counterspell_target_1',
        type: ResolutionStepType.TARGET_SELECTION,
        playerId: p1,
        description: 'Choose target spell for Counterspell',
        mandatory: true,
        sourceId: 'cast_counterspell_1_replay',
        sourceName: 'Counterspell',
        sourceImage: 'https://example.com/counterspell.jpg',
        validTargets: [
          {
            id: 'stack_spell_1',
            label: 'Lightning Bolt',
            description: 'stack',
            imageUrl: 'https://example.com/lightning-bolt.jpg',
            type: 'card',
            isOpponent: true,
          },
        ],
        targetTypes: ['spell_target'],
        minTargets: 1,
        maxTargets: 1,
        targetDescription: 'target spell',
        spellCastContext: {
          cardId: 'counterspell_1',
          cardName: 'Counterspell',
          manaCost: '{U}{U}',
          rawManaCost: '{U}{U}',
          playerId: p1,
          effectId: 'cast_counterspell_1_replay',
          oracleText: 'Counter target spell.',
          imageUrl: 'https://example.com/counterspell.jpg',
        },
      },
    } as any);

    expect(((game.state as any).pendingSpellCasts || {}).cast_counterspell_1_replay?.cardId).toBe('counterspell_1');
    expect((zones.hand || []).map((card: any) => card.id)).toEqual(['counterspell_1']);
    expect((game.state as any).stack || []).toHaveLength(1);
    const queue = ResolutionQueueManager.getQueue(gameId);
    expect(queue.steps).toHaveLength(1);
    expect(String((queue.steps[0] as any)?.id || '')).toBe('queued_counterspell_target_1');
    expect((queue.steps[0] as any)?.spellCastContext?.cardId).toBe('counterspell_1');
    expect((queue.steps[0] as any)?.validTargets?.[0]?.id).toBe('stack_spell_1');
  });

  it('replays queued gift cast-choice prompts before a gift is promised', () => {
    const gameId = 't_cast_spell_continuation_gift_prompt_replay';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    addPlayer(game, p1, 'P1');

    const zones = (game.state as any).zones[p1];
    zones.hand = [
      {
        id: 'gift_spell_1',
        name: "Long River's Pull",
        type_line: 'Instant',
        mana_cost: '{U}{U}',
        oracle_text: 'Gift a card\nCounter target creature spell. If the gift was promised, instead counter target spell.',
        zone: 'hand',
      },
    ];
    zones.handCount = 1;

    game.applyEvent({
      type: 'castSpellContinuation',
      playerId: p1,
      cardId: 'gift_spell_1',
      queuedResolutionStep: {
        id: 'queued_gift_choice_1',
        type: ResolutionStepType.OPTION_CHOICE,
        playerId: p1,
        sourceId: 'gift_spell_1',
        sourceName: "Long River's Pull",
        description: "Choose whether to promise a gift as you cast Long River's Pull.",
        mandatory: true,
        options: [
          { id: 'gift:none', label: 'Cast without promising a gift' },
          { id: 'gift:p2', label: 'Promise a gift to P2', description: 'P2' },
        ],
        minSelections: 1,
        maxSelections: 1,
        giftCastChoice: true,
        giftCardId: 'gift_spell_1',
        giftCardName: "Long River's Pull",
        giftType: 'a card',
        giftFromZone: 'hand',
      },
    } as any);

    expect(((game.state as any).pendingSpellCasts || {}).gift_spell_1).toBeUndefined();
    expect((zones.hand || []).map((card: any) => card.id)).toEqual(['gift_spell_1']);
    const queue = ResolutionQueueManager.getQueue(gameId);
    expect(queue.steps).toHaveLength(1);
    expect((queue.steps[0] as any)?.type).toBe('option_choice');
    expect((queue.steps[0] as any)?.giftCastChoice).toBe(true);
    expect((queue.steps[0] as any)?.giftCardId).toBe('gift_spell_1');
  });

  it('replays queued X-value prompts before the spell is cast', () => {
    const gameId = 't_cast_spell_continuation_x_prompt_replay';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    addPlayer(game, p1, 'P1');

    const zones = (game.state as any).zones[p1];
    zones.hand = [
      {
        id: 'x_spell_1',
        name: 'Pest Infestation',
        type_line: 'Sorcery',
        mana_cost: '{X}{X}{G}',
        oracle_text: 'Destroy up to X target artifacts and/or enchantments.',
        zone: 'hand',
      },
    ];
    zones.handCount = 1;

    game.applyEvent({
      type: 'castSpellContinuation',
      playerId: p1,
      cardId: 'x_spell_1',
      queuedResolutionStep: {
        id: 'queued_x_choice_1',
        type: ResolutionStepType.X_VALUE_SELECTION,
        playerId: p1,
        sourceId: 'x_spell_1',
        sourceName: 'Pest Infestation',
        description: 'Choose X for Pest Infestation.',
        mandatory: true,
        minValue: 0,
        maxValue: 20,
        xCount: 2,
        spellCastXSelection: true,
        spellCardId: 'x_spell_1',
        spellFromZone: 'hand',
      },
    } as any);

    expect(((game.state as any).pendingSpellCasts || {}).x_spell_1).toBeUndefined();
    expect((zones.hand || []).map((card: any) => card.id)).toEqual(['x_spell_1']);
    const queue = ResolutionQueueManager.getQueue(gameId);
    expect(queue.steps).toHaveLength(1);
    expect((queue.steps[0] as any)?.type).toBe('x_value_selection');
    expect((queue.steps[0] as any)?.spellCastXSelection).toBe(true);
    expect((queue.steps[0] as any)?.spellCardId).toBe('x_spell_1');
  });

  it('replays queued cast mode-selection prompts before any mode is chosen', () => {
    const gameId = 't_cast_spell_continuation_mode_prompt_replay';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    addPlayer(game, p1, 'P1');

    const zones = (game.state as any).zones[p1];
    zones.hand = [
      {
        id: 'mode_spell_1',
        name: 'Cyclonic Rift',
        type_line: 'Instant',
        mana_cost: '{1}{U}',
        oracle_text: "Return target nonland permanent you don't control to its owner's hand. Overload {6}{U}",
        zone: 'hand',
      },
    ];
    zones.handCount = 1;

    game.applyEvent({
      type: 'castSpellContinuation',
      playerId: p1,
      cardId: 'mode_spell_1',
      queuedResolutionStep: {
        id: 'queued_mode_choice_1',
        type: ResolutionStepType.MODE_SELECTION,
        playerId: p1,
        sourceId: 'mode_spell_1',
        sourceName: 'Cyclonic Rift',
        description: 'Choose casting mode for Cyclonic Rift',
        mandatory: true,
        modes: [
          { id: 'normal', label: 'Normal', description: 'Cast Cyclonic Rift normally.' },
          { id: 'overload', label: 'Overload', description: 'Cast Cyclonic Rift with Overload.' },
        ],
        minModes: 1,
        maxModes: 1,
        allowDuplicates: false,
        modeSelectionPurpose: 'overload',
        castSpellFromHandArgs: {
          cardId: 'mode_spell_1',
          fromZone: 'hand',
          skipPriorityCheck: true,
        },
      },
    } as any);

    expect(((game.state as any).pendingSpellCasts || {}).mode_spell_1).toBeUndefined();
    expect((zones.hand || []).map((card: any) => card.id)).toEqual(['mode_spell_1']);
    const queue = ResolutionQueueManager.getQueue(gameId);
    expect(queue.steps).toHaveLength(1);
    expect((queue.steps[0] as any)?.type).toBe('mode_selection');
    expect((queue.steps[0] as any)?.modeSelectionPurpose).toBe('overload');
    expect((queue.steps[0] as any)?.sourceId).toBe('mode_spell_1');
  });

  it('replays queued mutate mode-choice prompts before a cast mode is chosen', () => {
    const gameId = 't_cast_spell_continuation_mutate_mode_prompt_replay';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    addPlayer(game, p1, 'P1');

    const zones = (game.state as any).zones[p1];
    zones.hand = [
      {
        id: 'mutate_1',
        name: 'Gemrazer',
        type_line: 'Creature - Beast',
        mana_cost: '{3}{G}',
        oracle_text: 'Mutate {1}{G}{G}\nReach, trample',
        zone: 'hand',
      },
    ];
    zones.handCount = 1;

    game.applyEvent({
      type: 'castSpellContinuation',
      playerId: p1,
      cardId: 'mutate_1',
      queuedResolutionStep: {
        id: 'queued_mutate_mode_1',
        type: ResolutionStepType.OPTION_CHOICE,
        playerId: p1,
        sourceId: 'mutate_1',
        sourceName: 'Gemrazer',
        description: 'Choose how to cast Gemrazer.',
        mandatory: true,
        options: [
          { id: 'cast_normal', label: 'Cast Normally' },
          { id: 'cast_mutate', label: 'Cast with Mutate ({1}{G}{G})' },
        ],
        minSelections: 1,
        maxSelections: 1,
        mutateCastModeChoice: true,
        mutateCardId: 'mutate_1',
        mutateCost: '{1}{G}{G}',
      },
    } as any);

    expect(((game.state as any).pendingSpellCasts || {}).mutate_1).toBeUndefined();
    expect((zones.hand || []).map((card: any) => card.id)).toEqual(['mutate_1']);
    const queue = ResolutionQueueManager.getQueue(gameId);
    expect(queue.steps).toHaveLength(1);
    expect(String((queue.steps[0] as any)?.id || '')).toBe('queued_mutate_mode_1');
    expect((queue.steps[0] as any)?.type).toBe('option_choice');
    expect((queue.steps[0] as any)?.mutateCastModeChoice).toBe(true);
    expect((queue.steps[0] as any)?.mutateCardId).toBe('mutate_1');
  });

  it('replays queued mutate target-selection prompts before the spell is cast', () => {
    const gameId = 't_cast_spell_continuation_mutate_target_prompt_replay';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    addPlayer(game, p1, 'P1');

    const zones = (game.state as any).zones[p1];
    zones.hand = [
      {
        id: 'mutate_1',
        name: 'Gemrazer',
        type_line: 'Creature - Beast',
        mana_cost: '{3}{G}',
        oracle_text: 'Mutate {1}{G}{G}\nReach, trample',
        zone: 'hand',
      },
    ];
    zones.handCount = 1;
    (game.state as any).battlefield = [
      {
        id: 'host_1',
        controller: p1,
        owner: p1,
        tapped: false,
        counters: {},
        card: {
          id: 'host_card_1',
          name: 'Mutation Host',
          type_line: 'Creature - Beast',
          oracle_text: 'Vigilance',
          zone: 'battlefield',
        },
      },
    ];

    game.applyEvent({
      type: 'castSpellContinuation',
      playerId: p1,
      cardId: 'mutate_1',
      effectId: 'cast_mutate_1_replay',
      pendingSpellCast: {
        effectId: 'cast_mutate_1_replay',
        cardId: 'mutate_1',
        cardName: 'Gemrazer',
        manaCost: '{1}{G}{G}',
        rawManaCost: '{1}{G}{G}',
        fromZone: 'hand',
        playerId: p1,
        validTargetIds: ['host_1'],
        forcedAlternateCostId: 'mutate',
        mutateCost: '{1}{G}{G}',
        card: {
          id: 'mutate_1',
          name: 'Gemrazer',
          type_line: 'Creature - Beast',
          mana_cost: '{3}{G}',
          oracle_text: 'Mutate {1}{G}{G}\nReach, trample',
          zone: 'hand',
        },
      },
      queuedResolutionStep: {
        id: 'queued_mutate_target_1',
        type: ResolutionStepType.MUTATE_TARGET_SELECTION,
        playerId: p1,
        sourceId: 'cast_mutate_1_replay',
        sourceName: 'Gemrazer',
        description: 'Choose a creature to mutate onto for Gemrazer.',
        mandatory: true,
        effectId: 'cast_mutate_1_replay',
        cardId: 'mutate_1',
        cardName: 'Gemrazer',
        mutateCost: '{1}{G}{G}',
        validTargets: [
          {
            id: 'host_1',
            name: 'Mutation Host',
            typeLine: 'Creature - Beast',
            imageUrl: 'https://example.com/host.jpg',
            controller: p1,
            owner: p1,
            isAlreadyMutated: false,
            mutationCount: 0,
          },
        ],
      },
    } as any);

    expect(((game.state as any).pendingSpellCasts || {}).cast_mutate_1_replay?.cardId).toBe('mutate_1');
    expect((zones.hand || []).map((card: any) => card.id)).toEqual(['mutate_1']);
    expect((game.state as any).stack || []).toHaveLength(0);
    const queue = ResolutionQueueManager.getQueue(gameId);
    expect(queue.steps).toHaveLength(1);
    expect(String((queue.steps[0] as any)?.id || '')).toBe('queued_mutate_target_1');
    expect((queue.steps[0] as any)?.type).toBe('mutate_target_selection');
    expect((queue.steps[0] as any)?.effectId).toBe('cast_mutate_1_replay');
    expect((queue.steps[0] as any)?.validTargets?.[0]?.id).toBe('host_1');
  });

  it('replays queued multi-step target-selection prompts before the spell is cast', () => {
    const gameId = 't_cast_spell_continuation_multi_target_prompt_replay';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    addPlayer(game, p1, 'P1');
    addPlayer(game, p2, 'P2');

    const zones = (game.state as any).zones[p1];
    zones.hand = [
      {
        id: 'prismari_command_1',
        name: 'Prismari Command',
        type_line: 'Instant',
        mana_cost: '{1}{U}{R}',
        oracle_text: 'Choose two -\n• Prismari Command deals 2 damage to any target.\n• Target player draws two cards, then discards two cards.\n• Target player creates a Treasure token.\n• Destroy target artifact.',
        zone: 'hand',
      },
    ];
    zones.handCount = 1;
    (game.state as any).battlefield = [
      {
        id: 'sol_ring_1',
        controller: p2,
        owner: p2,
        tapped: false,
        counters: {},
        card: {
          id: 'sol_ring_card_1',
          name: 'Sol Ring',
          type_line: 'Artifact',
          oracle_text: '',
          zone: 'battlefield',
        },
      },
    ];

    game.applyEvent({
      type: 'castSpellContinuation',
      playerId: p1,
      cardId: 'prismari_command_1',
      effectId: 'cast_prismari_command_1_replay',
      pendingSpellCast: {
        effectId: 'cast_prismari_command_1_replay',
        cardId: 'prismari_command_1',
        cardName: 'Prismari Command',
        manaCost: '{1}{U}{R}',
        rawManaCost: '{1}{U}{R}',
        fromZone: 'hand',
        playerId: p1,
        selectedModes: ['mode_1', 'mode_4'],
        validTargetIds: [p2, 'sol_ring_1'],
        card: {
          id: 'prismari_command_1',
          name: 'Prismari Command',
          type_line: 'Instant',
          mana_cost: '{1}{U}{R}',
          oracle_text: 'Choose two -\n• Prismari Command deals 2 damage to any target.\n• Target player draws two cards, then discards two cards.\n• Target player creates a Treasure token.\n• Destroy target artifact.',
          zone: 'hand',
        },
      },
      queuedResolutionSteps: [
        {
          id: 'queued_prismari_target_1',
          type: ResolutionStepType.TARGET_SELECTION,
          playerId: p1,
          description: 'Choose any target for Prismari Command',
          mandatory: true,
          sourceId: 'cast_prismari_command_1_replay',
          sourceName: 'Prismari Command',
          sourceImage: 'https://example.com/prismari-command.jpg',
          validTargets: [
            {
              id: p2,
              label: 'P2',
              description: 'player',
              type: 'player',
              isOpponent: true,
            },
          ],
          targetTypes: ['spell_target'],
          minTargets: 1,
          maxTargets: 1,
          targetDescription: 'any target',
          spellCastContext: {
            cardId: 'prismari_command_1',
            cardName: 'Prismari Command',
            manaCost: '{1}{U}{R}',
            rawManaCost: '{1}{U}{R}',
            playerId: p1,
            effectId: 'cast_prismari_command_1_replay',
            oracleText: 'Choose two -\n• Prismari Command deals 2 damage to any target.\n• Target player draws two cards, then discards two cards.\n• Target player creates a Treasure token.\n• Destroy target artifact.',
            imageUrl: 'https://example.com/prismari-command.jpg',
          },
        },
        {
          id: 'queued_prismari_target_2',
          type: ResolutionStepType.TARGET_SELECTION,
          playerId: p1,
          description: 'Choose target artifact for Prismari Command',
          mandatory: true,
          sourceId: 'cast_prismari_command_1_replay',
          sourceName: 'Prismari Command',
          sourceImage: 'https://example.com/prismari-command.jpg',
          validTargets: [
            {
              id: 'sol_ring_1',
              label: 'Sol Ring',
              description: 'permanent',
              type: 'permanent',
              controller: p2,
              isOpponent: true,
            },
          ],
          targetTypes: ['spell_target'],
          minTargets: 1,
          maxTargets: 1,
          targetDescription: 'target artifact',
          spellCastContext: {
            cardId: 'prismari_command_1',
            cardName: 'Prismari Command',
            manaCost: '{1}{U}{R}',
            rawManaCost: '{1}{U}{R}',
            playerId: p1,
            effectId: 'cast_prismari_command_1_replay',
            oracleText: 'Choose two -\n• Prismari Command deals 2 damage to any target.\n• Target player draws two cards, then discards two cards.\n• Target player creates a Treasure token.\n• Destroy target artifact.',
            imageUrl: 'https://example.com/prismari-command.jpg',
          },
        },
      ],
    } as any);

    expect(((game.state as any).pendingSpellCasts || {}).cast_prismari_command_1_replay?.cardId).toBe('prismari_command_1');
    expect((zones.hand || []).map((card: any) => card.id)).toEqual(['prismari_command_1']);
    expect((game.state as any).stack || []).toHaveLength(0);
    const queue = ResolutionQueueManager.getQueue(gameId);
    expect(queue.steps).toHaveLength(2);
    expect(String((queue.steps[0] as any)?.id || '')).toBe('queued_prismari_target_1');
    expect(String((queue.steps[1] as any)?.id || '')).toBe('queued_prismari_target_2');
    expect(String((queue.steps[0] as any)?.targetDescription || '').toLowerCase()).toContain('any target');
    expect(String((queue.steps[1] as any)?.targetDescription || '').toLowerCase()).toContain('target artifact');
  });

  it('replays queued no-target spell payment prompts before the spell is cast', () => {
    const gameId = 't_cast_spell_continuation_payment_prompt_replay';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    addPlayer(game, p1, 'P1');

    const zones = (game.state as any).zones[p1];
    zones.hand = [
      {
        id: 'divination_1',
        name: 'Divination',
        type_line: 'Sorcery',
        mana_cost: '{2}{U}',
        oracle_text: 'Draw two cards.',
        zone: 'hand',
      },
    ];
    zones.handCount = 1;

    game.applyEvent({
      type: 'castSpellContinuation',
      playerId: p1,
      cardId: 'divination_1',
      effectId: 'cast_divination_1_replay',
      pendingSpellCast: {
        effectId: 'cast_divination_1_replay',
        cardId: 'divination_1',
        cardName: 'Divination',
        manaCost: '{2}{U}',
        rawManaCost: '{2}{U}',
        fromZone: 'hand',
        playerId: p1,
        validTargetIds: [],
        targets: [],
        noTargets: true,
        card: {
          id: 'divination_1',
          name: 'Divination',
          type_line: 'Sorcery',
          mana_cost: '{2}{U}',
          oracle_text: 'Draw two cards.',
          zone: 'hand',
        },
      },
      queuedResolutionStep: {
        id: 'queued_divination_payment_1',
        type: ResolutionStepType.MANA_PAYMENT_CHOICE,
        playerId: p1,
        sourceId: 'divination_1',
        sourceName: 'Divination',
        description: 'Pay costs to cast Divination.',
        mandatory: true,
        spellPaymentRequired: true,
        cardId: 'divination_1',
        cardName: 'Divination',
        manaCost: '{2}{U}',
        effectId: 'cast_divination_1_replay',
      },
    } as any);

    expect(((game.state as any).pendingSpellCasts || {}).cast_divination_1_replay?.cardId).toBe('divination_1');
    expect((zones.hand || []).map((card: any) => card.id)).toEqual(['divination_1']);
    const queue = ResolutionQueueManager.getQueue(gameId);
    expect(queue.steps).toHaveLength(1);
    expect((queue.steps[0] as any)?.type).toBe('mana_payment_choice');
    expect((queue.steps[0] as any)?.spellPaymentRequired).toBe(true);
  });

  it('replays queued targeted spell payment prompts after target selection is complete', () => {
    const gameId = 't_cast_spell_continuation_targeted_payment_prompt_replay';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    addPlayer(game, p1, 'P1');
    addPlayer(game, p2, 'P2');

    const zones = (game.state as any).zones[p1];
    zones.hand = [
      {
        id: 'prismari_command_1',
        name: 'Prismari Command',
        type_line: 'Instant',
        mana_cost: '{1}{U}{R}',
        oracle_text: 'Choose two -\n• Prismari Command deals 2 damage to any target.\n• Target player draws two cards, then discards two cards.\n• Target player creates a Treasure token.\n• Destroy target artifact.',
        zone: 'hand',
      },
    ];
    zones.handCount = 1;

    game.applyEvent({
      type: 'castSpellContinuation',
      playerId: p1,
      cardId: 'prismari_command_1',
      effectId: 'cast_prismari_command_payment_replay',
      pendingSpellCast: {
        effectId: 'cast_prismari_command_payment_replay',
        cardId: 'prismari_command_1',
        cardName: 'Prismari Command',
        manaCost: '{1}{U}{R}',
        rawManaCost: '{1}{U}{R}',
        finalManaCost: '{1}{U}{R}',
        fromZone: 'hand',
        playerId: p1,
        selectedModes: ['mode_1', 'mode_4'],
        targets: [p2, 'sol_ring_1'],
        validTargetIds: [p2, 'sol_ring_1'],
        card: {
          id: 'prismari_command_1',
          name: 'Prismari Command',
          type_line: 'Instant',
          mana_cost: '{1}{U}{R}',
          oracle_text: 'Choose two -\n• Prismari Command deals 2 damage to any target.\n• Target player draws two cards, then discards two cards.\n• Target player creates a Treasure token.\n• Destroy target artifact.',
          zone: 'hand',
        },
      },
      queuedResolutionStep: {
        id: 'queued_prismari_payment_1',
        type: ResolutionStepType.MANA_PAYMENT_CHOICE,
        playerId: p1,
        sourceId: 'prismari_command_1',
        sourceName: 'Prismari Command',
        description: 'Pay costs to cast Prismari Command.',
        mandatory: true,
        spellPaymentRequired: true,
        cardId: 'prismari_command_1',
        cardName: 'Prismari Command',
        manaCost: '{1}{U}{R}',
        effectId: 'cast_prismari_command_payment_replay',
        targets: [p2, 'sol_ring_1'],
      },
    } as any);

    expect(((game.state as any).pendingSpellCasts || {}).cast_prismari_command_payment_replay?.targets).toEqual([p2, 'sol_ring_1']);
    expect((zones.hand || []).map((card: any) => card.id)).toEqual(['prismari_command_1']);
    const queue = ResolutionQueueManager.getQueue(gameId);
    expect(queue.steps).toHaveLength(1);
    expect((queue.steps[0] as any)?.type).toBe('mana_payment_choice');
    expect((queue.steps[0] as any)?.targets).toEqual([p2, 'sol_ring_1']);
  });

  it('replays queued mutate payment prompts after a mutate target is chosen', () => {
    const gameId = 't_cast_spell_continuation_mutate_payment_prompt_replay';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    addPlayer(game, p1, 'P1');

    const zones = (game.state as any).zones[p1];
    zones.hand = [
      {
        id: 'mutate_1',
        name: 'Gemrazer',
        type_line: 'Creature - Beast',
        mana_cost: '{3}{G}',
        oracle_text: 'Mutate {1}{G}{G}\nReach, trample',
        zone: 'hand',
      },
    ];
    zones.handCount = 1;

    game.applyEvent({
      type: 'castSpellContinuation',
      playerId: p1,
      cardId: 'mutate_1',
      effectId: 'cast_mutate_1_payment_replay',
      pendingSpellCast: {
        effectId: 'cast_mutate_1_payment_replay',
        cardId: 'mutate_1',
        cardName: 'Gemrazer',
        manaCost: '{1}{G}{G}',
        rawManaCost: '{1}{G}{G}',
        fromZone: 'hand',
        playerId: p1,
        targets: ['host_1'],
        mutateTarget: 'host_1',
        mutateOnTop: true,
        forcedAlternateCostId: 'mutate',
        mutateCost: '{1}{G}{G}',
        validTargetIds: ['host_1'],
        card: {
          id: 'mutate_1',
          name: 'Gemrazer',
          type_line: 'Creature - Beast',
          mana_cost: '{3}{G}',
          oracle_text: 'Mutate {1}{G}{G}\nReach, trample',
          zone: 'hand',
        },
      },
      queuedResolutionStep: {
        id: 'queued_mutate_payment_1',
        type: ResolutionStepType.MANA_PAYMENT_CHOICE,
        playerId: p1,
        sourceId: 'mutate_1',
        sourceName: 'Gemrazer',
        description: 'Pay costs to cast Gemrazer (Mutate).',
        mandatory: true,
        spellPaymentRequired: true,
        cardId: 'mutate_1',
        cardName: 'Gemrazer',
        manaCost: '{1}{G}{G}',
        effectId: 'cast_mutate_1_payment_replay',
        targets: ['host_1'],
        forcedAlternateCostId: 'mutate',
      },
    } as any);

    expect(((game.state as any).pendingSpellCasts || {}).cast_mutate_1_payment_replay?.mutateTarget).toBe('host_1');
    expect((zones.hand || []).map((card: any) => card.id)).toEqual(['mutate_1']);
    const queue = ResolutionQueueManager.getQueue(gameId);
    expect(queue.steps).toHaveLength(1);
    expect((queue.steps[0] as any)?.type).toBe('mana_payment_choice');
    expect((queue.steps[0] as any)?.forcedAlternateCostId).toBe('mutate');
    expect((queue.steps[0] as any)?.targets).toEqual(['host_1']);
  });

  it('replays queued blight choice and target prompts before the spell is cast', () => {
    const gameId = 't_cast_spell_continuation_blight_prompt_replay';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    addPlayer(game, p1, 'P1');
    addPlayer(game, p2, 'P2');

    const zones = (game.state as any).zones[p1];
    zones.hand = [
      {
        id: 'blight_blast_1',
        name: 'Blight Blast',
        type_line: 'Sorcery',
        mana_cost: '{1}{B}',
        oracle_text: 'As an additional cost to cast this spell, blight 1 or pay {3}. Destroy target artifact.',
        zone: 'hand',
      },
    ];
    zones.handCount = 1;
    (game.state as any).battlefield = [
      {
        id: 'bear_1',
        controller: p1,
        owner: p1,
        tapped: false,
        counters: {},
        card: {
          id: 'bear_card_1',
          name: 'Runeclaw Bear',
          type_line: 'Creature - Bear',
          oracle_text: '',
          zone: 'battlefield',
        },
      },
      {
        id: 'sol_ring_1',
        controller: p2,
        owner: p2,
        tapped: false,
        counters: {},
        card: {
          id: 'sol_ring_card_1',
          name: 'Sol Ring',
          type_line: 'Artifact',
          oracle_text: '',
          zone: 'battlefield',
        },
      },
    ];

    game.applyEvent({
      type: 'castSpellContinuation',
      playerId: p1,
      cardId: 'blight_blast_1',
      effectId: 'cast_blight_blast_1_replay',
      pendingSpellCast: {
        effectId: 'cast_blight_blast_1_replay',
        cardId: 'blight_blast_1',
        cardName: 'Blight Blast',
        manaCost: '{1}{B}',
        rawManaCost: '{1}{B}',
        fromZone: 'hand',
        playerId: p1,
        additionalCostPaid: false,
        additionalCostMethod: 'none',
        validTargetIds: ['sol_ring_1'],
        card: {
          id: 'blight_blast_1',
          name: 'Blight Blast',
          type_line: 'Sorcery',
          mana_cost: '{1}{B}',
          oracle_text: 'As an additional cost to cast this spell, blight 1 or pay {3}. Destroy target artifact.',
          zone: 'hand',
        },
      },
      queuedResolutionSteps: [
        {
          id: 'queued_blight_choice_1',
          type: ResolutionStepType.OPTION_CHOICE,
          playerId: p1,
          description: 'Additional cost for Blight Blast: Choose how to pay',
          mandatory: true,
          sourceId: 'cast_blight_blast_1_replay',
          sourceName: 'Blight Blast',
          options: [
            { id: 'blight_cost', label: 'Blight 1' },
            { id: 'pay_mana_cost', label: 'Pay {3}' },
          ],
          minSelections: 1,
          maxSelections: 1,
          spellAdditionalCostBlightOrPay: true,
          spellAdditionalCostEffectId: 'cast_blight_blast_1_replay',
          spellAdditionalCostCardName: 'Blight Blast',
          spellAdditionalCostBlightN: 1,
          spellAdditionalCostOrPay: '{3}',
        },
        {
          id: 'queued_blight_target_1',
          type: ResolutionStepType.TARGET_SELECTION,
          playerId: p1,
          description: 'Choose target artifact for Blight Blast',
          mandatory: true,
          sourceId: 'cast_blight_blast_1_replay',
          sourceName: 'Blight Blast',
          validTargets: [
            {
              id: 'sol_ring_1',
              label: 'Sol Ring',
              description: 'permanent',
              type: 'permanent',
              controller: p2,
              isOpponent: true,
            },
          ],
          targetTypes: ['spell_target'],
          minTargets: 1,
          maxTargets: 1,
          targetDescription: 'target artifact',
          spellCastContext: {
            cardId: 'blight_blast_1',
            cardName: 'Blight Blast',
            manaCost: '{1}{B}',
            rawManaCost: '{1}{B}',
            playerId: p1,
            effectId: 'cast_blight_blast_1_replay',
            oracleText: 'As an additional cost to cast this spell, blight 1 or pay {3}. Destroy target artifact.',
          },
        },
      ],
    } as any);

    expect(((game.state as any).pendingSpellCasts || {}).cast_blight_blast_1_replay?.cardId).toBe('blight_blast_1');
    expect((zones.hand || []).map((card: any) => card.id)).toEqual(['blight_blast_1']);
    const queue = ResolutionQueueManager.getQueue(gameId);
    expect(queue.steps).toHaveLength(2);
    expect((queue.steps[0] as any)?.spellAdditionalCostBlightOrPay).toBe(true);
    expect(String((queue.steps[1] as any)?.targetDescription || '').toLowerCase()).toContain('target artifact');
  });
});