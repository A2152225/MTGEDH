import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import type { PlayerID } from '../../shared/src/index.js';
import GameManager from '../src/GameManager.js';
import { createGameIfNotExists, deleteGame, initDb } from '../src/db/index.js';
import { games } from '../src/socket/socket.js';
import { ensureGame } from '../src/socket/util.js';
import { movePermanentToGraveyard } from '../src/state/modules/counters_tokens.js';
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

  it('replays Fervent Paincaster exert damage activations with selected targets intact', () => {
    const gameId = createGameId();
    trackedGameIds.add(gameId);
    const playerId = 'p1' as PlayerID;
    const opponentId = 'p2' as PlayerID;
    const game = seedGame(gameId, playerId, opponentId);

    (game.state as any).battlefield = [
      {
        id: 'fervent_paincaster',
        controller: playerId,
        owner: playerId,
        tapped: false,
        summoningSickness: false,
        counters: {},
        basePower: 3,
        baseToughness: 1,
        card: {
          id: 'fervent_paincaster_card',
          name: 'Fervent Paincaster',
          type_line: 'Creature — Human Wizard',
          oracle_text: '{T}: This creature deals 1 damage to target player or planeswalker.\n{T}, Exert this creature: It deals 1 damage to target creature. (An exerted creature won\'t untap during your next untap step.)',
          power: '3',
          toughness: '1',
        },
      },
      createCreature(
        'target_creature',
        opponentId,
        'Target Creature',
        '',
        1,
        1,
      ),
    ];

    game.applyEvent({
      type: 'activateBattlefieldAbility',
      playerId,
      permanentId: 'fervent_paincaster',
      abilityId: 'fervent_paincaster-ability-1',
      cardName: 'Fervent Paincaster',
      abilityText: "It deals 1 damage to target creature. (An exerted creature won't untap during your next untap step.)",
      activatedAbilityText: "{T}, Exert this creature: It deals 1 damage to target creature. (An exerted creature won't untap during your next untap step.)",
      targets: ['target_creature'],
      tappedPermanents: ['fervent_paincaster'],
      exertedPermanentIdForCost: 'fervent_paincaster',
    } as any);

    const paincaster = ((game.state as any).battlefield || []).find((permanent: any) => permanent?.id === 'fervent_paincaster') as any;
    expect(paincaster?.tapped).toBe(true);
    expect(paincaster?.doesntUntapNextTurn).toBe(true);
    expect(paincaster?.exertedThisTurn).toBe(true);
    expect((((game.state as any).stack || []) as any[])).toHaveLength(1);

    game.applyEvent({ type: 'resolveTopOfStack' } as any);

    const targetCreature = (((game.state as any).battlefield || []) as any[]).find((permanent: any) => permanent?.id === 'target_creature') as any;
    expect(targetCreature).toBeDefined();
    expect(Number(targetCreature?.damageMarked || 0)).toBe(1);
    expect(Number(targetCreature?.markedDamage || 0)).toBe(0);
  });

  it('replays Pride Sovereign exert token creation with lifelink cats intact', () => {
    const gameId = createGameId();
    trackedGameIds.add(gameId);
    const playerId = 'p1' as PlayerID;
    const opponentId = 'p2' as PlayerID;
    const game = seedGame(gameId, playerId, opponentId);

    (game.state as any).battlefield = [
      {
        id: 'pride_sovereign',
        controller: playerId,
        owner: playerId,
        tapped: false,
        summoningSickness: false,
        counters: {},
        basePower: 2,
        baseToughness: 2,
        card: {
          id: 'pride_sovereign_card',
          name: 'Pride Sovereign',
          type_line: 'Creature — Cat',
          oracle_text: 'This creature gets +1/+1 for each other Cat you control.\n{W}, {T}, Exert this creature: Create two 1/1 white Cat creature tokens with lifelink. (An exerted creature won\'t untap during your next untap step.)',
          power: '2',
          toughness: '2',
        },
      },
    ];

    game.applyEvent({
      type: 'activateBattlefieldAbility',
      playerId,
      permanentId: 'pride_sovereign',
      abilityId: 'pride_sovereign-ability-0',
      cardName: 'Pride Sovereign',
      abilityText: 'Create two 1/1 white Cat creature tokens with lifelink. (An exerted creature won\'t untap during your next untap step.)',
      activatedAbilityText: '{W}, {T}, Exert this creature: Create two 1/1 white Cat creature tokens with lifelink. (An exerted creature won\'t untap during your next untap step.)',
      usesStack: true,
      tappedPermanents: ['pride_sovereign'],
      exertedPermanentIdForCost: 'pride_sovereign',
    } as any);

    const sovereign = ((game.state as any).battlefield || []).find((permanent: any) => permanent?.id === 'pride_sovereign') as any;
    expect(sovereign?.tapped).toBe(true);
    expect(sovereign?.doesntUntapNextTurn).toBe(true);
    expect(sovereign?.exertedThisTurn).toBe(true);
    expect((((game.state as any).stack || []) as any[])).toHaveLength(1);

    game.applyEvent({ type: 'resolveTopOfStack' } as any);

    const catTokens = (((game.state as any).battlefield || []) as any[]).filter((permanent: any) =>
      permanent?.id !== 'pride_sovereign' &&
      String(permanent?.card?.type_line || '').toLowerCase().includes('cat'),
    );
    expect(catTokens).toHaveLength(2);
    for (const token of catTokens) {
      expect((token?.card?.keywords || []).map((entry: any) => String(entry))).toContain('Lifelink');
    }
  });

  it('replays Angel of Condemnation exert exile activations with return-on-leave intact', () => {
    const gameId = createGameId();
    trackedGameIds.add(gameId);
    const playerId = 'p1' as PlayerID;
    const opponentId = 'p2' as PlayerID;
    const game = seedGame(gameId, playerId, opponentId);

    (game.state as any).battlefield = [
      {
        id: 'angel_of_condemnation',
        controller: playerId,
        owner: playerId,
        tapped: false,
        summoningSickness: false,
        counters: {},
        basePower: 3,
        baseToughness: 3,
        card: {
          id: 'angel_of_condemnation_card',
          name: 'Angel of Condemnation',
          type_line: 'Creature — Angel',
          oracle_text: 'Flying, vigilance\n{2}{W}, {T}: Exile another target creature. Return that card to the battlefield under its owner\'s control at the beginning of the next end step.\n{2}{W}, {T}, Exert this creature: Exile another target creature until this creature leaves the battlefield. (An exerted creature won\'t untap during your next untap step.)',
          power: '3',
          toughness: '3',
        },
      },
      createCreature(
        'target_creature',
        opponentId,
        'Target Creature',
        '',
        2,
        2,
      ),
    ];

    game.applyEvent({
      type: 'activateBattlefieldAbility',
      playerId,
      permanentId: 'angel_of_condemnation',
      abilityId: 'angel_of_condemnation-ability-1',
      cardName: 'Angel of Condemnation',
      abilityText: "Exile another target creature until this creature leaves the battlefield. (An exerted creature won't untap during your next untap step.)",
      activatedAbilityText: "{2}{W}, {T}, Exert this creature: Exile another target creature until this creature leaves the battlefield. (An exerted creature won't untap during your next untap step.)",
      targets: ['target_creature'],
      tappedPermanents: ['angel_of_condemnation'],
      exertedPermanentIdForCost: 'angel_of_condemnation',
    } as any);

    const angel = ((game.state as any).battlefield || []).find((permanent: any) => permanent?.id === 'angel_of_condemnation') as any;
    expect(angel?.tapped).toBe(true);
    expect(angel?.doesntUntapNextTurn).toBe(true);
    expect(angel?.exertedThisTurn).toBe(true);
    expect((((game.state as any).stack || []) as any[])).toHaveLength(1);

    game.applyEvent({ type: 'resolveTopOfStack' } as any);

    const battlefieldAfterExile = ((game.state as any).battlefield || []) as any[];
    expect(battlefieldAfterExile.some((permanent: any) => permanent?.id === 'target_creature')).toBe(false);
    expect((((game.state as any).zones?.[opponentId]?.exile || []) as any[]).some((card: any) => String(card?.name || '') === 'Target Creature')).toBe(true);
    expect(((game.state as any).linkedExiles || [])).toEqual([
      expect.objectContaining({
        exilingPermanentId: 'angel_of_condemnation',
        exiledCardName: 'Target Creature',
        originalOwner: opponentId,
      }),
    ]);

    expect(movePermanentToGraveyard(game as any, 'angel_of_condemnation')).toBe(true);

    const battlefieldAfterReturn = ((game.state as any).battlefield || []) as any[];
    const returnedCreature = battlefieldAfterReturn.find((permanent: any) => String(permanent?.card?.name || '') === 'Target Creature') as any;
    expect(returnedCreature).toBeDefined();
    expect(String(returnedCreature?.controller || '')).toBe(opponentId);
    expect(((game.state as any).linkedExiles || [])).toEqual([]);
  });
});