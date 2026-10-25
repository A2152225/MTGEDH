import { describe, it, expect } from 'vitest';
import { getCreatureInfo } from '../src/components/CombatSelectionModal-handlers/combatSelectionModalCreatureInfo';
import { isActivationManaOnly, isActivationFullyLocked } from '../src/components/PermanentRulesStatusBadges';

const mk = (oracle_text: string) => ({ id: 'c', controller: 'A', card: { name: 'X', oracle_text, type_line: 'Creature' } } as any);

describe('combat requirement hints', () => {
  it('flags must-attack / must-block / restrictions', () => {
    expect(getCreatureInfo(mk('X attacks each combat if able.')).dangers.mustAttack).toBe(true);
    expect(getCreatureInfo(mk('X blocks each combat if able.')).dangers.mustBlock).toBe(true);
    expect(getCreatureInfo(mk("X can't block.")).dangers.cantBlock).toBe(true);
    expect(getCreatureInfo(mk("X can't attack or block.")).dangers.cantAttack).toBe(true);
    expect(getCreatureInfo(mk("X can't attack unless you pay {2}.")).dangers.cantAttack).toBe(false);
    expect(getCreatureInfo(mk('Flying')).dangers.mustAttack).toBe(false);
  });
});

describe('mana-exempt activation lock', () => {
  it('distinguishes mana-only from full locks', () => {
    const manaOnly = { rulesStatus: { activationLocked: { manaAbilitiesAllowed: true } } };
    const full = { rulesStatus: { activationLocked: { manaAbilitiesAllowed: false } } };
    expect(isActivationManaOnly(manaOnly)).toBe(true);
    expect(isActivationFullyLocked(manaOnly)).toBe(false);
    expect(isActivationManaOnly(full)).toBe(false);
    expect(isActivationFullyLocked(full)).toBe(true);
  });
});
