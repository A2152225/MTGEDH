import { describe, expect, it } from 'vitest';
import type { GameState, PlayerID } from '../../shared/src';
import { applyOracleIRStepsToGameState } from '../src/oracleIRExecutor';
import { parseOracleTextToIR } from '../src/oracleIRParser';
import {
  cardMatchesTotalPowerToughnessLte,
  parseMoveZoneCreatureHandTotalPowerToughnessLte,
  parseMoveZoneTargetNonlandSameNameMassExile,
  parseMoveZoneUpToOneNonlandAmongThemRestLibraryBottom,
} from '../src/oracleIRExecutorZoneOps';

const controllerId = 'p1' as PlayerID;
const opponentId = 'p2' as PlayerID;

describe('Oracle IR gap batch 327 — Meek Attack / Moratorium Stone / Duelist\'s Flame', () => {
  it('parses Meek Attack total power and toughness hand selector', () => {
    expect(
      parseMoveZoneCreatureHandTotalPowerToughnessLte({
        kind: 'raw',
        text: 'a creature card with total power and toughness 5 or less from your hand',
      })
    ).toEqual({ totalPowerToughnessLte: 5 });
  });

  it('matches creature cards by combined power and toughness', () => {
    expect(
      cardMatchesTotalPowerToughnessLte(
        { type_line: 'Creature — Elf', power: 2, toughness: 3 },
        5
      )
    ).toBe(true);
    expect(
      cardMatchesTotalPowerToughnessLte(
        { type_line: 'Creature — Giant', power: 4, toughness: 4 },
        5
      )
    ).toBe(false);
  });

  it('parses Moratorium Stone same-name mass exile selector', () => {
    expect(
      parseMoveZoneTargetNonlandSameNameMassExile({
        kind: 'raw',
        text:
          'target nonland card from a graveyard, all other cards from graveyards with the same name as that card, and all permanents with that name',
      })
    ).toBe(true);
  });

  it('executes Meek Attack putting qualifying creature from hand onto battlefield', () => {
    const ir = parseOracleTextToIR(
      'You may put a creature card with total power and toughness 5 or less from your hand onto the battlefield.',
      'Meek Attack'
    );
    const step = ir.abilities[0]?.steps?.find((entry) => entry.kind === 'move_zone');
    expect(step).toBeTruthy();
    const state = {
      players: [
        {
          id: controllerId,
          library: [],
          hand: [
            {
              id: 'hand-ma-small',
              name: 'Small Creature',
              type_line: 'Creature — Elf',
              cmc: 2,
              power: 2,
              toughness: 3,
            },
            {
              id: 'hand-ma-big',
              name: 'Big Creature',
              type_line: 'Creature — Giant',
              cmc: 5,
              power: 4,
              toughness: 4,
            },
          ],
          graveyard: [],
          exile: [],
        },
      ],
      battlefield: [],
    } as GameState;
    const result = applyOracleIRStepsToGameState(
      state,
      [step!],
      {
        controllerId,
        sourceId: 'test',
        selectorContext: { chosenObjectIds: ['hand-ma-small'] },
      },
      { allowOptional: true }
    );
    expect(result.automationGaps || []).toHaveLength(0);
    expect((result.state.battlefield || []).length).toBe(1);
    expect((result.state.players[0]?.hand || []).length).toBe(1);
    expect((result.state.players[0]?.hand || [])[0]?.id).toBe('hand-ma-big');
  });

  it('executes Moratorium Stone exiling target and all same-named cards and permanents', () => {
    const ir = parseOracleTextToIR(
      '{4}, {T}, Sacrifice Moratorium Stone: Exile target nonland card from a graveyard, all other cards from graveyards with the same name as that card, and all permanents with that name.',
      'Moratorium Stone'
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
            { id: 'gy-ms-target', name: 'Lightning Bolt', type_line: 'Instant', cmc: 1 },
            { id: 'gy-ms-same', name: 'Lightning Bolt', type_line: 'Instant', cmc: 1 },
          ],
          exile: [],
        },
        {
          id: opponentId,
          library: [],
          hand: [],
          graveyard: [{ id: 'gy-ms-p2', name: 'Lightning Bolt', type_line: 'Instant', cmc: 1 }],
          exile: [],
        },
      ],
      battlefield: [
        {
          id: 'bf-ms-perm',
          name: 'Lightning Bolt',
          controller: opponentId,
          owner: opponentId,
          type_line: 'Instant',
          cmc: 1,
        },
      ],
    } as GameState;
    const result = applyOracleIRStepsToGameState(state, [step!], {
      controllerId,
      sourceId: 'test',
      selectorContext: { chosenObjectIds: ['gy-ms-target'] },
    });
    expect(result.automationGaps || []).toHaveLength(0);
    expect((result.state.players[0]?.graveyard || []).length).toBe(0);
    expect((result.state.players[1]?.graveyard || []).length).toBe(0);
    expect((result.state.battlefield || []).length).toBe(0);
    expect((result.state.players[0]?.exile || []).length).toBe(2);
    expect((result.state.players[1]?.exile || []).length).toBe(2);
  });

  it('parses and executes Duelist\'s Flame among-them exile with rest to library bottom', () => {
    expect(
      parseMoveZoneUpToOneNonlandAmongThemRestLibraryBottom({
        kind: 'raw',
        text:
          'up to one nonland card from among them and put the rest on the bottom of your library in a random order',
      })
    ).toBe(true);

    const ir = parseOracleTextToIR(
      'Reveal the top four cards of your library. Exile up to one nonland card from among them and put the rest on the bottom of your library in a random order.',
      "Duelist's Flame"
    );
    const step = ir.abilities[0]?.steps?.find(
      (entry) =>
        entry.kind === 'move_zone' &&
        /up to one nonland card from among them/i.test(String((entry as any).what?.text || ''))
    );
    expect(step).toBeTruthy();
    const state = {
      players: [
        {
          id: controllerId,
          library: [
            { id: 'lib-df-1', name: 'DF Instant', type_line: 'Instant', cmc: 2 },
            { id: 'lib-df-2', name: 'DF Creature', type_line: 'Creature — Human', cmc: 2, power: 2, toughness: 2 },
            { id: 'lib-df-3', name: 'DF Land', type_line: 'Basic Land — Island', cmc: 0 },
            { id: 'lib-df-4', name: 'DF Sorcery', type_line: 'Sorcery', cmc: 3 },
          ],
          hand: [],
          graveyard: [],
          exile: [],
        },
      ],
      battlefield: [],
    } as GameState;
    const result = applyOracleIRStepsToGameState(state, [step!], {
      controllerId,
      sourceId: 'test',
      lastMovedCards: [
        { id: 'lib-df-1', name: 'DF Instant', type_line: 'Instant', cmc: 2 },
        { id: 'lib-df-2', name: 'DF Creature', type_line: 'Creature — Human', cmc: 2, power: 2, toughness: 2 },
        { id: 'lib-df-3', name: 'DF Land', type_line: 'Basic Land — Island', cmc: 0 },
        { id: 'lib-df-4', name: 'DF Sorcery', type_line: 'Sorcery', cmc: 3 },
      ],
      selectorContext: { chosenObjectIds: ['lib-df-2'] },
    });
    expect(result.automationGaps || []).toHaveLength(0);
    expect((result.state.players[0]?.exile || []).length).toBe(1);
    expect((result.state.players[0]?.exile || [])[0]?.id).toBe('lib-df-2');
    expect((result.state.players[0]?.library || []).map((card: any) => card.id)).toEqual([
      'lib-df-1',
      'lib-df-3',
      'lib-df-4',
    ]);
  });
});
