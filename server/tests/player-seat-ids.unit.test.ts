import { describe, expect, it } from 'vitest';

import { createContext } from '../src/state/context.js';
import { join } from '../src/state/modules/join.js';
import {
  accountPlayerSeatId,
  aiPlayerSeatId,
  decideLoggedInSeat,
  isAiSeatId,
  joinAiPlayerSeat,
} from '../src/socket/join-handlers/playerSeatIds.js';

describe('player seat ids', () => {
  it('uses U_<username> for accounts and rejects unsafe names', () => {
    expect(accountPlayerSeatId('A2152225')).toBe('U_a2152225');
    expect(accountPlayerSeatId('King_2')).toBe('U_king_2');
    expect(accountPlayerSeatId('has space')).toBeNull();
    expect(accountPlayerSeatId('')).toBeNull();
  });

  it('builds AI ids from the display name plus a random suffix', () => {
    const id = aiPlayerSeatId('Humble Defector', []);
    expect(id).toMatch(/^AI_HumbleDefector_[a-z0-9]+$/);
    expect(isAiSeatId(id)).toBe(true);
    expect(isAiSeatId('ai_legacy')).toBe(true);
    expect(isAiSeatId('U_king')).toBe(false);
    expect(isAiSeatId('p_abc')).toBe(false);
  });

  it('seats a logged-in account on the stable id and leaves guests random', () => {
    const ctx = createContext('seat_ids_account');
    const seated = join(ctx, 'sock_account', 'King', false, 'U_king');
    expect(seated.playerId).toBe('U_king');
    expect(seated.added).toBe(true);
    expect(ctx.state.players.map((player) => player.id)).toEqual(['U_king']);
    expect(ctx.life.U_king).toBe(40);

    const guest = createContext('seat_ids_guest');
    const guestSeat = join(guest, 'sock_guest', 'Visitor', false);
    expect(String(guestSeat.playerId)).toMatch(/^p_/);
  });

  it('joins an AI opponent as AI_<Name>_<rand>', () => {
    const ctx = createContext('seat_ids_ai');
    (ctx as any).join = (
      socketId: string,
      name: string,
      spectator: boolean,
      fixedPlayerId?: string,
      seatToken?: string,
    ) => join(ctx, socketId, name, spectator, fixedPlayerId as any, seatToken);
    const seated = joinAiPlayerSeat(ctx, 'Humble Defector');
    expect(seated.playerId).toMatch(/^AI_HumbleDefector_[a-z0-9]+$/);
    expect(ctx.state.players.map((player) => player.id)).toEqual([seated.playerId]);
    expect(seated.seatToken).toBeTruthy();
  });

  it('reuses an open account seat and blocks a second live connection', () => {
    const game = {
      state: { players: [{ id: 'U_king', name: 'King', seatToken: 'tok_king' }] },
      participantsList: [{ socketId: 'sock_live', playerId: 'U_king', spectator: false }],
    };
    expect(decideLoggedInSeat({
      game,
      gameId: 'g1',
      spectator: false,
      username: 'king',
      currentSocketId: 'sock_other',
      joiningName: 'King',
    }).action).toBe('nameInUse');

    game.participantsList = [];
    const reuse = decideLoggedInSeat({
      game,
      gameId: 'g1',
      spectator: false,
      username: 'king',
      currentSocketId: 'sock_back',
      joiningName: 'King',
    });
    expect(reuse).toEqual({ action: 'reuse', playerId: 'U_king', seatToken: 'tok_king' });

    expect(decideLoggedInSeat({
      game: { state: { players: [] }, participantsList: [] },
      gameId: 'g1',
      spectator: false,
      username: 'king',
    })).toEqual({ action: 'assign', playerId: 'U_king' });

    expect(decideLoggedInSeat({
      game: { state: { players: [] }, participantsList: [] },
      gameId: 'g1',
      spectator: true,
      username: 'king',
    })).toEqual({ action: 'none' });
  });
});
