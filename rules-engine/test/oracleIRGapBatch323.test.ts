import { describe, expect, it } from 'vitest';
import type { GameState, PlayerID } from '../../shared/src';
import { applyOracleIRStepsToGameState } from '../src/oracleIRExecutor';
import { parseOracleTextToIR } from '../src/oracleIRParser';
import {
  parseMoveZoneSingleTargetFromYourGraveyard,
  parseMoveZoneUpToCreatureCardsPutIntoGraveyardsThisWay,
} from '../src/oracleIRExecutorZoneOps';

const controllerId = 'p1' as PlayerID;
const opponentId = 'p2' as PlayerID;

describe('Oracle IR gap batch 323 — Confront the Past / Danse Macabre / Tatsumasa', () => {
  it('parses Confront the Past target planeswalker MV X from graveyard', () => {
    expect(
      parseMoveZoneSingleTargetFromYourGraveyard({
        kind: 'raw',
        text: 'target planeswalker card with mana value X or less from your graveyard',
      })
    ).toEqual({ cardType: 'planeswalker', manaValueLte: -1 });
  });

  it('parses Danse Macabre up to two creature cards put into graveyards this way', () => {
    expect(
      parseMoveZoneUpToCreatureCardsPutIntoGraveyardsThisWay({
        kind: 'raw',
        text: 'up to two creature cards put into graveyards this way',
      })
    ).toEqual({ maxCount: 2, cardType: 'creature' });
  });

  it('executes Confront the Past returning planeswalker from graveyard to battlefield', () => {
    const ir = parseOracleTextToIR(
      'Return target planeswalker card with mana value X or less from your graveyard to the battlefield.',
      'Confront the Past'
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
            {
              id: 'gy-pw-1',
              name: 'Test Planeswalker',
              type_line: 'Legendary Planeswalker — Jace',
              cmc: 3,
            },
            {
              id: 'gy-creature-1',
              name: 'Test Creature',
              type_line: 'Creature — Human',
              cmc: 2,
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
      xValue: 4,
      selectorContext: { chosenObjectIds: ['gy-pw-1'] },
    });
    expect(result.automationGaps || []).toHaveLength(0);
    expect((result.state.battlefield || []).length).toBe(1);
    expect((result.state.players[0]?.graveyard || []).length).toBe(1);
  });

  it('executes Danse Macabre returning up to two sacrificed creatures to battlefield', () => {
    const ir = parseOracleTextToIR(
      'Each player sacrifices a creature of their choice. Return up to two creature cards put into graveyards this way to the battlefield under your control.',
      'Danse Macabre'
    );
    const step = ir.abilities[0]?.steps?.find(
      (entry) =>
        entry.kind === 'move_zone' &&
        /put into graveyards this way/i.test(String((entry as any).what?.text || ''))
    );
    expect(step).toBeTruthy();
    const sacrificed = [
      { id: 'gy-dm-1', name: 'DM Creature One', type_line: 'Creature — Zombie', cmc: 3 },
      { id: 'gy-dm-2', name: 'DM Creature Two', type_line: 'Creature — Elf', cmc: 2 },
    ];
    const state = {
      players: [
        {
          id: controllerId,
          library: [],
          hand: [],
          graveyard: sacrificed,
          exile: [],
        },
        { id: opponentId, library: [], hand: [], graveyard: [], exile: [] },
      ],
      battlefield: [],
    } as GameState;
    const result = applyOracleIRStepsToGameState(state, [step!], {
      controllerId,
      sourceId: 'test',
      lastMovedCards: sacrificed,
      lastSacrificedPermanents: sacrificed,
      selectorContext: { chosenObjectIds: ['gy-dm-1', 'gy-dm-2'] },
    });
    expect(result.automationGaps || []).toHaveLength(0);
    expect((result.state.battlefield || []).length).toBe(2);
    expect((result.state.players[0]?.graveyard || []).length).toBe(0);
  });

  it('executes Tatsumasa returning this permanent from graveyard to battlefield under owner', () => {
    const ir = parseOracleTextToIR(
      "Return this permanent to the battlefield under its owner's control when that token dies.",
      "Tatsumasa, the Dragon's Fang"
    );
    const step = ir.abilities[0]?.steps?.find((entry) => entry.kind === 'move_zone');
    expect(step).toBeTruthy();
    const sourceId = 'bf-tatsumasa';
    const state = {
      players: [
        {
          id: controllerId,
          library: [],
          hand: [],
          graveyard: [
            {
              id: sourceId,
              name: "Tatsumasa, the Dragon's Fang",
              type_line: 'Legendary Artifact — Equipment',
              cmc: 6,
            },
          ],
          exile: [],
        },
      ],
      battlefield: [],
    } as GameState;
    const result = applyOracleIRStepsToGameState(state, [step!], {
      controllerId,
      sourceId,
      sourceName: "Tatsumasa, the Dragon's Fang",
    });
    expect(result.automationGaps || []).toHaveLength(0);
    expect((result.state.battlefield || []).length).toBe(1);
    expect((result.state.battlefield?.[0] as any)?.controller).toBe(controllerId);
    expect((result.state.players[0]?.graveyard || []).length).toBe(0);
  });

  it('postprocess keeps Danse Macabre return step as move_zone selector', () => {
    const ir = parseOracleTextToIR(
      'Each player sacrifices a creature of their choice. Return up to two creature cards put into graveyards this way to the battlefield under your control.',
      'Danse Macabre'
    );
    const step = ir.abilities[0]?.steps?.find(
      (entry) =>
        entry.kind === 'move_zone' &&
        String((entry as any).what?.text || '')
          .trim()
          .toLowerCase() === 'up to two creature cards put into graveyards this way'
    );
    expect(step).toBeTruthy();
  });
});
