import { describe, expect, it } from 'vitest';
import type { GameState, PlayerID } from '../../shared/src';
import { applyOracleIRStepsToGameState } from '../src/oracleIRExecutor';
import { evaluateConditionalWrapperCondition } from '../src/oracleIRExecutorConditionalStepSupport';
import { parseOracleTextToIR } from '../src/oracleIRParser';
import {
  parseMoveZoneAnyNumberCardsFromYourHand,
  parseMoveZoneSingleTargetFromYourGraveyard,
  parseMoveZoneUpToTargetCountFromYourHand,
} from '../src/oracleIRExecutorZoneOps';

const controllerId = 'p1' as PlayerID;

describe('Oracle IR gap batch 334 — Recommission / Patron of the Moon / Tezzeret', () => {
  it('parses Recommission artifact-or-creature GY return selector', () => {
    expect(
      parseMoveZoneSingleTargetFromYourGraveyard({
        kind: 'raw',
        text: 'target artifact or creature card with mana value 3 or less from your graveyard',
      })
    ).toEqual({ cardType: 'artifact_or_creature', manaValueLte: 3 });
  });

  it('parses Patron up-to-two lands from hand selector', () => {
    expect(
      parseMoveZoneUpToTargetCountFromYourHand({
        kind: 'raw',
        text: 'up to two land cards from your hand',
      })
    ).toEqual({ maxCount: 2, criteria: { cardType: 'land' } });
  });

  it('parses Tezzeret any-number cards from hand selector', () => {
    expect(
      parseMoveZoneAnyNumberCardsFromYourHand({
        kind: 'raw',
        text: 'any number of cards from your hand',
      })
    ).toEqual({ cardType: 'any' });
  });

  it('evaluates Recommission creature-enters-this-way condition from chosen GY target', () => {
    const step = {
      kind: 'move_zone' as const,
      what: { kind: 'raw' as const, text: 'target artifact or creature card with mana value 3 or less from your graveyard' },
      to: 'battlefield' as const,
      withCounters: { '+1/+1': 1 },
      withCountersCondition: { kind: 'if' as const, raw: 'a creature enters this way' },
      raw: 'Return target artifact or creature card with mana value 3 or less from your graveyard to the battlefield. If a creature enters this way, it enters with an additional +1/+1 counter on it',
    };
    const state = {
      players: [
        {
          id: controllerId,
          library: [],
          hand: [],
          graveyard: [
            { id: 'gy-recommission-creature', name: 'Recommission Creature', type_line: 'Creature — Human', cmc: 2 },
          ],
          exile: [],
        },
      ],
      battlefield: [],
    } as GameState;
    expect(
      evaluateConditionalWrapperCondition({
        condition: step.withCountersCondition!,
        nextState: state,
        controllerId,
        ctx: {
          controllerId,
          selectorContext: { chosenObjectIds: ['gy-recommission-creature'] },
        } as any,
        lastActionOutcome: null,
        step,
      })
    ).toBe(true);
  });

  it('executes Recommission returning creature from graveyard with +1/+1 counter', () => {
    const ir = parseOracleTextToIR(
      'Return target artifact or creature card with mana value 3 or less from your graveyard to the battlefield. If a creature enters this way, it enters with an additional +1/+1 counter on it.',
      'Recommission'
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
            { id: 'gy-recommission-creature', name: 'Recommission Creature', type_line: 'Creature — Human', cmc: 2 },
          ],
          exile: [],
        },
      ],
      battlefield: [],
    } as GameState;
    const result = applyOracleIRStepsToGameState(state, [step!], {
      controllerId,
      sourceId: 'test',
      selectorContext: { chosenObjectIds: ['gy-recommission-creature'] },
    });
    expect(result.automationGaps || []).toHaveLength(0);
    expect((result.state.battlefield || []).length).toBe(1);
    expect((result.state.players[0]?.graveyard || []).length).toBe(0);
  });

  it('executes Patron putting up to two lands from hand onto battlefield tapped', () => {
    const ir = parseOracleTextToIR(
      'Put up to two land cards from your hand onto the battlefield tapped.',
      'Patron of the Moon'
    );
    const step = ir.abilities.flatMap((ability) => ability.steps || []).find(
      (entry) => entry.kind === 'move_zone' && /land cards from your hand/i.test(String((entry as any).what?.text || ''))
    );
    expect(step).toBeTruthy();
    const handCards = [
      { id: 'hand-patron-land-1', name: 'Patron Plains', type_line: 'Basic Land — Plains', cmc: 0 },
      { id: 'hand-patron-land-2', name: 'Patron Forest', type_line: 'Basic Land — Forest', cmc: 0 },
    ];
    const state = {
      players: [{ id: controllerId, library: [], hand: handCards, graveyard: [], exile: [] }],
      battlefield: [],
    } as GameState;
    const result = applyOracleIRStepsToGameState(state, [step!], {
      controllerId,
      sourceId: 'test',
      selectorContext: { chosenObjectIds: ['hand-patron-land-1', 'hand-patron-land-2'] },
    });
    expect(result.automationGaps || []).toHaveLength(0);
    expect((result.state.battlefield || []).length).toBe(2);
    expect((result.state.players[0]?.hand || []).length).toBe(0);
  });

  it('executes Tezzeret putting any number of cards from hand onto battlefield face down', () => {
    const ir = parseOracleTextToIR(
      "Put any number of cards from your hand onto the battlefield face down. They're 5/5 artifact creatures.",
      'Tezzeret, Cruel Machinist'
    );
    const step = ir.abilities.flatMap((ability) => ability.steps || []).find(
      (entry) => entry.kind === 'move_zone' && /^any number of cards from your hand$/i.test(String((entry as any).what?.text || ''))
    );
    expect(step).toBeTruthy();
    const handCards = [
      { id: 'hand-tezzeret-1', name: 'Tezzeret Hand One', type_line: 'Instant', cmc: 2 },
      { id: 'hand-tezzeret-2', name: 'Tezzeret Hand Two', type_line: 'Artifact', cmc: 1 },
    ];
    const state = {
      players: [{ id: controllerId, library: [], hand: handCards, graveyard: [], exile: [] }],
      battlefield: [],
    } as GameState;
    const result = applyOracleIRStepsToGameState(state, [step!], {
      controllerId,
      sourceId: 'test',
      selectorContext: { chosenObjectIds: ['hand-tezzeret-1', 'hand-tezzeret-2'] },
    });
    expect(result.automationGaps || []).toHaveLength(0);
    expect((result.state.battlefield || []).length).toBe(2);
    expect((result.state.players[0]?.hand || []).length).toBe(0);
  });
});
