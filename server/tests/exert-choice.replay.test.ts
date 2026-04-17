import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import type { PlayerID } from '../../shared/src/index.js';
import GameManager from '../src/GameManager.js';
import { createGameIfNotExists, deleteGame, initDb } from '../src/db/index.js';
import { registerCombatHandlers } from '../src/socket/combat.js';
import { games } from '../src/socket/socket.js';
import { ensureGame } from '../src/socket/util.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';

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