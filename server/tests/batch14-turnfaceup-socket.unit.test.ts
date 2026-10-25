import { describe, it, expect, vi, beforeEach } from 'vitest';

const games = new Map<string, any>();
vi.mock('../src/socket/util.js', () => ({
  ensureGame: (id: string) => games.get(id),
  broadcastGame: vi.fn(),
  getPlayerName: (_g: any, id: string) => id,
  payManaCostWithAvailableSources: vi.fn(() => ({ ok: true, tappedPermanents: ['land1'] })),
}));
vi.mock('../src/db/index.js', () => ({ appendEvent: vi.fn() }));
vi.mock('../src/state/modules/triggerEmissionFamilyUtils.js', () => ({ processFaceUpTriggers: vi.fn() }));

import { handleTurnFaceUpRequest } from '../src/socket/game-actions-handlers/gameActionsTurnFaceUpSocketHandler.js';
import { appendEvent } from '../src/db/index.js';
import { buildFaceDownCardStub } from '../src/state/modules/faceDownCasting.js';

function setup(oracle: string, extraBattlefield: any[] = []) {
  const real = { id: 'r1', name: 'Real Thing', type_line: 'Creature \u2014 Bird', oracle_text: oracle, power: '3', toughness: '3' };
  const state: any = {
    priority: 'a',
    battlefield: [{ id: 'p1', controller: 'a', owner: 'a', isFaceDown: true, faceDownType: 'morph', faceUpCard: real, card: buildFaceDownCardStub('morph', 'p1') }, ...extraBattlefield],
    zones: { a: { hand: [], graveyard: [] } },
    life: { a: 20 },
  };
  const game: any = {
    state, seq: 1, bumpSeq: () => {},
    applyEvent: (e: any) => { const p = state.battlefield.find((x: any) => x.id === e.permanentId); if (p) { p.isFaceDown = false; p.card = e.actualCard; } },
  };
  game.ctx = game;
  games.set('g', game);
  const roomEmits: any[] = [];
  const io: any = { to: () => ({ emit: (ev: string, data: any) => roomEmits.push([ev, data]) }) };
  const sockEmits: any[] = [];
  const socket: any = { data: { playerId: 'a' }, emit: (ev: string, data: any) => sockEmits.push([ev, data]) };
  return { state, io, socket, roomEmits, sockEmits };
}

describe('Batch 14 - turnFaceUp socket handler', () => {
  beforeEach(() => { (appendEvent as any).mockClear?.(); });
  it('mana morph: always emits cardRevealed for the turned card', async () => {
    const t = setup('Morph {1}{U}');
    await handleTurnFaceUpRequest(t.io, t.socket, () => true, { gameId: 'g', permanentId: 'p1' });
    const rev = t.roomEmits.filter(([e]) => e === 'cardRevealed');
    expect(rev.length).toBe(1);
    expect(rev[0][1]).toMatchObject({ reason: 'turn_face_up', permanentId: 'p1', cardName: 'Real Thing', card: { name: 'Real Thing' } });
    expect((appendEvent as any).mock.calls[0][3]).toMatchObject({ tappedPermanentIds: ['land1'] });
  });
  it('return-a-Bird cost prompts, then pays and persists the ids', async () => {
    const bird = { id: 'b1', controller: 'a', owner: 'a', card: { id: 'bc', name: 'Birdy', type_line: 'Creature \u2014 Bird' } };
    const t = setup("Morph\u2014Return a Bird you control to its owner's hand.", [bird]);
    await handleTurnFaceUpRequest(t.io, t.socket, () => true, { gameId: 'g', permanentId: 'p1' });
    expect(t.sockEmits[0]).toEqual(['turnFaceUpCostPrompt', expect.objectContaining({ component: 'return', count: 1, candidateIds: ['b1'] })]);
    await handleTurnFaceUpRequest(t.io, t.socket, () => true, { gameId: 'g', permanentId: 'p1', costChoices: { return: ['b1'] } });
    expect(t.state.battlefield.map((p: any) => p.id)).toEqual(['p1']);
    expect(t.state.battlefield[0].isFaceDown).toBe(false);
    expect((appendEvent as any).mock.calls[0][3]).toMatchObject({ returnedPermanentIds: ['b1'] });
    expect(t.roomEmits.some(([e, d]) => e === 'cardRevealed' && d.reason === 'turn_face_up')).toBe(true);
  });
  it('reveal cost keeps the legacy reveal prompt and emits two reveals', async () => {
    const t = setup('Morph\u2014Reveal a white card in your hand.');
    t.state.zones.a.hand.push({ id: 'w1', name: 'Plains Guy', colors: ['W'] });
    await handleTurnFaceUpRequest(t.io, t.socket, () => true, { gameId: 'g', permanentId: 'p1' });
    expect(t.sockEmits[0][0]).toBe('turnFaceUpRevealPrompt');
    await handleTurnFaceUpRequest(t.io, t.socket, () => true, { gameId: 'g', permanentId: 'p1', revealCardId: 'w1' });
    const reasons = t.roomEmits.filter(([e]) => e === 'cardRevealed').map(([, d]) => d.reason);
    expect(reasons).toEqual(['turn_face_up', 'turn_face_up_cost']);
  });
});