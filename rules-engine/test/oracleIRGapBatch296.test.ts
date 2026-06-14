import { describe, expect, it } from 'vitest';
import type { GameState, PlayerID } from '../../shared/src';
import { applyOracleIRStepsToGameState } from '../src/oracleIRExecutor';
import { parseOracleTextToIR } from '../src/oracleIRParser';
import { parseSimpleBattlefieldSelector } from '../src/oracleIRExecutorBattlefieldParser';
import {
  parseMoveZoneContextualThemSplit,
  parseMoveZoneCountTargetCardsFromSingleGraveyard,
  parseMoveZoneSingleCardFromEachPlayersGraveyard,
  parseMoveZoneThisCreatureAndTargetYouControl,
} from '../src/oracleIRExecutorZoneOps';

const controllerId = 'p1' as PlayerID;

describe('Oracle IR gap batch 296 — selector cluster fixes', () => {
  it('parses surveil any-number graveyard + rest library top split', () => {
    expect(
      parseMoveZoneContextualThemSplit({
        kind: 'raw',
        text: 'any number of them',
      })
    ).toEqual({ kind: 'any_number_hand_graveyard_rest' });
  });

  it('parses Snow Hound this-creature-and-colored-target bounce selector', () => {
    expect(
      parseMoveZoneThisCreatureAndTargetYouControl({
        kind: 'raw',
        text: 'this creature and target green or blue creature you control',
      })
    ).toEqual({
      selectorText: 'target green or blue creature you control',
    });
    expect(
      parseSimpleBattlefieldSelector({
        kind: 'raw',
        text: 'target green or blue creature you control',
      })
    ).toMatchObject({
      types: ['creature'],
      colorsAnyOf: ['G', 'U'],
      controllerFilter: 'you',
    });
  });

  it('parses Rats\' Feast X cards from single graveyard exile', () => {
    expect(
      parseMoveZoneCountTargetCardsFromSingleGraveyard({
        kind: 'raw',
        text: 'X target cards from a single graveyard',
      })
    ).toEqual({ count: 0, cardType: 'any', useXValue: true });
  });

  it('parses King Narfi each-graveyard creature or planeswalker exile', () => {
    expect(
      parseMoveZoneSingleCardFromEachPlayersGraveyard({
        kind: 'raw',
        text: 'a creature or planeswalker card from each graveyard',
      })
    ).toEqual({ cardType: 'creature_or_planeswalker' });
  });

  it('executes surveil disposal via contextual them split (Candlestick pattern)', () => {
    const ir = parseOracleTextToIR(
      'Equipped creature gets +1/+1 and has "Whenever this creature attacks, surveil 2." (Look at the top two cards of your library, then put any number of them into your graveyard and the rest on top of your library in any order.)',
      'Candlestick'
    );
    const step = ir.abilities
      .flatMap((ability) => ability.steps || [])
      .find((entry) => entry.kind === 'move_zone' && (entry as any).to === 'graveyard');
    expect(step).toBeTruthy();

    const surveilTop = [
      { id: 'lib-surveil-1', name: 'Surveil One', type_line: 'Instant', cmc: 1 },
      { id: 'lib-surveil-2', name: 'Surveil Two', type_line: 'Creature — Human', cmc: 2 },
    ];
    const state = {
      players: [
        {
          id: controllerId,
          library: [...surveilTop, { id: 'lib-deep-1', name: 'Deep Card', type_line: 'Sorcery' }],
          hand: [],
          graveyard: [],
        },
      ],
      battlefield: [],
    } as GameState;

    const result = applyOracleIRStepsToGameState(state, [step], {
      controllerId,
      sourceId: 'candlestick',
      lastMovedCards: surveilTop,
      selectorContext: { chosenObjectIds: ['lib-surveil-1'] },
    });
    expect(result.automationGaps?.some((gap) => gap.reasonCode === 'unsupported_selector')).toBe(false);
    const player = result.state?.players.find((entry) => entry.id === controllerId) as any;
    expect(player.graveyard.length).toBe(1);
    expect(player.graveyard[0].id).toBe('lib-surveil-1');
    expect(player.library[0].id).toBe('lib-surveil-2');
  });

  it('executes Snow Hound source + green or blue creature bounce', () => {
    const ir = parseOracleTextToIR(
      "{1}, {T}: Return this creature and target green or blue creature you control to their owner's hand.",
      'Snow Hound'
    );
    const step = ir.abilities[0]?.steps?.[0];
    const state = {
      players: [{ id: controllerId, library: [], hand: [], graveyard: [] }],
      battlefield: [
        {
          id: 'bf-source',
          name: 'Snow Hound',
          controller: controllerId,
          owner: controllerId,
          type_line: 'Creature — Dog',
        },
        {
          id: 'bf-blue-creature',
          name: 'Merfolk',
          controller: controllerId,
          owner: controllerId,
          type_line: 'Creature — Merfolk',
          colors: ['U'],
        },
      ],
    } as GameState;

    const result = applyOracleIRStepsToGameState(state, [step], {
      controllerId,
      sourceId: 'bf-source',
      selectorContext: { chosenObjectIds: ['bf-source', 'bf-blue-creature'] },
    });
    expect(result.automationGaps?.some((gap) => gap.reasonCode === 'unsupported_selector')).toBe(false);
    expect((result.state?.battlefield || []).length).toBe(0);
    const player = result.state?.players.find((entry) => entry.id === controllerId) as any;
    expect(player.hand.length).toBe(2);
  });

  it('executes Rats\' Feast X exile from a single graveyard', () => {
    const ir = parseOracleTextToIR('Exile X target cards from a single graveyard.', "Rats' Feast");
    const step = ir.abilities[0]?.steps?.[0];
    const state = {
      players: [
        {
          id: controllerId,
          library: [],
          hand: [],
          graveyard: [
            { id: 'gy-single-1', name: 'One', type_line: 'Instant' },
            { id: 'gy-single-2', name: 'Two', type_line: 'Sorcery' },
            { id: 'gy-single-3', name: 'Three', type_line: 'Creature — Rat' },
          ],
        },
      ],
      battlefield: [],
    } as GameState;

    const result = applyOracleIRStepsToGameState(state, [step], {
      controllerId,
      sourceId: 'rats-feast',
      xValue: 2,
      selectorContext: { chosenObjectIds: ['gy-single-1', 'gy-single-2'] },
    });
    expect(result.automationGaps?.some((gap) => gap.reasonCode === 'unsupported_selector')).toBe(false);
    const player = result.state?.players.find((entry) => entry.id === controllerId) as any;
    expect(player.graveyard.length).toBe(1);
    expect(player.exile.length).toBe(2);
  });

  it('executes King Narfi optional each-graveyard exile', () => {
    const ir = parseOracleTextToIR(
      'Each player mills four cards. Then you may exile a creature or planeswalker card from each graveyard.',
      "King Narfi's Betrayal"
    );
    const step = ir.abilities[0]?.steps?.find((entry) => entry.kind === 'move_zone');
    const state = {
      players: [
        {
          id: 'p1',
          library: [],
          hand: [],
          graveyard: [{ id: 'gy-p1-creature-each', name: 'Zombie', type_line: 'Creature — Zombie' }],
        },
        {
          id: 'p2',
          library: [],
          hand: [],
          graveyard: [
            { id: 'gy-p2-pw-each', name: 'Jace', type_line: 'Legendary Planeswalker — Jace' },
          ],
        },
      ],
      battlefield: [],
    } as GameState;

    const result = applyOracleIRStepsToGameState(
      state,
      [step],
      {
        controllerId,
        sourceId: 'narfi',
        selectorContext: { chosenObjectIds: ['gy-p1-creature-each', 'gy-p2-pw-each'] },
      },
      { allowOptional: true }
    );
    expect(result.automationGaps?.some((gap) => gap.reasonCode === 'unsupported_selector')).toBe(false);
    const p1 = result.state?.players.find((entry) => entry.id === 'p1') as any;
    const p2 = result.state?.players.find((entry) => entry.id === 'p2') as any;
    expect(p1.graveyard.length).toBe(0);
    expect(p2.graveyard.length).toBe(0);
    expect(p1.exile.length).toBe(1);
    expect(p2.exile.length).toBe(1);
  });
});
