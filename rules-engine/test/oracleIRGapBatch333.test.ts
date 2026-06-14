import { describe, expect, it } from 'vitest';
import type { GameState, PlayerID } from '../../shared/src';
import { applyOracleIRStepsToGameState } from '../src/oracleIRExecutor';
import { parseOracleTextToIR } from '../src/oracleIRParser';
import {
  parseMoveZoneSingleTargetFromLinkedExile,
  parseMoveZoneTypedCardFromAmongThem,
  parseMoveZoneUpToTargetCountFromYourGraveyard,
} from '../src/oracleIRExecutorZoneOps';

const controllerId = 'p1' as PlayerID;

describe('Oracle IR gap batch 333 — Bound // Determined / Northampton Farm / Deploy the Gatewatch', () => {
  it('parses Bound up-to-X cards from graveyard selector', () => {
    expect(
      parseMoveZoneUpToTargetCountFromYourGraveyard({
        kind: 'raw',
        text: 'up to X cards from your graveyard',
      })
    ).toEqual({
      maxCount: 0,
      criteria: { cardType: 'any' },
      useXValue: true,
    });
  });

  it('parses Northampton Farm creature exiled with this land', () => {
    expect(
      parseMoveZoneSingleTargetFromLinkedExile({
        kind: 'raw',
        text: 'a creature card exiled with this land',
      })
    ).toEqual({ cardType: 'creature' });
  });

  it('parses Deploy the Gatewatch planeswalker among-them battlefield split', () => {
    const step = {
      kind: 'move_zone' as const,
      what: { kind: 'raw' as const, text: 'up to two planeswalker cards from among them' },
      to: 'battlefield' as const,
      toRaw: 'the battlefield',
      raw: 'Put up to two planeswalker cards from among them onto the battlefield. Put the rest on the bottom of your library in a random order',
    };
    expect(parseMoveZoneTypedCardFromAmongThem(step.what as any, step)).toEqual({
      cardType: 'planeswalker',
      maxCount: 2,
      bfLibraryBottomSplit: true,
      entersTappedFromWhat: false,
    });
  });

  it('executes Bound returning up to X graveyard cards to hand', () => {
    const ir = parseOracleTextToIR(
      "Sacrifice a creature. Return up to X cards from your graveyard to your hand, where X is the number of colors that creature was.",
      'Bound // Determined'
    );
    const step = ir.abilities[0]?.steps?.find((entry) => entry.kind === 'move_zone');
    expect(step).toBeTruthy();
    const gyCards = [
      { id: 'gy-bound-1', name: 'Bound GY One', type_line: 'Instant', cmc: 1 },
      { id: 'gy-bound-2', name: 'Bound GY Two', type_line: 'Creature — Elf', cmc: 2 },
    ];
    const state = {
      players: [{ id: controllerId, library: [], hand: [], graveyard: gyCards, exile: [] }],
      battlefield: [],
    } as GameState;
    const result = applyOracleIRStepsToGameState(state, [step!], {
      controllerId,
      sourceId: 'test',
      xValue: 2,
      lastSacrificedPermanents: [
        {
          id: 'bf-bound-sac',
          name: 'Bound Sacrifice',
          typeLine: 'Creature — Human Soldier',
          colors: ['W', 'R'],
          cmc: 2,
        },
      ],
      selectorContext: { chosenObjectIds: ['gy-bound-1', 'gy-bound-2'] },
    });
    expect(result.automationGaps || []).toHaveLength(0);
    expect((result.state.players[0]?.hand || []).length).toBe(2);
    expect((result.state.players[0]?.graveyard || []).length).toBe(0);
  });

  it('executes Northampton Farm returning creature exiled with this land to battlefield', () => {
    const ir = parseOracleTextToIR(
      '{2}, {T}, Sacrifice this land: Return a creature card exiled with this land to the battlefield under your control.',
      'Northampton Farm'
    );
    const step = ir.abilities.flatMap((ability) => ability.steps || []).find(
      (entry) =>
        entry.kind === 'move_zone' &&
        /creature card exiled with this land/i.test(String((entry as any).what?.text || ''))
    );
    expect(step).toBeTruthy();
    const sourceId = 'bf-northampton-farm';
    const exiledCreature = {
      id: 'exile-northampton-creature',
      name: 'Northampton Exiled Creature',
      type_line: 'Creature — Human',
      cmc: 3,
      exiledWith: sourceId,
    };
    const state = {
      players: [{ id: controllerId, library: [], hand: [], graveyard: [], exile: [exiledCreature] }],
      battlefield: [
        {
          id: sourceId,
          name: 'Northampton Farm',
          controller: controllerId,
          owner: controllerId,
          type_line: 'Land',
          cmc: 0,
        },
      ],
    } as GameState;
    const result = applyOracleIRStepsToGameState(state, [step!], {
      controllerId,
      sourceId,
      selectorContext: { chosenObjectIds: [exiledCreature.id] },
    });
    expect(result.automationGaps || []).toHaveLength(0);
    expect((result.state.battlefield || []).length).toBe(2);
    expect((result.state.players[0]?.exile || []).length).toBe(0);
  });

  it('executes Deploy the Gatewatch putting planeswalkers from among them onto battlefield', () => {
    const ir = parseOracleTextToIR(
      'Look at the top seven cards of your library. Put up to two planeswalker cards from among them onto the battlefield. Put the rest on the bottom of your library in a random order.',
      'Deploy the Gatewatch'
    );
    const step = ir.abilities[0]?.steps?.find((entry) => entry.kind === 'move_zone');
    expect(step).toBeTruthy();
    const libraryCards = [
      { id: 'lib-gatewatch-pw-1', name: 'Gatewatch Jace', type_line: 'Legendary Planeswalker — Jace', cmc: 4 },
      { id: 'lib-gatewatch-pw-2', name: 'Gatewatch Gideon', type_line: 'Legendary Planeswalker — Gideon', cmc: 3 },
      { id: 'lib-gatewatch-creature', name: 'Gatewatch Bear', type_line: 'Creature — Bear', cmc: 2 },
      { id: 'lib-gatewatch-instant', name: 'Gatewatch Bolt', type_line: 'Instant', cmc: 1 },
    ];
    const state = {
      players: [{ id: controllerId, library: libraryCards, hand: [], graveyard: [], exile: [] }],
      battlefield: [],
    } as GameState;
    const result = applyOracleIRStepsToGameState(state, [step!], {
      controllerId,
      sourceId: 'test',
      lastMovedCards: libraryCards,
      selectorContext: { chosenObjectIds: ['lib-gatewatch-pw-1', 'lib-gatewatch-pw-2'] },
    });
    expect(result.automationGaps || []).toHaveLength(0);
    expect((result.state.battlefield || []).length).toBe(2);
    expect((result.state.players[0]?.library || []).length).toBe(2);
  });
});
