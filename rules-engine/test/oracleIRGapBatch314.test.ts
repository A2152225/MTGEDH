import { describe, expect, it } from 'vitest';
import type { GameState, PlayerID } from '../../shared/src';
import { applyOracleIRStepsToGameState } from '../src/oracleIRExecutor';
import { parseOracleTextToIR } from '../src/oracleIRParser';
import {
  parseMoveZoneOpponentChoiceFromTargetPlayersGraveyard,
  parseMoveZoneSingleTargetFromYourGraveyard,
} from '../src/oracleIRExecutorZoneOps';

const controllerId = 'p1' as PlayerID;
const opponentId = 'p2' as PlayerID;

describe('Oracle IR gap batch 314 — Meanders Guide / Myr Reservoir / Tasigur', () => {
  it('parses Meanders Guide target creature mv 3 or less from your graveyard', () => {
    expect(
      parseMoveZoneSingleTargetFromYourGraveyard({
        kind: 'raw',
        text: 'target creature card with mana value 3 or less from your graveyard',
      })
    ).toEqual({ cardType: 'creature', manaValueLte: 3 });
  });

  it('parses Myr Reservoir target Myr card from your graveyard', () => {
    expect(
      parseMoveZoneSingleTargetFromYourGraveyard({
        kind: 'raw',
        text: 'target Myr card from your graveyard',
      })
    ).toEqual({ cardType: 'any', creatureTypesAnyOf: ['Myr'] });
  });

  it('parses Tasigur opponent choice nonland from your graveyard', () => {
    expect(
      parseMoveZoneOpponentChoiceFromTargetPlayersGraveyard({
        kind: 'raw',
        text: "a nonland card of an opponent's choice from your graveyard",
      })
    ).toEqual({
      cardType: 'nonland',
      fromHandOrGraveyardOwner: 'controller',
    });
  });

  it('executes Meanders Guide return creature mv 3 or less from graveyard to battlefield', () => {
    const ir = parseOracleTextToIR(
      'Return target creature card with mana value 3 or less from your graveyard to the battlefield.',
      "Meander's Guide"
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
            { id: 'gy-meander-ok', name: 'Meander Zombie', type_line: 'Creature — Zombie', cmc: 2 },
            { id: 'gy-meander-big', name: 'Meander Giant', type_line: 'Creature — Giant', cmc: 5 },
          ],
          exile: [],
        },
        { id: opponentId, library: [], hand: [], graveyard: [], exile: [] },
      ],
      battlefield: [],
    } as GameState;

    const result = applyOracleIRStepsToGameState(state, [step!], {
      controllerId,
      sourceId: 'meanders-guide',
      selectorContext: { chosenObjectIds: ['gy-meander-ok'] },
    });
    expect(result.automationGaps?.some((gap) => gap.reasonCode === 'unsupported_selector')).toBe(false);
    const controller = result.state?.players.find((entry) => entry.id === controllerId) as any;
    expect(controller.graveyard.map((card: any) => card.id)).toEqual(['gy-meander-big']);
    expect(result.state?.battlefield?.length).toBe(1);
    const permanent = result.state?.battlefield?.[0] as any;
    expect(String(permanent?.name || permanent?.card?.name || '')).toBe('Meander Zombie');
  });

  it('executes Myr Reservoir return target Myr from graveyard to hand', () => {
    const ir = parseOracleTextToIR(
      'Return target Myr card from your graveyard to your hand.',
      'Myr Reservoir'
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
            { id: 'gy-myr', name: 'Myr Retriever', type_line: 'Artifact Creature — Myr', cmc: 2 },
            { id: 'gy-non-myr', name: 'Non-Myr Elf', type_line: 'Creature — Elf', cmc: 1 },
          ],
          exile: [],
        },
        { id: opponentId, library: [], hand: [], graveyard: [], exile: [] },
      ],
      battlefield: [],
    } as GameState;

    const result = applyOracleIRStepsToGameState(state, [step!], {
      controllerId,
      sourceId: 'myr-reservoir',
      selectorContext: { chosenObjectIds: ['gy-myr'] },
    });
    expect(result.automationGaps?.some((gap) => gap.reasonCode === 'unsupported_selector')).toBe(false);
    const controller = result.state?.players.find((entry) => entry.id === controllerId) as any;
    expect(controller.hand.map((card: any) => card.id)).toEqual(['gy-myr']);
    expect(controller.graveyard.map((card: any) => card.id)).toEqual(['gy-non-myr']);
  });

  it('executes Tasigur opponent choice nonland from your graveyard to hand', () => {
    const ir = parseOracleTextToIR(
      "Then return a nonland card of an opponent's choice from your graveyard to your hand.",
      'Tasigur, the Golden Fang'
    );
    const step = ir.abilities.find((ability) =>
      ability.steps?.some(
        (entry) =>
          entry.kind === 'move_zone' &&
          String((entry as any).what?.text || '').includes("opponent's choice")
      )
    )?.steps?.find(
      (entry) =>
        entry.kind === 'move_zone' &&
        String((entry as any).what?.text || '').includes("opponent's choice")
    );
    expect(step).toBeTruthy();
    const state = {
      players: [
        {
          id: controllerId,
          library: [],
          hand: [],
          graveyard: [
            { id: 'gy-tasigur-instant', name: 'Tasigur Bolt', type_line: 'Instant', cmc: 1 },
            { id: 'gy-tasigur-land', name: 'Tasigur Forest', type_line: 'Basic Land — Forest', cmc: 0 },
          ],
          exile: [],
        },
        { id: opponentId, library: [], hand: [], graveyard: [], exile: [] },
      ],
      battlefield: [],
    } as GameState;

    const result = applyOracleIRStepsToGameState(state, [step!], {
      controllerId,
      sourceId: 'tasigur',
      targetPlayerId: opponentId,
      selectorContext: {
        targetPlayerId: opponentId,
        targetOpponentId: opponentId,
        chosenObjectIds: ['gy-tasigur-instant'],
      },
    });
    expect(result.automationGaps?.some((gap) => gap.reasonCode === 'unsupported_selector')).toBe(false);
    const controller = result.state?.players.find((entry) => entry.id === controllerId) as any;
    expect(controller.hand.map((card: any) => card.id)).toEqual(['gy-tasigur-instant']);
    expect(controller.graveyard.map((card: any) => card.id)).toEqual(['gy-tasigur-land']);
  });
});
