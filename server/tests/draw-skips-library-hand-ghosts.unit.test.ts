import { describe, expect, it } from 'vitest';
import { commitCardDraws } from '../../rules-engine/src/oracleIRExecutorDrawTransitionCommit.js';
import { drawCardsForPlayer } from '../../rules-engine/src/oracleIRExecutorPlayerUtils.js';

function handAndLibrary() {
  const hotPursuit = { id: 'hot_pursuit', name: 'Hot Pursuit' };
  const swamp = { id: 'swamp_1', name: 'Swamp' };
  const drawnA = { id: 'drawn_a', name: 'Mountain' };
  const drawnB = { id: 'drawn_b', name: 'Forest' };
  return {
    players: [{ id: 'p1', hand: [{ ...hotPursuit }, { ...swamp }], library: [] }],
    zones: {
      p1: {
        hand: [{ ...hotPursuit }, { ...swamp }],
        library: [{ ...hotPursuit }, { ...swamp }, { ...drawnA }, { ...drawnB }],
      },
    },
  };
}

describe('draw skips library cards already in hand', () => {
  it('does not copy hand cards when those ids are still on top of the library', () => {
    const state: any = handAndLibrary();
    const player = state.players[0];
    const result = drawCardsForPlayer(state, 'p1', 2);
    const names = (result.state.players[0].hand || player.hand).map((card: any) => card.name);
    expect(names.filter((name: string) => name === 'Hot Pursuit')).toHaveLength(1);
    expect(names.filter((name: string) => name === 'Swamp')).toHaveLength(1);
    expect(names).toEqual(['Hot Pursuit', 'Swamp', 'Mountain', 'Forest']);
  });

  it('commitCardDraws also skips those ghosts', () => {
    const state: any = handAndLibrary();
    const result = commitCardDraws({
      state,
      playerId: 'p1',
      count: 2,
      stepIndex: 0,
      stepKind: 'draw',
      cause: 'test',
      ctx: {
        serverBridge: {
          proposeTransitions(transitions: any[]) {
            return { ready: transitions, halt: false };
          },
        },
      } as any,
    });
    const names = result.state.zones.p1.hand.map((card: any) => card.name);
    expect(names.filter((name: string) => name === 'Hot Pursuit')).toHaveLength(1);
    expect(names.filter((name: string) => name === 'Swamp')).toHaveLength(1);
    expect(names).toEqual(['Hot Pursuit', 'Swamp', 'Mountain', 'Forest']);
    expect(result.drawnCount).toBe(2);
  });
});
