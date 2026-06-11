import { describe, expect, it } from 'vitest';

import { createInitialGameState } from '../src/state/gameState.js';
import { movePermanentToGraveyard } from '../src/state/modules/counters_tokens.js';
import { executeTriggerEffect } from '../src/state/modules/stackExecuteTriggerEffectUtils.js';
import { handleElixirShuffle } from '../src/state/modules/zone-manipulation.js';
import { movePermanentToHand, movePermanentToLibrary } from '../src/state/modules/zones.js';
import { replay as replayEvents } from '../src/state/modules/replay.js';
import { chooseAIReturnControlledPermanentId, handleBounceLandETB } from '../src/socket/ai.js';
import { evaluateReplacementEvent } from '../src/state/modules/replacement-effects.js';

function createBaseGame(gameId: string) {
  const game = createInitialGameState(gameId);
  const playerId = 'p1';
  const opponentId = 'p2';

  game.applyEvent({ type: 'join', playerId, name: 'P1' } as any);
  game.applyEvent({ type: 'join', playerId: opponentId, name: 'P2' } as any);
  (game.state as any).startingLife = 40;
  (game.state as any).life = { [playerId]: 40, [opponentId]: 40 };
  (game.state as any).zones = {
    [playerId]: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0, library: [], libraryCount: 0 },
    [opponentId]: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0, library: [], libraryCount: 0 },
  };
  (game.state as any).battlefield = [];
  game.libraries.set(playerId as any, []);
  game.libraries.set(opponentId as any, []);

  return game;
}

function replacementCreature(id: string, name = 'Replacement Creature') {
  return {
    id,
    controller: 'p1',
    owner: 'p1',
    tapped: false,
    leaveBattlefieldReplacementDestination: 'exile',
    card: {
      id: `${id}_card`,
      name,
      type_line: 'Creature - Spirit',
      oracle_text: 'If this creature would leave the battlefield, exile it instead of putting it anywhere else.',
      power: '2',
      toughness: '2',
      leaveBattlefieldReplacementDestination: 'exile',
    },
  };
}

function landPermanent(id: string, name: string, replacement = false) {
  return {
    id,
    controller: 'p1',
    owner: 'p1',
    tapped: false,
    ...(replacement ? { leaveBattlefieldReplacementDestination: 'exile' } : {}),
    card: {
      id: `${id}_card`,
      name,
      type_line: 'Land',
      oracle_text: replacement ? 'If this permanent would leave the battlefield, exile it instead of putting it anywhere else.' : '{T}: Add {W}.',
      ...(replacement ? { leaveBattlefieldReplacementDestination: 'exile' } : {}),
    },
  };
}

function tokenPermanent(id: string, name = 'Spirit Token') {
  return {
    id,
    controller: 'p1',
    owner: 'p1',
    tapped: false,
    isToken: true,
    card: {
      id: `${id}_card`,
      name,
      type_line: 'Token Creature - Spirit',
      oracle_text: '',
      power: '1',
      toughness: '1',
    },
  };
}

function zoneIds(game: any, playerId: string, zoneName: 'graveyard' | 'exile') {
  return (((game.state as any).zones?.[playerId]?.[zoneName] || []) as any[]).map((card: any) => String(card?.id || ''));
}

