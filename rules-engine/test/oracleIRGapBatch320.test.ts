import { describe, expect, it } from 'vitest';
import type { GameState, PlayerID } from '../../shared/src';
import { applyOracleIRStepsToGameState } from '../src/oracleIRExecutor';
import { parseOracleTextToIR } from '../src/oracleIRParser';
import {
  parseMoveZoneCountTargetCardsFromSingleGraveyard,
  parseMoveZoneHalfCreaturesTheyControlRoundedUp,
} from '../src/oracleIRExecutorZoneOps';

const controllerId = 'p1' as PlayerID;
const targetId = 'p2' as PlayerID;

describe('Oracle IR gap batch 320 — Split the Party / Martyr of Bones / Animal Magnetism', () => {
  it('parses Split the Party half creatures they control bounce', () => {
    expect(
      parseMoveZoneHalfCreaturesTheyControlRoundedUp({
        kind: 'raw',
        text: 'half the creatures they control',
      })
    ).toBe(true);
  });

  it('parses Martyr of Bones up to X target cards from a single graveyard', () => {
    expect(
      parseMoveZoneCountTargetCardsFromSingleGraveyard({
        kind: 'raw',
        text: 'up to X target cards from a single graveyard',
      })
    ).toEqual({ count: 0, cardType: 'any', useXValue: true, upTo: true });
  });

  it('executes Split the Party returning half creatures rounded up', () => {
    const ir = parseOracleTextToIR(
      "Choose target player. Return half the creatures they control to their owner's hand, rounded up.",
      'Split the Party'
    );
    const step = ir.abilities[0]?.steps?.find((entry) => entry.kind === 'move_zone');
    expect(step).toBeTruthy();
    const state = {
      players: [
        { id: controllerId, library: [], hand: [], graveyard: [], exile: [] },
        { id: targetId, library: [], hand: [], graveyard: [], exile: [] },
      ],
      battlefield: [
        {
          id: 'bf-stp-1',
          name: 'STP One',
          controller: targetId,
          owner: targetId,
          type_line: 'Creature — Goblin',
          cmc: 1,
        },
        {
          id: 'bf-stp-2',
          name: 'STP Two',
          controller: targetId,
          owner: targetId,
          type_line: 'Creature — Elf',
          cmc: 2,
        },
        {
          id: 'bf-stp-3',
          name: 'STP Three',
          controller: targetId,
          owner: targetId,
          type_line: 'Creature — Human',
          cmc: 1,
        },
      ],
    } as GameState;
    const result = applyOracleIRStepsToGameState(state, [step!], {
      controllerId,
      sourceId: 'test',
      targetPlayerId: targetId,
      selectorContext: { chosenObjectIds: ['bf-stp-1', 'bf-stp-2'] },
    });
    expect(result.automationGaps || []).toHaveLength(0);
    expect((result.state.battlefield || []).length).toBe(1);
    expect((result.state.players[1]?.hand || []).length).toBe(2);
  });

  it('executes Martyr of Bones exiling one card from a single graveyard', () => {
    const ir = parseOracleTextToIR(
      '{B}, Sacrifice Martyr of Bones: Exile up to X target cards from a single graveyard.',
      'Martyr of Bones'
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
            { id: 'gy-mob-1', name: 'Mob One', type_line: 'Instant', cmc: 1 },
            { id: 'gy-mob-2', name: 'Mob Two', type_line: 'Sorcery', cmc: 2 },
          ],
          exile: [],
        },
      ],
      battlefield: [],
    } as GameState;
    const result = applyOracleIRStepsToGameState(state, [step!], {
      controllerId,
      sourceId: 'test',
      xValue: 1,
      selectorContext: { chosenObjectIds: ['gy-mob-1'], xValue: 1 },
    });
    expect(result.automationGaps || []).toHaveLength(0);
    expect((result.state.players[0]?.exile || []).length).toBe(1);
    expect((result.state.players[0]?.graveyard || []).length).toBe(1);
  });

  it('parses Animal Magnetism into that-card BF plus rest to graveyard steps', () => {
    const ir = parseOracleTextToIR(
      'Reveal the top four cards of your library. An opponent chooses a creature card from among them. Put that card onto the battlefield and the rest into your graveyard.',
      'Animal Magnetism'
    );
    const steps =
      ir.abilities
        ?.flatMap((ability) => ability.steps || [])
        ?.filter((entry) => entry.kind === 'move_zone') || [];
    expect(steps.map((entry) => String((entry as any).what?.text || ''))).toEqual(['that card', 'the rest']);
  });

  it('executes Animal Magnetism putting chosen creature on battlefield and rest in graveyard', () => {
    const ir = parseOracleTextToIR(
      'Reveal the top four cards of your library. An opponent chooses a creature card from among them. Put that card onto the battlefield and the rest into your graveyard.',
      'Animal Magnetism'
    );
    const steps =
      ir.abilities
        ?.flatMap((ability) => ability.steps || [])
        ?.filter((entry) => entry.kind === 'move_zone') || [];
    expect(steps.length).toBe(2);
    const revealedCards = [
      { id: 'lib-am-1', name: 'AM Creature', type_line: 'Creature — Human', cmc: 2 },
      { id: 'lib-am-2', name: 'AM Bolt', type_line: 'Instant', cmc: 1 },
      { id: 'lib-am-3', name: 'AM Bear', type_line: 'Creature — Bear', cmc: 2 },
      { id: 'lib-am-4', name: 'AM Forest', type_line: 'Basic Land — Forest', cmc: 0 },
    ];
    let state = {
      players: [
        {
          id: controllerId,
          library: [...revealedCards],
          hand: [],
          graveyard: [],
          exile: [],
        },
      ],
      battlefield: [],
    } as GameState;
    const ctx = {
      controllerId,
      sourceId: 'test',
      lastMovedCards: revealedCards,
      selectorContext: { chosenObjectIds: ['lib-am-1'] },
    };
    for (const step of steps) {
      const result = applyOracleIRStepsToGameState(state, [step], ctx);
      expect(result.automationGaps || []).toHaveLength(0);
      state = result.state;
    }
    expect((state.battlefield || []).length).toBe(1);
    expect((state.players[0]?.graveyard || []).length).toBe(3);
    expect((state.players[0]?.library || []).length).toBe(0);
    expect((state.players[0]?.hand || []).length).toBe(0);
  });
});
