import { describe, expect, it } from 'vitest';
import type { GameState, PlayerID } from '../../shared/src';
import { applyOracleIRStepsToGameState } from '../src/oracleIRExecutor';
import { parseOracleTextToIR } from '../src/oracleIRParser';
import {
  parseMoveZoneCountTypedCards,
  parseMoveZoneCreatureYouDontControlLowestToughness,
  parseMoveZoneSingleTargetFromYourGraveyard,
} from '../src/oracleIRExecutorZoneOps';

const controllerId = 'p1' as PlayerID;
const opponentId = 'p2' as PlayerID;

describe('Oracle IR gap batch 325 — Atzocan Seer / See the Unwritten / Bounce Chamber', () => {
  it('parses Atzocan Seer target Dinosaur from graveyard', () => {
    expect(
      parseMoveZoneSingleTargetFromYourGraveyard({
        kind: 'raw',
        text: 'target Dinosaur card from your graveyard',
      })
    ).toEqual({ cardType: 'any', creatureTypesAnyOf: ['Dinosaur'] });
  });

  it('parses See the Unwritten two creature cards selector', () => {
    expect(parseMoveZoneCountTypedCards({ kind: 'raw', text: 'two creature cards' })).toEqual({
      count: 2,
      cardType: 'creature',
    });
  });

  it('parses Bounce Chamber lowest toughness opponent creature selector', () => {
    expect(
      parseMoveZoneCreatureYouDontControlLowestToughness({
        kind: 'raw',
        text: "a creature you don't control with the lowest toughness among creatures you don't control",
      })
    ).toBe(true);
  });

  it('executes Atzocan Seer returning target Dinosaur from graveyard to hand', () => {
    const ir = parseOracleTextToIR(
      'Return target Dinosaur card from your graveyard to your hand.',
      'Atzocan Seer'
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
            { id: 'gy-dino', name: 'Atzocan Dino', type_line: 'Creature — Dinosaur', cmc: 3 },
            { id: 'gy-human', name: 'Atzocan Human', type_line: 'Creature — Human', cmc: 2 },
          ],
          exile: [],
        },
      ],
      battlefield: [],
    } as GameState;
    const result = applyOracleIRStepsToGameState(state, [step!], {
      controllerId,
      sourceId: 'test',
      selectorContext: { chosenObjectIds: ['gy-dino'] },
    });
    expect(result.automationGaps || []).toHaveLength(0);
    expect((result.state.players[0]?.hand || []).length).toBe(1);
    expect((result.state.players[0]?.graveyard || []).length).toBe(1);
  });

  it('executes See the Unwritten putting two creature cards from hand onto battlefield', () => {
    const ir = parseOracleTextToIR(
      'You may put a creature card from your hand onto the battlefield. If you do, you may put two creature cards onto the battlefield instead of one.',
      'See the Unwritten'
    );
    const step = ir.abilities[0]?.steps?.find(
      (entry) =>
        entry.kind === 'conditional' &&
        Array.isArray((entry as any).steps) &&
        (entry as any).steps.some(
          (nested: any) =>
            nested.kind === 'move_zone' &&
            String(nested.what?.text || '').trim().toLowerCase() === 'two creature cards'
        )
    );
    expect(step).toBeTruthy();
    const innerStep = (step as any).steps.find(
      (nested: any) =>
        nested.kind === 'move_zone' &&
        String(nested.what?.text || '').trim().toLowerCase() === 'two creature cards'
    );
    const state = {
      players: [
        {
          id: controllerId,
          library: [],
          hand: [
            { id: 'hand-su-1', name: 'SU Creature One', type_line: 'Creature — Beast', cmc: 4 },
            { id: 'hand-su-2', name: 'SU Creature Two', type_line: 'Creature — Elf', cmc: 2 },
          ],
          graveyard: [],
          exile: [],
        },
      ],
      battlefield: [],
    } as GameState;
    const result = applyOracleIRStepsToGameState(
      state,
      [innerStep],
      {
        controllerId,
        sourceId: 'test',
        selectorContext: { chosenObjectIds: ['hand-su-1', 'hand-su-2'] },
      },
      { allowOptional: true }
    );
    expect(result.automationGaps || []).toHaveLength(0);
    expect((result.state.battlefield || []).length).toBe(2);
    expect((result.state.players[0]?.hand || []).length).toBe(0);
  });

  it('executes Bounce Chamber returning lowest toughness creature you do not control', () => {
    const ir = parseOracleTextToIR(
      "Visit - Return a creature you don't control with the lowest toughness among creatures you don't control to its owner's hand.",
      'Bounce Chamber'
    );
    const step = ir.abilities[0]?.steps?.find((entry) => entry.kind === 'move_zone');
    expect(step).toBeTruthy();
    const state = {
      players: [
        { id: controllerId, library: [], hand: [], graveyard: [], exile: [] },
        { id: opponentId, library: [], hand: [], graveyard: [], exile: [] },
      ],
      battlefield: [
        {
          id: 'bf-bc-low',
          name: 'Low Toughness',
          controller: opponentId,
          owner: opponentId,
          type_line: 'Creature — Goblin',
          cmc: 1,
          toughness: 1,
          power: 1,
        },
        {
          id: 'bf-bc-high',
          name: 'High Toughness',
          controller: opponentId,
          owner: opponentId,
          type_line: 'Creature — Giant',
          cmc: 4,
          toughness: 5,
          power: 4,
        },
      ],
    } as GameState;
    const result = applyOracleIRStepsToGameState(state, [step!], {
      controllerId,
      sourceId: 'test',
      selectorContext: { chosenObjectIds: ['bf-bc-low'] },
    });
    expect(result.automationGaps || []).toHaveLength(0);
    expect((result.state.battlefield || []).map((perm: any) => perm.id)).toEqual(['bf-bc-high']);
    expect((result.state.players[1]?.hand || []).length).toBe(1);
  });
});
