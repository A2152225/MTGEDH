import { describe, expect, it } from 'vitest';
import type { GameState, PlayerID } from '../../shared/src';
import { applyOracleIRStepsToGameState } from '../src/oracleIRExecutor';
import { parseOracleTextToIR } from '../src/oracleIRParser';
import {
  parseMoveZoneAllFromYourGraveyard,
  parseMoveZoneSingleTypedCardFromYourGraveyard,
  parseMoveZoneTypedCardFromYourHand,
} from '../src/oracleIRExecutorZoneOps';

const controllerId = 'p1' as PlayerID;

describe('Oracle IR gap batch 300 — GY MV compound + chosen-type hand', () => {
  it('parses Ascend all creature/planeswalker MV X from graveyard', () => {
    expect(
      parseMoveZoneAllFromYourGraveyard({
        kind: 'raw',
        text: 'all creature and planeswalker cards with mana value X or less from your graveyard',
      })
    ).toEqual({ cardType: 'creature_or_planeswalker', manaValueLte: -1 });
  });

  it('parses Blood single creature/planeswalker MV X from graveyard', () => {
    expect(
      parseMoveZoneSingleTypedCardFromYourGraveyard({
        kind: 'raw',
        text: 'a creature or planeswalker card with mana value X or less from your graveyard',
      })
    ).toEqual({ cardType: 'creature_or_planeswalker', manaValueLte: -1 });
  });

  it('parses Belbe creature of the chosen type from hand', () => {
    expect(
      parseMoveZoneTypedCardFromYourHand({
        kind: 'raw',
        text: 'a creature card of the chosen type from your hand',
      })
    ).toEqual({ cardType: 'creature', usesChosenCreatureType: true });
  });

  it('executes Ascend from Avernus all matching graveyard cards to battlefield', () => {
    const ir = parseOracleTextToIR(
      'Return all creature and planeswalker cards with mana value X or less from your graveyard to the battlefield.',
      'Ascend from Avernus'
    );
    const step = ir.abilities[0]?.steps?.[0];
    const state = {
      players: [
        {
          id: controllerId,
          library: [],
          hand: [],
          graveyard: [
            { id: 'gy-ascend-1', name: 'Zombie', type_line: 'Creature — Zombie', cmc: 2 },
            { id: 'gy-ascend-2', name: 'Jace', type_line: 'Legendary Planeswalker — Jace', cmc: 4 },
            { id: 'gy-ascend-land', name: 'Plains', type_line: 'Basic Land — Plains', cmc: 0 },
          ],
        },
      ],
      battlefield: [],
    } as GameState;

    const result = applyOracleIRStepsToGameState(state, [step], {
      controllerId,
      sourceId: 'ascend',
      xValue: 3,
    });
    expect(result.automationGaps?.some((gap) => gap.reasonCode === 'unsupported_selector')).toBe(false);
    expect((result.state?.battlefield || []).length).toBe(1);
    const player = result.state?.players.find((entry) => entry.id === controllerId) as any;
    expect(player.graveyard.length).toBe(2);
  });

  it('executes Blood on the Snow single graveyard return with X', () => {
    const ir = parseOracleTextToIR(
      'Destroy all creatures. Then return a creature or planeswalker card with mana value X or less from your graveyard to the battlefield, where X is the amount of {S} spent to cast this spell.',
      'Blood on the Snow'
    );
    const step = ir.abilities[0]?.steps?.find(
      (entry) => entry.kind === 'move_zone' && (entry as any).to === 'battlefield'
    );
    const state = {
      players: [
        {
          id: controllerId,
          library: [],
          hand: [],
          graveyard: [
            { id: 'gy-blood-1', name: 'Zombie', type_line: 'Creature — Zombie', cmc: 2 },
            { id: 'gy-blood-2', name: 'Jace', type_line: 'Legendary Planeswalker — Jace', cmc: 4 },
          ],
        },
      ],
      battlefield: [],
    } as GameState;

    const result = applyOracleIRStepsToGameState(state, [step], {
      controllerId,
      sourceId: 'blood',
      xValue: 3,
      selectorContext: { chosenObjectIds: ['gy-blood-1'] },
    });
    expect(result.automationGaps?.some((gap) => gap.reasonCode === 'unsupported_selector')).toBe(false);
    expect((result.state?.battlefield || []).length).toBe(1);
    const player = result.state?.players.find((entry) => entry.id === controllerId) as any;
    expect(player.graveyard.length).toBe(1);
  });

  it('executes Belbe Portal optional chosen-type creature from hand', () => {
    const ir = parseOracleTextToIR(
      "As this artifact enters, choose a creature type.\n{3}, {T}: You may put a creature card of the chosen type from your hand onto the battlefield.",
      "Belbe's Portal"
    );
    const step = ir.abilities
      .flatMap((ability) => ability.steps || [])
      .find(
        (entry) =>
          entry.kind === 'move_zone' &&
          (entry as any).what?.text === 'a creature card of the chosen type from your hand'
      );
    const state = {
      players: [
        {
          id: controllerId,
          library: [],
          hand: [
            { id: 'hand-belbe-1', name: 'Elf', type_line: 'Creature — Elf', cmc: 2 },
            { id: 'hand-belbe-2', name: 'Bolt', type_line: 'Instant', cmc: 1 },
          ],
          graveyard: [],
        },
      ],
      battlefield: [],
    } as GameState;

    const result = applyOracleIRStepsToGameState(
      state,
      [step],
      {
        controllerId,
        sourceId: 'belbe',
        selectorContext: { chosenCreatureType: 'Elf', chosenObjectIds: ['hand-belbe-1'] },
      },
      { allowOptional: true }
    );
    expect(result.automationGaps?.some((gap) => gap.reasonCode === 'unsupported_selector')).toBe(false);
    expect((result.state?.battlefield || []).length).toBe(1);
    const player = result.state?.players.find((entry) => entry.id === controllerId) as any;
    expect(player.hand.length).toBe(1);
  });
});
