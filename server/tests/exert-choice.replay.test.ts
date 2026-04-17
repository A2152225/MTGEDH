import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import type { PlayerID } from '../../shared/src/index.js';
import GameManager from '../src/GameManager.js';
import { createGameIfNotExists, deleteGame, initDb } from '../src/db/index.js';
import { registerCombatHandlers } from '../src/socket/combat.js';
import { registerResolutionHandlers } from '../src/socket/resolution.js';
import { games } from '../src/socket/socket.js';
import { ensureGame } from '../src/socket/util.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';

async function resetGame(gameId: string) {
  ResolutionQueueManager.removeQueue(gameId);
  GameManager.deleteGame(gameId);
  games.delete(gameId as any);
  await deleteGame(gameId);
}

function seedCombatGame(gameId: string, attackerId: string, defenderId: string) {
  createGameIfNotExists(gameId, 'commander', 40);
  const game = ensureGame(gameId);
  if (!game) throw new Error('ensureGame returned undefined');

  (game as any).gameId = gameId;
  (game.state as any).players = [
    { id: attackerId, name: 'Attacker', spectator: false, life: 40 },
    { id: defenderId, name: 'Defender', spectator: false, life: 40 },
  ];
  (game.state as any).life = { [attackerId]: 40, [defenderId]: 40 };
  (game.state as any).turnPlayer = attackerId;
  (game.state as any).activePlayer = attackerId;
  (game.state as any).priority = attackerId;
  (game.state as any).phase = 'combat';
  (game.state as any).step = 'declareAttackers';
  (game.state as any).turn = 1;
  (game.state as any).turnNumber = 1;
  (game.state as any).stack = [];
  (game.state as any).battlefield = [];
  (game.state as any).extraCombats = [];

  return game;
}

function createMockIo(emitted: Array<{ room?: string; event: string; payload: any }>, sockets: any[] = []) {
  return {
    to: (room: string) => ({
      emit: (event: string, payload: any) => emitted.push({ room, event, payload }),
    }),
    emit: (event: string, payload: any) => emitted.push({ event, payload }),
    sockets: {
      sockets: new Map(sockets.map((socket, index) => [`s_${index}`, socket])),
    },
  } as any;
}

function createMockSocket(playerId: string, emitted: Array<{ room?: string; event: string; payload: any }>, gameId: string) {
  const handlers: Record<string, Function> = {};
  const socket = {
    data: { playerId, spectator: false, gameId },
    rooms: new Set<string>([gameId]),
    on: (event: string, handler: Function) => {
      handlers[event] = handler;
    },
    emit: (event: string, payload: any) => {
      emitted.push({ event, payload });
    },
  } as any;

  return { socket, handlers };
}

