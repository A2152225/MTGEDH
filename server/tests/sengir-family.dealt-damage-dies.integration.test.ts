import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createGameIfNotExists, initDb } from '../src/db/index.js';
import { ensureGame } from '../src/socket/util.js';
import { movePermanentToGraveyard } from '../src/state/modules/counters_tokens.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';
import { resetIntegrationGame } from './helpers/integrationGameReset.js';

import '../src/state/modules/priority.js';

const SENGIR = 'Flying\nWhenever a creature dealt damage by this creature this turn dies, put a +1/+1 counter on this creature.';

function setup(gameId: string, damaged: boolean) {
  createGameIfNotExists(gameId, 'commander', 40);
  const game = ensureGame(gameId);
  if (!game) throw new Error('ensureGame returned undefined');
  const s: any = game.state;
  s.players = [
    { id: 'p1', name: 'P1', spectator: false, life: 40 },
    { id: 'p2', name: 'P2', spectator: false, life: 40 },
  ];
  s.turnPlayer = 'p1';
  s.priority = 'p1';
  s.stack = [];
  const mk = (id: string, ctl: string, name: string, oracle: string) => ({
    id, controller: ctl, owner: ctl, tapped: false, counters: {}, basePower: 2, baseToughness: 2,
    card: { id: id + '_card', name, type_line: 'Creature - Vampire', oracle_text: oracle, zone: 'battlefield', power: '2', toughness: '2' },
  });
  s.battlefield = [mk('sengir_1', 'p1', 'Sengir Vampire', SENGIR), mk('victim_1', 'p2', 'Doomed Guard', '')];
  const z = () => ({ hand: [], handCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0, library: [], libraryCount: 0 });
  s.zones = { p1: z(), p2: z() };
  s.creaturesDamagedByThisCreatureThisTurn = damaged ? { sengir_1: { victim_1: true } } : {};
  return game;
}

describe('Sengir family: dealt damage by this creature this turn dies', () => {
  const gameId = 'test_sengir_family_dealt_damage_dies';
  beforeAll(async () => { await initDb(); });
  beforeEach(async () => { ResolutionQueueManager.removeQueue(gameId); await resetIntegrationGame(gameId); });

  it('queues and resolves the +1/+1 counter when a damaged creature dies', () => {
    const game: any = setup(gameId, true);
    expect(movePermanentToGraveyard(game, 'victim_1')).toBe(true);
    expect(game.state.stack).toHaveLength(1);
    expect(game.state.stack[0]).toMatchObject({ source: 'sengir_1' });
    game.resolveTopOfStack();
    const sengir = game.state.battlefield.find((p: any) => p.id === 'sengir_1');
    expect(Number(sengir?.counters?.['+1/+1'] || 0)).toBe(1);
  });

  it('does not trigger when the dying creature was not damaged by it this turn', () => {
    const game: any = setup(gameId, false);
    expect(movePermanentToGraveyard(game, 'victim_1')).toBe(true);
    expect(game.state.stack || []).toHaveLength(0);
  });
});
