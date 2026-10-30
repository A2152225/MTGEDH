import { describe, it, expect } from 'vitest';
import { calculateVariablePT } from '../src/state/utils.js';

describe('calculateVariablePT', () => {
  it('counts artifacts and/or creatures you control once each', () => {
    const controllerId = 'p1';
    const gameState = {
      players: [{ id: controllerId }],
      battlefield: [
        {
          id: 'smithy',
          controller: controllerId,
          card: { name: 'Thousand Moons Smithy', type_line: 'Legendary Artifact' },
        },
        {
          id: 'soldier',
          controller: controllerId,
          card: { name: 'Soldier', type_line: 'Creature — Soldier' },
        },
        {
          id: 'golem',
          controller: controllerId,
          card: {
            name: 'Gnome Soldier',
            type_line: 'Token Artifact Creature — Gnome Soldier',
            oracle_text:
              "This token's power and toughness are each equal to the number of artifacts and/or creatures you control.",
          },
        },
        {
          id: 'opponent-creature',
          controller: 'p2',
          card: { name: 'Bear', type_line: 'Creature — Bear' },
        },
      ],
      zones: {},
    };

    const pt = calculateVariablePT(
      {
        name: 'Gnome Soldier',
        type_line: 'Token Artifact Creature — Gnome Soldier',
        oracle_text:
          "This token's power and toughness are each equal to the number of artifacts and/or creatures you control.",
        controller: controllerId,
      },
      gameState,
    );

    expect(pt).toEqual({ power: 3, toughness: 3 });
  });

  it('counts face-down creatures on the battlefield for Ixidron', () => {
    const oracle_text =
      "As this creature enters, turn all other nontoken creatures face down. (They're 2/2 creatures.)\nIxidron's power and toughness are each equal to the number of face-down creatures on the battlefield.";
    const ixidron = { id: 'ix', controller: 'p1', card: { id: 'ix-card', name: 'Ixidron', type_line: 'Creature — Illusion', oracle_text } };
    const faceDown = (id: string, controller: string) => ({
      id,
      controller,
      isFaceDown: true,
      card: { id, faceDown: true, isFaceDownStub: true, name: '', type_line: 'Creature', power: '2', toughness: '2' },
    });
    const gameState = {
      players: [{ id: 'p1' }, { id: 'p2' }],
      battlefield: [
        ixidron,
        faceDown('fd1', 'p1'),
        faceDown('fd2', 'p2'),
        faceDown('fd3', 'p2'),
        { id: 'token', controller: 'p1', isToken: true, card: { name: 'Soldier', type_line: 'Token Creature — Soldier' } },
      ],
      zones: {},
    };

    expect(calculateVariablePT({ ...ixidron.card, controller: 'p1' }, gameState)).toEqual({ power: 3, toughness: 3 });
  });
});
