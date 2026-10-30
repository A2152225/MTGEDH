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

  it('does not mark goad sources for a requirement that applies to other creatures', () => {
    const baeloth =
      "Creatures your opponents control with power less than Baeloth Barrityl's power are goaded. " +
      '(They attack each combat if able and attack a player other than you if able.)\n' +
      'Whenever a goaded attacking or blocking creature dies, you create a Treasure token.';
    expect(getCreatureInfo(mk(baeloth)).dangers.mustAttack).toBe(false);

    const ancestor =
      'Whenever this creature enters or attacks, goad target creature. ' +
      '(Until your next turn, that creature attacks each combat if able and attacks a player other than you if able.)';
    expect(getCreatureInfo(mk(ancestor)).dangers.mustAttack).toBe(false);

    expect(getCreatureInfo(mk('Creatures your opponents control attack each combat if able.')).dangers.mustAttack).toBe(false);
    expect(getCreatureInfo(mk('Other creatures you control attack each combat if able.')).dangers.mustAttack).toBe(false);
    expect(getCreatureInfo(mk('Whenever Fire Lord Ozai attacks, you may sacrifice another creature.')).dangers.mustAttack).toBe(false);
  });

  it('still marks creatures that are included in the attack requirement', () => {
    expect(getCreatureInfo(mk('All creatures have double strike and attack each combat if able.')).dangers.mustAttack).toBe(true);
    expect(getCreatureInfo(mk('Creatures you control attack each combat if able.')).dangers.mustAttack).toBe(true);
    const iron = mk('Iron Golem attacks or blocks each combat if able.');
    iron.card.name = 'Iron Golem';
    expect(getCreatureInfo(iron).dangers.mustAttack).toBe(true);
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
