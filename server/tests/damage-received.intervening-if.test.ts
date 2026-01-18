import { describe, it, expect } from 'vitest';
import type { GameContext } from '../src/state/context';
import { processDamageReceivedTriggers } from '../src/state/modules/triggers/damage-received';

describe('Intervening-if filtering for damage-received triggers (trigger time)', () => {
  it('does not queue a damage-received trigger when recognized intervening-if is false', () => {
    const p1 = 'p1';

    const state: any = {
      players: [{ id: p1 }],
      battlefield: [
        {
          id: 'dmg_perm',
          controller: p1,
          owner: p1,
          card: {
            id: 'dmg_perm_card',
            name: 'Test Damage Creature',
            type_line: 'Creature — Weird',
            oracle_text:
              "Whenever this creature is dealt damage, if you control an artifact, it deals that much damage to target opponent.",
          },
        },
      ],
    };

    const ctx = { state } as unknown as GameContext;

    let fired = 0;
    processDamageReceivedTriggers(ctx, state.battlefield[0], 3, () => {
      fired += 1;
    });
    expect(fired).toBe(0);

    // Satisfy the condition: control an artifact.
    state.battlefield.push({
      id: 'art_1',
      controller: p1,
      owner: p1,
      card: { id: 'art_1_card', name: 'Test Artifact', type_line: 'Artifact', oracle_text: '' },
    });

    processDamageReceivedTriggers(ctx, state.battlefield[0], 3, () => {
      fired += 1;
    });
    expect(fired).toBe(1);
  });
});
