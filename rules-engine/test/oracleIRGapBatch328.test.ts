import { describe, expect, it } from 'vitest';
import type { GameState, PlayerID } from '../../shared/src';
import { applyAttachStep } from '../src/oracleIRExecutorAttachStepHandlers';
import { applyOracleIRStepsToGameState } from '../src/oracleIRExecutor';
import { parseOracleTextToIR } from '../src/oracleIRParser';
import {
  parseMoveZoneAllSpellsAndAbilitiesFromStackIncludingThis,
  parseMoveZoneAnyNumberDistinctManaValuesFromYourGraveyard,
  selectGraveyardCardIdsWithDistinctManaValues,
} from '../src/oracleIRExecutorZoneOps';

const controllerId = 'p1' as PlayerID;
const opponentId = 'p2' as PlayerID;

describe('Oracle IR gap batch 328 — Mandate of Peace / Seasons Past / Enchantment Alteration', () => {
  it('parses Mandate of Peace stack mass exile selector', () => {
    expect(
      parseMoveZoneAllSpellsAndAbilitiesFromStackIncludingThis({
        kind: 'raw',
        text: 'all spells and abilities from the stack, including this spell',
      })
    ).toBe(true);
  });

  it('parses Seasons Past distinct mana values graveyard selector', () => {
    expect(
      parseMoveZoneAnyNumberDistinctManaValuesFromYourGraveyard({
        kind: 'raw',
        text: 'any number of cards with different mana values from your graveyard',
      })
    ).toBe(true);
  });

  it('selects graveyard cards with distinct mana values', () => {
    const state = {
      players: [
        {
          id: controllerId,
          library: [],
          hand: [],
          graveyard: [
            { id: 'gy-sp-1', name: 'SP One', type_line: 'Instant', cmc: 1 },
            { id: 'gy-sp-2', name: 'SP Two', type_line: 'Creature — Elf', cmc: 2 },
            { id: 'gy-sp-dup', name: 'SP Two Dup', type_line: 'Instant', cmc: 2 },
            { id: 'gy-sp-3', name: 'SP Three', type_line: 'Sorcery', cmc: 3 },
          ],
          exile: [],
        },
      ],
      battlefield: [],
    } as GameState;
    expect(
      selectGraveyardCardIdsWithDistinctManaValues(state, controllerId, [
        'gy-sp-1',
        'gy-sp-2',
        'gy-sp-3',
      ])
    ).toEqual(['gy-sp-1', 'gy-sp-2', 'gy-sp-3']);
  });

  it('executes Mandate of Peace exiling all spells and abilities from the stack', () => {
    const ir = parseOracleTextToIR(
      'Prevent all combat damage that would be dealt this turn. Exile all spells and abilities from the stack, including this spell.',
      'Mandate of Peace'
    );
    const step = ir.abilities[0]?.steps?.find(
      (entry) =>
        entry.kind === 'move_zone' &&
        String((entry as any).what?.text || '')
          .trim()
          .toLowerCase() === 'all spells and abilities from the stack, including this spell'
    );
    expect(step).toBeTruthy();
    const state = {
      players: [
        { id: controllerId, library: [], hand: [], graveyard: [], exile: [] },
        { id: opponentId, library: [], hand: [], graveyard: [], exile: [] },
      ],
      battlefield: [],
      stack: [
        { id: 'stack-mp-1', name: 'Stack Bolt', controller: controllerId, owner: controllerId, type_line: 'Instant', cmc: 1 },
        { id: 'stack-mp-2', name: 'Stack Ability', controller: opponentId, owner: opponentId, type_line: 'Ability', cmc: 0 },
      ],
    } as GameState;
    const result = applyOracleIRStepsToGameState(state, [step!], {
      controllerId,
      sourceId: 'stack-mp-1',
    });
    expect(result.automationGaps || []).toHaveLength(0);
    expect(((result.state as any).stack || []).length).toBe(0);
    expect((result.state.players[0]?.exile || []).length).toBe(1);
    expect((result.state.players[1]?.exile || []).length).toBe(1);
  });

  it('executes Seasons Past returning distinct mana value cards from graveyard to hand', () => {
    const ir = parseOracleTextToIR(
      'Return any number of cards with different mana values from your graveyard to your hand.',
      'Seasons Past'
    );
    const step = ir.abilities[0]?.steps?.find((entry) => entry.kind === 'move_zone');
    expect(step).toBeTruthy();
    const state = {
      players: [
        {
          id: controllerId,
          library: [],
          hand: [],
          graveyard: [
            { id: 'gy-sp-1', name: 'SP One', type_line: 'Instant', cmc: 1 },
            { id: 'gy-sp-2', name: 'SP Two', type_line: 'Creature — Elf', cmc: 2 },
            { id: 'gy-sp-3', name: 'SP Three', type_line: 'Sorcery', cmc: 3 },
          ],
          exile: [],
        },
      ],
      battlefield: [],
    } as GameState;
    const result = applyOracleIRStepsToGameState(state, [step!], {
      controllerId,
      sourceId: 'test',
      selectorContext: { chosenObjectIds: ['gy-sp-1', 'gy-sp-2', 'gy-sp-3'] },
    });
    expect(result.automationGaps || []).toHaveLength(0);
    expect((result.state.players[0]?.hand || []).length).toBe(3);
    expect((result.state.players[0]?.graveyard || []).length).toBe(0);
  });

  it('executes Enchantment Alteration reattaching aura to another permanent of that type', () => {
    const ir = parseOracleTextToIR(
      'Attach target Aura attached to a creature or land to another permanent of that type.',
      'Enchantment Alteration'
    );
    const step = ir.abilities[0]?.steps?.find((entry) => entry.kind === 'attach');
    expect(step).toBeTruthy();
    const state = {
      players: [{ id: controllerId, library: [], hand: [], graveyard: [], exile: [] }],
      battlefield: [
        {
          id: 'bf-ea-host',
          name: 'EA Host Creature',
          controller: controllerId,
          owner: controllerId,
          type_line: 'Creature — Human',
          cmc: 2,
        },
        {
          id: 'bf-ea-target',
          name: 'EA Target Creature',
          controller: controllerId,
          owner: controllerId,
          type_line: 'Creature — Elf',
          cmc: 2,
        },
        {
          id: 'bf-ea-aura',
          name: 'EA Aura',
          controller: controllerId,
          owner: controllerId,
          type_line: 'Enchantment — Aura',
          attachedTo: 'bf-ea-host',
        },
      ],
    } as GameState;
    const result = applyAttachStep(state, step as any, {
      controllerId,
      sourceId: 'test',
      selectorContext: { chosenObjectIds: ['bf-ea-aura', 'bf-ea-target'] },
    });
    expect(result.applied).toBe(true);
    const aura = (result.state.battlefield || []).find((perm: any) => perm.id === 'bf-ea-aura');
    expect(aura?.attachedTo).toBe('bf-ea-target');
  });
});