describe('exertChoice replay coverage', () => {
  const trackedGameIds = new Set<string>();
  const createGameId = () => `exert_choice_replay_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  beforeAll(async () => {
    await initDb();
  });

  afterEach(async () => {
    for (const gameId of trackedGameIds) {
      await resetGame(gameId);
    }
    trackedGameIds.clear();
  });

  it('replays exertChoice by restoring the next-untap restriction and turn-scoped exert marker', () => {
    const gameId = createGameId();
    trackedGameIds.add(gameId);
    const attackerId = 'p1' as PlayerID;
    const defenderId = 'p2' as PlayerID;
    const game = seedCombatGame(gameId, attackerId, defenderId);

    (game.state as any).battlefield = [{
      id: 'combat_celebrant',
      controller: attackerId,
      owner: attackerId,
      tapped: false,
      summoningSickness: false,
      counters: {},
      basePower: 4,
      baseToughness: 1,
      attacking: defenderId,
      card: {
        id: 'combat_celebrant_card',
        name: 'Combat Celebrant',
        type_line: 'Creature - Human Warrior',
        oracle_text: "If this creature hasn't been exerted this turn, you may exert it as it attacks. When you do, untap all other creatures you control and after this phase, there is an additional combat phase. (An exerted creature won't untap during your next untap step.)",
        power: '4',
        toughness: '1',
      },
    }];

    game.applyEvent({
      type: 'exertChoice',
      playerId: attackerId,
      attackerId: 'combat_celebrant',
    } as any);

    const attacker = ((game.state as any).battlefield || [])[0] as any;
    expect(attacker.doesntUntapNextTurn).toBe(true);
    expect(attacker.exertedThisTurn).toBe(true);
  });

  it('replays whenever-you-exert watcher triggers like Trueheart Twins', () => {
    const gameId = createGameId();
    trackedGameIds.add(gameId);
    const attackerId = 'p1' as PlayerID;
    const defenderId = 'p2' as PlayerID;
    const game = seedCombatGame(gameId, attackerId, defenderId);

    (game.state as any).battlefield = [
      {
        id: 'trueheart_twins',
        controller: attackerId,
        owner: attackerId,
        tapped: false,
        summoningSickness: false,
        counters: {},
        basePower: 4,
        baseToughness: 4,
        card: {
          id: 'trueheart_twins_card',
          name: 'Trueheart Twins',
          type_line: 'Creature - Jackal Warrior',
          oracle_text: "You may exert this creature as it attacks. (It won't untap during your next untap step.)\nWhenever you exert a creature, creatures you control get +1/+0 until end of turn.",
          power: '4',
          toughness: '4',
        },
      },
      {
        id: 'supporting_ally',
        controller: attackerId,
        owner: attackerId,
        tapped: false,
        summoningSickness: false,
        counters: {},
        basePower: 2,
        baseToughness: 2,
        card: {
          id: 'supporting_ally_card',
          name: 'Supporting Ally',
          type_line: 'Creature - Warrior',
          oracle_text: '',
          power: '2',
          toughness: '2',
        },
      },
    ];

    game.applyEvent({
      type: 'exertChoice',
      playerId: attackerId,
      attackerId: 'trueheart_twins',
    } as any);

    game.applyEvent({
      type: 'pushTriggeredAbility',
      triggerId: 'trueheart_twins_exert_replay',
      sourceId: 'trueheart_twins',
      permanentId: 'trueheart_twins',
      sourceName: 'Trueheart Twins',
      controllerId: attackerId,
      description: 'creatures you control get +1/+0 until end of turn.',
      triggerType: 'whenever_you_exert',
      effect: 'creatures you control get +1/+0 until end of turn.',
      mandatory: true,
      card: { ...((game.state as any).battlefield[0] as any).card },
    } as any);

    game.applyEvent({ type: 'resolveTopOfStack' } as any);

    const twins = ((game.state as any).battlefield || []).find((permanent: any) => permanent?.id === 'trueheart_twins') as any;
    const ally = ((game.state as any).battlefield || []).find((permanent: any) => permanent?.id === 'supporting_ally') as any;
    expect(twins.doesntUntapNextTurn).toBe(true);
    expect(twins.exertedThisTurn).toBe(true);
    expect(twins.temporaryPTMods).toEqual([
      expect.objectContaining({ power: 1, toughness: 0, expiresAt: 'end_of_turn' }),
    ]);
    expect(ally.temporaryPTMods).toEqual([
      expect.objectContaining({ power: 1, toughness: 0, expiresAt: 'end_of_turn' }),
    ]);
  });

  it('replays damage-and-life whenever-you-exert watcher triggers like Resolute Survivors', () => {
    const gameId = createGameId();
    trackedGameIds.add(gameId);
    const attackerId = 'p1' as PlayerID;
    const defenderId = 'p2' as PlayerID;
    const game = seedCombatGame(gameId, attackerId, defenderId);

    (game.state as any).battlefield = [
      {
        id: 'resolute_survivors',
        controller: attackerId,
        owner: attackerId,
        tapped: false,
        summoningSickness: false,
        counters: {},
        basePower: 3,
        baseToughness: 3,
        card: {
          id: 'resolute_survivors_card',
          name: 'Resolute Survivors',
          type_line: 'Creature - Human Warrior',
          oracle_text: "You may exert this creature as it attacks. (It won't untap during your next untap step.)\nWhenever you exert a creature, this creature deals 1 damage to each opponent and you gain 1 life.",
          power: '3',
          toughness: '3',
        },
      },
    ];

    game.applyEvent({
      type: 'exertChoice',
      playerId: attackerId,
      attackerId: 'resolute_survivors',
    } as any);

    game.applyEvent({
      type: 'pushTriggeredAbility',
      triggerId: 'resolute_survivors_exert_replay',
      sourceId: 'resolute_survivors',
      permanentId: 'resolute_survivors',
      sourceName: 'Resolute Survivors',
      controllerId: attackerId,
      description: 'this creature deals 1 damage to each opponent and you gain 1 life.',
      triggerType: 'whenever_you_exert',
      effect: 'this creature deals 1 damage to each opponent and you gain 1 life.',
      mandatory: true,
      card: { ...((game.state as any).battlefield[0] as any).card },
    } as any);

    game.applyEvent({ type: 'resolveTopOfStack' } as any);

    expect((game.state as any).life[attackerId]).toBe(41);
    expect((game.state as any).life[defenderId]).toBe(39);
  });

  it('replays named self-reference exert rewards like Anep, Vizier of Hazoret by exiling the top two cards and marking them playable through your next turn', () => {
    const gameId = createGameId();
    trackedGameIds.add(gameId);
    const attackerId = 'p1' as PlayerID;
    const defenderId = 'p2' as PlayerID;
    const game = seedCombatGame(gameId, attackerId, defenderId);

    (game.state as any).battlefield = [
      {
        id: 'anep_vizier_of_hazoret',
        controller: attackerId,
        owner: attackerId,
        tapped: false,
        summoningSickness: false,
        counters: {},
        basePower: 4,
        baseToughness: 2,
        card: {
          id: 'anep_vizier_of_hazoret_card',
          name: 'Anep, Vizier of Hazoret',
          type_line: 'Legendary Creature - Jackal Warrior',
          oracle_text: "Trample\nYou may exert Anep as it attacks. When you do, exile the top two cards of your library. Until the end of your next turn, you may play those cards. (An exerted creature won't untap during your next untap step.)",
          power: '4',
          toughness: '2',
        },
      },
    ];
    (game.state as any).zones = {
      [attackerId]: {
        hand: [],
        handCount: 0,
        library: [
          { id: 'anep_top_land', name: 'Mountain', type_line: 'Basic Land - Mountain', oracle_text: '', colors: [] },
          { id: 'anep_top_spell', name: 'Anep Top Spell', type_line: 'Sorcery', oracle_text: '', colors: ['R'] },
        ],
        libraryCount: 2,
        graveyard: [],
        graveyardCount: 0,
        exile: [],
        exileCount: 0,
      },
      [defenderId]: { hand: [], handCount: 0, library: [], libraryCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0 },
    };
    (game as any).libraries.set(attackerId, (game.state as any).zones[attackerId].library);
    (game as any).libraries.set(defenderId, []);

    game.applyEvent({
      type: 'exertChoice',
      playerId: attackerId,
      attackerId: 'anep_vizier_of_hazoret',
    } as any);

    game.applyEvent({
      type: 'pushTriggeredAbility',
      triggerId: 'anep_vizier_of_hazoret_exert_replay',
      sourceId: 'anep_vizier_of_hazoret',
      permanentId: 'anep_vizier_of_hazoret',
      sourceName: 'Anep, Vizier of Hazoret',
      controllerId: attackerId,
      description: 'exile the top two cards of your library. Until the end of your next turn, you may play those cards.',
      triggerType: 'exert',
      effect: 'exile the top two cards of your library. Until the end of your next turn, you may play those cards.',
      mandatory: true,
      card: { ...((game.state as any).battlefield[0] as any).card },
    } as any);

    game.applyEvent({ type: 'resolveTopOfStack' } as any);

    const anep = (((game.state as any).battlefield || []) as any[]).find((permanent: any) => permanent?.id === 'anep_vizier_of_hazoret') as any;
    const attackerZones = (game.state as any).zones[attackerId] as any;
    const exiledIds = (attackerZones.exile || []).map((card: any) => card.id);
    const pendingImpulse = ((game.state as any).pendingImpulseDraws?.[attackerId] || []) as any[];
    expect(anep?.doesntUntapNextTurn).toBe(true);
    expect(anep?.exertedThisTurn).toBe(true);
    expect(exiledIds).toEqual(['anep_top_land', 'anep_top_spell']);
    expect(attackerZones.exileCount).toBe(2);
    expect(attackerZones.libraryCount).toBe(0);
    expect((game.state as any).playableFromExile?.[attackerId]?.anep_top_land).toBe(2);
    expect((game.state as any).playableFromExile?.[attackerId]?.anep_top_spell).toBe(2);
    expect(attackerZones.exile).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'anep_top_land', canBePlayedBy: attackerId, playableUntilTurn: 2 }),
      expect.objectContaining({ id: 'anep_top_spell', canBePlayedBy: attackerId, playableUntilTurn: 2 }),
    ]));
    expect(pendingImpulse).toEqual(expect.arrayContaining([
      expect.objectContaining({ cardId: 'anep_top_land', playableUntilTurn: 2 }),
      expect.objectContaining({ cardId: 'anep_top_spell', playableUntilTurn: 2 }),
    ]));
  });

  it('replays pronoun-based exert rewards like Themberchaud by granting flying until end of turn', () => {
    const gameId = createGameId();
    trackedGameIds.add(gameId);
    const attackerId = 'p1' as PlayerID;
    const defenderId = 'p2' as PlayerID;
    const game = seedCombatGame(gameId, attackerId, defenderId);

    (game.state as any).battlefield = [
      {
        id: 'themberchaud',
        controller: attackerId,
        owner: attackerId,
        tapped: false,
        summoningSickness: false,
        counters: {},
        basePower: 5,
        baseToughness: 5,
        card: {
          id: 'themberchaud_card',
          name: 'Themberchaud',
          type_line: 'Legendary Creature - Dragon',
          oracle_text: "Trample\nWhen Themberchaud enters, he deals X damage to each other creature without flying and each player, where X is the number of Mountains you control.\nYou may exert Themberchaud as he attacks. When you do, he gains flying until end of turn. (An exerted creature won't untap during your next untap step.)",
          power: '5',
          toughness: '5',
        },
      },
    ];

    game.applyEvent({
      type: 'exertChoice',
      playerId: attackerId,
      attackerId: 'themberchaud',
    } as any);

    game.applyEvent({
      type: 'pushTriggeredAbility',
      triggerId: 'themberchaud_exert_replay',
      sourceId: 'themberchaud',
      permanentId: 'themberchaud',
      sourceName: 'Themberchaud',
      controllerId: attackerId,
      description: 'he gains flying until end of turn.',
      triggerType: 'exert',
      effect: 'he gains flying until end of turn.',
      mandatory: true,
      card: { ...((game.state as any).battlefield[0] as any).card },
    } as any);

    game.applyEvent({ type: 'resolveTopOfStack' } as any);

    const themberchaud = (((game.state as any).battlefield || []) as any[]).find((permanent: any) => permanent?.id === 'themberchaud') as any;
    expect(themberchaud?.doesntUntapNextTurn).toBe(true);
    expect(themberchaud?.exertedThisTurn).toBe(true);
    expect(themberchaud?.temporaryAbilities).toEqual([
      expect.objectContaining({ ability: 'flying', expiresAt: 'end_of_turn' }),
    ]);
  });

  it('replays targeted whenever-you-exert watcher triggers like Vizier of the True with persisted targets', () => {
    const gameId = createGameId();
    trackedGameIds.add(gameId);
    const attackerId = 'p1' as PlayerID;
    const defenderId = 'p2' as PlayerID;
    const game = seedCombatGame(gameId, attackerId, defenderId);

    (game.state as any).battlefield = [
      {
        id: 'vizier_of_the_true',
        controller: attackerId,
        owner: attackerId,
        tapped: false,
        summoningSickness: false,
        counters: {},
        basePower: 3,
        baseToughness: 2,
        card: {
          id: 'vizier_of_the_true_card',
          name: 'Vizier of the True',
          type_line: 'Creature - Human Cleric',
          oracle_text: "You may exert this creature as it attacks. (It won't untap during your next untap step.)\nWhenever you exert a creature, tap target creature an opponent controls.",
          power: '3',
          toughness: '2',
        },
      },
      {
        id: 'friendly_ally',
        controller: attackerId,
        owner: attackerId,
        tapped: false,
        summoningSickness: false,
        counters: {},
        basePower: 2,
        baseToughness: 2,
        card: {
          id: 'friendly_ally_card',
          name: 'Friendly Ally',
          type_line: 'Creature - Warrior',
          oracle_text: '',
          power: '2',
          toughness: '2',
        },
      },
      {
        id: 'defender_wall',
        controller: defenderId,
        owner: defenderId,
        tapped: false,
        summoningSickness: false,
        counters: {},
        basePower: 0,
        baseToughness: 4,
        card: {
          id: 'defender_wall_card',
          name: 'Defender Wall',
          type_line: 'Creature - Wall',
          oracle_text: '',
          power: '0',
          toughness: '4',
        },
      },
    ];

    game.applyEvent({
      type: 'exertChoice',
      playerId: attackerId,
      attackerId: 'vizier_of_the_true',
    } as any);

    game.applyEvent({
      type: 'pushTriggeredAbility',
      triggerId: 'vizier_of_the_true_exert_replay',
      sourceId: 'vizier_of_the_true',
      permanentId: 'vizier_of_the_true',
      sourceName: 'Vizier of the True',
      controllerId: attackerId,
      description: 'tap target creature an opponent controls.',
      triggerType: 'whenever_you_exert',
      effect: 'tap target creature an opponent controls.',
      mandatory: true,
      targets: ['defender_wall'],
      card: { ...((game.state as any).battlefield[0] as any).card },
    } as any);

    game.applyEvent({ type: 'resolveTopOfStack' } as any);

    const battlefield = ((game.state as any).battlefield || []) as any[];
    const vizier = battlefield.find((permanent: any) => permanent?.id === 'vizier_of_the_true') as any;
    const ally = battlefield.find((permanent: any) => permanent?.id === 'friendly_ally') as any;
    const target = battlefield.find((permanent: any) => permanent?.id === 'defender_wall') as any;
    expect(vizier?.doesntUntapNextTurn).toBe(true);
    expect(vizier?.exertedThisTurn).toBe(true);
    expect(target?.tapped).toBe(true);
    expect(ally?.tapped).toBe(false);
  });

  it('replays discard-then-draw whenever-you-exert watcher triggers like Battlefield Scavenger through the queued prompt flow', async () => {
    const gameId = createGameId();
    trackedGameIds.add(gameId);
    const attackerId = 'p1' as PlayerID;
    const defenderId = 'p2' as PlayerID;
    const game = seedCombatGame(gameId, attackerId, defenderId);

    (game.state as any).battlefield = [
      {
        id: 'battlefield_scavenger',
        controller: attackerId,
        owner: attackerId,
        tapped: false,
        summoningSickness: false,
        counters: {},
        basePower: 2,
        baseToughness: 2,
        card: {
          id: 'battlefield_scavenger_card',
          name: 'Battlefield Scavenger',
          type_line: 'Creature - Jackal Rogue',
          oracle_text: "You may exert this creature as it attacks. (It won't untap during your next untap step.)\nWhenever you exert a creature, you may discard a card. If you do, draw a card.",
          power: '2',
          toughness: '2',
        },
      },
    ];
    (game.state as any).zones = {
      [attackerId]: {
        hand: [
          { id: 'discard_spell', name: 'Discard Spell', type_line: 'Sorcery', oracle_text: '' },
          { id: 'keep_spell', name: 'Keep Spell', type_line: 'Instant', oracle_text: '' },
        ],
        handCount: 2,
        library: [
          { id: 'draw_spell', name: 'Draw Spell', type_line: 'Creature - Beast', oracle_text: '', power: '2', toughness: '2' },
        ],
        libraryCount: 1,
        graveyard: [],
        graveyardCount: 0,
        exile: [],
        exileCount: 0,
      },
      [defenderId]: { hand: [], handCount: 0, library: [], libraryCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0 },
    };
    (game as any).libraries.set(attackerId, (game.state as any).zones[attackerId].library);
    (game as any).libraries.set(defenderId, []);

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket: attackerSocket, handlers: attackerHandlers } = createMockSocket(attackerId, emitted, gameId);
    const io = createMockIo(emitted, [attackerSocket]);
    registerResolutionHandlers(io as any, attackerSocket as any);

    game.applyEvent({
      type: 'exertChoice',
      playerId: attackerId,
      attackerId: 'battlefield_scavenger',
    } as any);

    game.applyEvent({
      type: 'pushTriggeredAbility',
      triggerId: 'battlefield_scavenger_exert_replay',
      sourceId: 'battlefield_scavenger',
      permanentId: 'battlefield_scavenger',
      sourceName: 'Battlefield Scavenger',
      controllerId: attackerId,
      description: 'you may discard a card. If you do, draw a card.',
      triggerType: 'whenever_you_exert',
      effect: 'you may discard a card. If you do, draw a card.',
      mandatory: true,
      card: { ...((game.state as any).battlefield[0] as any).card },
    } as any);

    game.applyEvent({ type: 'resolveTopOfStack' } as any);

    const discardChoiceStep = ResolutionQueueManager.getStepsForPlayer(gameId, attackerId).find(
      (entry: any) => entry?.type === ResolutionStepType.OPTION_CHOICE && entry?.optionalDiscardThenDrawChoice === true,
    ) as any;
    expect(discardChoiceStep).toBeDefined();
    expect((discardChoiceStep.options || []).map((option: any) => option.id)).toEqual(['discard', 'dont']);

    await attackerHandlers.submitResolutionResponse({
      gameId,
      stepId: String(discardChoiceStep.id),
      selections: 'discard',
    });

    const discardStep = ResolutionQueueManager.getStepsForPlayer(gameId, attackerId).find(
      (entry: any) => entry?.type === ResolutionStepType.DISCARD_SELECTION && entry?.sourceName === 'Battlefield Scavenger',
    ) as any;
    expect(discardStep).toBeDefined();
    expect(discardStep?.afterDiscardDrawCount).toBe(1);

    await attackerHandlers.submitResolutionResponse({
      gameId,
      stepId: String(discardStep.id),
      selections: ['discard_spell'],
    });

    const scavenger = (((game.state as any).battlefield || []) as any[]).find((permanent: any) => permanent?.id === 'battlefield_scavenger') as any;
    const attackerZones = (game.state as any).zones[attackerId] as any;
    expect(scavenger?.doesntUntapNextTurn).toBe(true);
    expect(scavenger?.exertedThisTurn).toBe(true);
    expect((attackerZones.hand || []).map((card: any) => card.id)).toEqual(['keep_spell', 'draw_spell']);
    expect((attackerZones.graveyard || []).map((card: any) => card.id)).toContain('discard_spell');
    expect(attackerZones.handCount).toBe(2);
    expect(attackerZones.libraryCount).toBe(0);
  });

  it('replays reveal-until-equipment whenever-you-exert watcher triggers like Rohirrim Chargers and attaches the found Equipment to the exerted creature', async () => {
    const gameId = createGameId();
    trackedGameIds.add(gameId);
    const attackerId = 'p1' as PlayerID;
    const defenderId = 'p2' as PlayerID;
    const game = seedCombatGame(gameId, attackerId, defenderId);

    (game.state as any).battlefield = [
      {
        id: 'rohirrim_chargers',
        controller: attackerId,
        owner: attackerId,
        tapped: false,
        summoningSickness: false,
        counters: {},
        basePower: 4,
        baseToughness: 4,
        card: {
          id: 'rohirrim_chargers_card',
          name: 'Rohirrim Chargers',
          type_line: 'Creature - Human Knight',
          oracle_text: "You may exert this creature as it attacks. (It won't untap during your next untap step.)\nWhenever you exert a creature, reveal cards from the top of your library until you reveal an Equipment card. Put that card onto the battlefield attached to that creature, then put the rest on the bottom of your library in a random order.",
          power: '4',
          toughness: '4',
        },
      },
    ];
    (game.state as any).zones = {
      [attackerId]: {
        hand: [],
        handCount: 0,
        library: [
          { id: 'miss_before', name: 'Miss Before', type_line: 'Creature - Human', oracle_text: '', power: '2', toughness: '2' },
          { id: 'equipment_hit', name: 'Equipment Hit', type_line: 'Artifact - Equipment', oracle_text: 'Equipped creature gets +2/+0.' },
          { id: 'miss_after', name: 'Miss After', type_line: 'Instant', oracle_text: '' },
        ],
        libraryCount: 3,
        graveyard: [],
        graveyardCount: 0,
        exile: [],
        exileCount: 0,
      },
      [defenderId]: { hand: [], handCount: 0, library: [], libraryCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0 },
    };
    (game as any).libraries.set(attackerId, (game.state as any).zones[attackerId].library);
    (game as any).libraries.set(defenderId, []);

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket: attackerSocket, handlers: attackerHandlers } = createMockSocket(attackerId, emitted, gameId);
    const io = createMockIo(emitted, [attackerSocket]);
    registerResolutionHandlers(io as any, attackerSocket as any);

    game.applyEvent({
      type: 'exertChoice',
      playerId: attackerId,
      attackerId: 'rohirrim_chargers',
    } as any);

    game.applyEvent({
      type: 'pushTriggeredAbility',
      triggerId: 'rohirrim_chargers_exert_replay',
      sourceId: 'rohirrim_chargers',
      permanentId: 'rohirrim_chargers',
      sourceName: 'Rohirrim Chargers',
      controllerId: attackerId,
      description: 'reveal cards from the top of your library until you reveal an Equipment card. Put that card onto the battlefield attached to that creature, then put the rest on the bottom of your library in a random order.',
      triggerType: 'whenever_you_exert',
      effect: 'reveal cards from the top of your library until you reveal an Equipment card. Put that card onto the battlefield attached to that creature, then put the rest on the bottom of your library in a random order.',
      mandatory: true,
      effectData: { exertedPermanentId: 'rohirrim_chargers' },
      card: { ...((game.state as any).battlefield[0] as any).card },
    } as any);

    game.applyEvent({ type: 'resolveTopOfStack' } as any);

    const searchStep = ResolutionQueueManager.getStepsForPlayer(gameId, attackerId).find(
      (entry: any) => entry?.type === ResolutionStepType.LIBRARY_SEARCH && entry?.sourceName === 'Rohirrim Chargers',
    ) as any;
    expect(searchStep).toBeDefined();
    expect(searchStep.attachSelectedEquipmentToPermanentId).toBe('rohirrim_chargers');
    expect((searchStep.availableCards || []).map((entry: any) => entry.id)).toEqual(['equipment_hit']);

    await attackerHandlers.submitResolutionResponse({
      gameId,
      stepId: String(searchStep.id),
      selections: ['equipment_hit'],
    });

    const battlefield = (((game.state as any).battlefield || []) as any[]);
    const chargers = battlefield.find((permanent: any) => permanent?.id === 'rohirrim_chargers') as any;
    const equipment = battlefield.find((permanent: any) => permanent?.card?.id === 'equipment_hit') as any;
    const attackerZones = (game.state as any).zones[attackerId] as any;
    expect(chargers?.doesntUntapNextTurn).toBe(true);
    expect(chargers?.exertedThisTurn).toBe(true);
    expect(equipment).toBeDefined();
    expect(equipment?.attachedTo).toBe('rohirrim_chargers');
    expect(chargers?.attachedEquipment || []).toContain(equipment.id);
    expect(chargers?.isEquipped).toBe(true);
    expect((attackerZones.library || []).map((card: any) => card.id).sort()).toEqual(['miss_after', 'miss_before']);
    expect(attackerZones.libraryCount).toBe(2);
  });

  it('replays targeted exert triggers with persisted targets', () => {
    const gameId = createGameId();
    trackedGameIds.add(gameId);
    const attackerId = 'p1' as PlayerID;
    const defenderId = 'p2' as PlayerID;
    const game = seedCombatGame(gameId, attackerId, defenderId);

    (game.state as any).battlefield = [
      {
        id: 'ahn_crop_crasher',
        controller: attackerId,
        owner: attackerId,
        tapped: false,
        summoningSickness: false,
        counters: {},
        basePower: 3,
        baseToughness: 2,
        attacking: defenderId,
        card: {
          id: 'ahn_crop_crasher_card',
          name: 'Ahn-Crop Crasher',
          type_line: 'Creature - Minotaur Warrior',
          oracle_text: "You may exert this creature as it attacks. When you do, target creature can't block this turn. (An exerted creature won't untap during your next untap step.)",
          power: '3',
          toughness: '2',
        },
      },
      {
        id: 'defender_wall',
        controller: defenderId,
        owner: defenderId,
        tapped: false,
        summoningSickness: false,
        counters: {},
        basePower: 0,
        baseToughness: 4,
        card: {
          id: 'defender_wall_card',
          name: 'Defender Wall',
          type_line: 'Creature - Wall',
          oracle_text: '',
          power: '0',
          toughness: '4',
        },
      },
    ];

    game.applyEvent({
      type: 'exertChoice',
      playerId: attackerId,
      attackerId: 'ahn_crop_crasher',
    } as any);

    game.applyEvent({
      type: 'pushTriggeredAbility',
      triggerId: 'exert_target_replay',
      sourceId: 'ahn_crop_crasher',
      permanentId: 'ahn_crop_crasher',
      sourceName: 'Ahn-Crop Crasher',
      controllerId: attackerId,
      description: "target creature can't block this turn",
      triggerType: 'exert',
      effect: "target creature can't block this turn",
      mandatory: true,
      targets: ['defender_wall'],
      card: { ...((game.state as any).battlefield[0] as any).card },
    } as any);

    game.applyEvent({ type: 'resolveTopOfStack' } as any);

    const target = ((game.state as any).battlefield || []).find((permanent: any) => permanent?.id === 'defender_wall') as any;
    expect(target.temporaryAbilities).toEqual([
      expect.objectContaining({ ability: "can't block", expiresAt: 'end_of_turn' }),
    ]);

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket: attackerSocket } = createMockSocket(attackerId, emitted, gameId);
    const { socket: defenderSocket, handlers: defenderHandlers } = createMockSocket(defenderId, emitted, gameId);
    const io = createMockIo(emitted, [attackerSocket, defenderSocket]);
    registerCombatHandlers(io as any, attackerSocket as any);
    registerCombatHandlers(io as any, defenderSocket as any);

    (game.state as any).step = 'declareBlockers';
    const emitStart = emitted.length;
    void defenderHandlers.declareBlockers({
      gameId,
      blockers: [{ blockerId: 'defender_wall', attackerId: 'ahn_crop_crasher' }],
    });

    const newEmits = emitted.slice(emitStart);
    expect(newEmits.some((entry) => entry.event === 'error' && entry.payload?.code === 'CANT_BLOCK')).toBe(true);
  });

  it('replays draw-card exert triggers deterministically', () => {
    const gameId = createGameId();
    trackedGameIds.add(gameId);
    const attackerId = 'p1' as PlayerID;
    const defenderId = 'p2' as PlayerID;
    const game = seedCombatGame(gameId, attackerId, defenderId);

    (game.state as any).zones = {
      [attackerId]: { hand: [], handCount: 0, library: [{ id: 'watchful_draw', name: 'Watchful Draw', type_line: 'Creature - Beast', oracle_text: '', power: '1', toughness: '1' }], libraryCount: 1, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0 },
      [defenderId]: { hand: [], handCount: 0, library: [], libraryCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0 },
    };
    (game as any).libraries.set(attackerId, (game.state as any).zones[attackerId].library);
    (game as any).libraries.set(defenderId, []);

    (game.state as any).battlefield = [
      {
        id: 'watchful_naga',
        controller: attackerId,
        owner: attackerId,
        tapped: false,
        summoningSickness: false,
        counters: {},
        basePower: 2,
        baseToughness: 2,
        attacking: defenderId,
        card: {
          id: 'watchful_naga_card',
          name: 'Watchful Naga',
          type_line: 'Creature - Snake Wizard',
          oracle_text: "You may exert this creature as it attacks. When you do, draw a card. (An exerted creature won't untap during your next untap step.)",
          power: '2',
          toughness: '2',
        },
      },
    ];

    game.applyEvent({
      type: 'exertChoice',
      playerId: attackerId,
      attackerId: 'watchful_naga',
    } as any);

    game.applyEvent({
      type: 'pushTriggeredAbility',
      triggerId: 'exert_draw_replay',
      sourceId: 'watchful_naga',
      permanentId: 'watchful_naga',
      sourceName: 'Watchful Naga',
      controllerId: attackerId,
      description: 'draw a card',
      triggerType: 'exert',
      effect: 'draw a card',
      mandatory: true,
      card: { ...((game.state as any).battlefield[0] as any).card },
    } as any);

    game.applyEvent({ type: 'resolveTopOfStack' } as any);

    const attackerZones = (game.state as any).zones[attackerId] as any;
    expect((attackerZones.hand || []).map((card: any) => card?.id)).toContain('watchful_draw');
    expect(attackerZones.handCount).toBe(1);
    expect(attackerZones.libraryCount).toBe(0);
  });

  it('replays team-pump exert triggers deterministically', () => {
    const gameId = createGameId();
    trackedGameIds.add(gameId);
    const attackerId = 'p1' as PlayerID;
    const defenderId = 'p2' as PlayerID;
    const game = seedCombatGame(gameId, attackerId, defenderId);

    (game.state as any).battlefield = [
      {
        id: 'tah_crop_elite',
        controller: attackerId,
        owner: attackerId,
        tapped: false,
        summoningSickness: false,
        counters: {},
        basePower: 2,
        baseToughness: 2,
        attacking: defenderId,
        card: {
          id: 'tah_crop_elite_card',
          name: 'Tah-Crop Elite',
          type_line: 'Creature - Bird Warrior',
          oracle_text: "Flying\nYou may exert this creature as it attacks. When you do, creatures you control get +1/+1 until end of turn. (An exerted creature won't untap during your next untap step.)",
          power: '2',
          toughness: '2',
        },
      },
      {
        id: 'ally_creature',
        controller: attackerId,
        owner: attackerId,
        tapped: false,
        summoningSickness: false,
        counters: {},
        basePower: 3,
        baseToughness: 3,
        card: {
          id: 'ally_creature_card',
          name: 'Ally Creature',
          type_line: 'Creature - Warrior',
          oracle_text: '',
          power: '3',
          toughness: '3',
        },
      },
    ];

    game.applyEvent({
      type: 'exertChoice',
      playerId: attackerId,
      attackerId: 'tah_crop_elite',
    } as any);

    game.applyEvent({
      type: 'pushTriggeredAbility',
      triggerId: 'exert_team_pump_replay',
      sourceId: 'tah_crop_elite',
      permanentId: 'tah_crop_elite',
      sourceName: 'Tah-Crop Elite',
      controllerId: attackerId,
      description: 'creatures you control get +1/+1 until end of turn',
      triggerType: 'exert',
      effect: 'creatures you control get +1/+1 until end of turn',
      mandatory: true,
      card: { ...((game.state as any).battlefield[0] as any).card },
    } as any);

    game.applyEvent({ type: 'resolveTopOfStack' } as any);

    const battlefield = ((game.state as any).battlefield || []) as any[];
    const elite = battlefield.find((permanent: any) => permanent?.id === 'tah_crop_elite') as any;
    const ally = battlefield.find((permanent: any) => permanent?.id === 'ally_creature') as any;

    expect(elite?.temporaryPTMods).toEqual([
      expect.objectContaining({ power: 1, toughness: 1, expiresAt: 'end_of_turn' }),
    ]);
    expect(ally?.temporaryPTMods).toEqual([
      expect.objectContaining({ power: 1, toughness: 1, expiresAt: 'end_of_turn' }),
    ]);
  });

  it('replays self-unblockable plus scry exert triggers deterministically', () => {
    const gameId = createGameId();
    trackedGameIds.add(gameId);
    const attackerId = 'p1' as PlayerID;
    const defenderId = 'p2' as PlayerID;
    const game = seedCombatGame(gameId, attackerId, defenderId);

    (game.state as any).battlefield = [
      {
        id: 'clockwork_droid',
        controller: attackerId,
        owner: attackerId,
        tapped: false,
        summoningSickness: false,
        counters: {},
        basePower: 3,
        baseToughness: 1,
        attacking: defenderId,
        card: {
          id: 'clockwork_droid_card',
          name: 'Clockwork Droid',
          type_line: 'Artifact Creature - Robot',
          oracle_text: "You may exert this creature as it attacks. When you do, it can't be blocked this turn and you scry 1. (An exerted creature won't untap during your next untap step. To scry 1, look at the top card of your library. You may put that card on the bottom.)",
          power: '3',
          toughness: '1',
        },
      },
    ];

    game.applyEvent({
      type: 'exertChoice',
      playerId: attackerId,
      attackerId: 'clockwork_droid',
    } as any);

    game.applyEvent({
      type: 'pushTriggeredAbility',
      triggerId: 'exert_unblockable_scry_replay',
      sourceId: 'clockwork_droid',
      permanentId: 'clockwork_droid',
      sourceName: 'Clockwork Droid',
      controllerId: attackerId,
      description: "it can't be blocked this turn and you scry 1",
      triggerType: 'exert',
      effect: "it can't be blocked this turn and you scry 1",
      mandatory: true,
      card: { ...((game.state as any).battlefield[0] as any).card },
    } as any);

    game.applyEvent({ type: 'resolveTopOfStack' } as any);

    const droid = (((game.state as any).battlefield || []) as any[]).find((permanent: any) => permanent?.id === 'clockwork_droid') as any;
    expect(droid?.temporaryAbilities).toEqual([
      expect.objectContaining({ ability: "can't be blocked", expiresAt: 'end_of_turn' }),
    ]);
    expect((game.state as any).pendingScry?.[attackerId]).toBe(1);
  });

  it('replays graveyard-return exert triggers with persisted bound targets', () => {
    const gameId = createGameId();
    trackedGameIds.add(gameId);
    const attackerId = 'p1' as PlayerID;
    const defenderId = 'p2' as PlayerID;
    const game = seedCombatGame(gameId, attackerId, defenderId);

    (game.state as any).zones = {
      [attackerId]: {
        hand: [], handCount: 0,
        library: [], libraryCount: 0,
        exile: [], exileCount: 0,
        graveyard: [{
          id: 'cheap_return',
          name: 'Cheap Return',
          type_line: 'Creature - Cleric',
          oracle_text: '',
          mana_cost: '{1}{W}',
          cmc: 2,
          power: '2',
          toughness: '2',
        }],
        graveyardCount: 1,
      },
      [defenderId]: { hand: [], handCount: 0, library: [], libraryCount: 0, exile: [], exileCount: 0, graveyard: [], graveyardCount: 0 },
    };

    (game.state as any).battlefield = [
      {
        id: 'devoted_crop_mate',
        controller: attackerId,
        owner: attackerId,
        tapped: false,
        summoningSickness: false,
        counters: {},
        basePower: 3,
        baseToughness: 2,
        attacking: defenderId,
        card: {
          id: 'devoted_crop_mate_card',
          name: 'Devoted Crop-Mate',
          type_line: 'Creature - Human Warrior',
          oracle_text: "You may exert this creature as it attacks. When you do, return target creature card with mana value 2 or less from your graveyard to the battlefield. (An exerted creature won't untap during your next untap step.)",
          power: '3',
          toughness: '2',
        },
      },
    ];

    game.applyEvent({
      type: 'exertChoice',
      playerId: attackerId,
      attackerId: 'devoted_crop_mate',
    } as any);

    game.applyEvent({
      type: 'pushTriggeredAbility',
      triggerId: 'exert_graveyard_return_replay',
      sourceId: 'devoted_crop_mate',
      permanentId: 'devoted_crop_mate',
      sourceName: 'Devoted Crop-Mate',
      controllerId: attackerId,
      description: 'return target creature card with mana value 2 or less from your graveyard to the battlefield',
      triggerType: 'exert',
      effect: 'return target creature card with mana value 2 or less from your graveyard to the battlefield',
      mandatory: true,
      requiresTarget: true,
      targetType: 'creature',
      targetZone: 'graveyard',
      targetDestination: 'battlefield',
      targetGraveyardScope: 'your',
      targetFilterTypes: ['creature'],
      targetFilterMaxManaValue: 2,
      targets: ['cheap_return'],
      preselectedTargetsPersisted: true,
      boundGraveyardCardId: 'cheap_return',
      boundGraveyardOwnerId: attackerId,
      card: { ...((game.state as any).battlefield[0] as any).card },
    } as any);

    game.applyEvent({ type: 'resolveTopOfStack' } as any);

    const returnedPermanent = (((game.state as any).battlefield || []) as any[]).find(
      (permanent: any) => String(permanent?.card?.id || '') === 'cheap_return',
    ) as any;
    expect(returnedPermanent).toMatchObject({
      controller: attackerId,
      owner: attackerId,
    });
    expect(((game.state as any).zones[attackerId]?.graveyard || []).length).toBe(0);
  });

  it('replays non-Dragon exert damage triggers with persisted target filters', () => {
    const gameId = createGameId();
    trackedGameIds.add(gameId);
    const attackerId = 'p1' as PlayerID;
    const defenderId = 'p2' as PlayerID;
    const game = seedCombatGame(gameId, attackerId, defenderId);

    (game.state as any).battlefield = [
      {
        id: 'glorybringer',
        controller: attackerId,
        owner: attackerId,
        tapped: false,
        summoningSickness: false,
        counters: {},
        basePower: 4,
        baseToughness: 4,
        attacking: defenderId,
        card: {
          id: 'glorybringer_card',
          name: 'Glorybringer',
          type_line: 'Creature - Dragon',
          oracle_text: "You may exert this creature as it attacks. When you do, it deals 4 damage to target non-Dragon creature an opponent controls. (An exerted creature won't untap during your next untap step.)",
          power: '4',
          toughness: '4',
        },
      },
      {
        id: 'dragon_target',
        controller: defenderId,
        owner: defenderId,
        tapped: false,
        summoningSickness: false,
        counters: {},
        basePower: 4,
        baseToughness: 4,
        card: {
          id: 'dragon_target_card',
          name: 'Dragon Target',
          type_line: 'Creature - Dragon',
          oracle_text: '',
          power: '4',
          toughness: '4',
        },
      },
      {
        id: 'beast_target',
        controller: defenderId,
        owner: defenderId,
        tapped: false,
        summoningSickness: false,
        counters: {},
        basePower: 2,
        baseToughness: 2,
        card: {
          id: 'beast_target_card',
          name: 'Beast Target',
          type_line: 'Creature - Beast',
          oracle_text: '',
          power: '2',
          toughness: '2',
        },
      },
    ];

    game.applyEvent({
      type: 'exertChoice',
      playerId: attackerId,
      attackerId: 'glorybringer',
    } as any);

    game.applyEvent({
      type: 'pushTriggeredAbility',
      triggerId: 'exert_non_dragon_damage_replay',
      sourceId: 'glorybringer',
      permanentId: 'glorybringer',
      sourceName: 'Glorybringer',
      controllerId: attackerId,
      description: 'it deals 4 damage to target non-Dragon creature an opponent controls',
      triggerType: 'exert',
      effect: 'it deals 4 damage to target non-Dragon creature an opponent controls',
      mandatory: true,
      requiresTarget: true,
      targetType: 'creature',
      targetConstraint: 'opponent',
      targetFilterTypes: ['creature'],
      targetFilterExcludeTypes: ['dragon'],
      targets: ['beast_target'],
      card: { ...((game.state as any).battlefield[0] as any).card },
    } as any);

    game.applyEvent({ type: 'resolveTopOfStack' } as any);

    const beastTarget = (((game.state as any).battlefield || []) as any[]).find((permanent: any) => permanent?.id === 'beast_target') as any;
    const dragonTarget = (((game.state as any).battlefield || []) as any[]).find((permanent: any) => permanent?.id === 'dragon_target') as any;
    expect(beastTarget?.damageMarked).toBe(4);
    expect(dragonTarget?.damageMarked || 0).toBe(0);
  });

  it('replays Oketra\'s Avenger exert prevention through combat damage', () => {
    const gameId = createGameId();
    trackedGameIds.add(gameId);
    const attackerId = 'p1' as PlayerID;
    const defenderId = 'p2' as PlayerID;
    const game = seedCombatGame(gameId, attackerId, defenderId);

    (game.state as any).battlefield = [
      {
        id: 'oketras_avenger',
        controller: attackerId,
        owner: attackerId,
        tapped: false,
        summoningSickness: false,
        counters: {},
        basePower: 3,
        baseToughness: 1,
        attacking: defenderId,
        blockedBy: ['large_blocker'],
        card: {
          id: 'oketras_avenger_card',
          name: "Oketra's Avenger",
          type_line: 'Creature - Human Warrior',
          oracle_text: "You may exert this creature as it attacks. When you do, prevent all combat damage that would be dealt to it this turn. (An exerted creature won't untap during your next untap step.)",
          power: '3',
          toughness: '1',
        },
      },
      {
        id: 'large_blocker',
        controller: defenderId,
        owner: defenderId,
        tapped: false,
        summoningSickness: false,
        counters: {},
        basePower: 4,
        baseToughness: 4,
        blocking: ['oketras_avenger'],
        card: {
          id: 'large_blocker_card',
          name: 'Large Blocker',
          type_line: 'Creature - Beast',
          oracle_text: '',
          power: '4',
          toughness: '4',
        },
      },
    ];

    (game.state as any).step = 'declareBlockers';
    (game.state as any).blockersDeclaredBy = [defenderId];

    game.applyEvent({
      type: 'exertChoice',
      playerId: attackerId,
      attackerId: 'oketras_avenger',
    } as any);

    game.applyEvent({
      type: 'pushTriggeredAbility',
      triggerId: 'exert_prevent_combat_damage_replay',
      sourceId: 'oketras_avenger',
      permanentId: 'oketras_avenger',
      sourceName: "Oketra's Avenger",
      controllerId: attackerId,
      description: 'prevent all combat damage that would be dealt to it this turn',
      triggerType: 'exert',
      effect: 'prevent all combat damage that would be dealt to it this turn',
      mandatory: true,
      card: { ...((game.state as any).battlefield[0] as any).card },
    } as any);

    game.applyEvent({ type: 'resolveTopOfStack' } as any);
    game.applyEvent({ type: 'nextStep' } as any);

    const avenger = (((game.state as any).battlefield || []) as any[]).find((permanent: any) => permanent?.id === 'oketras_avenger') as any;
    const blocker = (((game.state as any).battlefield || []) as any[]).find((permanent: any) => permanent?.id === 'large_blocker') as any;
    expect(Number(avenger?.markedDamage || 0)).toBe(0);
    expect(Number(blocker?.markedDamage || 0)).toBe(3);
    expect(avenger?.markedForDestruction).toBeUndefined();
  });

  it('replays Rhonas\'s Stalwart exert restrictions for blocker legality', async () => {
    const gameId = createGameId();
    trackedGameIds.add(gameId);
    const attackerId = 'p1' as PlayerID;
    const defenderId = 'p2' as PlayerID;
    const game = seedCombatGame(gameId, attackerId, defenderId);

    (game.state as any).battlefield = [
      {
        id: 'rhonas_stalwart',
        controller: attackerId,
        owner: attackerId,
        tapped: false,
        summoningSickness: false,
        counters: {},
        basePower: 2,
        baseToughness: 2,
        attacking: defenderId,
        card: {
          id: 'rhonas_stalwart_card',
          name: "Rhonas's Stalwart",
          type_line: 'Creature - Zombie Warrior',
          oracle_text: "You may exert this creature as it attacks. When you do, it can't be blocked by creatures with power 2 or less this turn. (An exerted creature won't untap during your next untap step.)",
          power: '2',
          toughness: '2',
        },
      },
      {
        id: 'small_blocker',
        controller: defenderId,
        owner: defenderId,
        tapped: false,
        summoningSickness: false,
        counters: {},
        basePower: 2,
        baseToughness: 2,
        card: {
          id: 'small_blocker_card',
          name: 'Small Blocker',
          type_line: 'Creature - Zombie',
          oracle_text: '',
          power: '2',
          toughness: '2',
        },
      },
      {
        id: 'large_blocker',
        controller: defenderId,
        owner: defenderId,
        tapped: false,
        summoningSickness: false,
        counters: {},
        basePower: 3,
        baseToughness: 3,
        card: {
          id: 'large_blocker_card',
          name: 'Large Blocker',
          type_line: 'Creature - Beast',
          oracle_text: '',
          power: '3',
          toughness: '3',
        },
      },
    ];

    game.applyEvent({
      type: 'exertChoice',
      playerId: attackerId,
      attackerId: 'rhonas_stalwart',
    } as any);

    game.applyEvent({
      type: 'pushTriggeredAbility',
      triggerId: 'exert_low_power_block_replay',
      sourceId: 'rhonas_stalwart',
      permanentId: 'rhonas_stalwart',
      sourceName: "Rhonas's Stalwart",
      controllerId: attackerId,
      description: "it can't be blocked by creatures with power 2 or less this turn",
      triggerType: 'exert',
      effect: "it can't be blocked by creatures with power 2 or less this turn",
      mandatory: true,
      card: { ...((game.state as any).battlefield[0] as any).card },
    } as any);

    game.applyEvent({ type: 'resolveTopOfStack' } as any);

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket: attackerSocket } = createMockSocket(attackerId, emitted, gameId);
    const { socket: defenderSocket, handlers: defenderHandlers } = createMockSocket(defenderId, emitted, gameId);
    const io = createMockIo(emitted, [attackerSocket, defenderSocket]);
    registerCombatHandlers(io as any, attackerSocket as any);
    registerCombatHandlers(io as any, defenderSocket as any);

    (game.state as any).step = 'declareBlockers';

    const failedStart = emitted.length;
    await defenderHandlers.declareBlockers({
      gameId,
      blockers: [{ blockerId: 'small_blocker', attackerId: 'rhonas_stalwart' }],
    });
    const failedBlockEmits = emitted.slice(failedStart);
    expect(failedBlockEmits.some((entry) => entry.event === 'error' && entry.payload?.code === 'CANT_BLOCK')).toBe(true);

    const successStart = emitted.length;
    await defenderHandlers.declareBlockers({
      gameId,
      blockers: [{ blockerId: 'large_blocker', attackerId: 'rhonas_stalwart' }],
    });
    const successEmits = emitted.slice(successStart);
    expect(successEmits.some((entry) => entry.event === 'error')).toBe(false);

    const attacker = ((game.state as any).battlefield || []).find((permanent: any) => permanent?.id === 'rhonas_stalwart') as any;
    expect(attacker?.blockedBy).toEqual(['large_blocker']);
  });

  it('replays Hydra Trainer exert pumps using the total counters you control', () => {
    const gameId = createGameId();
    trackedGameIds.add(gameId);
    const attackerId = 'p1' as PlayerID;
    const defenderId = 'p2' as PlayerID;
    const game = seedCombatGame(gameId, attackerId, defenderId);

    (game.state as any).battlefield = [
      {
        id: 'hydra_trainer',
        controller: attackerId,
        owner: attackerId,
        tapped: false,
        summoningSickness: false,
        counters: { '+1/+1': 2 },
        basePower: 1,
        baseToughness: 1,
        attacking: defenderId,
        card: {
          id: 'hydra_trainer_card',
          name: 'Hydra Trainer',
          type_line: 'Creature - Human Warrior',
          oracle_text: "You may exert this creature as it attacks. When you do, target creature gets +X/+X until end of turn, where X is the number of counters on permanents you control. (An exerted creature won't untap during your next untap step.)\n{2}{G}: Adapt 2. (If this creature has no +1/+1 counters on it, put two +1/+1 counters on it.)",
          power: '1',
          toughness: '1',
        },
      },
      {
        id: 'counter_target',
        controller: attackerId,
        owner: attackerId,
        tapped: false,
        summoningSickness: false,
        counters: {},
        basePower: 2,
        baseToughness: 2,
        card: {
          id: 'counter_target_card',
          name: 'Counter Target',
          type_line: 'Creature - Hydra',
          oracle_text: '',
          power: '2',
          toughness: '2',
        },
      },
      {
        id: 'charge_relic',
        controller: attackerId,
        owner: attackerId,
        tapped: false,
        summoningSickness: false,
        counters: { charge: 1 },
        card: {
          id: 'charge_relic_card',
          name: 'Charge Relic',
          type_line: 'Artifact',
          oracle_text: '',
        },
      },
    ];

    game.applyEvent({
      type: 'exertChoice',
      playerId: attackerId,
      attackerId: 'hydra_trainer',
    } as any);

    game.applyEvent({
      type: 'pushTriggeredAbility',
      triggerId: 'exert_counter_scaled_pump_replay',
      sourceId: 'hydra_trainer',
      permanentId: 'hydra_trainer',
      sourceName: 'Hydra Trainer',
      controllerId: attackerId,
      description: 'target creature gets +X/+X until end of turn, where X is the number of counters on permanents you control',
      triggerType: 'exert',
      effect: 'target creature gets +X/+X until end of turn, where X is the number of counters on permanents you control',
      mandatory: true,
      requiresTarget: true,
      targetType: 'creature',
      targetFilterTypes: ['creature'],
      targets: ['counter_target'],
      card: { ...((game.state as any).battlefield[0] as any).card },
    } as any);

    game.applyEvent({ type: 'resolveTopOfStack' } as any);

    const target = (((game.state as any).battlefield || []) as any[]).find((permanent: any) => permanent?.id === 'counter_target') as any;
    expect(target?.temporaryPTMods).toEqual([
      expect.objectContaining({ power: 3, toughness: 3, expiresAt: 'end_of_turn' }),
    ]);
  });

  it('replays Sandstorm Crasher exert token copies with a defending-player snapshot', () => {
    const gameId = createGameId();
    trackedGameIds.add(gameId);
    const attackerId = 'p1' as PlayerID;
    const defenderId = 'p2' as PlayerID;
    const game = seedCombatGame(gameId, attackerId, defenderId);

    (game.state as any).battlefield = [
      {
        id: 'sandstorm_crasher',
        controller: attackerId,
        owner: attackerId,
        tapped: false,
        summoningSickness: false,
        counters: {},
        basePower: 3,
        baseToughness: 4,
        attacking: defenderId,
        card: {
          id: 'sandstorm_crasher_card',
          name: 'Sandstorm Crasher',
          type_line: 'Creature - Minotaur Berserker Wizard',
          oracle_text: "Trample\nYou may exert this creature as it attacks. When you do, create a tapped and attacking token that's a copy of target creature you control. Sacrifice the token at the beginning of the next end step. (An exerted creature won't untap during your next untap step.)",
          power: '3',
          toughness: '4',
        },
      },
      {
        id: 'copy_source',
        controller: attackerId,
        owner: attackerId,
        tapped: false,
        summoningSickness: false,
        counters: {},
        basePower: 5,
        baseToughness: 5,
        card: {
          id: 'copy_source_card',
          name: 'Copy Source',
          type_line: 'Creature - Beast',
          oracle_text: '',
          power: '5',
          toughness: '5',
        },
      },
    ];

    game.applyEvent({
      type: 'exertChoice',
      playerId: attackerId,
      attackerId: 'sandstorm_crasher',
    } as any);

    game.applyEvent({
      type: 'pushTriggeredAbility',
      triggerId: 'sandstorm_crasher_replay',
      sourceId: 'sandstorm_crasher',
      permanentId: 'sandstorm_crasher',
      sourceName: 'Sandstorm Crasher',
      controllerId: attackerId,
      description: "create a tapped and attacking token that's a copy of target creature you control. sacrifice the token at the beginning of the next end step",
      triggerType: 'exert',
      effect: "create a tapped and attacking token that's a copy of target creature you control. sacrifice the token at the beginning of the next end step",
      mandatory: true,
      targets: ['copy_source'],
      defendingPlayer: defenderId,
      sourcePermanentSnapshot: { ...((game.state as any).battlefield[0] as any) },
      card: { ...((game.state as any).battlefield[0] as any).card },
    } as any);

    game.applyEvent({ type: 'resolveTopOfStack' } as any);

    const battlefield = ((game.state as any).battlefield || []) as any[];
    const tokens = battlefield.filter((permanent: any) => permanent?.isToken === true);
    const delayedSacrifice = ((game.state as any).pendingSacrificeAtNextEndStep || []) as any[];
    const delayedExile = ((game.state as any).pendingExileAtEndOfCombat || []) as any[];

    expect(tokens).toHaveLength(1);
    expect(tokens[0]).toMatchObject({
      attacking: defenderId,
      tapped: true,
      copiedFromPermanentId: 'copy_source',
    });
    expect(tokens[0]?.card?.name).toBe('Copy Source');
    expect(delayedSacrifice).toHaveLength(1);
    expect(delayedSacrifice[0]?.permanentId).toBe(tokens[0]?.id);
    expect(delayedExile).toHaveLength(0);
  });
});