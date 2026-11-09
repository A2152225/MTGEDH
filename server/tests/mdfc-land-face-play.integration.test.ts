import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createGameIfNotExists, deleteGame, initDb } from '../src/db/index.js';
import { registerGameActions } from '../src/socket/game-actions.js';
import { ensureGame } from '../src/socket/util.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';
import { games } from '../src/socket/socket.js';
import { applyManualAction } from '../src/state/modules/manualActionApply.js';

const gameId = 'test_mdfc_land_face_play_from_hand';
const p1 = 'p1';
const face = (name: string, type_line: string, extra: any = {}) => ({ name, type_line, oracle_text: '', image_uris: { small: `https://example.com/${name}.jpg` }, ...extra });
const malakir = () => ({
  id: 'malakir_1', name: 'Malakir Rebirth // Malakir Mire', type_line: 'Instant // Land', layout: 'modal_dfc', cmc: 1,
  card_faces: [face('Malakir Rebirth', 'Instant', { mana_cost: '{B}', oracle_text: 'Choose target creature.' }),
    face('Malakir Mire', 'Land', { mana_cost: '', oracle_text: 'Malakir Mire enters the battlefield tapped.\n{T}: Add {B}.' })],
});
const boggart = () => ({
  id: 'boggart_1', name: 'Boggart Trawler // Boggart Bog', type_line: 'Creature — Goblin // Land', layout: 'modal_dfc', cmc: 3,
  card_faces: [face('Boggart Trawler', 'Creature — Goblin', { mana_cost: '{2}{B}', power: '3', toughness: '1', oracle_text: "When this creature enters, exile target player's graveyard." }),
    face('Boggart Bog', 'Land', { mana_cost: '', oracle_text: '{T}: Add {B}.' })],
});

function setup(hand: any[]): any {
  createGameIfNotExists(gameId, 'commander', 40, undefined, p1);
  const game: any = ensureGame(gameId);
  const s = game.state;
  s.players = [{ id: p1, name: 'P1', spectator: false, life: 40 }];
  s.life = { [p1]: 40 }; s.startingLife = 40;
  s.zones = { [p1]: { hand, handCount: hand.length, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0, library: [], libraryCount: 0 } };
  s.turnNumber = 3; s.phase = 'precombatMain'; s.step = 'MAIN1'; s.turnPlayer = p1; s.priority = p1;
  s.battlefield = []; s.stack = []; s.landsPlayedThisTurn = { [p1]: 0 };
  return game;
}

function socketFor(): { handlers: Record<string, Function>; emitted: any[] } {
  const emitted: any[] = [];
  const handlers: Record<string, Function> = {};
  const socket: any = { data: { playerId: p1, gameId, spectator: false }, rooms: new Set([gameId]), on: (ev: string, fn: Function) => { handlers[ev] = fn; }, emit: (event: string, payload: any) => emitted.push({ event, payload }) };
  const io: any = { to: () => ({ emit: (event: string, payload: any) => emitted.push({ event, payload }) }), emit: (event: string, payload: any) => emitted.push({ event, payload }), sockets: { sockets: new Map() } };
  registerGameActions(io, socket);
  return { handlers, emitted };
}

async function reset() { ResolutionQueueManager.removeQueue(gameId); games.delete(gameId as any); try { await deleteGame(gameId); } catch { /* test-only */ } }

describe('modal DFC land faces', () => {
  beforeAll(async () => { await initDb(); });
  beforeEach(reset);
  afterEach(reset);

  for (const [label, selectedFace] of [['without a face index', undefined], ['with the back face chosen', 1]] as const) {
    it(`plays a spell-front MDFC as its land back face from hand ${label}`, async () => {
      const game = setup([malakir()]);
      const { handlers, emitted } = socketFor();
      await handlers['playLand']({ gameId, cardId: 'malakir_1', ...(selectedFace === undefined ? {} : { selectedFace }) });
      expect(emitted.filter((e) => e.event === 'error').map((e) => e.payload?.message)).toEqual([]);
      const perm = game.state.battlefield.find((p: any) => p.card?.id === 'malakir_1');
      expect(perm?.card?.name).toBe('Malakir Mire');
      expect(perm?.card?.type_line).toBe('Land');
      expect(game.state.zones[p1].hand).toHaveLength(0);
    });
  }

  it('a modal DFC put onto the battlefield manually enters front face up, and is playable as its land face after a bounce', async () => {
    const game = setup([boggart()]);
    applyManualAction(game as any, { verb: 'put_from_hand', actorId: p1, targetPlayerId: p1, objectIds: ['boggart_1'], toZone: 'battlefield' } as any);
    const perm = game.state.battlefield.find((p: any) => p.card?.id === 'boggart_1');
    expect(perm.card.type_line).toBe('Creature — Goblin');
    applyManualAction(game as any, { verb: 'bounce', actorId: p1, targetPlayerId: p1, objectIds: [perm.id], toZone: 'hand' } as any);
    const back = game.state.zones[p1].hand.find((c: any) => c.id === 'boggart_1');
    expect(back.type_line).toBe('Creature — Goblin // Land');
    expect(back.selectedMDFCFace).toBeUndefined();
    const { handlers } = socketFor();
    await handlers['playLand']({ gameId, cardId: 'boggart_1' });
    const land = game.state.battlefield.find((p: any) => p.card?.id === 'boggart_1');
    expect(land?.card?.name).toBe('Boggart Bog');
    expect(land?.card?.type_line).toBe('Land');
  });

  it('a modal DFC put onto the battlefield manually enters front face up with that face\'s characteristics', () => {
    const game = setup([boggart()]);
    const res: any = applyManualAction(game as any, { verb: 'put_from_hand', actorId: p1, targetPlayerId: p1, objectIds: ['boggart_1'], toZone: 'battlefield' } as any);
    expect(res?.ok).toBe(true);
    const perm = game.state.battlefield.find((p: any) => p.card?.id === 'boggart_1');
    expect(perm.card.name).toBe('Boggart Trawler');
    expect(perm.card.type_line).toBe('Creature — Goblin');
    expect(perm.basePower).toBe(3);
    expect(perm.baseToughness).toBe(1);
    expect(perm.card.card_faces).toHaveLength(2);
  });
});