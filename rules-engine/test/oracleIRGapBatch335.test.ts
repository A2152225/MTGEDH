import { describe, expect, it } from 'vitest';
import type { GameState, PlayerID } from '../../shared/src';
import { applyOracleIRStepsToGameState } from '../src/oracleIRExecutor';
import { parseOracleTextToIR } from '../src/oracleIRParser';
import {
  cardMatchesMoveZoneSingleTargetCriteria,
  parseMoveZoneSingleTargetFromYourGraveyard,
  parseMoveZoneTypedCardFromAmongThem,
  parseMoveZoneUpToTargetCountFromYourGraveyard,
} from '../src/oracleIRExecutorZoneOps';

const controllerId = 'p1' as PlayerID;

describe('Oracle IR gap batch 335 — Niko / Ballad / Leonardo', () => {
  it('parses Niko foretell GY return selector', () => {
    expect(
      parseMoveZoneSingleTargetFromYourGraveyard({
        kind: 'raw',
        text: 'target card with foretell from your graveyard',
      })
    ).toEqual({ cardType: 'any', requiresForetell: true });
  });

  it('matches foretell cards for Niko selector', () => {
    const criteria = { cardType: 'any' as const, requiresForetell: true };
    expect(
      cardMatchesMoveZoneSingleTargetCriteria(
        {
          type_line: 'Instant',
          oracle_text: 'Foretell {1}{U}\nDraw a card.',
          keywords: ['Foretell'],
        },
        criteria
      )
    ).toBe(true);
    expect(
      cardMatchesMoveZoneSingleTargetCriteria({ type_line: 'Instant', oracle_text: 'Draw a card.' }, criteria)
    ).toBe(false);
  });

  it('parses Ballad historic among-them selector', () => {
    expect(
      parseMoveZoneTypedCardFromAmongThem(
        { kind: 'raw', text: 'a historic card from among them' },
        { to: 'hand', raw: 'You may put a historic card from among them into your hand.' }
      )
    ).toEqual({ cardType: 'any', requiresHistoric: true });
  });

  it('parses Leonardo one-or-two creature GY return selector', () => {
    expect(
      parseMoveZoneUpToTargetCountFromYourGraveyard({
        kind: 'raw',
        text: 'one or two target creature cards each with mana value 3 or less from your graveyard',
      })
    ).toEqual({ maxCount: 2, criteria: { cardType: 'creature', manaValueLte: 3 } });
  });

  it('executes Niko returning foretell card from graveyard to hand', () => {
    const ir = parseOracleTextToIR(
      'Return target card with foretell from your graveyard to your hand.',
      'Niko Defies Destiny'
    );
    const step = ir.abilities.flatMap((ability) => ability.steps || []).find((entry) => entry.kind === 'move_zone');
    expect(step).toBeTruthy();
    const state = {
      players: [
        {
          id: controllerId,
          library: [],
          hand: [],
          graveyard: [
            {
              id: 'gy-niko-foretell',
              name: 'Niko Foretell Card',
              type_line: 'Instant',
              cmc: 3,
              oracle_text: 'Foretell {1}{U}',
              keywords: ['Foretell'],
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
      selectorContext: { chosenObjectIds: ['gy-niko-foretell'] },
    });
    expect(result.automationGaps || []).toHaveLength(0);
    expect((result.state.players[0]?.hand || []).length).toBe(1);
    expect((result.state.players[0]?.graveyard || []).length).toBe(0);
  });

  it('executes Ballad putting historic card from among milled cards into hand', () => {
    const ir = parseOracleTextToIR(
      'You may put a historic card from among them into your hand.',
      'Ballad of the Black Flag'
    );
    const step = ir.abilities.flatMap((ability) => ability.steps || []).find((entry) => entry.kind === 'move_zone');
    expect(step).toBeTruthy();
    const milledCards = [
      { id: 'gy-ballad-artifact', name: 'Ballad Compass', type_line: 'Artifact', cmc: 2 },
      { id: 'gy-ballad-creature', name: 'Ballad Sailor', type_line: 'Creature — Human', cmc: 2 },
    ];
    const state = {
      players: [{ id: controllerId, library: [], hand: [], graveyard: milledCards, exile: [] }],
      battlefield: [],
    } as GameState;
    const result = applyOracleIRStepsToGameState(
      state,
      [step!],
      {
        controllerId,
        sourceId: 'test',
        lastMovedCards: milledCards,
        selectorContext: { chosenObjectIds: ['gy-ballad-artifact'] },
      },
      { allowOptional: true }
    );
    expect(result.automationGaps || []).toHaveLength(0);
    expect((result.state.players[0]?.hand || []).length).toBe(1);
    expect((result.state.players[0]?.hand?.[0]?.id || '').trim()).toBe('gy-ballad-artifact');
  });

  it('executes Leonardo returning up to two creatures from graveyard to battlefield', () => {
    const ir = parseOracleTextToIR(
      'Return one or two target creature cards each with mana value 3 or less from your graveyard to the battlefield.',
      "Leonardo's Technique"
    );
    const step = ir.abilities.flatMap((ability) => ability.steps || []).find((entry) => entry.kind === 'move_zone');
    expect(step).toBeTruthy();
    const state = {
      players: [
        {
          id: controllerId,
          library: [],
          hand: [],
          graveyard: [
            { id: 'gy-leonardo-bear', name: 'Leonardo Bear', type_line: 'Creature — Bear', cmc: 2 },
            { id: 'gy-leonardo-elf', name: 'Leonardo Elf', type_line: 'Creature — Elf', cmc: 1 },
          ],
          exile: [],
        },
      ],
      battlefield: [],
    } as GameState;
    const result = applyOracleIRStepsToGameState(state, [step!], {
      controllerId,
      sourceId: 'test',
      selectorContext: { chosenObjectIds: ['gy-leonardo-bear', 'gy-leonardo-elf'] },
    });
    expect(result.automationGaps || []).toHaveLength(0);
    expect((result.state.battlefield || []).length).toBe(2);
    expect((result.state.players[0]?.graveyard || []).length).toBe(0);
  });
});
