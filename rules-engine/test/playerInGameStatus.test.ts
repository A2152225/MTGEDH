import { describe, expect, it } from 'vitest';
import {
  playerHasLeftTheGame,
  playerIsLegalAttackTarget,
} from '../src/playerInGameStatus';

describe('playerInGameStatus', () => {
  it('treats hasLost, eliminated, conceded, and leftGame as leaving the game', () => {
    expect(playerHasLeftTheGame({ id: 'p1', hasLost: true })).toBe(true);
    expect(playerHasLeftTheGame({ id: 'p1', eliminated: true })).toBe(true);
    expect(playerHasLeftTheGame({ id: 'p1', conceded: true })).toBe(true);
    expect(playerHasLeftTheGame({ id: 'p1', leftGame: true })).toBe(true);
    expect(playerHasLeftTheGame({ id: 'p1', life: 0 } as any)).toBe(false);
  });

  it('does not treat 0 life as a legal-attack-target disqualifier', () => {
    expect(playerIsLegalAttackTarget({ id: 'p2' }, 'p1')).toBe(true);
    expect(playerIsLegalAttackTarget({ id: 'p2', hasLost: true }, 'p1')).toBe(false);
    expect(playerIsLegalAttackTarget({ id: 'p2', eliminated: true }, 'p1')).toBe(false);
    expect(playerIsLegalAttackTarget({ id: 'p2', isSpectator: true }, 'p1')).toBe(false);
    expect(playerIsLegalAttackTarget({ id: 'p1' }, 'p1')).toBe(false);
  });
});
