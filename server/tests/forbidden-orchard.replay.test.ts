import { describe, expect, it } from 'vitest';

import { createInitialGameState } from '../src/state/gameState.js';
import type { PlayerID } from '../../shared/src';

function addPlayer(game: any, id: PlayerID, name: string) {
  game.applyEvent({ type: 'join', playerId: id, name });
}

describe('Forbidden Orchard replay semantics', () => {
  it('replays the chosen opponent Spirit token creation', () => {
    const game = createInitialGameState('t_forbidden_orchard_replay');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    addPlayer(game, p1, 'P1');
    addPlayer(game, p2, 'P2');

    game.applyEvent({
      type: 'confirmForbiddenOrchardTarget',
      playerId: p1,
      permanentId: 'orchard_perm',
      targetOpponentId: p2,
    } as any);

    const battlefield = (game.state as any).battlefield;
    expect(battlefield).toHaveLength(1);

    const token = battlefield[0];
    expect(token.controller).toBe(p2);
    expect(token.owner).toBe(p2);
    expect(token.tapped).toBe(false);
    expect(token.summoningSickness).toBe(true);
    expect(token.isToken).toBe(true);
    expect(token.basePower).toBe(1);
    expect(token.baseToughness).toBe(1);
    expect(token.card.name).toBe('Spirit');
    expect(token.card.type_line).toBe('Token Creature — Spirit');
    expect(token.card.id).toBe(token.id);
  });
});