describe('leave-battlefield replacement helper convergence', () => {
  it('evaluates leave-battlefield replacement events with replayable outcome metadata', () => {
    const permanent = {
      ...replacementCreature('replacement_event_1', 'Marked Traveler'),
      leaveBattlefieldReplacementSourceName: 'Serra Paragon',
      leaveBattlefieldReplacementLifeGain: 2,
    };

    const result = evaluateReplacementEvent({
      type: 'zone-change',
      object: permanent,
      objectId: permanent.id,
      sourceZone: 'battlefield',
      destinationZone: 'graveyard',
      controller: 'p1',
      owner: 'p1',
      cause: 'destroy',
    });

    expect(result).toMatchObject({
      applied: true,
      eventType: 'zone-change',
      effectId: 'leave-battlefield-exile-instead',
      sourceName: 'Serra Paragon',
      originalDestination: 'graveyard',
      replacementDestination: 'exile',
      lifeGain: 2,
      reason: 'explicit_leave_battlefield_replacement',
    });
  });

  it('evaluates zone changes without replacement as explicit not-applied results', () => {
    const result = evaluateReplacementEvent({
      type: 'zone-change',
      object: landPermanent('ordinary_land_event_1', 'Ordinary Plains'),
      objectId: 'ordinary_land_event_1',
      sourceZone: 'battlefield',
      destinationZone: 'hand',
      controller: 'p1',
      owner: 'p1',
    });

    expect(result).toMatchObject({
      applied: false,
      eventType: 'zone-change',
      originalDestination: 'hand',
      replacementDestination: 'hand',
    });
  });

  it('evaluates ordinary token battlefield exits as explicit cease-to-exist results', () => {
    const result = evaluateReplacementEvent({
      type: 'zone-change',
      object: tokenPermanent('token_event_1'),
      objectId: 'token_event_1',
      sourceZone: 'battlefield',
      destinationZone: 'hand',
      controller: 'p1',
      owner: 'p1',
      cause: 'bounce',
    });

    expect(result).toMatchObject({
      applied: true,
      eventType: 'zone-change',
      effectId: 'token-ceases-to-exist',
      originalDestination: 'hand',
      reason: 'token_left_battlefield',
      metadata: { ceasesToExist: true },
    });
    expect(result.replacementDestination).toBeUndefined();
  });

  it('exiles replacement permanents destroyed by state-based lethal damage', () => {
    const game = createBaseGame('lbr_sba_lethal');
    const permanent = replacementCreature('replacement_creature_1');
    (permanent as any).damageMarked = 2;
    (game.state as any).battlefield = [permanent];

    game.runSBA();

    expect(((game.state as any).battlefield || []).some((entry: any) => entry?.id === 'replacement_creature_1')).toBe(false);
    expect(zoneIds(game, 'p1', 'graveyard')).not.toContain('replacement_creature_1_card');
    expect(zoneIds(game, 'p1', 'exile')).toContain('replacement_creature_1_card');
  });

  it('exiles replacement permanents removed by the legend rule', () => {
    const game = createBaseGame('lbr_legend_rule');
    (game.state as any).battlefield = [
      {
        ...replacementCreature('legendary_replacement_1', 'Mirror Legend'),
        card: {
          ...replacementCreature('legendary_replacement_1', 'Mirror Legend').card,
          type_line: 'Legendary Creature - Spirit',
        },
      },
      {
        ...replacementCreature('legendary_replacement_2', 'Mirror Legend'),
        card: {
          ...replacementCreature('legendary_replacement_2', 'Mirror Legend').card,
          type_line: 'Legendary Creature - Spirit',
        },
      },
    ];

    game.runSBA();

    const battlefieldCopies = (((game.state as any).battlefield || []) as any[]).filter((entry: any) => String(entry?.card?.name || '') === 'Mirror Legend');
    expect(battlefieldCopies).toHaveLength(1);
    expect(zoneIds(game, 'p1', 'graveyard')).toHaveLength(0);
    expect(zoneIds(game, 'p1', 'exile')).toHaveLength(1);
  });

  it('exiles replacement permanents instead of shuffling them into the library with Elixir-style self shuffle', () => {
    const game = createBaseGame('lbr_elixir_self_shuffle');
    (game.state as any).battlefield = [
      {
        id: 'self_shuffle_perm_1',
        controller: 'p1',
        owner: 'p1',
        tapped: false,
        leaveBattlefieldReplacementDestination: 'exile',
        card: {
          id: 'self_shuffle_card_1',
          name: 'Self-Shuffling Relic',
          type_line: 'Artifact',
          oracle_text: 'If this artifact would leave the battlefield, exile it instead of putting it anywhere else.',
          leaveBattlefieldReplacementDestination: 'exile',
        },
      },
    ];
    (game.state as any).zones.p1.graveyard = [{ id: 'graveyard_card_1', name: 'Graveyard Card', type_line: 'Creature', zone: 'graveyard' }];
    (game.state as any).zones.p1.graveyardCount = 1;

    const shuffledCount = handleElixirShuffle(game as any, 'p1', 'self_shuffle_perm_1');

    expect(shuffledCount).toBe(1);
    expect(((game.state as any).battlefield || []).some((entry: any) => entry?.id === 'self_shuffle_perm_1')).toBe(false);
    expect((game.libraries.get('p1' as any) || []).map((card: any) => String(card?.id || ''))).toContain('graveyard_card_1');
    expect((game.libraries.get('p1' as any) || []).map((card: any) => String(card?.id || ''))).not.toContain('self_shuffle_card_1');
    expect(zoneIds(game, 'p1', 'exile')).toContain('self_shuffle_card_1');
  });

  it('exiles replacement permanents sacrificed by unknown-game upkeep fallback', () => {
    const game = createBaseGame('lbr_unknown_upkeep_sacrifice');
    (game.state as any).battlefield = [
      {
        id: 'upkeep_source_1',
        controller: 'p1',
        owner: 'p1',
        tapped: false,
        leaveBattlefieldReplacementDestination: 'exile',
        card: {
          id: 'upkeep_source_card_1',
          name: 'Demanding Monument',
          type_line: 'Artifact',
          oracle_text: "At the beginning of your upkeep, sacrifice a creature. If you can't, sacrifice Demanding Monument.",
          leaveBattlefieldReplacementDestination: 'exile',
        },
      },
    ];
    const ctx = {
      state: game.state,
      libraries: game.libraries,
      commandZone: (game as any).commandZone,
      bumpSeq: () => game.bumpSeq(),
    } as any;

    executeTriggerEffect(
      ctx,
      'p1' as any,
      'Demanding Monument',
      "At the beginning of your upkeep, sacrifice a creature. If you can't, sacrifice Demanding Monument.",
      { source: 'upkeep_source_1', triggerType: 'sacrifice_creature_or_self' },
    );

    expect(((game.state as any).battlefield || []).some((entry: any) => entry?.id === 'upkeep_source_1')).toBe(false);
    expect(zoneIds(game, 'p1', 'graveyard')).not.toContain('upkeep_source_card_1');
    expect(zoneIds(game, 'p1', 'exile')).toContain('upkeep_source_card_1');
  });

  it('exiles replacement permanents removed through the generic removePermanent event', () => {
    const game = createBaseGame('lbr_remove_permanent_event');
    (game.state as any).battlefield = [replacementCreature('remove_event_perm_1', 'Remove Event Creature')];

    game.applyEvent({ type: 'removePermanent', permanentId: 'remove_event_perm_1' } as any);

    expect(((game.state as any).battlefield || []).some((entry: any) => entry?.id === 'remove_event_perm_1')).toBe(false);
    expect(zoneIds(game, 'p1', 'graveyard')).not.toContain('remove_event_perm_1_card');
    expect(zoneIds(game, 'p1', 'exile')).toContain('remove_event_perm_1_card');
  });

  it('replays generic removePermanent replacement outcomes deterministically', () => {
    const game = createBaseGame('lbr_remove_permanent_replay');
    (game.state as any).battlefield = [replacementCreature('remove_replay_perm_1', 'Remove Replay Creature')];

    replayEvents(game as any, [{ type: 'removePermanent', permanentId: 'remove_replay_perm_1' } as any]);

    expect(((game.state as any).battlefield || []).some((entry: any) => entry?.id === 'remove_replay_perm_1')).toBe(false);
    expect(zoneIds(game, 'p1', 'graveyard')).not.toContain('remove_replay_perm_1_card');
    expect(zoneIds(game, 'p1', 'exile')).toContain('remove_replay_perm_1_card');
  });

  it('does not put non-replacement tokens into a library', () => {
    const game = createBaseGame('lbr_token_library');
    (game.state as any).battlefield = [tokenPermanent('token_perm_1')];

    expect(movePermanentToLibrary(game as any, 'token_perm_1', 'top')).toBe(true);

    expect(((game.state as any).battlefield || []).some((entry: any) => entry?.id === 'token_perm_1')).toBe(false);
    expect((game.libraries.get('p1' as any) || []).map((card: any) => String(card?.id || ''))).not.toContain('token_perm_1_card');
    expect(zoneIds(game, 'p1', 'graveyard')).not.toContain('token_perm_1_card');
    expect(zoneIds(game, 'p1', 'exile')).not.toContain('token_perm_1_card');
  });

  it('does not put non-replacement tokens into hand or graveyard', () => {
    const handGame = createBaseGame('lbr_token_hand');
    (handGame.state as any).battlefield = [tokenPermanent('token_perm_hand_1')];

    expect(movePermanentToHand(handGame as any, 'token_perm_hand_1')).toBe(true);
    expect(((handGame.state as any).battlefield || []).some((entry: any) => entry?.id === 'token_perm_hand_1')).toBe(false);
    expect((((handGame.state as any).zones?.p1?.hand || []) as any[]).map((card: any) => String(card?.id || ''))).not.toContain('token_perm_hand_1_card');

    const graveyardGame = createBaseGame('lbr_token_graveyard');
    (graveyardGame.state as any).battlefield = [tokenPermanent('token_perm_graveyard_1')];

    expect(movePermanentToGraveyard(graveyardGame as any, 'token_perm_graveyard_1')).toBe(true);
    expect(((graveyardGame.state as any).battlefield || []).some((entry: any) => entry?.id === 'token_perm_graveyard_1')).toBe(false);
    expect(zoneIds(graveyardGame, 'p1', 'graveyard')).not.toContain('token_perm_graveyard_1_card');
  });

  it('AI return-controlled-permanent choices prefer normal hand returns over exile replacement', () => {
    const game = createBaseGame('lbr_ai_return_choice');
    (game.state as any).battlefield = [
      landPermanent('replacement_land_1', 'Replacement Plains', true),
      landPermanent('normal_land_1', 'Ordinary Plains'),
    ];

    const selected = chooseAIReturnControlledPermanentId(game as any, 'p1' as any, {
      sourceId: 'bounce_land_1',
      returnControlledPermanentOptions: [
        { permanentId: 'replacement_land_1', cardName: 'Replacement Plains', leaveBattlefieldReplacementDestination: 'exile' },
        { permanentId: 'normal_land_1', cardName: 'Ordinary Plains' },
      ],
    });

    expect(selected).toBe('normal_land_1');
  });

  it('AI bounce-land automation returns a normal land before an exile-replacement land', async () => {
    const game = createBaseGame('lbr_ai_bounce_land');
    (game.state as any).battlefield = [
      landPermanent('replacement_land_2', 'Replacement Plains', true),
      landPermanent('normal_land_2', 'Ordinary Plains'),
      landPermanent('bounce_land_2', 'Azorius Chancery'),
    ];

    await handleBounceLandETB(game as any, 'p1' as any, 'Azorius Chancery');

    expect(((game.state as any).battlefield || []).some((entry: any) => entry?.id === 'replacement_land_2')).toBe(true);
    expect(((game.state as any).battlefield || []).some((entry: any) => entry?.id === 'normal_land_2')).toBe(false);
    expect((((game.state as any).zones?.p1?.hand || []) as any[]).map((card: any) => String(card?.id || ''))).toContain('normal_land_2_card');
    expect(zoneIds(game, 'p1', 'exile')).not.toContain('replacement_land_2_card');
  });
});