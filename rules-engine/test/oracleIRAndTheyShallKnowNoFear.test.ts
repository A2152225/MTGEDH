import { describe, expect, it } from 'vitest';

import type { GameState, PlayerID } from '../../shared/src';
import { applyOracleIRStepsToGameState, buildOracleIRExecutionContext } from '../src/oracleIRExecutor';
import { parseOracleTextToIR } from '../src/oracleIRParser';
import { executorPermanentHasIndestructible } from '../src/oracleIRExecutorBattlefieldIndestructible';

const ATSKNF_TEXT =
  'Choose a creature type. Creatures you control of the chosen type get +1/+0 and gain indestructible until end of turn.';
const GENEROUS_GIFT_TEXT =
  'Destroy target permanent. Its controller creates a 3/3 green Elephant creature token.';

function makeState(): GameState {
  return {
    players: [
      { id: 'p_myrel', name: 'Myrel' },
      { id: 'p_neera', name: 'Neera' },
    ],
    battlefield: [
      {
        id: 'neera_1',
        controller: 'p_neera',
        owner: 'p_neera',
        card: {
          id: 'neera_card',
          name: 'Neera, Wild Mage',
          type_line: 'Legendary Creature — Human Elf Shaman',
          power: '2',
          toughness: '7',
        },
      },
      {
        id: 'wizard_1',
        controller: 'p_neera',
        owner: 'p_neera',
        card: {
          id: 'wizard_card',
          name: 'Snapcaster Mage',
          type_line: 'Creature — Human Wizard',
          power: '2',
          toughness: '1',
        },
      },
    ],
    zones: {
      p_myrel: { hand: [], graveyard: [], exile: [] },
      p_neera: { hand: [], graveyard: [], exile: [] },
    },
  } as GameState;
}

function applySpell(
  state: GameState,
  oracleText: string,
  sourceName: string,
  controllerId: PlayerID,
  extras: {
    chosenCreatureType?: string;
    chosenObjectIds?: string[];
    targetPermanentId?: string;
  } = {},
) {
  const ir = parseOracleTextToIR(oracleText, sourceName);
  const steps = ir.abilities.flatMap((ability) => ability.steps || []);
  return applyOracleIRStepsToGameState(
    state,
    steps,
    buildOracleIRExecutionContext({
      controllerId,
      sourceName,
      sourceObjectType: 'spell',
      ...(extras.chosenCreatureType ? { selectorContext: { chosenCreatureType: extras.chosenCreatureType } } : {}),
      ...(extras.chosenObjectIds ? { selectorContext: { chosenCreatureType: extras.chosenCreatureType, chosenObjectIds: extras.chosenObjectIds } } : {}),
      ...(extras.targetPermanentId ? { targetPermanentId: extras.targetPermanentId } : {}),
    }, {
      sourceObjectType: 'spell',
      ...(extras.chosenCreatureType ? { chosenCreatureType: extras.chosenCreatureType } : {}),
      ...(extras.chosenObjectIds ? { chosenObjectIds: extras.chosenObjectIds } : {}),
    }),
    { allowOptional: true },
  );
}

describe('And They Shall Know No Fear vs Generous Gift', () => {
  it('parses choose-type then until-EOT +1/+0 and indestructible', () => {
    const ir = parseOracleTextToIR(ATSKNF_TEXT, 'And They Shall Know No Fear');
    const steps = ir.abilities.flatMap((ability) => ability.steps || []);
    expect(steps.map((step) => step.kind)).toEqual([
      'choose_creature_type',
      'modify_pt',
      'grant_temporary_ability',
    ]);
    expect(steps[2]).toMatchObject({
      kind: 'grant_temporary_ability',
      abilities: ['indestructible'],
    });
  });

  it('Hive Mind copy choosing Elf grants indestructible so Generous Gift cannot destroy Neera', () => {
    const afterFear = applySpell(
      makeState(),
      ATSKNF_TEXT,
      'And They Shall Know No Fear',
      'p_neera',
      { chosenCreatureType: 'Elf' },
    );

    expect(afterFear.appliedSteps?.map((step) => step.kind)).toEqual([
      'choose_creature_type',
      'modify_pt',
      'grant_temporary_ability',
    ]);

    const neera = (afterFear.state.battlefield || []).find((perm: any) => perm.id === 'neera_1');
    const wizard = (afterFear.state.battlefield || []).find((perm: any) => perm.id === 'wizard_1');
    expect(neera).toBeTruthy();
    expect(executorPermanentHasIndestructible(neera, afterFear.state.battlefield || [])).toBe(true);
    expect(executorPermanentHasIndestructible(wizard, afterFear.state.battlefield || [])).toBe(false);
    expect(((neera as any)?.grantedAbilities || []).map((value: unknown) => String(value).toLowerCase()))
      .toContain('indestructible');

    const afterGift = applySpell(
      afterFear.state as GameState,
      GENEROUS_GIFT_TEXT,
      'Generous Gift',
      'p_myrel',
      { chosenObjectIds: ['neera_1'], targetPermanentId: 'neera_1' },
    );

    expect(afterGift.appliedSteps?.map((step) => step.kind)).toEqual(['destroy', 'create_token']);
    expect((afterGift.state.battlefield || []).some((perm: any) => perm.id === 'neera_1')).toBe(true);
    expect((afterGift.log || []).some((line) => /indestructible and wasn't destroyed/i.test(line))).toBe(true);
    expect((afterGift.state.battlefield || []).some((perm: any) =>
      perm.controller === 'p_neera' && /elephant/i.test(String(perm.card?.name || perm.name || '')),
    )).toBe(true);
  });
});
