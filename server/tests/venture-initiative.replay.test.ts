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

describe('venture and initiative replay semantics', () => {
  beforeEach(() => {
    for (const gameId of [
      't_venture_choose_dungeon_resolve_replay',
      't_venture_choose_dungeon_effect_replay',
      't_venture_choose_room_resolve_replay',
      't_venture_room_token_replay',
      't_venture_room_creature_token_replay',
      't_venture_runestone_execute_effect_replay',
      't_venture_mad_wizard_execute_effect_replay',
      't_venture_room_penalty_choice_replay',
      't_venture_room_free_cast_choice_replay',
      't_venture_room_throne_choice_replay',
      't_venture_room_discard_payment_replay',
      't_venture_room_sacrifice_payment_replay',
      't_venture_fungi_target_creature_replay',
      't_venture_twisted_target_creature_replay',
      't_venture_choose_room_complete_replay',
      't_venture_trap_target_player_replay',
      't_venture_forge_target_creature_replay',
      't_venture_arena_target_creature_replay',
    ]) {
      resetGame(gameId);
    }
  });

  it('replays ventureChooseDungeonResolve by restoring the chosen dungeon, including Undercity', () => {
    const game = createInitialGameState('t_venture_choose_dungeon_resolve_replay');
    const playerId = 'p1' as PlayerID;

    addPlayer(game, playerId, 'P1');

    game.applyEvent({
      type: 'ventureChooseDungeonResolve',
      playerId,
      dungeonId: 'undercity',
      dungeonName: 'Undercity',
      roomIndex: 0,
      currentRoomId: 'secret_entrance',
      currentRoomName: 'Secret Entrance',
      currentRoomEffect: 'Search your library for a basic land card, reveal it, put it into your hand, then shuffle.',
      roomPath: ['secret_entrance'],
    } as any);

    expect((((game.state as any).dungeonProgress || {})[playerId])).toMatchObject({
      dungeonId: 'undercity',
      dungeonName: 'Undercity',
      roomIndex: 0,
      currentRoomId: 'secret_entrance',
      currentRoomName: 'Secret Entrance',
      roomPath: ['secret_entrance'],
    });
  });

  it('replays ventureChooseDungeonResolve and applies deterministic entry effects', () => {
    const game = createInitialGameState('t_venture_choose_dungeon_effect_replay');
    const playerId = 'p1' as PlayerID;

    addPlayer(game, playerId, 'P1');

    game.applyEvent({
      type: 'ventureChooseDungeonResolve',
      playerId,
      dungeonId: 'mad_mage',
      dungeonName: 'Dungeon of the Mad Mage',
      roomIndex: 0,
      currentRoomId: 'yawning_portal',
      currentRoomName: 'Yawning Portal',
      currentRoomEffect: 'You gain 1 life.',
      roomPath: ['yawning_portal'],
    } as any);

    expect((((game.state as any).dungeonProgress || {})[playerId])).toMatchObject({
      dungeonId: 'mad_mage',
      dungeonName: 'Dungeon of the Mad Mage',
      currentRoomId: 'yawning_portal',
    });
    expect((((game.state as any).life || {})[playerId] ?? (game.state as any).players?.[0]?.life)).toBe(41);
  });

  it('replays ventureChooseRoomResolve by restoring the chosen next room snapshot', () => {
    const game = createInitialGameState('t_venture_choose_room_resolve_replay');
    const playerId = 'p1' as PlayerID;

    addPlayer(game, playerId, 'P1');

    game.applyEvent({
      type: 'ventureChooseRoomResolve',
      playerId,
      dungeonId: 'lost_mine',
      dungeonName: 'Lost Mine of Phandelver',
      roomIndex: 1,
      currentRoomId: 'mine_tunnels',
      currentRoomName: 'Mine Tunnels',
      currentRoomEffect: 'Create a Treasure token.',
      roomPath: ['cave_entrance', 'mine_tunnels'],
      completed: false,
    } as any);

    expect((((game.state as any).dungeonProgress || {})[playerId])).toMatchObject({
      dungeonId: 'lost_mine',
      dungeonName: 'Lost Mine of Phandelver',
      roomIndex: 1,
      currentRoomId: 'mine_tunnels',
      currentRoomName: 'Mine Tunnels',
      roomPath: ['cave_entrance', 'mine_tunnels'],
    });
  });

  it('replays a room-enter token event by restoring the authoritative token snapshot', () => {
    const game = createInitialGameState('t_venture_room_token_replay');
    const playerId = 'p1' as PlayerID;
    const treasureId = 'venture_treasure_replay_1';

    addPlayer(game, playerId, 'P1');

    game.applyEvent({
      type: 'ventureChooseRoomResolve',
      playerId,
      dungeonId: 'lost_mine',
      dungeonName: 'Lost Mine of Phandelver',
      roomIndex: 1,
      currentRoomId: 'mine_tunnels',
      currentRoomName: 'Mine Tunnels',
      currentRoomEffect: 'Create a Treasure token.',
      roomPath: ['cave_entrance', 'mine_tunnels'],
      completed: false,
    } as any);

    expect(((game.state as any).battlefield || []).some((permanent: any) => permanent && permanent.id === treasureId)).toBe(false);

    game.applyEvent({
      type: 'executeEffect',
      effectType: 'createToken',
      controllerId: playerId,
      tokenData: {
        id: treasureId,
        name: 'Treasure',
        typeLine: 'Token Artifact — Treasure',
        colors: [],
        abilities: ['{T}, Sacrifice this artifact: Add one mana of any color.'],
        hasHaste: false,
      },
    } as any);

    const treasure = ((game.state as any).battlefield || []).find((permanent: any) => permanent && permanent.id === treasureId) as any;
    expect(treasure).toBeDefined();
    expect(treasure?.isToken).toBe(true);
    expect(String(treasure?.card?.type_line || '')).toBe('Token Artifact — Treasure');
    expect(Array.isArray(treasure?.card?.keywords) ? treasure.card.keywords : []).toContain('{T}, Sacrifice this artifact: Add one mana of any color.');
  });

  it('replays a creature-token room event by restoring keyword-bearing token stats', () => {
    const game = createInitialGameState('t_venture_room_creature_token_replay');
    const playerId = 'p1' as PlayerID;
    const tokenId = 'venture_atropal_replay_1';

    addPlayer(game, playerId, 'P1');

    game.applyEvent({
      type: 'executeEffect',
      effectType: 'createToken',
      controllerId: playerId,
      tokenData: {
        id: tokenId,
        name: 'The Atropal',
        typeLine: 'Token Legendary Creature — God Horror',
        power: 4,
        toughness: 4,
        colors: ['B'],
        abilities: ['Deathtouch'],
        hasHaste: false,
      },
    } as any);

    const atropal = ((game.state as any).battlefield || []).find((permanent: any) => permanent && permanent.id === tokenId) as any;
    expect(atropal).toBeDefined();
    expect(atropal?.basePower).toBe(4);
    expect(atropal?.baseToughness).toBe(4);
    expect(String(atropal?.card?.type_line || '')).toBe('Token Legendary Creature — God Horror');
    expect(Array.isArray(atropal?.card?.keywords) ? atropal.card.keywords : []).toContain('Deathtouch');
  });

  it('replays a Runestone Caverns executeEffect by restoring exile state and play-from-exile permission', () => {
    const game = createInitialGameState('t_venture_runestone_execute_effect_replay');
    const playerId = 'p1' as PlayerID;

    addPlayer(game, playerId, 'P1');

    game.applyEvent({
      type: 'executeEffect',
      effectType: 'dungeonExileCards',
      controllerId: playerId,
      grantPlayableFromExile: true,
      exiledCards: [
        {
          id: 'runestone_replay_1',
          name: 'Opt',
          type_line: 'Instant',
          mana_cost: '{U}',
          oracle_text: 'Scry 1. Draw a card.',
        },
        {
          id: 'runestone_replay_2',
          name: 'Island',
          type_line: 'Basic Land — Island',
        },
      ],
      libraryAfter: [
        {
          id: 'runestone_replay_3',
          name: 'Swamp',
          type_line: 'Basic Land — Swamp',
          zone: 'library',
        },
      ],
    } as any);

    expect((((game.state as any).zones?.[playerId]?.exile || []) as any[]).map((card: any) => card.id)).toEqual([
      'runestone_replay_1',
      'runestone_replay_2',
    ]);
    expect((game.state as any).playableFromExile?.[playerId]?.runestone_replay_1).toBe(true);
    const runestoneLibrary = game.libraries?.get(playerId) || [];
    expect(runestoneLibrary.map((card: any) => card.id)).toEqual([
      'runestone_replay_3',
    ]);
  });

  it('replays a Mad Wizard\'s Lair executeEffect by restoring the drawn cards to hand', () => {
    const game = createInitialGameState('t_venture_mad_wizard_execute_effect_replay');
    const playerId = 'p1' as PlayerID;

    addPlayer(game, playerId, 'P1');

    game.applyEvent({
      type: 'executeEffect',
      effectType: 'dungeonDrawCards',
      controllerId: playerId,
      drawnCards: [
        { id: 'mad_wizard_replay_1', name: 'Opt', type_line: 'Instant', zone: 'hand' },
        { id: 'mad_wizard_replay_2', name: 'Island', type_line: 'Basic Land — Island', zone: 'hand' },
        { id: 'mad_wizard_replay_3', name: 'Negate', type_line: 'Instant', zone: 'hand' },
      ],
      libraryAfter: [
        { id: 'mad_wizard_replay_4', name: 'Plains', type_line: 'Basic Land — Plains', zone: 'library' },
      ],
    } as any);

    expect((((game.state as any).zones?.[playerId]?.hand || []) as any[]).map((card: any) => card.id)).toEqual([
      'mad_wizard_replay_1',
      'mad_wizard_replay_2',
      'mad_wizard_replay_3',
    ]);
    const madWizardLibrary = game.libraries?.get(playerId) || [];
    expect(madWizardLibrary.map((card: any) => card.id)).toEqual([
      'mad_wizard_replay_4',
    ]);
  });

  it('replays dungeonRoomPenaltyChoiceResolve by clearing the queued option step and applying life loss', () => {
    const gameId = 't_venture_room_penalty_choice_replay';

    const game = createInitialGameState(gameId);
    addPlayer(game, 'p1' as PlayerID, 'P1');
    addPlayer(game, 'p2' as PlayerID, 'P2');

    game.applyEvent({
      type: 'resolveTopOfStackPrompt',
      playerId: 'p2',
      sourceId: 'venture_veils_prompt',
      queuedResolutionStep: {
        id: 'queued_veils_choice_1',
        type: ResolutionStepType.OPTION_CHOICE,
        playerId: 'p2',
        sourceId: 'venture_veils_prompt',
        sourceName: 'Veils of Fear',
        description: 'Tomb of Annihilation: Veils of Fear - Lose 2 life unless you discard a card',
        mandatory: true,
        options: [
          { id: 'discard_card', label: 'Discard a card' },
          { id: 'lose_life', label: 'Lose 2 life' },
        ],
        minSelections: 1,
        maxSelections: 1,
        dungeonRoomPenaltyChoice: {
          dungeonId: 'tomb',
          roomId: 'veils_of_fear',
          amount: 2,
          paymentType: 'discard',
          sourceName: 'Veils of Fear',
        },
      },
    } as any);

    expect(ResolutionQueueManager.getQueue(gameId).steps).toHaveLength(1);

    game.applyEvent({
      type: 'dungeonRoomPenaltyChoiceResolve',
      playerId: 'p2',
      resolvedStepId: 'queued_veils_choice_1',
      sourceId: 'venture_veils_prompt',
      sourceName: 'Veils of Fear',
      dungeonId: 'tomb',
      currentRoomId: 'veils_of_fear',
      amount: 2,
      choice: 'lose_life',
    } as any);

    expect(ResolutionQueueManager.getQueue(gameId).steps).toHaveLength(0);
    expect((((game.state as any).life || {})['p2'] ?? (game.state as any).players?.find((player: any) => player.id === 'p2')?.life)).toBe(38);
  });

  it('replays dungeonRoomFreeCastChoiceResolve by clearing the queued Mad Wizard\'s Lair option step', () => {
    const gameId = 't_venture_room_free_cast_choice_replay';

    const game = createInitialGameState(gameId);
    const playerId = 'p1' as PlayerID;
    addPlayer(game, playerId, 'P1');

    game.applyEvent({
      type: 'resolveTopOfStackPrompt',
      playerId,
      sourceId: 'venture_mad_wizard_prompt',
      queuedResolutionStep: {
        id: 'queued_mad_wizard_choice_1',
        type: ResolutionStepType.OPTION_CHOICE,
        playerId,
        sourceId: 'venture_mad_wizard_prompt',
        sourceName: "Mad Wizard's Lair",
        description: "Dungeon of the Mad Mage: Mad Wizard's Lair - You may cast one of the revealed cards without paying its mana cost",
        mandatory: false,
        options: [
          { id: 'mad_wizard_replay_1', label: 'Opt' },
          { id: 'decline', label: 'Decline' },
        ],
        minSelections: 1,
        maxSelections: 1,
        dungeonRoomFreeCastFromHandChoice: {
          dungeonId: 'mad_mage',
          roomId: 'mad_wizards_lair',
          sourceName: "Mad Wizard's Lair",
          drawnCardIds: ['mad_wizard_replay_1'],
        },
      },
    } as any);

    expect(ResolutionQueueManager.getQueue(gameId).steps).toHaveLength(1);

    game.applyEvent({
      type: 'dungeonRoomFreeCastChoiceResolve',
      playerId,
      resolvedStepId: 'queued_mad_wizard_choice_1',
      sourceId: 'venture_mad_wizard_prompt',
      sourceName: "Mad Wizard's Lair",
      dungeonId: 'mad_mage',
      currentRoomId: 'mad_wizards_lair',
      choice: 'decline',
    } as any);

    expect(ResolutionQueueManager.getQueue(gameId).steps).toHaveLength(0);
  });

  it('replays dungeonRoomThroneResolve by clearing the queued prompt and restoring the chosen creature with counters and hexproof', () => {
    const gameId = 't_venture_room_throne_choice_replay';

    const game = createInitialGameState(gameId);
    const playerId = 'p1' as PlayerID;
    addPlayer(game, playerId, 'P1');
    (game.state as any).turnNumber = 7;

    game.applyEvent({
      type: 'resolveTopOfStackPrompt',
      playerId,
      sourceId: 'venture_throne_prompt',
      queuedResolutionStep: {
        id: 'queued_throne_choice_1',
        type: ResolutionStepType.OPTION_CHOICE,
        playerId,
        sourceId: 'venture_throne_prompt',
        sourceName: 'Throne of the Dead Three',
        description: 'Undercity: Throne of the Dead Three - Choose a creature card to put onto the battlefield',
        mandatory: true,
        options: [
          { id: 'throne_replay_1', label: 'Hill Giant' },
        ],
        minSelections: 1,
        maxSelections: 1,
        dungeonRoomThroneChoice: {
          dungeonId: 'undercity',
          roomId: 'throne_of_the_dead_three',
          sourceName: 'Throne of the Dead Three',
          revealedCards: [
            { id: 'throne_replay_1', name: 'Hill Giant', type_line: 'Creature — Giant', power: '3', toughness: '3' },
          ],
        },
      },
    } as any);

    expect(ResolutionQueueManager.getQueue(gameId).steps).toHaveLength(1);

    game.applyEvent({
      type: 'dungeonRoomThroneResolve',
      playerId,
      resolvedStepId: 'queued_throne_choice_1',
      sourceId: 'venture_throne_prompt',
      sourceName: 'Throne of the Dead Three',
      dungeonId: 'undercity',
      currentRoomId: 'throne_of_the_dead_three',
      selectedCard: { id: 'throne_replay_1', name: 'Hill Giant', type_line: 'Creature — Giant', power: '3', toughness: '3' },
      createdPermanentId: 'throne_perm_replay_1',
      turnApplied: 7,
      libraryAfter: [
        { id: 'throne_replay_2', name: 'Island', type_line: 'Basic Land — Island', zone: 'library' },
      ],
    } as any);

    expect(ResolutionQueueManager.getQueue(gameId).steps).toHaveLength(0);
    const throneLibrary = game.libraries?.get(playerId) || [];
    expect(throneLibrary.map((card: any) => card.id)).toEqual([
      'throne_replay_2',
    ]);
    const permanent = ((game.state as any).battlefield || []).find((entry: any) => String(entry?.id || '') === 'throne_perm_replay_1') as any;
    expect(permanent).toBeDefined();
    expect((permanent?.counters || {})['+1/+1']).toBe(3);
    expect(Array.isArray(permanent?.grantedAbilities) ? permanent.grantedAbilities : []).toContain('Hexproof');
    expect(Array.isArray(permanent?.untilNextTurnGrants) ? permanent.untilNextTurnGrants : []).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ controllerId: playerId, turnApplied: 7, kind: 'hexproof' }),
      ]),
    );
  });

  it('replays discardEffect by clearing a queued dungeon discard-payment step', () => {
    const gameId = 't_venture_room_discard_payment_replay';

    const game = createInitialGameState(gameId);
    const playerId = 'p1' as PlayerID;
    addPlayer(game, playerId, 'P1');
    (game.state as any).zones = {
      [playerId]: {
        hand: [
          {
            id: 'discard_card_1',
            name: 'Swamp',
            type_line: 'Basic Land — Swamp',
            image_uris: {},
          },
        ],
        handCount: 1,
        graveyard: [],
        graveyardCount: 0,
        exile: [],
        exileCount: 0,
      },
    };

    game.applyEvent({
      type: 'resolveTopOfStackPrompt',
      playerId,
      sourceId: 'venture_oubliette_prompt',
      queuedResolutionStep: {
        id: 'queued_oubliette_discard_1',
        type: ResolutionStepType.DISCARD_SELECTION,
        playerId,
        sourceId: 'venture_oubliette_prompt',
        sourceName: 'Oubliette',
        description: 'Tomb of Annihilation: Oubliette - Discard a card',
        mandatory: true,
        discardCount: 1,
        hand: [
          {
            id: 'discard_card_1',
            name: 'Swamp',
            type_line: 'Basic Land — Swamp',
            image_uris: {},
          },
        ],
        dungeonRoomPayment: {
          dungeonId: 'tomb',
          roomId: 'oubliette',
          paymentType: 'discard',
          sourceName: 'Oubliette',
        },
      },
    } as any);

    expect(ResolutionQueueManager.getQueue(gameId).steps).toHaveLength(1);

    game.applyEvent({
      type: 'discardEffect',
      playerId,
      cardIds: ['discard_card_1'],
      destination: 'graveyard',
      resolvedStepId: 'queued_oubliette_discard_1',
      sourceId: 'venture_oubliette_prompt',
      dungeonRoomPayment: {
        dungeonId: 'tomb',
        roomId: 'oubliette',
        paymentType: 'discard',
        sourceName: 'Oubliette',
      },
    } as any);

    expect(ResolutionQueueManager.getQueue(gameId).steps).toHaveLength(0);
    expect(((game.state as any).zones?.[playerId]?.hand || []).map((card: any) => card.id)).not.toContain('discard_card_1');
    expect(((game.state as any).zones?.[playerId]?.graveyard || []).map((card: any) => card.id)).toContain('discard_card_1');
  });

  it('replays sacrificePermanent by clearing a queued dungeon sacrifice-payment step', () => {
    const gameId = 't_venture_room_sacrifice_payment_replay';

    const game = createInitialGameState(gameId);
    const playerId = 'p1' as PlayerID;
    const creatureId = 'sacrifice_creature_1';
    addPlayer(game, playerId, 'P1');
    (game.state as any).zones = {
      [playerId]: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0 },
    };
    (game.state as any).battlefield = [
      {
        id: creatureId,
        controller: playerId,
        owner: playerId,
        tapped: false,
        card: {
          id: 'sacrifice_creature_card_1',
          name: 'Runeclaw Bear',
          type_line: 'Creature — Bear',
          power: '2',
          toughness: '2',
          image_uris: {},
        },
      },
    ];

    game.applyEvent({
      type: 'resolveTopOfStackPrompt',
      playerId,
      sourceId: 'venture_sandfall_prompt',
      queuedResolutionStep: {
        id: 'queued_sandfall_sacrifice_1',
        type: ResolutionStepType.TARGET_SELECTION,
        playerId,
        sourceId: 'venture_sandfall_prompt',
        sourceName: 'Sandfall Cell',
        description: 'Sandfall Cell: Sacrifice a creature, artifact, or land or lose 2 life',
        mandatory: true,
        validTargets: [
          {
            id: creatureId,
            label: 'Runeclaw Bear',
            description: 'Creature — Bear',
          },
        ],
        targetTypes: ['permanent'],
        minTargets: 1,
        maxTargets: 1,
        targetDescription: 'creature, artifact, or land you control',
        dungeonRoomPayment: {
          dungeonId: 'tomb',
          roomId: 'sandfall_cell',
          paymentType: 'sacrifice',
          sourceName: 'Sandfall Cell',
        },
      },
    } as any);

    expect(ResolutionQueueManager.getQueue(gameId).steps).toHaveLength(1);

    game.applyEvent({
      type: 'sacrificePermanent',
      permanentId: creatureId,
      playerId,
      resolvedStepId: 'queued_sandfall_sacrifice_1',
      sourceId: 'venture_sandfall_prompt',
      dungeonRoomPayment: {
        dungeonId: 'tomb',
        roomId: 'sandfall_cell',
        paymentType: 'sacrifice',
        sourceName: 'Sandfall Cell',
      },
    } as any);

    expect(ResolutionQueueManager.getQueue(gameId).steps).toHaveLength(0);
    expect(((game.state as any).battlefield || []).some((permanent: any) => permanent.id === creatureId)).toBe(false);
    expect(((game.state as any).zones?.[playerId]?.graveyard || []).map((card: any) => card.name)).toContain('Runeclaw Bear');
  });

  it('replays Fungi Cavern target-creature resolution by clearing the queued target prompt and applying the PT modifier', () => {
    const gameId = 't_venture_fungi_target_creature_replay';

    const game = createInitialGameState(gameId);
    const playerId = 'p1' as PlayerID;
    const targetCreatureId = 'fungi_target_replay_1';

    addPlayer(game, playerId, 'P1');
    addPlayer(game, 'p2' as PlayerID, 'P2');
    (game.state as any).turnNumber = 4;
    (game.state as any).battlefield = [
      {
        id: targetCreatureId,
        controller: 'p2',
        owner: 'p2',
        tapped: false,
        card: {
          id: 'fungi_target_replay_card_1',
          name: 'Runeclaw Bear',
          type_line: 'Creature — Bear',
          power: '2',
          toughness: '2',
          image_uris: {},
        },
      },
    ];

    game.applyEvent({
      type: 'ventureChooseRoomResolve',
      playerId,
      dungeonId: 'lost_mine',
      dungeonName: 'Lost Mine of Phandelver',
      roomIndex: 2,
      currentRoomId: 'fungi_cavern',
      currentRoomName: 'Fungi Cavern',
      currentRoomEffect: 'Target creature gets -4/-0 until your next turn.',
      roomPath: ['cave_entrance', 'mine_tunnels', 'fungi_cavern'],
      completed: false,
    } as any);

    game.applyEvent({
      type: 'resolveTopOfStackPrompt',
      playerId,
      sourceId: 'venture_fungi_prompt',
      queuedResolutionStep: {
        id: 'queued_fungi_prompt_1',
        type: ResolutionStepType.TARGET_SELECTION,
        playerId,
        sourceId: 'venture_fungi_prompt',
        sourceName: 'Fungi Cavern',
        description: 'Lost Mine of Phandelver: Fungi Cavern - Choose target creature',
        mandatory: true,
        validTargets: [
          {
            id: targetCreatureId,
            label: 'Runeclaw Bear',
            description: 'Creature — Bear controlled by P2',
          },
        ],
        targetTypes: ['creature'],
        minTargets: 1,
        maxTargets: 1,
        targetDescription: 'target creature',
        dungeonTargetCreatureEffect: {
          dungeonId: 'lost_mine',
          roomId: 'fungi_cavern',
          powerDelta: -4,
          toughnessDelta: 0,
          sourceName: 'Fungi Cavern',
        },
      },
    } as any);

    expect(ResolutionQueueManager.getQueue(gameId).steps).toHaveLength(1);

    game.applyEvent({
      type: 'dungeonTargetCreatureResolve',
      playerId,
      selectedPermanentId: targetCreatureId,
      resolvedStepId: 'queued_fungi_prompt_1',
      sourceId: 'venture_fungi_prompt',
      sourceName: 'Fungi Cavern',
      dungeonId: 'lost_mine',
      currentRoomId: 'fungi_cavern',
      powerDelta: -4,
      toughnessDelta: 0,
    } as any);

    expect(ResolutionQueueManager.getQueue(gameId).steps).toHaveLength(0);
    const targetCreature = ((game.state as any).battlefield || []).find((permanent: any) => permanent.id === targetCreatureId) as any;
    expect(Array.isArray(targetCreature?.untilNextTurnPtMods) ? targetCreature.untilNextTurnPtMods : []).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ power: -4, toughness: 0, controllerId: playerId, turnApplied: 4 }),
      ]),
    );
  });

  it('replays Twisted Caverns target-creature resolution by clearing the queued target prompt and applying the attack restriction', () => {
    const gameId = 't_venture_twisted_target_creature_replay';

    const game = createInitialGameState(gameId);
    const playerId = 'p1' as PlayerID;
    const targetCreatureId = 'twisted_target_replay_1';

    addPlayer(game, playerId, 'P1');
    addPlayer(game, 'p2' as PlayerID, 'P2');
    (game.state as any).turnNumber = 8;
    (game.state as any).battlefield = [
      {
        id: targetCreatureId,
        controller: 'p2',
        owner: 'p2',
        tapped: false,
        card: {
          id: 'twisted_target_replay_card_1',
          name: 'Hill Giant',
          type_line: 'Creature — Giant',
          power: '3',
          toughness: '3',
          image_uris: {},
        },
      },
    ];

    game.applyEvent({
      type: 'ventureChooseRoomResolve',
      playerId,
      dungeonId: 'mad_mage',
      dungeonName: 'Dungeon of the Mad Mage',
      roomIndex: 2,
      currentRoomId: 'twisted_caverns',
      currentRoomName: 'Twisted Caverns',
      currentRoomEffect: "Target creature can't attack until your next turn.",
      roomPath: ['yawning_portal', 'dungeon_level', 'twisted_caverns'],
      completed: false,
    } as any);

    game.applyEvent({
      type: 'resolveTopOfStackPrompt',
      playerId,
      sourceId: 'venture_twisted_prompt',
      queuedResolutionStep: {
        id: 'queued_twisted_prompt_1',
        type: ResolutionStepType.TARGET_SELECTION,
        playerId,
        sourceId: 'venture_twisted_prompt',
        sourceName: 'Twisted Caverns',
        description: 'Dungeon of the Mad Mage: Twisted Caverns - Choose target creature',
        mandatory: true,
        validTargets: [
          {
            id: targetCreatureId,
            label: 'Hill Giant',
            description: 'Creature — Giant controlled by P2',
          },
        ],
        targetTypes: ['creature'],
        minTargets: 1,
        maxTargets: 1,
        targetDescription: 'target creature',
        dungeonTargetCreatureEffect: {
          dungeonId: 'mad_mage',
          roomId: 'twisted_caverns',
          grantText: "This creature can't attack (until your next turn)",
          sourceName: 'Twisted Caverns',
        },
      },
    } as any);

    expect(ResolutionQueueManager.getQueue(gameId).steps).toHaveLength(1);

    game.applyEvent({
      type: 'dungeonTargetCreatureResolve',
      playerId,
      selectedPermanentId: targetCreatureId,
      resolvedStepId: 'queued_twisted_prompt_1',
      sourceId: 'venture_twisted_prompt',
      sourceName: 'Twisted Caverns',
      dungeonId: 'mad_mage',
      currentRoomId: 'twisted_caverns',
      grantText: "This creature can't attack (until your next turn)",
    } as any);

    expect(ResolutionQueueManager.getQueue(gameId).steps).toHaveLength(0);
    const targetCreature = ((game.state as any).battlefield || []).find((permanent: any) => permanent.id === targetCreatureId) as any;
    expect(
      Array.isArray(targetCreature?.grantedAbilities)
        ? targetCreature.grantedAbilities.map((ability: any) => String(ability).toLowerCase())
        : [],
    ).toContain("this creature can't attack (until your next turn)");
    expect(Array.isArray(targetCreature?.untilNextTurnGrants) ? targetCreature.untilNextTurnGrants : []).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ controllerId: playerId, turnApplied: 8, kind: 'cant_attack' }),
      ]),
    );
  });

  it('replays ventureChooseRoomResolve completion by recording completion and clearing active progress', () => {
    const game = createInitialGameState('t_venture_choose_room_complete_replay');
    const playerId = 'p1' as PlayerID;

    addPlayer(game, playerId, 'P1');
    game.libraries!.set(playerId, [
      {
        id: 'replay_draw_1',
        name: 'Replay Draw',
        zone: 'library',
      } as any,
    ]);

    game.applyEvent({
      type: 'ventureChooseRoomResolve',
      playerId,
      dungeonId: 'lost_mine',
      dungeonName: 'Lost Mine of Phandelver',
      roomIndex: 3,
      currentRoomId: 'temple_of_dumathoin',
      currentRoomName: 'Temple of Dumathoin',
      currentRoomEffect: 'Draw a card.',
      roomPath: ['cave_entrance', 'goblin_lair', 'dark_pool', 'temple_of_dumathoin'],
      completed: true,
    } as any);

    expect((((game.state as any).dungeonProgress || {})[playerId])).toBeUndefined();
    expect((((game.state as any).completedDungeons || {})[playerId])).toBe(1);
    expect((((game.state as any).completedDungeonNames || {})[playerId] || [])).toContain('Lost Mine of Phandelver');
    expect((((game.state as any).zones || {})[playerId]?.hand || []).map((card: any) => card.id)).toContain('replay_draw_1');
  });

  it('replays Trap target-player resolution by clearing the queued player prompt and applying life loss', () => {
    const gameId = 't_venture_trap_target_player_replay';

    const game = createInitialGameState(gameId);
    const playerId = 'p1' as PlayerID;
    const targetPlayerId = 'p2' as PlayerID;

    addPlayer(game, playerId, 'P1');
    addPlayer(game, targetPlayerId, 'P2');

    game.applyEvent({
      type: 'ventureChooseRoomResolve',
      playerId,
      dungeonId: 'undercity',
      dungeonName: 'Undercity',
      roomIndex: 2,
      currentRoomId: 'trap',
      currentRoomName: 'Trap!',
      currentRoomEffect: 'Target player loses 5 life.',
      roomPath: ['secret_entrance', 'forge', 'trap'],
      completed: false,
    } as any);

    game.applyEvent({
      type: 'resolveTopOfStackPrompt',
      playerId,
      sourceId: 'venture_trap_prompt',
      queuedResolutionStep: {
        id: 'queued_trap_prompt_1',
        type: ResolutionStepType.PLAYER_CHOICE,
        playerId,
        sourceId: 'venture_trap_prompt',
        sourceName: 'Trap!',
        description: 'Undercity: Trap! - Choose target player',
        mandatory: true,
        players: [playerId, targetPlayerId],
        dungeonTargetPlayerEffect: {
          dungeonId: 'undercity',
          roomId: 'trap',
          amount: 5,
        },
      },
    } as any);

    expect(ResolutionQueueManager.getQueue(gameId).steps).toHaveLength(1);

    game.applyEvent({
      type: 'dungeonTargetPlayerResolve',
      playerId,
      selectedPlayerId: targetPlayerId,
      resolvedStepId: 'queued_trap_prompt_1',
      sourceId: 'venture_trap_prompt',
      sourceName: 'Trap!',
      dungeonId: 'undercity',
      currentRoomId: 'trap',
      amount: 5,
    } as any);

    expect(ResolutionQueueManager.getQueue(gameId).steps).toHaveLength(0);
    expect((((game.state as any).life || {})[targetPlayerId] ?? (game.state as any).players?.find((p: any) => p.id === targetPlayerId)?.life)).toBe(35);
  });

  it('replays Forge target-creature resolution by clearing the queued target prompt and applying counters', () => {
    const gameId = 't_venture_forge_target_creature_replay';

    const game = createInitialGameState(gameId);
    const playerId = 'p1' as PlayerID;
    const targetCreatureId = 'forge_target_replay_1';

    addPlayer(game, playerId, 'P1');
    addPlayer(game, 'p2' as PlayerID, 'P2');
    (game.state as any).battlefield = [
      {
        id: targetCreatureId,
        controller: 'p2',
        owner: 'p2',
        tapped: false,
        card: {
          id: 'forge_target_replay_card_1',
          name: 'Grizzly Bears',
          type_line: 'Creature — Bear',
          power: '2',
          toughness: '2',
          image_uris: {},
        },
      },
    ];

    game.applyEvent({
      type: 'ventureChooseRoomResolve',
      playerId,
      dungeonId: 'undercity',
      dungeonName: 'Undercity',
      roomIndex: 1,
      currentRoomId: 'forge',
      currentRoomName: 'Forge',
      currentRoomEffect: 'Put two +1/+1 counters on target creature.',
      roomPath: ['secret_entrance', 'forge'],
      completed: false,
    } as any);

    game.applyEvent({
      type: 'resolveTopOfStackPrompt',
      playerId,
      sourceId: 'venture_forge_prompt',
      queuedResolutionStep: {
        id: 'queued_forge_prompt_1',
        type: ResolutionStepType.TARGET_SELECTION,
        playerId,
        sourceId: 'venture_forge_prompt',
        sourceName: 'Forge',
        description: 'Undercity: Forge - Choose target creature',
        mandatory: true,
        validTargets: [
          {
            id: targetCreatureId,
            label: 'Grizzly Bears',
            description: 'Creature — Bear controlled by P2',
          },
        ],
        targetTypes: ['creature'],
        minTargets: 1,
        maxTargets: 1,
        targetDescription: 'target creature',
        dungeonTargetCreatureEffect: {
          dungeonId: 'undercity',
          roomId: 'forge',
          amount: 2,
          counterType: '+1/+1',
        },
      },
    } as any);

    expect(ResolutionQueueManager.getQueue(gameId).steps).toHaveLength(1);

    game.applyEvent({
      type: 'dungeonTargetCreatureResolve',
      playerId,
      selectedPermanentId: targetCreatureId,
      resolvedStepId: 'queued_forge_prompt_1',
      sourceId: 'venture_forge_prompt',
      sourceName: 'Forge',
      dungeonId: 'undercity',
      currentRoomId: 'forge',
      amount: 2,
      counterType: '+1/+1',
      goadedByPlayerId: playerId,
    } as any);

    expect(ResolutionQueueManager.getQueue(gameId).steps).toHaveLength(0);
    const targetCreature = ((game.state as any).battlefield || []).find((permanent: any) => permanent.id === targetCreatureId) as any;
    expect(targetCreature?.counters?.['+1/+1']).toBe(2);
  });

  it('replays Arena target-creature resolution by clearing the queued target prompt and applying goad', () => {
    const gameId = 't_venture_arena_target_creature_replay';

    const game = createInitialGameState(gameId);
    const playerId = 'p1' as PlayerID;
    const targetCreatureId = 'arena_target_replay_1';

    addPlayer(game, playerId, 'P1');
    addPlayer(game, 'p2' as PlayerID, 'P2');
    (game.state as any).turnNumber = 7;
    (game.state as any).battlefield = [
      {
        id: targetCreatureId,
        controller: 'p2',
        owner: 'p2',
        tapped: false,
        card: {
          id: 'arena_target_replay_card_1',
          name: 'Hill Giant',
          type_line: 'Creature — Giant',
          power: '3',
          toughness: '3',
          image_uris: {},
        },
      },
    ];

    game.applyEvent({
      type: 'ventureChooseRoomResolve',
      playerId,
      dungeonId: 'undercity',
      dungeonName: 'Undercity',
      roomIndex: 2,
      currentRoomId: 'arena',
      currentRoomName: 'Arena',
      currentRoomEffect: 'Goad target creature.',
      roomPath: ['secret_entrance', 'forge', 'arena'],
      completed: false,
    } as any);

    game.applyEvent({
      type: 'resolveTopOfStackPrompt',
      playerId,
      sourceId: 'venture_arena_prompt',
      queuedResolutionStep: {
        id: 'queued_arena_prompt_1',
        type: ResolutionStepType.TARGET_SELECTION,
        playerId,
        sourceId: 'venture_arena_prompt',
        sourceName: 'Arena',
        description: 'Undercity: Arena - Choose target creature',
        mandatory: true,
        validTargets: [
          {
            id: targetCreatureId,
            label: 'Hill Giant',
            description: 'Creature — Giant controlled by P2',
          },
        ],
        targetTypes: ['creature'],
        minTargets: 1,
        maxTargets: 1,
        targetDescription: 'target creature',
        dungeonTargetCreatureEffect: {
          dungeonId: 'undercity',
          roomId: 'arena',
        },
      },
    } as any);

    expect(ResolutionQueueManager.getQueue(gameId).steps).toHaveLength(1);

    game.applyEvent({
      type: 'dungeonTargetCreatureResolve',
      playerId,
      selectedPermanentId: targetCreatureId,
      resolvedStepId: 'queued_arena_prompt_1',
      sourceId: 'venture_arena_prompt',
      sourceName: 'Arena',
      dungeonId: 'undercity',
      currentRoomId: 'arena',
      goadedByPlayerId: playerId,
    } as any);

    expect(ResolutionQueueManager.getQueue(gameId).steps).toHaveLength(0);
    const targetCreature = ((game.state as any).battlefield || []).find((permanent: any) => permanent.id === targetCreatureId) as any;
    expect(Array.isArray(targetCreature?.goadedBy) ? targetCreature.goadedBy : []).toContain(playerId);
    expect((targetCreature?.goadedUntil || {})[playerId]).toBe(8);
  });
});