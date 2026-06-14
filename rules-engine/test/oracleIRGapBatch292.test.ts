import { describe, expect, it } from 'vitest';
import type { GameState, PlayerID } from '../../shared/src';
import { applyOracleIRStepsToGameState } from '../src/oracleIRExecutor';
import { parseOracleTextToIR } from '../src/oracleIRParser';
import {
  parseMoveZoneAdventureCardThatPlayerOwnsFromExile,
  parseMoveZoneAllFromEachPlayersGraveyard,
  parseMoveZoneCountTargetBattlefieldBounce,
  parseMoveZoneTypedCardFromHandOrGraveyard,
} from '../src/oracleIRExecutorZoneOps';

const controllerId = 'p1' as PlayerID;
const opponentId = 'p2' as PlayerID;

describe('Oracle IR gap batch 292 — selector cluster fixes', () => {
  it('parses Cry of the Carnarium all GY creatures put from BF this turn', () => {
    expect(
      parseMoveZoneAllFromEachPlayersGraveyard({
        kind: 'raw',
        text: 'all creature cards in all graveyards that were put there from the battlefield this turn',
      })
    ).toEqual({ cardType: 'creature', putIntoGraveyardThisTurn: true });
  });

  it('parses Memory Theft adventure card from exile', () => {
    expect(
      parseMoveZoneAdventureCardThatPlayerOwnsFromExile({
        kind: 'raw',
        text: 'a card that has an Adventure that player owns from exile',
      })
    ).toBe(true);
  });

  it('parses Aether Burst up to X target creatures bounce', () => {
    expect(
      parseMoveZoneCountTargetBattlefieldBounce({
        kind: 'raw',
        text: 'up to X target creatures',
      })
    ).toEqual({ count: 0, selectorText: 'target creatures', useXValue: true });
  });

  it('parses Nissa creature MV lte lands from hand or graveyard', () => {
    expect(
      parseMoveZoneTypedCardFromHandOrGraveyard(
        {
          kind: 'raw',
          text: 'a creature card with mana value less than or equal to the number of lands you control',
        },
        'You may put a creature card with mana value less than or equal to the number of lands you control onto the battlefield from your hand or graveyard with two +1/+1 counters on it.'
      )
    ).toEqual({
      cardType: 'creature',
      manaValueLteLandsControlled: true,
      fromHandOrGraveyardOwner: 'controller',
    });
  });

  it('executes Cry of the Carnarium GY exile', () => {
    const ir = parseOracleTextToIR(
      'All creatures get -2/-2 until end of turn. Exile all creature cards in all graveyards that were put there from the battlefield this turn. If a creature would die this turn, exile it instead.',
      'Cry of the Carnarium'
    );
    const steps = ir.abilities[0]?.steps?.filter((step) => step.kind === 'move_zone') || [];
    const state = {
      turn: 3,
      players: [
        {
          id: controllerId,
          library: [],
          hand: [],
          graveyard: [
            {
              id: 'gy-1',
              name: 'Zombie',
              type_line: 'Creature — Zombie',
              putIntoGraveyardTurn: 3,
            },
          ],
          exile: [],
        },
      ],
      battlefield: [],
    } as GameState;

    const result = applyOracleIRStepsToGameState(state, steps, { controllerId, sourceId: 'carnarium' });
    expect(result.automationGaps?.some((gap) => gap.reasonCode === 'unsupported_selector')).toBe(false);
    const player = result.state?.players.find((entry) => entry.id === controllerId) as any;
    expect(player.exile.length).toBe(1);
  });

  it('executes Aether Burst up to X bounce', () => {
    const ir = parseOracleTextToIR(
      "Return up to X target creatures to their owners' hands, where X is one plus the number of cards named Aether Burst in all graveyards as you cast this spell.",
      'Aether Burst'
    );
    const steps = ir.abilities[0]?.steps || [];
    const state = {
      players: [{ id: controllerId, library: [], hand: [], graveyard: [] }],
      battlefield: [
        {
          id: 'bf-1',
          name: 'Bear',
          controller: controllerId,
          owner: controllerId,
          type_line: 'Creature — Bear',
        },
      ],
    } as GameState;

    const result = applyOracleIRStepsToGameState(state, steps, {
      controllerId,
      sourceId: 'aether-burst',
      sourceName: 'Aether Burst',
      xValue: 2,
      selectorContext: { chosenObjectIds: ['bf-1'] },
    });
    expect(result.automationGaps?.some((gap) => gap.reasonCode === 'unsupported_selector')).toBe(false);
    expect((result.state?.battlefield || []).length).toBe(0);
  });

  it('executes Nissa -5 from graveyard to battlefield', () => {
    const ir = parseOracleTextToIR(
      'Landfall — Whenever a land you control enters, put a loyalty counter on Nissa.\n+1: Untap target land you control. You may have it become a 3/3 Elemental creature with haste and menace until end of turn. It\'s still a land.\n−5: You may put a creature card with mana value less than or equal to the number of lands you control onto the battlefield from your hand or graveyard with two +1/+1 counters on it.',
      'Nissa of Shadowed Boughs'
    );
    const steps = ir.abilities[2]?.steps || [];
    const state = {
      players: [
        {
          id: controllerId,
          library: [],
          hand: [],
          graveyard: [{ id: 'gy-elf', name: 'Elf', type_line: 'Creature — Elf', cmc: 2 }],
        },
      ],
      battlefield: [
        {
          id: 'land-1',
          name: 'Forest',
          controller: controllerId,
          owner: controllerId,
          type_line: 'Basic Land — Forest',
        },
        {
          id: 'land-2',
          name: 'Island',
          controller: controllerId,
          owner: controllerId,
          type_line: 'Basic Land — Island',
        },
      ],
    } as GameState;

    const result = applyOracleIRStepsToGameState(
      state,
      steps,
      {
        controllerId,
        sourceId: 'nissa',
        selectorContext: { chosenObjectIds: ['gy-elf'] },
      },
      { allowOptional: true }
    );
    expect(result.automationGaps?.some((gap) => gap.reasonCode === 'unsupported_selector')).toBe(false);
    const player = result.state?.players.find((entry) => entry.id === controllerId) as any;
    expect(player.graveyard.length).toBe(0);
    expect((result.state?.battlefield || []).length).toBe(3);
  });
});
