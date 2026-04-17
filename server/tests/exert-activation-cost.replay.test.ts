import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import type { PlayerID } from '../../shared/src/index.js';
import GameManager from '../src/GameManager.js';
import { createGameIfNotExists, deleteGame, initDb } from '../src/db/index.js';
import { games } from '../src/socket/socket.js';
import { ensureGame } from '../src/socket/util.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';

async function resetGame(gameId: string) {
  ResolutionQueueManager.removeQueue(gameId);
  GameManager.deleteGame(gameId);
  games.delete(gameId as any);
  await deleteGame(gameId);
}

function seedGame(gameId: string, playerId: string, opponentId: string) {
  createGameIfNotExists(gameId, 'commander', 40);
  const game = ensureGame(gameId);
  if (!game) throw new Error('ensureGame returned undefined');

  (game as any).gameId = gameId;
  (game.state as any).players = [
    { id: playerId, name: 'P1', spectator: false, life: 40 },
    { id: opponentId, name: 'P2', spectator: false, life: 40 },
  ];
  (game.state as any).life = { [playerId]: 40, [opponentId]: 40 };
  (game.state as any).turnPlayer = playerId;
  (game.state as any).activePlayer = playerId;
  (game.state as any).priority = playerId;
  (game.state as any).phase = 'main';
  (game.state as any).step = 'main1';
  (game.state as any).turn = 1;
  (game.state as any).turnNumber = 1;
  (game.state as any).stack = [];
  (game.state as any).battlefield = [];
  (game.state as any).manaPool = {
    [playerId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    [opponentId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
  };
  (game.state as any).zones = {
    [playerId]: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0, library: [], libraryCount: 0 },
    [opponentId]: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0, library: [], libraryCount: 0 },
  };

  return game;
}

function createCreature(
  id: string,
  controller: string,
  name: string,
  oracleText: string,
  power: number,
  toughness: number,
) {
  return {
    id,
    controller,
    owner: controller,
    tapped: false,
    summoningSickness: false,
    counters: {},
    basePower: power,
    baseToughness: toughness,
    card: {
      id: `${id}_card`,
      name,
      type_line: 'Creature - Warrior',
      oracle_text: oracleText,
      power: String(power),
      toughness: String(toughness),
    },
  };
}

