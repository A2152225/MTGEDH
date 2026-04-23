import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { PlayerID } from '../../shared/src/index.js';
import GameManager from '../src/GameManager.js';
import { createGameIfNotExists, deleteGame, initDb } from '../src/db/index.js';
import { executeTriggerEffect } from '../src/state/modules/stack.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';
import { initializePriorityResolutionHandler } from '../src/socket/resolution.js';
import { games } from '../src/socket/socket.js';
import { ensureGame } from '../src/socket/util.js';

function createNoopIo() {
  return {
    to: (_room: string) => ({ emit: () => {} }),
    emit: () => {},
  } as any;
}

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
    { id: playerId, name: 'P1', spectator: false, life: 40, isAI: false },
    { id: opponentId, name: 'P2', spectator: false, life: 40, isAI: false },
  ];
  (game.state as any).startingLife = 40;
  (game.state as any).life = { [playerId]: 40, [opponentId]: 40 };
  (game.state as any).phase = 'main1';
  (game.state as any).step = 'MAIN1';
  (game.state as any).turnPlayer = playerId;
  (game.state as any).priority = playerId;
  (game.state as any).stack = [];
  (game.state as any).battlefield = [];
  (game.state as any).zones = {
    [playerId]: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0, library: [], libraryCount: 0 },
    [opponentId]: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0, library: [], libraryCount: 0 },
  };
  (game as any).libraries = new Map<PlayerID, any[]>([[playerId, []], [opponentId, []]]);
  return game;
}

describe('trigger-side graveyard reanimation: trailing Aura attach rider', () => {
  const gameId = 'aura_attach_trigger_rider';
  const playerId = 'p1' as PlayerID;
  const opponentId = 'p2' as PlayerID;

  beforeAll(async () => {
    await initDb();
    initializePriorityResolutionHandler(createNoopIo() as any);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  beforeEach(async () => { await resetGame(gameId); });
  afterEach(async () => { await resetGame(gameId); });

  it('attaches the reanimated Aura to the trigger source permanent (Iridescent Drake-style)', () => {
    const game = seedGame(gameId, playerId, opponentId);
    const drakeCard = {
      id: 'iridescent_drake_card',
      name: 'Iridescent Drake',
      type_line: 'Creature \u2014 Drake',
      oracle_text: 'Flying. When Iridescent Drake enters, you may return target Aura card from your graveyard to the battlefield attached to Iridescent Drake.',
      power: '2', toughness: '2',
    };
    const drakePermanent = {
      id: 'drake_perm',
      controller: playerId,
      owner: playerId,
      counters: {},
      tapped: false,
      summoningSickness: false,
      card: drakeCard,
    };
    (game.state as any).battlefield.push(drakePermanent);

    const auraCard = {
      id: 'flight_aura_card',
      name: 'Flight',
      type_line: 'Enchantment \u2014 Aura',
      oracle_text: 'Enchant creature. Enchanted creature has flying.',
    };
    (game.state as any).zones[playerId].graveyard.push(auraCard);
    (game.state as any).zones[playerId].graveyardCount = 1;

    executeTriggerEffect(
      game as any,
      playerId,
      'Iridescent Drake',
      'Return target Aura card from your graveyard to the battlefield attached to Iridescent Drake.',
      {
        source: 'drake_perm',
        permanentId: 'drake_perm',
        triggerType: 'etb',
        card: drakeCard,
        targets: [auraCard.id],
      } as any
    );

    const battlefield: any[] = (game.state as any).battlefield;
    const aura = battlefield.find((p) => p?.card?.id === auraCard.id);
    expect(aura).toBeDefined();
    expect(aura.attachedTo).toBe('drake_perm');
    expect((game.state as any).zones[playerId].graveyard).toHaveLength(0);
  });

  it('does not set attachedTo when the rider says "attached to <other>" naming a different permanent', () => {
    const game = seedGame(gameId, playerId, opponentId);
    const sourceCard = {
      id: 'src_card',
      name: 'Some Trigger Source',
      type_line: 'Creature \u2014 Wizard',
      oracle_text: '',
      power: '1', toughness: '1',
    };
    const sourcePerm = {
      id: 'src_perm',
      controller: playerId, owner: playerId,
      counters: {}, tapped: false, summoningSickness: false,
      card: sourceCard,
    };
    (game.state as any).battlefield.push(sourcePerm);

    const auraCard = {
      id: 'mind_control_card',
      name: 'Mind Control',
      type_line: 'Enchantment \u2014 Aura',
      oracle_text: 'Enchant creature. You control enchanted creature.',
    };
    (game.state as any).zones[playerId].graveyard.push(auraCard);
    (game.state as any).zones[playerId].graveyardCount = 1;

    // Description names a totally different permanent; rider should not match self/it/source-name.
    executeTriggerEffect(
      game as any,
      playerId,
      'Some Trigger Source',
      'Return target Aura card from your graveyard to the battlefield attached to Other Permanent.',
      {
        source: 'src_perm',
        permanentId: 'src_perm',
        triggerType: 'etb',
        card: sourceCard,
        targets: [auraCard.id],
      } as any
    );

    const battlefield: any[] = (game.state as any).battlefield;
    const aura = battlefield.find((p) => p?.card?.id === auraCard.id);
    expect(aura).toBeDefined();
    expect(aura.attachedTo).toBeUndefined();
  });
});
