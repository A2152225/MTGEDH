import { describe, expect, it } from 'vitest';
import type { GameState, PlayerID } from '../../shared/src';
import { applyOracleIRStepsToGameState } from '../src/oracleIRExecutor';
import { parseOracleTextToIR } from '../src/oracleIRParser';
import {
  parseMoveZoneAllCommandersFromCommandZone,
  parseMoveZoneCountTargetCardsFromSingleGraveyard,
  parseMoveZoneEachAttackingCreature,
} from '../src/oracleIRExecutorZoneOps';

const controllerId = 'p1' as PlayerID;
const opponentId = 'p2' as PlayerID;

describe('Oracle IR gap batch 311 — Pestilent Cauldron / Tevesh / Aetherize', () => {
  it('parses Pestilent Cauldron four target cards from a single graveyard', () => {
    expect(
      parseMoveZoneCountTargetCardsFromSingleGraveyard({
        kind: 'raw',
        text: 'four target cards from a single graveyard',
      })
    ).toEqual({ count: 4, cardType: 'any' });
  });

  it('parses Tevesh all commanders from the command zone', () => {
    expect(
      parseMoveZoneAllCommandersFromCommandZone({
        kind: 'raw',
        text: 'all commanders from the command zone',
      })
    ).toBe(true);
  });

  it('parses Aetherize all attacking creatures', () => {
    expect(
      parseMoveZoneEachAttackingCreature({
        kind: 'raw',
        text: 'all attacking creatures',
      })
    ).toBe(true);
  });

  it('executes Pestilent Cauldron exile four target cards from a single graveyard', () => {
    const ir = parseOracleTextToIR(
      '{2}, {T}: Exile four target cards from a single graveyard.',
      'Pestilent Cauldron // Restorative Burst'
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
            { id: 'gy-pc-1', name: 'PC One', type_line: 'Instant', cmc: 1 },
            { id: 'gy-pc-2', name: 'PC Two', type_line: 'Sorcery', cmc: 2 },
            { id: 'gy-pc-3', name: 'PC Three', type_line: 'Creature — Rat', cmc: 3 },
            { id: 'gy-pc-4', name: 'PC Four', type_line: 'Enchantment', cmc: 2 },
            { id: 'gy-pc-5', name: 'PC Five', type_line: 'Artifact', cmc: 1 },
          ],
          exile: [],
        },
        {
          id: opponentId,
          library: [],
          hand: [],
          graveyard: [{ id: 'gy-p2-1', name: 'Opp Card', type_line: 'Instant', cmc: 1 }],
          exile: [],
        },
      ],
      battlefield: [],
    } as GameState;

    const result = applyOracleIRStepsToGameState(state, [step!], {
      controllerId,
      sourceId: 'pestilent-cauldron',
      selectorContext: { chosenObjectIds: ['gy-pc-1', 'gy-pc-2', 'gy-pc-3', 'gy-pc-4'] },
    });
    expect(result.automationGaps?.some((gap) => gap.reasonCode === 'unsupported_selector')).toBe(false);
    const player = result.state?.players.find((entry) => entry.id === controllerId) as any;
    expect(player.exile.length).toBe(4);
    expect(player.graveyard.length).toBe(1);
  });

  it('executes Tevesh put all commanders from command zone onto battlefield', () => {
    const ir = parseOracleTextToIR(
      'Put all commanders from the command zone onto the battlefield under your control.',
      'Tevesh Szat, Doom of Fools'
    );
    const step = ir.abilities[0]?.steps?.find((entry) => entry.kind === 'move_zone');
    expect(step).toBeTruthy();
    const state = {
      players: [
        {
          id: controllerId,
          library: [],
          hand: [],
          graveyard: [],
          exile: [],
          commandZone: [
            {
              id: 'cmd-p1',
              name: 'P1 Commander',
              type_line: 'Legendary Creature — Human Cleric',
              cmc: 4,
              isCommander: true,
            },
          ],
        },
        {
          id: opponentId,
          library: [],
          hand: [],
          graveyard: [],
          exile: [],
          commandZone: [
            {
              id: 'cmd-p2',
              name: 'P2 Commander',
              type_line: 'Legendary Creature — Elf Warrior',
              cmc: 3,
              isCommander: true,
            },
          ],
        },
      ],
      battlefield: [],
    } as GameState;

    const result = applyOracleIRStepsToGameState(state, [step!], {
      controllerId,
      sourceId: 'tevesh-szat',
    });
    expect(result.automationGaps?.some((gap) => gap.reasonCode === 'unsupported_selector')).toBe(false);
    expect(result.state?.battlefield?.length).toBe(2);
    for (const perm of result.state?.battlefield || []) {
      expect(String((perm as any)?.controller || '')).toBe(controllerId);
    }
    const p1 = result.state?.players.find((entry) => entry.id === controllerId) as any;
    const p2 = result.state?.players.find((entry) => entry.id === opponentId) as any;
    expect(p1.commandZone.length).toBe(0);
    expect(p2.commandZone.length).toBe(0);
  });

  it('executes Aetherize return all attacking creatures to owners hands', () => {
    const ir = parseOracleTextToIR(
      "Return all attacking creatures to their owner's hand.",
      'Aetherize'
    );
    const step = ir.abilities[0]?.steps?.[0];
    expect(step?.kind).toBe('move_zone');
    const state = {
      players: [
        { id: controllerId, library: [], hand: [], graveyard: [], exile: [] },
        { id: opponentId, library: [], hand: [], graveyard: [], exile: [] },
      ],
      battlefield: [
        {
          id: 'bf-aetherize-1',
          name: 'Attacking Bear',
          controller: opponentId,
          owner: opponentId,
          type_line: 'Creature — Bear',
          cmc: 2,
          attacking: controllerId,
        },
        {
          id: 'bf-aetherize-2',
          name: 'Attacking Elf',
          controller: opponentId,
          owner: opponentId,
          type_line: 'Creature — Elf',
          cmc: 1,
          attacking: controllerId,
        },
        {
          id: 'bf-nonattacking',
          name: 'Blocking Knight',
          controller: controllerId,
          owner: controllerId,
          type_line: 'Creature — Knight',
          cmc: 2,
        },
      ],
    } as GameState;

    const result = applyOracleIRStepsToGameState(state, [step!], {
      controllerId,
      sourceId: 'aetherize',
    });
    expect(result.automationGaps?.some((gap) => gap.reasonCode === 'unsupported_selector')).toBe(false);
    expect(result.state?.battlefield?.length).toBe(1);
    expect(String((result.state?.battlefield?.[0] as any)?.id || '')).toBe('bf-nonattacking');
    const opponent = result.state?.players.find((entry) => entry.id === opponentId) as any;
    expect(opponent.hand.length).toBe(2);
  });
});
