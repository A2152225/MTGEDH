import { describe, expect, it } from 'vitest';
import type { GameState, PlayerID } from '../../shared/src';
import { applyOracleIRStepsToGameState } from '../src/oracleIRExecutor';
import { parseOracleTextToIR } from '../src/oracleIRParser';
import {
  parseMoveZoneAllCardsDiscardedThisWay,
  parseMoveZoneOpponentChoicePermanentToHand,
  parseMoveZoneTypedCardFromAmongThem,
} from '../src/oracleIRExecutorZoneOps';

const controllerId = 'p1' as PlayerID;
const opponentId = 'p2' as PlayerID;

describe('Oracle IR gap batch 305 — permanent among-them / discarded-this-way / opponent choice bounce', () => {
  it('parses Storm the Festival up to two permanent MV≤5 among-them split', () => {
    expect(
      parseMoveZoneTypedCardFromAmongThem(
        { kind: 'raw', text: 'up to two permanent cards with mana value 5 or less from among them' },
        {
          to: 'battlefield',
          toRaw: 'the battlefield',
          raw: 'You may put up to two permanent cards with mana value 5 or less from among them onto the battlefield. Put the rest on the bottom of your library in a random order',
        }
      )
    ).toEqual({
      cardType: 'permanent',
      maxCount: 2,
      manaValueLte: 5,
      bfLibraryBottomSplit: true,
      entersTappedFromWhat: false,
    });
  });

  it('parses Mind Roots up to one land discarded this way', () => {
    expect(
      parseMoveZoneAllCardsDiscardedThisWay({
        kind: 'raw',
        text: 'up to one land card discarded this way',
      })
    ).toEqual({ cardType: 'land', maxCount: 1 });
  });

  it('parses Teferi target opponent chooses a permanent they control', () => {
    expect(
      parseMoveZoneOpponentChoicePermanentToHand(
        { kind: 'raw', text: 'a permanent' },
        "Target opponent chooses a permanent they control and returns it to its owner's hand"
      )
    ).toBe(true);
  });

  it('executes Storm the Festival optional permanent among-them to battlefield', () => {
    const ir = parseOracleTextToIR(
      'Look at the top five cards of your library. You may put up to two permanent cards with mana value 5 or less from among them onto the battlefield. Put the rest on the bottom of your library in a random order.',
      'Storm the Festival'
    );
    const step = ir.abilities[0]?.steps?.find(
      (entry) =>
        entry.kind === 'move_zone' &&
        /among them/i.test(String((entry as any).what?.text || ''))
    );
    const topFive = [
      { id: 'lib-storm-1', name: 'Storm Bear', type_line: 'Creature — Bear', cmc: 2 },
      { id: 'lib-storm-2', name: 'Storm Bolt', type_line: 'Instant', cmc: 1 },
      { id: 'lib-storm-3', name: 'Storm Ring', type_line: 'Artifact', cmc: 1 },
      { id: 'lib-storm-4', name: 'Storm Titan', type_line: 'Creature — Giant', cmc: 8 },
      { id: 'lib-storm-5', name: 'Storm Forest', type_line: 'Basic Land — Forest', cmc: 0 },
    ];
    const state = {
      players: [
        {
          id: controllerId,
          library: [...topFive],
          hand: [],
          graveyard: [],
        },
      ],
      battlefield: [],
    } as GameState;

    const result = applyOracleIRStepsToGameState(
      state,
      step ? [step] : [],
      {
        controllerId,
        sourceId: 'storm',
        lastMovedCards: topFive,
        selectorContext: { chosenObjectIds: ['lib-storm-1', 'lib-storm-3'] },
      },
      { allowOptional: true }
    );
    expect(result.automationGaps?.some((gap) => gap.reasonCode === 'unsupported_selector')).toBe(false);
    expect(result.state?.battlefield?.length).toBe(2);
    const player = result.state?.players.find((entry) => entry.id === controllerId) as any;
    expect(player.library.length).toBe(3);
  });

  it('executes Mind Roots put up to one land discarded this way onto battlefield tapped', () => {
    const ir = parseOracleTextToIR(
      'Target player discards two cards. Put up to one land card discarded this way onto the battlefield tapped under your control.',
      'Mind Roots'
    );
    const step = ir.abilities[0]?.steps?.find(
      (entry) =>
        entry.kind === 'move_zone' &&
        /discarded this way/i.test(String((entry as any).what?.text || ''))
    );
    const state = {
      players: [
        {
          id: controllerId,
          library: [],
          hand: [],
          graveyard: [],
        },
        {
          id: opponentId,
          library: [],
          hand: [],
          graveyard: [
            { id: 'discard-land-1', name: 'Plains', type_line: 'Basic Land — Plains', cmc: 0 },
            { id: 'discard-creature-1', name: 'Shock Trooper', type_line: 'Creature — Soldier', cmc: 2 },
          ],
        },
      ],
      battlefield: [],
    } as GameState;

    const result = applyOracleIRStepsToGameState(state, step ? [step] : [], {
      controllerId,
      sourceId: 'mind-roots',
      lastDiscardedCards: [
        { id: 'discard-land-1', name: 'Plains', type_line: 'Basic Land — Plains', cmc: 0 },
        { id: 'discard-creature-1', name: 'Shock Trooper', type_line: 'Creature — Soldier', cmc: 2 },
      ],
      selectorContext: { targetPlayerId: opponentId, chosenObjectIds: ['discard-land-1'] },
    });
    expect(result.automationGaps?.some((gap) => gap.reasonCode === 'unsupported_selector')).toBe(false);
    expect(result.state?.battlefield?.length).toBe(1);
    expect((result.state?.battlefield?.[0] as any)?.tapped).toBe(true);
  });

  it('executes Teferi target opponent chooses a permanent to hand', () => {
    const ir = parseOracleTextToIR(
      "−3: Target opponent chooses a permanent they control and returns it to its owner's hand.",
      'Teferi, Temporal Pilgrim'
    );
    const step = ir.abilities[0]?.steps?.find((entry) => entry.kind === 'move_zone' && (entry as any).to === 'hand');
    const state = {
      players: [
        { id: controllerId, library: [], hand: [], graveyard: [] },
        { id: opponentId, library: [], hand: [], graveyard: [] },
      ],
      battlefield: [
        {
          id: 'bf-opponent-perm-1',
          name: 'Opponent Creature',
          controller: opponentId,
          owner: opponentId,
          type_line: 'Creature — Human',
          colors: ['U'],
        },
      ],
    } as GameState;

    const result = applyOracleIRStepsToGameState(state, step ? [step] : [], {
      controllerId,
      sourceId: 'teferi',
      selectorContext: { targetPlayerId: opponentId, chosenObjectIds: ['bf-opponent-perm-1'] },
    });
    expect(result.automationGaps?.some((gap) => gap.reasonCode === 'unsupported_selector')).toBe(false);
    expect(result.state?.battlefield?.length).toBe(0);
    const opponent = result.state?.players.find((entry) => entry.id === opponentId) as any;
    expect(opponent.hand.length).toBe(1);
  });
});
