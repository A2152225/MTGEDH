import { describe, expect, it } from 'vitest';
import { parseOracleTextToIR } from '../../rules-engine/src/oracleIRParser.js';
import { tryApplyOracleIRToActivatedAbility } from '../src/state/modules/oracleIrAbilityExecution.js';

describe('oracle IR activated ability execution', () => {
  it('parses Wizard\'s Spellbook d20 branches from activated effect text', () => {
    const effectText =
      'Exile target instant or sorcery card from a graveyard. Roll a d20.\n' +
      '1—9 | Copy that card. You may cast the copy.\n' +
      '10—19 | Copy that card. You may cast the copy without paying its mana cost.\n' +
      '20 | Copy each card exiled with Wizard\'s Spellbook. You may cast any number of the copies without paying their mana costs.';
    const ir = parseOracleTextToIR(effectText, "Wizard's Spellbook");
    const steps = ir.abilities.flatMap((ability) => ability.steps);
    expect(steps.some((step) => step.kind === 'move_zone')).toBe(true);
    expect(steps.some((step) => step.kind === 'roll_die')).toBe(true);
  });

  it('reports handled for supported activated ability steps', () => {
    const ctx = {
      state: {
        players: [{ id: 'p1', name: 'Player 1' }],
        battlefield: [],
        life: { p1: 40 },
        zones: {
          p1: {
            hand: [],
            library: [],
            graveyard: [
              {
                id: 'gy1',
                name: 'Lightning Bolt',
                type_line: 'Instant',
                oracle_text: 'Lightning Bolt deals 3 damage to any target.',
              },
            ],
            exile: [],
          },
        },
      },
    } as any;

    const oracleText =
      "{T}: Exile target instant or sorcery card from a graveyard. Roll a d20.\n" +
      "1—9 | Copy that card. You may cast the copy.\n" +
      "10—19 | Copy that card. You may cast the copy without paying its mana cost.\n" +
      "20 | Copy each card exiled with Wizard's Spellbook. You may cast any number of the copies without paying their mana costs.";

    const result = tryApplyOracleIRToActivatedAbility(ctx, {
      controller: 'p1',
      sourceName: "Wizard's Spellbook",
      oracleText,
      sourcePermanentId: 'perm1',
      stackItemId: 'stack1',
      targets: ['gy1'],
      allowOptional: true,
    });

    expect(result.handled).toBe(true);
    expect(result.applied).toBeGreaterThan(0);
  });
});
