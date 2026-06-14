import { describe, expect, it } from 'vitest';
import type { GameState, PlayerID } from '../../shared/src';
import { applyOracleIRStepsToGameState } from '../src/oracleIRExecutor';
import { parseOracleTextToIR } from '../src/oracleIRParser';
import {
  parseMoveZoneAllTypedCardsTargetPlayerOwns,
  parseMoveZoneSingleTargetFromAGraveyard,
  parseMoveZoneTypedCardFromAmongThem,
} from '../src/oracleIRExecutorZoneOps';

const controllerId = 'p1' as PlayerID;
const opponentId = 'p2' as PlayerID;

describe('Oracle IR gap batch 336 — Reenact / Hurkyl / Back for Seconds', () => {
  it('parses Reenact nonland in-graveyard this-turn exile selector', () => {
    expect(
      parseMoveZoneSingleTargetFromAGraveyard({
        kind: 'raw',
        text: 'target nonland card in a graveyard that was put there from anywhere this turn',
      })
    ).toEqual({ cardType: 'nonland', putIntoGraveyardThisTurn: true });
  });

  it('parses Hurkyl all artifacts target player owns selector', () => {
    expect(
      parseMoveZoneAllTypedCardsTargetPlayerOwns({
        kind: 'raw',
        text: 'all artifacts target player owns',
      })
    ).toEqual({ cardType: 'artifact' });
  });

  it('parses Back for Seconds one-of-those MV<=4 among-them selector after postprocess', () => {
    const ir = parseOracleTextToIR(
      'You may put one of those cards with mana value 4 or less onto the battlefield instead of putting it into your hand.',
      'Back for Seconds'
    );
    const step = ir.abilities.flatMap((ability) => ability.steps || []).find((entry) => entry.kind === 'move_zone');
    expect(step).toBeTruthy();
    expect((step as any).what?.text).toBe('one of those cards with mana value 4 or less');
    expect((step as any).to).toBe('battlefield');
    expect(
      parseMoveZoneTypedCardFromAmongThem({ kind: 'raw', text: String((step as any).what?.text || '') }, step as any)
    ).toEqual({ cardType: 'any', maxCount: 1, manaValueLte: 4 });
  });

  it('executes Reenact exiling nonland card put into graveyard this turn', () => {
    const ir = parseOracleTextToIR(
      'Exile target nonland card in a graveyard that was put there from anywhere this turn.',
      'Reenact the Crime'
    );
    const step = ir.abilities.flatMap((ability) => ability.steps || []).find((entry) => entry.kind === 'move_zone');
    expect(step).toBeTruthy();
    const state = {
      turn: 3,
      players: [
        {
          id: controllerId,
          library: [],
          hand: [],
          graveyard: [
            {
              id: 'gy-reenact-instant',
              name: 'Reenact Bolt',
              type_line: 'Instant',
              cmc: 2,
              putIntoGraveyardTurn: 3,
            },
          ],
          exile: [],
        },
      ],
      battlefield: [],
    } as GameState;
    const result = applyOracleIRStepsToGameState(state, [step!], {
      controllerId,
      sourceId: 'test',
      selectorContext: { chosenObjectIds: ['gy-reenact-instant'] },
    });
    expect(result.automationGaps || []).toHaveLength(0);
    expect((result.state.players[0]?.exile || []).length).toBe(1);
    expect((result.state.players[0]?.graveyard || []).length).toBe(0);
  });

  it('executes Hurkyl returning all artifacts target player owns to their hand', () => {
    const ir = parseOracleTextToIR(
      "Return all artifacts target player owns to their hand.",
      "Hurkyl's Recall"
    );
    const step = ir.abilities.flatMap((ability) => ability.steps || []).find((entry) => entry.kind === 'move_zone');
    expect(step).toBeTruthy();
    const state = {
      players: [
        { id: controllerId, library: [], hand: [], graveyard: [], exile: [] },
        {
          id: opponentId,
          library: [],
          hand: [],
          graveyard: [
            {
              id: 'gy-hurkyl-tablet',
              name: 'Hurkyl Tablet',
              type_line: 'Artifact',
              cmc: 3,
              owner: opponentId,
            },
          ],
          exile: [],
        },
      ],
      battlefield: [
        {
          id: 'bf-hurkyl-ring',
          name: 'Hurkyl Ring',
          controller: opponentId,
          owner: opponentId,
          type_line: 'Artifact',
          cmc: 2,
        },
      ],
    } as GameState;
    const result = applyOracleIRStepsToGameState(state, [step!], {
      controllerId,
      sourceId: 'test',
      targetPlayerId: opponentId,
      selectorContext: { targetPlayerId: opponentId },
    });
    expect(result.automationGaps || []).toHaveLength(0);
    const opponent = result.state.players.find((player) => player.id === opponentId) as any;
    expect(opponent.hand.length).toBe(2);
    expect((result.state.battlefield || []).length).toBe(0);
    expect(opponent.graveyard.length).toBe(0);
  });

  it('executes Back for Seconds putting one returned creature onto battlefield instead of hand', () => {
    const ir = parseOracleTextToIR(
      'You may put one of those cards with mana value 4 or less onto the battlefield instead of putting it into your hand.',
      'Back for Seconds'
    );
    const step = ir.abilities.flatMap((ability) => ability.steps || []).find((entry) => entry.kind === 'move_zone');
    expect(step).toBeTruthy();
    const returnedCards = [
      { id: 'gy-back-small', name: 'Back Small Creature', type_line: 'Creature — Human', cmc: 3 },
      { id: 'gy-back-big', name: 'Back Big Creature', type_line: 'Creature — Giant', cmc: 6 },
    ];
    const state = {
      players: [{ id: controllerId, library: [], hand: [], graveyard: returnedCards, exile: [] }],
      battlefield: [],
    } as GameState;
    const result = applyOracleIRStepsToGameState(
      state,
      [step!],
      {
        controllerId,
        sourceId: 'test',
        lastMovedCards: returnedCards,
        selectorContext: { chosenObjectIds: ['gy-back-small'] },
      },
      { allowOptional: true }
    );
    expect(result.automationGaps || []).toHaveLength(0);
    expect((result.state.battlefield || []).length).toBe(1);
    expect((result.state.players[0]?.hand || []).length).toBe(0);
  });
});
