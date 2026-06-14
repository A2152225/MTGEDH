import { describe, expect, it } from 'vitest';
import type { GameState, PlayerID } from '../../shared/src';
import { applyOracleIRStepsToGameState } from '../src/oracleIRExecutor';
import { parseOracleTextToIR } from '../src/oracleIRParser';
import {
  parseMoveZoneSingleTargetFromAGraveyard,
  parseMoveZoneTheCardsFromTargetOpponentHand,
  parseMoveZoneTypedCardFromAmongMilledCards,
} from '../src/oracleIRExecutorZoneOps';

const controllerId = 'p1' as PlayerID;
const opponentId = 'p2' as PlayerID;

describe('Oracle IR gap batch 308 — Head Games / Abyssal Harvester / Bramble Familiar', () => {
  it('parses Head Games target opponent hand to library top', () => {
    expect(
      parseMoveZoneTheCardsFromTargetOpponentHand({
        kind: 'raw',
        text: "the cards from target opponent's hand",
      })
    ).toEqual({ cardType: 'any' });
  });

  it('parses Abyssal Harvester target creature from graveyard put there this turn', () => {
    expect(
      parseMoveZoneSingleTargetFromAGraveyard({
        kind: 'raw',
        text: 'target creature card from a graveyard that was put there this turn',
      })
    ).toEqual({ cardType: 'creature', putIntoGraveyardThisTurn: true });
  });

  it('parses Bramble Familiar or-type card from among milled cards', () => {
    expect(
      parseMoveZoneTypedCardFromAmongMilledCards({
        kind: 'raw',
        text: 'a creature, enchantment, or land card from among the milled cards',
      })
    ).toEqual({
      criteria: [{ cardType: 'creature' }, { cardType: 'enchantment' }, { cardType: 'land' }],
    });
  });

  it('executes Head Games moving opponent hand to library top', () => {
    const ir = parseOracleTextToIR(
      "Target opponent puts the cards from their hand on top of their library in any order. You look at that player's hand and choose those cards.",
      'Head Games'
    );
    const step = ir.abilities[0]?.steps?.find(
      (entry) =>
        entry.kind === 'move_zone' &&
        String((entry as any).what?.text || '').includes("the cards from target opponent's hand")
    );
    expect(step).toBeTruthy();
    const state = {
      turnNumber: 3,
      players: [
        { id: controllerId, library: [{ id: 'p1-lib', name: 'Lib', type_line: 'Instant', cmc: 1 }], hand: [], graveyard: [], exile: [] },
        {
          id: opponentId,
          library: [{ id: 'p2-lib', name: 'Opp Lib', type_line: 'Instant', cmc: 1 }],
          hand: [
            { id: 'head-hand-1', name: 'Head Games Hand One', type_line: 'Instant', cmc: 1 },
            { id: 'head-hand-2', name: 'Head Games Hand Two', type_line: 'Creature — Bear', cmc: 2 },
          ],
          graveyard: [],
          exile: [],
        },
      ],
      battlefield: [],
    } as GameState;

    const result = applyOracleIRStepsToGameState(state, [step!], {
      controllerId,
      sourceId: 'head-games',
      targetPlayerId: opponentId,
      selectorContext: { chosenObjectIds: ['head-hand-1', 'head-hand-2'] },
    });
    expect(result.automationGaps?.some((gap) => gap.reasonCode === 'unsupported_selector')).toBe(false);
    const opponent = result.state?.players.find((entry) => entry.id === opponentId) as any;
    expect(opponent.hand.length).toBe(0);
    expect(opponent.library.slice(0, 2).map((card: any) => card.id)).toEqual(['head-hand-1', 'head-hand-2']);
  });

  it('executes Abyssal Harvester exiling target creature put into graveyard this turn', () => {
    const ir = parseOracleTextToIR(
      '{T}: Exile target creature card from a graveyard that was put there this turn.',
      'Abyssal Harvester'
    );
    const step = ir.abilities[0]?.steps?.[0];
    expect(step?.kind).toBe('move_zone');
    const state = {
      turnNumber: 3,
      players: [
        {
          id: controllerId,
          library: [],
          hand: [],
          graveyard: [
            {
              id: 'gy-abyssal-turn',
              name: 'Abyssal Fresh Corpse',
              type_line: 'Creature — Zombie',
              cmc: 2,
              putIntoGraveyardTurn: 3,
            },
            {
              id: 'gy-abyssal-old',
              name: 'Abyssal Old Corpse',
              type_line: 'Creature — Zombie',
              cmc: 2,
              putIntoGraveyardTurn: 1,
            },
          ],
          exile: [],
        },
        { id: opponentId, library: [], hand: [], graveyard: [], exile: [] },
      ],
      battlefield: [],
    } as GameState;

    const result = applyOracleIRStepsToGameState(state, [step!], {
      controllerId,
      sourceId: 'abyssal-harvester',
      selectorContext: { chosenObjectIds: ['gy-abyssal-turn'] },
    });
    expect(result.automationGaps?.some((gap) => gap.reasonCode === 'unsupported_selector')).toBe(false);
    const player = result.state?.players.find((entry) => entry.id === controllerId) as any;
    expect(player.graveyard.map((card: any) => card.id)).toEqual(['gy-abyssal-old']);
    expect(player.exile.map((card: any) => card.id)).toEqual(['gy-abyssal-turn']);
  });

  it('executes Bramble Familiar putting milled creature onto battlefield', () => {
    const ir = parseOracleTextToIR(
      'Mill two cards. Then put a creature, enchantment, or land card from among the milled cards onto the battlefield.',
      'Bramble Familiar // Fetch Quest'
    );
    const step = ir.abilities[0]?.steps?.find(
      (entry) =>
        entry.kind === 'move_zone' &&
        String((entry as any).what?.text || '').includes('from among the milled cards')
    );
    expect(step).toBeTruthy();
    const milledFixtures = [
      { id: 'milled-bramble-creature', name: 'Bramble Bear', type_line: 'Creature — Bear', cmc: 2 },
      { id: 'milled-bramble-land', name: 'Bramble Forest', type_line: 'Basic Land — Forest', cmc: 0 },
    ];
    const state = {
      players: [
        {
          id: controllerId,
          library: [],
          hand: [],
          graveyard: [...milledFixtures],
          exile: [],
        },
        { id: opponentId, library: [], hand: [], graveyard: [], exile: [] },
      ],
      battlefield: [],
    } as GameState;

    const result = applyOracleIRStepsToGameState(state, [step!], {
      controllerId,
      sourceId: 'bramble-familiar',
      lastMilledCards: milledFixtures,
      selectorContext: { chosenObjectIds: ['milled-bramble-creature'] },
    });
    expect(result.automationGaps?.some((gap) => gap.reasonCode === 'unsupported_selector')).toBe(false);
    const player = result.state?.players.find((entry) => entry.id === controllerId) as any;
    expect(player.graveyard.map((card: any) => card.id)).toEqual(['milled-bramble-land']);
    expect(result.state?.battlefield?.length).toBe(1);
    const permanent = result.state?.battlefield?.[0] as any;
    expect(String(permanent?.name || permanent?.card?.name || '')).toBe('Bramble Bear');
  });
});
