import { describe, expect, it } from 'vitest';
import {
  isCounterPreventingAttack,
  isCounterPreventingBlock,
} from '../../shared/src/counterCombatRestrictions';

const GWafa_ORACLE =
  "{W}{U}, {T}: Put a bribery counter on target creature you don't control. Its controller draws a card.\nCreatures with bribery counters on them can't attack or block.";

describe('counterCombatRestrictions', () => {
  const briberyCreature = {
    id: 'creature_1',
    counters: { bribery: 1 },
    card: { name: 'Opponent Creature', type_line: 'Creature — Human' },
  };

  const gwafa = {
    id: 'gwafa_1',
    card: { name: 'Gwafa Hazid, Profiteer', oracle_text: GWafa_ORACLE },
  };

  it('prevents attack and block while the source permanent is on the battlefield', () => {
    const battlefield = [gwafa, briberyCreature];

    expect(isCounterPreventingAttack(briberyCreature, battlefield)).toMatchObject({
      isPrevented: true,
      counterType: 'bribery',
      sourceName: 'Gwafa Hazid, Profiteer',
    });
    expect(isCounterPreventingBlock(briberyCreature, battlefield)).toMatchObject({
      isPrevented: true,
      counterType: 'bribery',
    });
  });

  it('does not prevent combat when the source leaves the battlefield', () => {
    expect(isCounterPreventingAttack(briberyCreature, [briberyCreature])).toEqual({ isPrevented: false });
    expect(isCounterPreventingBlock(briberyCreature, [briberyCreature])).toEqual({ isPrevented: false });
  });

  it('does not prevent combat when the creature has no bribery counters', () => {
    const cleanCreature = {
      id: 'creature_2',
      counters: {},
      card: { name: 'Clean Creature', type_line: 'Creature — Elf' },
    };

    expect(isCounterPreventingAttack(cleanCreature, [gwafa, cleanCreature])).toEqual({ isPrevented: false });
    expect(isCounterPreventingBlock(cleanCreature, [gwafa, cleanCreature])).toEqual({ isPrevented: false });
  });
});
