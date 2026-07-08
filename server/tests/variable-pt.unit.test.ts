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
});
