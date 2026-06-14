import { describe, expect, it } from 'vitest';
import type { GameState, PlayerID } from '../../shared/src';
import { applyOracleIRStepsToGameState } from '../src/oracleIRExecutor';
import { parseOracleTextToIR } from '../src/oracleIRParser';
import {
  parseMoveZoneAlternateCostColorCardFromYourHand,
  parseMoveZoneRandomSingleFromYourGraveyard,
  parseMoveZoneSingleTargetFromYourGraveyard,
} from '../src/oracleIRExecutorZoneOps';

const controllerId = 'p1' as PlayerID;

describe('Oracle IR gap batch 294 — selector cluster fixes', () => {
  it('parses Angrath target Pirate card from graveyard', () => {
    expect(
      parseMoveZoneSingleTargetFromYourGraveyard({
        kind: 'raw',
        text: 'target Pirate card from your graveyard',
      })
    ).toMatchObject({
      cardType: 'any',
      creatureTypesAnyOf: ['Pirate'],
    });
  });

  it('parses Coiling Rebirth target creature card from graveyard', () => {
    expect(
      parseMoveZoneSingleTargetFromYourGraveyard({
        kind: 'raw',
        text: 'target creature card from your graveyard',
      })
    ).toEqual({ cardType: 'creature' });
  });

  it('parses Reap the Past X cards at random from graveyard', () => {
    expect(
      parseMoveZoneRandomSingleFromYourGraveyard(
        { kind: 'raw', text: 'X cards at random from your graveyard' },
        'Return X cards at random from your graveyard to your hand'
      )
    ).toEqual({
      count: 0,
      criteria: { cardType: 'any' },
      useXValue: true,
    });
  });

  it('parses Disrupting Shoal alternate cost with mana value X', () => {
    expect(
      parseMoveZoneAlternateCostColorCardFromYourHand({
        kind: 'raw',
        text: "a blue card with mana value X from your hand rather than pay this spell's mana cost",
      })
    ).toEqual({
      colorsAllOf: ['U'],
      cardType: 'any',
      count: 1,
      manaValueLte: -1,
    });
  });

  it('executes Angrath −3 return target Pirate from graveyard', () => {
    const ir = parseOracleTextToIR(
      '{B}{R}: Exile target card from an opponent\'s graveyard.\n−3: Return target Pirate card from your graveyard to the battlefield.',
      'Angrath, Minotaur Pirate'
    );
    const minusThree = ir.abilities.find((ability) =>
      ability.steps?.some((step) => step.kind === 'move_zone' && String(step.raw || '').includes('Pirate'))
    );
    const steps = minusThree?.steps || [];
    const state = {
      players: [
        {
          id: controllerId,
          library: [],
          hand: [],
          graveyard: [
            {
              id: 'gy-pirate-1',
              name: 'Kitesail Freebooter',
              type_line: 'Creature — Human Pirate',
              cmc: 2,
            },
          ],
        },
      ],
      battlefield: [],
    } as GameState;

    const result = applyOracleIRStepsToGameState(state, steps, {
      controllerId,
      sourceId: 'angrath',
      selectorContext: { chosenObjectIds: ['gy-pirate-1'] },
    });
    expect(result.automationGaps?.some((gap) => gap.reasonCode === 'unsupported_selector')).toBe(false);
    const player = result.state?.players.find((entry) => entry.id === controllerId) as any;
    expect(player.graveyard.length).toBe(0);
    expect((result.state?.battlefield || []).length).toBe(1);
  });

  it('executes Reap the Past random X graveyard return', () => {
    const ir = parseOracleTextToIR(
      '{X}{G}: Return X cards at random from your graveyard to your hand.',
      'Reap the Past'
    );
    const steps = ir.abilities[0]?.steps || [];
    const state = {
      players: [
        {
          id: controllerId,
          library: [],
          hand: [],
          graveyard: [
            { id: 'gy-1', name: 'Card 1', type_line: 'Instant' },
            { id: 'gy-2', name: 'Card 2', type_line: 'Sorcery' },
            { id: 'gy-3', name: 'Card 3', type_line: 'Creature — Elf' },
            { id: 'gy-4', name: 'Card 4', type_line: 'Artifact' },
          ],
        },
      ],
      battlefield: [],
    } as GameState;

    const result = applyOracleIRStepsToGameState(state, steps, {
      controllerId,
      sourceId: 'reap',
      xValue: 2,
    });
    expect(result.automationGaps?.some((gap) => gap.reasonCode === 'unsupported_selector')).toBe(false);
    const player = result.state?.players.find((entry) => entry.id === controllerId) as any;
    expect(player.hand.length).toBe(2);
    expect(player.graveyard.length).toBe(2);
  });

  it('executes Disrupting Shoal alternate-cost exile', () => {
    const ir = parseOracleTextToIR(
      'You may exile a blue card with mana value X from your hand rather than pay this spell\'s mana cost.\nCounter target spell unless its controller pays {X}.',
      'Disrupting Shoal'
    );
    const steps = ir.abilities[0]?.steps?.filter((step) => step.kind === 'move_zone') || [];
    const state = {
      players: [
        {
          id: controllerId,
          library: [],
          hand: [
            {
              id: 'hand-blue-3',
              name: 'Audit Blue Three',
              type_line: 'Instant',
              colors: ['U'],
              cmc: 3,
            },
          ],
          graveyard: [],
        },
      ],
      battlefield: [],
    } as GameState;

    const result = applyOracleIRStepsToGameState(state, steps, {
      controllerId,
      sourceId: 'shoal',
      xValue: 3,
      selectorContext: { chosenObjectIds: ['hand-blue-3'] },
    }, { allowOptional: true });
    expect(result.automationGaps?.some((gap) => gap.reasonCode === 'unsupported_selector')).toBe(false);
    const player = result.state?.players.find((entry) => entry.id === controllerId) as any;
    expect(player.hand.length).toBe(0);
    expect(player.exile.length).toBe(1);
  });
});
