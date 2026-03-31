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

  it('detects Wall of Souls combat-damage wording and preserves opponent-or-planeswalker targeting', () => {
    const p1 = 'p1';

    const state: any = {
      players: [{ id: p1 }],
      battlefield: [
        {
          id: 'wall_perm',
          controller: p1,
          owner: p1,
          card: {
            id: 'wall_card',
            name: 'Wall of Souls',
            type_line: 'Creature — Wall',
            oracle_text:
              "Defender\nWhenever this creature is dealt combat damage, it deals that much damage to target opponent or planeswalker.",
          },
        },
      ],
    };

    const ctx = { state } as unknown as GameContext;

    let triggerInfo: any = null;
    processDamageReceivedTriggers(ctx, state.battlefield[0], 3, (nextTrigger) => {
      triggerInfo = nextTrigger;
    });

    expect(triggerInfo).toBeTruthy();
    expect(triggerInfo.damageAmount).toBe(3);
    expect(triggerInfo.targetType).toBe('opponent_or_planeswalker');
    expect(String(triggerInfo.effect || '')).toContain('target opponent or planeswalker');
  });

  it('detects generic combat-damage life-gain triggers without target selection', () => {
    const p1 = 'p1';

    const state: any = {
      players: [{ id: p1 }],
      battlefield: [
        {
          id: 'essence_perm',
          controller: p1,
          owner: p1,
          card: {
            id: 'essence_card',
            name: 'Wall of Essence',
            type_line: 'Creature — Wall',
            oracle_text:
              'Defender\nWhenever this creature is dealt combat damage, you gain that much life.',
          },
        },
      ],
    };

    const ctx = { state } as unknown as GameContext;

    let triggerInfo: any = null;
    processDamageReceivedTriggers(ctx, state.battlefield[0], 4, (nextTrigger) => {
      triggerInfo = nextTrigger;
    });

    expect(triggerInfo).toBeTruthy();
    expect(triggerInfo.targetType).toBe('none');
    expect(triggerInfo.effectMode).toBe('gain_life');
    expect(triggerInfo.damageAmount).toBe(4);
  });

  it('captures the attacking player for Souls of the Faultless life-loss reflection', () => {
    const p1 = 'p1';
    const p2 = 'p2';

    const state: any = {
      players: [{ id: p1 }, { id: p2 }],
      phase: 'combat',
      turnPlayer: p2,
      activePlayer: p2,
      battlefield: [
        {
          id: 'souls_perm',
          controller: p1,
          owner: p1,
          card: {
            id: 'souls_card',
            name: 'Souls of the Faultless',
            type_line: 'Creature — Spirit',
            oracle_text:
              "Defender\nWhenever this creature is dealt combat damage, you gain that much life and attacking player loses that much life.",
          },
        },
      ],
    };

    const ctx = { state } as unknown as GameContext;

    let triggerInfo: any = null;
    processDamageReceivedTriggers(ctx, state.battlefield[0], 3, (nextTrigger) => {
      triggerInfo = nextTrigger;
    });

    expect(triggerInfo).toBeTruthy();
    expect(triggerInfo.targetType).toBe('none');
    expect(triggerInfo.effectMode).toBe('gain_life_and_attacking_player_loses_life');
    expect(triggerInfo.attackingPlayerId).toBe(p2);
  });
});