describe('activated exert costs replay coverage', () => {
  const trackedGameIds = new Set<string>();
  const createGameId = () => `exert_activation_replay_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  beforeAll(async () => {
    await initDb();
  });

  afterEach(async () => {
    for (const gameId of trackedGameIds) {
      await resetGame(gameId);
    }
    trackedGameIds.clear();
  });

  it('replays activated exert costs and persisted whenever-you-exert watchers deterministically', () => {
    const gameId = createGameId();
    trackedGameIds.add(gameId);
    const playerId = 'p1' as PlayerID;
    const opponentId = 'p2' as PlayerID;
    const game = seedGame(gameId, playerId, opponentId);

    (game.state as any).battlefield = [
      createCreature(
        'steward_of_solidarity',
        playerId,
        'Steward of Solidarity',
        '{T}, Exert this creature: Create a 1/1 white Warrior creature token with vigilance.',
        2,
        2,
      ),
      createCreature(
        'trueheart_twins',
        playerId,
        'Trueheart Twins',
        "You may exert this creature as it attacks. (It won't untap during your next untap step.)\nWhenever you exert a creature, creatures you control get +1/+0 until end of turn.",
        4,
        4,
      ),
    ];

    game.applyEvent({
      type: 'activateBattlefieldAbility',
      playerId,
      permanentId: 'steward_of_solidarity',
      abilityId: 'steward_of_solidarity-ability-0',
      cardName: 'Steward of Solidarity',
      abilityText: 'Create a 1/1 white Warrior creature token with vigilance.',
      activatedAbilityText: '{T}, Exert this creature: Create a 1/1 white Warrior creature token with vigilance.',
      usesStack: true,
      tappedPermanents: ['steward_of_solidarity'],
      exertedPermanentIdForCost: 'steward_of_solidarity',
    } as any);

    const steward = ((game.state as any).battlefield || []).find((permanent: any) => permanent?.id === 'steward_of_solidarity') as any;
    expect(steward?.tapped).toBe(true);
    expect(steward?.doesntUntapNextTurn).toBe(true);
    expect(steward?.exertedThisTurn).toBe(true);
    expect((((game.state as any).stack || []) as any[])).toHaveLength(1);

    game.applyEvent({
      type: 'pushTriggeredAbility',
      triggerId: 'steward_exert_watcher_replay',
      sourceId: 'trueheart_twins',
      permanentId: 'trueheart_twins',
      sourceName: 'Trueheart Twins',
      controllerId: playerId,
      description: 'creatures you control get +1/+0 until end of turn.',
      triggerType: 'whenever_you_exert',
      effect: 'creatures you control get +1/+0 until end of turn.',
      mandatory: true,
      card: { ...((game.state as any).battlefield[1] as any).card },
    } as any);

    expect((((game.state as any).stack || []) as any[])).toHaveLength(2);

    game.applyEvent({ type: 'resolveTopOfStack' } as any);

    const twins = ((game.state as any).battlefield || []).find((permanent: any) => permanent?.id === 'trueheart_twins') as any;
    expect(steward.temporaryPTMods).toEqual([
      expect.objectContaining({ power: 1, toughness: 0, expiresAt: 'end_of_turn' }),
    ]);
    expect(twins.temporaryPTMods).toEqual([
      expect.objectContaining({ power: 1, toughness: 0, expiresAt: 'end_of_turn' }),
    ]);

    game.applyEvent({ type: 'resolveTopOfStack' } as any);

    const warriorToken = ((game.state as any).battlefield || []).find((permanent: any) =>
      permanent?.id !== 'steward_of_solidarity' &&
      permanent?.id !== 'trueheart_twins' &&
      String(permanent?.card?.type_line || '').toLowerCase().includes('warrior'),
    ) as any;
    expect(warriorToken).toBeDefined();
    expect((warriorToken.card.keywords || []).map((entry: any) => String(entry))).toContain('Vigilance');
  });

  it('replays queued battlefield mana prompts with deferred exert metadata intact', () => {
    const gameId = createGameId();
    trackedGameIds.add(gameId);
    const playerId = 'p1' as PlayerID;
    const opponentId = 'p2' as PlayerID;
    const game = seedGame(gameId, playerId, opponentId);

    (game.state as any).battlefield = [
      createCreature(
        'oasis_ritualist',
        playerId,
        'Oasis Ritualist',
        "{T}: Add one mana of any color.\n{T}, Exert this creature: Add two mana of any one color. (An exerted creature won't untap during your next untap step.)",
        2,
        4,
      ),
    ];

    game.applyEvent({
      type: 'activateBattlefieldAbility',
      playerId,
      permanentId: 'oasis_ritualist',
      abilityId: 'oasis_ritualist-ability-1',
      cardName: 'Oasis Ritualist',
      abilityText: 'Add two mana of any one color.',
      activatedAbilityText: "{T}, Exert this creature: Add two mana of any one color. (An exerted creature won't untap during your next untap step.)",
      tappedPermanents: ['oasis_ritualist'],
      queuedResolutionStep: {
        id: 'oasis_ritualist_choice',
        type: ResolutionStepType.MANA_COLOR_SELECTION,
        playerId,
        sourceId: 'oasis_ritualist',
        sourceName: 'Oasis Ritualist',
        description: "Choose a color for Oasis Ritualist's mana.",
        mandatory: true,
        selectionKind: 'any_color',
        permanentId: 'oasis_ritualist',
        abilityId: 'oasis_ritualist-ability-1',
        cardName: 'Oasis Ritualist',
        abilityText: 'Add two mana of any one color.',
        activatedAbilityText: "{T}, Exert this creature: Add two mana of any one color. (An exerted creature won't untap during your next untap step.)",
        amount: 2,
        allowedColors: ['W', 'U', 'B', 'R', 'G'],
        tappedPermanentsForCost: ['oasis_ritualist'],
        requiresSelfExertForCost: true,
      },
    } as any);

    const steps = ResolutionQueueManager.getStepsForPlayer(gameId, playerId);
    expect(steps).toHaveLength(1);
    expect(steps[0]).toEqual(expect.objectContaining({
      type: ResolutionStepType.MANA_COLOR_SELECTION,
      permanentId: 'oasis_ritualist',
      requiresSelfExertForCost: true,
    }));

    const ritualist = ((game.state as any).battlefield || []).find((permanent: any) => permanent?.id === 'oasis_ritualist') as any;
    expect(ritualist?.tapped).toBe(true);
  });

  it('replays stacked Hope Tender exert activations with selected lands intact', () => {
    const gameId = createGameId();
    trackedGameIds.add(gameId);
    const playerId = 'p1' as PlayerID;
    const opponentId = 'p2' as PlayerID;
    const game = seedGame(gameId, playerId, opponentId);

    (game.state as any).battlefield = [
      createCreature(
        'hope_tender',
        playerId,
        'Hope Tender',
        "{1}, {T}: Untap target land.\n{1}, {T}, Exert this creature: Untap two target lands. (An exerted creature won't untap during your next untap step.)",
        2,
        2,
      ),
      {
        id: 'forest_a',
        controller: playerId,
        owner: playerId,
        tapped: true,
        card: { id: 'forest_a_card', name: 'Forest A', type_line: 'Basic Land — Forest', oracle_text: '' },
      },
      {
        id: 'forest_b',
        controller: playerId,
        owner: playerId,
        tapped: true,
        card: { id: 'forest_b_card', name: 'Forest B', type_line: 'Basic Land — Forest', oracle_text: '' },
      },
    ];

    game.applyEvent({
      type: 'activateBattlefieldAbility',
      playerId,
      permanentId: 'hope_tender',
      abilityId: 'hope_tender-ability-1',
      cardName: 'Hope Tender',
      abilityText: "Untap two target lands. (An exerted creature won't untap during your next untap step.)",
      activatedAbilityText: "{1}, {T}, Exert this creature: Untap two target lands. (An exerted creature won't untap during your next untap step.)",
      targets: ['forest_a', 'forest_b'],
      tappedPermanents: ['hope_tender'],
      exertedPermanentIdForCost: 'hope_tender',
      tapUntapAction: 'untap',
    } as any);

    const stack = (((game.state as any).stack || []) as any[]);
    expect(stack).toHaveLength(1);
    expect(stack[0]).toEqual(expect.objectContaining({
      source: 'hope_tender',
      description: "Untap two target lands. (An exerted creature won't untap during your next untap step.)",
      targets: ['forest_a', 'forest_b'],
      tapUntapAction: 'untap',
    }));

    const hopeTender = ((game.state as any).battlefield || []).find((permanent: any) => permanent?.id === 'hope_tender') as any;
    const forestA = ((game.state as any).battlefield || []).find((permanent: any) => permanent?.id === 'forest_a') as any;
    const forestB = ((game.state as any).battlefield || []).find((permanent: any) => permanent?.id === 'forest_b') as any;
    expect(hopeTender?.tapped).toBe(true);
    expect(hopeTender?.doesntUntapNextTurn).toBe(true);
    expect(hopeTender?.exertedThisTurn).toBe(true);
    expect(forestA?.tapped).toBe(true);
    expect(forestB?.tapped).toBe(true);

    game.applyEvent({ type: 'resolveTopOfStack' } as any);

    expect(forestA?.tapped).toBe(false);
    expect(forestB?.tapped).toBe(false);
  });
});