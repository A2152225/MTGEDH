import { describe, expect, it } from 'vitest';
import type { GameState, PlayerID } from '../../shared/src';
import { applyOracleIRStepsToGameState } from '../src/oracleIRExecutor';
import { parseOracleTextToIR } from '../src/oracleIRParser';
import {
  parseMoveZoneSingleTargetFromYourGraveyard,
  parseMoveZoneThisPermanentAndAnotherTargetCreature,
} from '../src/oracleIRExecutorZoneOps';

const controllerId = 'p1' as PlayerID;
const opponentId = 'p2' as PlayerID;

describe('Oracle IR gap batch 332 — Nahiri / The Five Doctors / Lady Sun', () => {
  it('parses Nahiri loyalty-limited graveyard exile selector', () => {
    expect(
      parseMoveZoneSingleTargetFromYourGraveyard({
        kind: 'raw',
        text: "target creature or Equipment card with mana value less than this permanent's loyalty from your graveyard",
      })
    ).toEqual({
      cardType: 'creature_or_equipment',
      manaValueLtReferenceLoyalty: true,
    });
  });

  it('parses Lady Sun this permanent and another target creature bounce', () => {
    expect(
      parseMoveZoneThisPermanentAndAnotherTargetCreature({
        kind: 'raw',
        text: 'this permanent and another target creature',
      })
    ).toBe(true);
  });

  it('postprocesses Five Doctors kicked those-cards-to-battlefield step', () => {
    const ir = parseOracleTextToIR(
      'Search your library and/or graveyard for up to five Doctor cards, reveal them, and put them into your hand. If you search your library this way, shuffle. If this spell was kicked, put those cards onto the battlefield instead of putting them into your hand.',
      'The Five Doctors'
    );
    const conditional = ir.abilities.flatMap((ability) => ability.steps || []).find(
      (entry) => entry.kind === 'conditional' && /this spell was kicked/i.test(String((entry as any).condition?.raw || ''))
    );
    const step = (conditional as any)?.steps?.find((entry: any) => entry.kind === 'move_zone');
    expect(step?.to).toBe('battlefield');
    expect(String((step as any)?.what?.text || '').trim()).toBe('those cards');
  });

  it('executes Nahiri exiling target creature from graveyard', () => {
    const ir = parseOracleTextToIR(
      "0: Exile target creature or Equipment card with mana value less than Nahiri's loyalty from your graveyard. Create a token that's a copy of it.",
      'Nahiri, the Unforgiving'
    );
    const moveStep = ir.abilities.flatMap((ability) => ability.steps || []).find(
      (entry) =>
        entry.kind === 'move_zone' &&
        String((entry as any).what?.text || '').includes('graveyard')
    );
    expect(moveStep).toBeTruthy();
    const state = {
      players: [
        {
          id: controllerId,
          library: [],
          hand: [],
          graveyard: [
            { id: 'gy-nahiri-creature', name: 'Nahiri GY Creature', type_line: 'Creature — Human', cmc: 2 },
          ],
          exile: [],
        },
        { id: opponentId, library: [], hand: [], graveyard: [], exile: [] },
      ],
      battlefield: [
        {
          id: 'bf-nahiri',
          name: 'Nahiri',
          controller: controllerId,
          owner: controllerId,
          type_line: 'Legendary Planeswalker — Nahiri',
          cmc: 4,
          loyalty: 5,
          counters: { loyalty: 5 },
        },
      ],
    } as GameState;
    const result = applyOracleIRStepsToGameState(state, [moveStep!], {
      controllerId,
      sourceId: 'bf-nahiri',
      selectorContext: { chosenObjectIds: ['gy-nahiri-creature'] },
    });
    expect(result.automationGaps || []).toHaveLength(0);
    expect((result.state.players[0]?.exile || []).length).toBe(1);
    expect((result.state.players[0]?.graveyard || []).length).toBe(0);
  });

  it('executes Five Doctors putting those cards from hand onto battlefield', () => {
    const ir = parseOracleTextToIR(
      'If this spell was kicked, put those cards onto the battlefield instead of putting them into your hand.',
      'The Five Doctors'
    );
    const conditional = ir.abilities[0]?.steps?.find((entry) => entry.kind === 'conditional') as any;
    const step = conditional?.steps?.find((entry: any) => entry.kind === 'move_zone');
    expect(step).toBeTruthy();
    const handCards = [
      { id: 'hand-tfd-1', name: 'TFD One', type_line: 'Creature — Human', cmc: 3 },
      { id: 'hand-tfd-2', name: 'TFD Two', type_line: 'Instant', cmc: 2 },
    ];
    const state = {
      players: [{ id: controllerId, library: [], hand: handCards, graveyard: [], exile: [] }],
      battlefield: [],
    } as GameState;
    const result = applyOracleIRStepsToGameState(state, [step!], {
      controllerId,
      sourceId: 'test',
      lastMovedCards: handCards,
      selectorContext: { chosenObjectIds: ['hand-tfd-1', 'hand-tfd-2'] },
    });
    expect(result.automationGaps || []).toHaveLength(0);
    expect((result.state.battlefield || []).length).toBe(2);
    expect((result.state.players[0]?.hand || []).length).toBe(0);
  });

  it('executes Lady Sun bouncing this permanent and another target creature', () => {
    const ir = parseOracleTextToIR(
      "{T}: Return Lady Sun and another target creature to their owners' hands.",
      'Lady Sun'
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
          id: 'bf-lady-sun',
          name: 'Lady Sun',
          controller: controllerId,
          owner: controllerId,
          type_line: 'Legendary Creature — Human',
          cmc: 3,
        },
        {
          id: 'bf-lady-target',
          name: 'Lady Target',
          controller: opponentId,
          owner: opponentId,
          type_line: 'Creature — Elf',
          cmc: 2,
        },
      ],
    } as GameState;
    const result = applyOracleIRStepsToGameState(state, [step!], {
      controllerId,
      sourceId: 'bf-lady-sun',
      targetCreatureId: 'bf-lady-target',
      selectorContext: { targetCreatureId: 'bf-lady-target', chosenObjectIds: ['bf-lady-sun', 'bf-lady-target'] },
    });
    expect(result.automationGaps || []).toHaveLength(0);
    expect((result.state.battlefield || []).length).toBe(0);
    expect((result.state.players[0]?.hand || []).length).toBe(1);
    expect((result.state.players[1]?.hand || []).length).toBe(1);
  });
});
