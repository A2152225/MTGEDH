import { describe, expect, it } from 'vitest';
import { applyEvent } from '../src/state/modules/applyEvent';
import { evaluateInterveningIfClause } from '../src/state/modules/triggers/intervening-if';

describe('Intervening-if: added mana with this ability this turn', () => {
  const clause = "if you haven't added mana with this ability this turn";

  it('returns null when tracking is absent', () => {
    const g: any = { state: {} };
    expect(evaluateInterveningIfClause(g, 'p1', clause, { id: 'perm1' } as any, { abilityId: '0' } as any)).toBe(null);
  });

  it('returns true when tracking exists and ability has no entry (provably not yet)', () => {
    const g: any = {
      state: {
        addedManaWithThisAbilityThisTurn: {
          p1: {},
        },
      },
    };
    expect(evaluateInterveningIfClause(g, 'p1', clause, { id: 'perm1' } as any, { abilityId: '0' } as any)).toBe(true);
  });

  it('returns false when tracking shows mana was added for this ability', () => {
    const g: any = {
      state: {
        addedManaWithThisAbilityThisTurn: {
          p1: {
            'perm1:0': true,
          },
        },
      },
    };
    expect(evaluateInterveningIfClause(g, 'p1', clause, { id: 'perm1' } as any, { abilityId: '0' } as any)).toBe(false);
  });

  it('accepts explicit permanent-scoped boolean when abilityId is unknown', () => {
    const g: any = {
      state: {
        addedManaWithThisAbilityThisTurn: {
          p1: {
            perm1: true,
          },
        },
      },
    };
    expect(evaluateInterveningIfClause(g, 'p1', clause, { id: 'perm1' } as any)).toBe(false);
  });

  it('applyEvent(activateManaAbility) sets tracking deterministically', () => {
    const ctx: any = { state: { battlefield: [] }, bumpSeq() {} };

    applyEvent(ctx, {
      type: 'activateManaAbility',
      playerId: 'p1',
      permanentId: 'perm1',
      abilityId: '0',
      manaColor: 'G',
    } as any);

    expect(ctx.state.addedManaWithThisAbilityThisTurn?.p1?.['perm1:0']).toBe(true);

    // Now the clause should be deterministically false.
    expect(evaluateInterveningIfClause(ctx, 'p1', clause, { id: 'perm1' } as any, { abilityId: '0' } as any)).toBe(false);
  });

  it('applyEvent(activateBattlefieldAbility) sets tracking for mana-like activations', () => {
    const ctx: any = { state: {}, bumpSeq() {} };

    applyEvent(ctx, {
      type: 'activateBattlefieldAbility',
      playerId: 'p1',
      permanentId: 'perm1',
      abilityId: '0',
      abilityText: '{T}: Add {G}.',
      cardName: 'Forest',
    } as any);

    expect(ctx.state.addedManaWithThisAbilityThisTurn?.p1?.['perm1:0']).toBe(true);
  });
});
