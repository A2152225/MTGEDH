import { describe, expect, it } from 'vitest';
import type { GameState, PlayerID } from '../../shared/src';
import { applyTurnFaceDownStep } from '../src/oracleIRExecutorBattlefieldTurnFaceSteps';

describe('turn face down public stub', () => {
  it('keeps the resolved-spell id and publishes a nameless 2/2 creature', () => {
    const p1 = 'p1' as PlayerID;
    const state = {
      id: 'turn-face-down-stub',
      players: [{ id: p1 }],
      battlefield: [{
        id: 'stack_3gy9zr1p',
        controller: p1,
        card: {
          id: 'card-bears',
          name: 'Grizzly Bears',
          type_line: 'Creature — Bear',
          image_uris: { normal: 'https://example.test/bears.jpg' },
          power: '2',
          toughness: '2',
        },
      }],
      stack: [],
    } as unknown as GameState;

    const result = applyTurnFaceDownStep(
      state,
      {
        kind: 'turn_face_down',
        target: { kind: 'raw', text: 'target creature you control' },
        raw: 'turn target creature you control face down',
      } as any,
      { controllerId: p1 } as any,
    );

    expect(result.applied).toBe(true);
    const perm = (result.state as any).battlefield[0];
    expect(perm.id).toBe('stack_3gy9zr1p');
    expect(perm.isFaceDown).toBe(true);
    expect(perm.card.name).toBe('');
    expect(perm.card.displayName).toBe('Face-down creature');
    expect(perm.card.type_line).toBe('Creature');
    expect(perm.card.isFaceDownStub).toBe(true);
    expect(perm.card.image_uris).toBeUndefined();
    expect(perm.faceUpCard.name).toBe('Grizzly Bears');
    expect(perm.effectiveTypes).toEqual(['Creature']);
  });
});
