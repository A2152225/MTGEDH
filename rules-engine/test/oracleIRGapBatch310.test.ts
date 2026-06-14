import { describe, expect, it } from 'vitest';
import type { GameState, PlayerID } from '../../shared/src';
import { applyOracleIRStepsToGameState } from '../src/oracleIRExecutor';
import { parseOracleTextToIR } from '../src/oracleIRParser';
import {
  parseMoveZoneAllFromYourGraveyard,
  parseMoveZoneCardPutIntoGraveyardThisWay,
  parseMoveZoneCountTargetBattlefieldBounce,
} from '../src/oracleIRExecutorZoneOps';

const controllerId = 'p1' as PlayerID;
const opponentId = 'p2' as PlayerID;

describe('Oracle IR gap batch 310 — Kiora / Starfall / Shilgengar', () => {
  it('parses Kiora any number of target enchantments bounce', () => {
    expect(
      parseMoveZoneCountTargetBattlefieldBounce({
        kind: 'raw',
        text: 'any number of target enchantments',
      })
    ).toEqual({ count: 99, selectorText: 'target enchantments' });
  });

  it('parses Starfall creature put into graveyard this way', () => {
    expect(
      parseMoveZoneCardPutIntoGraveyardThisWay({
        kind: 'raw',
        text: 'a creature card put into your graveyard this way',
      })
    ).toEqual({ cardType: 'creature' });
  });

  it('parses Shilgengar each creature card from graveyard', () => {
    expect(
      parseMoveZoneAllFromYourGraveyard({
        kind: 'raw',
        text: 'each creature card from your graveyard',
      })
    ).toEqual({ cardType: 'creature' });
  });

  it('executes Kiora return any number of target enchantments', () => {
    const ir = parseOracleTextToIR("Return any number of target enchantments to their owners' hands.", "Kiora's Dismissal");
    const step = ir.abilities[0]?.steps?.[0];
    expect(step?.kind).toBe('move_zone');
    const state = {
      players: [
        { id: controllerId, library: [], hand: [], graveyard: [], exile: [] },
        { id: opponentId, library: [], hand: [], graveyard: [], exile: [] },
      ],
      battlefield: [
        {
          id: 'bf-kiora-enchant-1',
          name: 'Kiora Enchant One',
          controller: opponentId,
          owner: opponentId,
          type_line: 'Enchantment',
          cmc: 2,
        },
        {
          id: 'bf-kiora-enchant-2',
          name: 'Kiora Enchant Two',
          controller: opponentId,
          owner: opponentId,
          type_line: 'Enchantment — Aura',
          cmc: 1,
        },
      ],
    } as GameState;

    const result = applyOracleIRStepsToGameState(state, [step!], {
      controllerId,
      sourceId: 'kioras-dismissal',
      selectorContext: { chosenObjectIds: ['bf-kiora-enchant-1', 'bf-kiora-enchant-2'] },
    });
    expect(result.automationGaps?.some((gap) => gap.reasonCode === 'unsupported_selector')).toBe(false);
    expect(result.state?.battlefield?.length).toBe(0);
    const opponent = result.state?.players.find((entry) => entry.id === opponentId) as any;
    expect(opponent.hand.length).toBe(2);
  });

  it('executes Starfall return creature put into graveyard this way', () => {
    const ir = parseOracleTextToIR(
      'Destroy all creatures. Then return a creature card put into your graveyard this way to the battlefield under your control.',
      'Starfall Invocation'
    );
    const step = ir.abilities[0]?.steps?.find(
      (entry) =>
        entry.kind === 'move_zone' &&
        String((entry as any).what?.text || '').includes('a creature card put into your graveyard this way')
    );
    expect(step).toBeTruthy();
    const destroyedFixture = {
      id: 'gy-starfall',
      name: 'Starfall Zombie',
      type_line: 'Creature — Zombie',
      cmc: 2,
    };
    const state = {
      players: [
        {
          id: controllerId,
          library: [],
          hand: [],
          graveyard: [destroyedFixture],
          exile: [],
        },
        { id: opponentId, library: [], hand: [], graveyard: [], exile: [] },
      ],
      battlefield: [],
    } as GameState;

    const result = applyOracleIRStepsToGameState(state, [step!], {
      controllerId,
      sourceId: 'starfall-invocation',
      lastMovedCards: [destroyedFixture],
      selectorContext: { chosenObjectIds: ['gy-starfall'] },
    });
    expect(result.automationGaps?.some((gap) => gap.reasonCode === 'unsupported_selector')).toBe(false);
    const player = result.state?.players.find((entry) => entry.id === controllerId) as any;
    expect(player.graveyard.length).toBe(0);
    expect(result.state?.battlefield?.length).toBe(1);
  });

  it('executes Shilgengar return each creature with finality counter', () => {
    const ir = parseOracleTextToIR(
      'Return each creature card from your graveyard to the battlefield with a finality counter on it.',
      'Shilgengar, Sire of Famine'
    );
    const step = ir.abilities[0]?.steps?.[0];
    expect(step?.kind).toBe('move_zone');
    const state = {
      players: [
        {
          id: controllerId,
          library: [],
          hand: [],
          graveyard: [
            { id: 'gy-shilgengar-1', name: 'Shilgengar Bear', type_line: 'Creature — Bear', cmc: 2 },
            { id: 'gy-shilgengar-2', name: 'Shilgengar Elf', type_line: 'Creature — Elf', cmc: 1 },
          ],
          exile: [],
        },
        { id: opponentId, library: [], hand: [], graveyard: [], exile: [] },
      ],
      battlefield: [],
    } as GameState;

    const result = applyOracleIRStepsToGameState(state, [step!], {
      controllerId,
      sourceId: 'shilgengar',
    });
    expect(result.automationGaps?.some((gap) => gap.reasonCode === 'unsupported_selector')).toBe(false);
    const player = result.state?.players.find((entry) => entry.id === controllerId) as any;
    expect(player.graveyard.length).toBe(0);
    expect(result.state?.battlefield?.length).toBe(2);
    for (const permanent of result.state?.battlefield || []) {
      expect((permanent as any)?.counters?.finality ?? (permanent as any)?.card?.counters?.finality).toBe(1);
    }
  });
});
