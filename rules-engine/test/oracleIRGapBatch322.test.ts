import { describe, expect, it } from 'vitest';
import type { GameState, PlayerID } from '../../shared/src';
import { applyOracleIRStepsToGameState } from '../src/oracleIRExecutor';
import { parseOracleTextToIR } from '../src/oracleIRParser';
import {
  parseMoveZoneAllCardsFromPileOfYourChoice,
  parseMoveZoneAllCreaturesBlockingOrBlockedByTargetCreature,
  parseMoveZoneThoseLands,
} from '../src/oracleIRExecutorZoneOps';

const controllerId = 'p1' as PlayerID;
const opponentId = 'p2' as PlayerID;

describe('Oracle IR gap batch 322 — Boneyard Parley pile / Trial // Error / Planar Overlay', () => {
  it('parses Boneyard Parley chosen pile selector', () => {
    expect(
      parseMoveZoneAllCardsFromPileOfYourChoice({
        kind: 'raw',
        text: 'all cards from the pile of your choice',
      })
    ).toBe(true);
  });

  it('parses Trial // Error blocking or blocked by target creature selector', () => {
    expect(
      parseMoveZoneAllCreaturesBlockingOrBlockedByTargetCreature({
        kind: 'raw',
        text: 'all creatures blocking or blocked by target creature',
      })
    ).toBe(true);
  });

  it('parses Planar Overlay those lands selector', () => {
    expect(parseMoveZoneThoseLands({ kind: 'raw', text: 'those lands' })).toBe(true);
  });

  it('executes Boneyard Parley pile step onto battlefield and rest to graveyards', () => {
    const ir = parseOracleTextToIR(
      "Exile up to five target creature cards from graveyards. Then put all cards from the pile of your choice onto the battlefield under your control and the rest into their owners' graveyards.",
      'Boneyard Parley'
    );
    const steps = ir.abilities[0]?.steps?.filter((entry) => entry.kind === 'move_zone') || [];
    expect(steps.length).toBeGreaterThanOrEqual(3);
    const pileStep = steps.find(
      (entry) =>
        entry.kind === 'move_zone' &&
        String((entry as any).what?.text || '').includes('all cards from the pile of your choice')
    );
    const restStep = steps.find(
      (entry) =>
        entry.kind === 'move_zone' &&
        String((entry as any).what?.text || '').trim().toLowerCase() === 'the rest'
    );
    expect(pileStep).toBeTruthy();
    expect(restStep).toBeTruthy();

    const exiledFixtures = [
      { id: 'ex-bp-1', name: 'BP Exiled One', type_line: 'Creature — Zombie', cmc: 3 },
      { id: 'ex-bp-2', name: 'BP Exiled Two', type_line: 'Creature — Elf', cmc: 2 },
      { id: 'ex-bp-3', name: 'BP Exiled Three', type_line: 'Creature — Human', cmc: 1 },
    ];
    const state = {
      players: [
        {
          id: controllerId,
          library: [],
          hand: [],
          graveyard: [],
          exile: exiledFixtures,
        },
      ],
      battlefield: [],
    } as GameState;

    const ctx = {
      controllerId,
      sourceId: 'test',
      lastExiledCards: exiledFixtures,
      lastMovedCards: exiledFixtures,
      selectorContext: { chosenObjectIds: ['ex-bp-1', 'ex-bp-2'] },
    };

    const pileResult = applyOracleIRStepsToGameState(state, [pileStep!], ctx);
    expect(pileResult.automationGaps || []).toHaveLength(0);
    expect((pileResult.state.battlefield || []).length).toBe(2);
    expect((pileResult.state.players[0]?.exile || []).length).toBe(1);

    const restResult = applyOracleIRStepsToGameState(pileResult.state, [restStep!], ctx);
    expect(restResult.automationGaps || []).toHaveLength(0);
    expect((restResult.state.players[0]?.exile || []).length).toBe(0);
    expect((restResult.state.players[0]?.graveyard || []).length).toBe(1);
  });

  it('executes Trial // Error bouncing combatants but not the target creature', () => {
    const ir = parseOracleTextToIR(
      "Return all creatures blocking or blocked by target creature to their owner's hand.",
      'Trial // Error'
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
          id: 'bf-blocker',
          name: 'Blocker',
          controller: opponentId,
          owner: opponentId,
          type_line: 'Creature — Goblin',
          cmc: 1,
          blocking: 'bf-attacker',
        },
        {
          id: 'bf-attacker',
          name: 'Attacker',
          controller: controllerId,
          owner: controllerId,
          type_line: 'Creature — Human',
          cmc: 2,
          blockedBy: ['bf-blocker'],
        },
      ],
    } as GameState;
    const result = applyOracleIRStepsToGameState(state, [step!], {
      controllerId,
      sourceId: 'test',
      targetCreatureId: 'bf-attacker',
    });
    expect(result.automationGaps || []).toHaveLength(0);
    expect((result.state.battlefield || []).map((perm: any) => perm.id)).toEqual(['bf-attacker']);
    expect((result.state.players[1]?.hand || []).length).toBe(1);
  });

  it('executes Planar Overlay returning contextual lands to owners hands', () => {
    const ir = parseOracleTextToIR("Return those lands to their owners' hands.", 'Planar Overlay');
    const step = ir.abilities[0]?.steps?.find((entry) => entry.kind === 'move_zone');
    expect(step).toBeTruthy();
    const landFixtures = [
      {
        id: 'bf-land-1',
        name: 'Overlay Plains',
        controller: opponentId,
        owner: opponentId,
        type_line: 'Basic Land — Plains',
        cmc: 0,
      },
      {
        id: 'bf-land-2',
        name: 'Overlay Island',
        controller: controllerId,
        owner: controllerId,
        type_line: 'Basic Land — Island',
        cmc: 0,
      },
    ];
    const state = {
      players: [
        { id: controllerId, library: [], hand: [], graveyard: [], exile: [] },
        { id: opponentId, library: [], hand: [], graveyard: [], exile: [] },
      ],
      battlefield: landFixtures,
    } as GameState;
    const result = applyOracleIRStepsToGameState(state, [step!], {
      controllerId,
      sourceId: 'test',
      lastMovedCards: landFixtures,
    });
    expect(result.automationGaps || []).toHaveLength(0);
    expect((result.state.battlefield || []).length).toBe(0);
    expect((result.state.players[0]?.hand || []).length).toBe(1);
    expect((result.state.players[1]?.hand || []).length).toBe(1);
  });
});
