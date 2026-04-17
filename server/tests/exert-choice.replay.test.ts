import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import type { PlayerID } from '../../shared/src/index.js';
import GameManager from '../src/GameManager.js';
import { createGameIfNotExists, deleteGame, initDb } from '../src/db/index.js';
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
});