import { describe, expect, it } from 'vitest';
import type { GameState, PlayerID } from '../../shared/src';
import { applyOracleIRStepsToGameState } from '../src/oracleIRExecutor';
import { parseOracleTextToIR } from '../src/oracleIRParser';
import {
  parseMoveZoneAllCardsFromAllHandsAndGraveyards,
  parseMoveZoneCreatureFromHandSharingTypeWithEachTappedThisWay,
  parseMoveZoneEachCreatureThatDealtDamageThisTurn,
} from '../src/oracleIRExecutorZoneOps';

const controllerId = 'p1' as PlayerID;
const opponentId = 'p2' as PlayerID;

describe('Oracle IR gap batch 324 — Cryptic Gateway / Worldfire / Restore the Peace', () => {
  it('parses Cryptic Gateway hand creature sharing type with each tapped creature', () => {
    expect(
      parseMoveZoneCreatureFromHandSharingTypeWithEachTappedThisWay({
        kind: 'raw',
        text: 'a creature card from your hand that shares a creature type with each creature tapped this way',
      })
    ).toBe(true);
  });

  it('parses Worldfire all cards from all hands and graveyards', () => {
    expect(
      parseMoveZoneAllCardsFromAllHandsAndGraveyards({
        kind: 'raw',
        text: 'all cards from all hands and graveyards',
      })
    ).toBe(true);
  });

  it('parses Restore the Peace each creature that dealt damage this turn', () => {
    expect(
      parseMoveZoneEachCreatureThatDealtDamageThisTurn({
        kind: 'raw',
        text: 'each creature that dealt damage this turn',
      })
    ).toBe(true);
  });

  it('executes Cryptic Gateway putting matching hand creature onto battlefield', () => {
    const ir = parseOracleTextToIR(
      '{T}: You may put a creature card from your hand that shares a creature type with each creature tapped this way onto the battlefield.',
      'Cryptic Gateway'
    );
    const step = ir.abilities[0]?.steps?.find((entry) => entry.kind === 'move_zone');
    expect(step).toBeTruthy();
    const state = {
      players: [
        {
          id: controllerId,
          library: [],
          hand: [
            { id: 'hand-goblin', name: 'Goblin Guide', type_line: 'Creature — Goblin', cmc: 1 },
            { id: 'hand-elf', name: 'Elvish Mystic', type_line: 'Creature — Elf', cmc: 1 },
          ],
          graveyard: [],
          exile: [],
        },
      ],
      battlefield: [
        {
          id: 'bf-goblin-1',
          name: 'Tapped Goblin One',
          controller: controllerId,
          owner: controllerId,
          type_line: 'Creature — Goblin',
          cmc: 1,
          tapped: true,
        },
        {
          id: 'bf-goblin-2',
          name: 'Tapped Goblin Two',
          controller: controllerId,
          owner: controllerId,
          type_line: 'Creature — Goblin',
          cmc: 2,
          tapped: true,
        },
      ],
    } as GameState;
    const result = applyOracleIRStepsToGameState(
      state,
      [step!],
      {
        controllerId,
        sourceId: 'bf-gateway',
        lastTappedMatchingPermanentIds: ['bf-goblin-1', 'bf-goblin-2'],
        selectorContext: { chosenObjectIds: ['hand-goblin'] },
      },
      { allowOptional: true }
    );
    expect(result.automationGaps || []).toHaveLength(0);
    expect((result.state.battlefield || []).length).toBe(3);
    expect((result.state.players[0]?.hand || []).map((c: any) => c.id)).toEqual(['hand-elf']);
  });

  it('executes Worldfire exiling all cards from all hands and graveyards', () => {
    const ir = parseOracleTextToIR('Exile all cards from all hands and graveyards.', 'Worldfire');
    const step = ir.abilities[0]?.steps?.find((entry) => entry.kind === 'move_zone');
    expect(step).toBeTruthy();
    const state = {
      players: [
        {
          id: controllerId,
          library: [],
          hand: [{ id: 'hand-p1', name: 'P1 Hand', type_line: 'Instant', cmc: 1 }],
          graveyard: [{ id: 'gy-p1', name: 'P1 GY', type_line: 'Creature — Human', cmc: 2 }],
          exile: [],
        },
        {
          id: opponentId,
          library: [],
          hand: [{ id: 'hand-p2', name: 'P2 Hand', type_line: 'Instant', cmc: 1 }],
          graveyard: [{ id: 'gy-p2', name: 'P2 GY', type_line: 'Creature — Elf', cmc: 2 }],
          exile: [],
        },
      ],
      battlefield: [],
    } as GameState;
    const result = applyOracleIRStepsToGameState(state, [step!], { controllerId, sourceId: 'test' });
    expect(result.automationGaps || []).toHaveLength(0);
    expect((result.state.players[0]?.hand || []).length).toBe(0);
    expect((result.state.players[0]?.graveyard || []).length).toBe(0);
    expect((result.state.players[1]?.hand || []).length).toBe(0);
    expect((result.state.players[1]?.graveyard || []).length).toBe(0);
    expect((result.state.players[0]?.exile || []).length).toBe(2);
    expect((result.state.players[1]?.exile || []).length).toBe(2);
  });

  it('executes Restore the Peace bouncing creatures that dealt damage this turn', () => {
    const ir = parseOracleTextToIR(
      "Return each creature that dealt damage this turn to its owner's hand.",
      'Restore the Peace'
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
          id: 'bf-damager',
          name: 'Damager',
          controller: controllerId,
          owner: controllerId,
          type_line: 'Creature — Human',
          cmc: 2,
          dealtDamageThisTurn: true,
        },
        {
          id: 'bf-innocent',
          name: 'Innocent',
          controller: opponentId,
          owner: opponentId,
          type_line: 'Creature — Elf',
          cmc: 1,
        },
      ],
    } as GameState;
    const result = applyOracleIRStepsToGameState(state, [step!], { controllerId, sourceId: 'test' });
    expect(result.automationGaps || []).toHaveLength(0);
    expect((result.state.battlefield || []).map((perm: any) => perm.id)).toEqual(['bf-innocent']);
    expect((result.state.players[0]?.hand || []).length).toBe(1);
  });
});
