import { describe, expect, it } from 'vitest';
import type { GameState, PlayerID } from '../../shared/src';
import { applyOracleIRStepsToGameState } from '../src/oracleIRExecutor';
import { parseOracleTextToIR } from '../src/oracleIRParser';
import {
  cardHasAdventureCharacteristics,
  parseMoveZoneAllAdventureCardsFromMilledCards,
  parseMoveZoneAllCardsMilledThisWay,
  parseMoveZoneAllFromTargetPlayerHandAndGraveyard,
  parseMoveZoneMassBattlefieldCreatureBounce,
  parseMoveZoneTypedCardFromAmongThem,
} from '../src/oracleIRExecutorZoneOps';

const controllerId = 'p1' as PlayerID;
const opponentId = 'p2' as PlayerID;

describe('Oracle IR gap batch 290 — selector cluster fixes', () => {
  it('parses Sparring Dummy land card milled this way', () => {
    expect(
      parseMoveZoneAllCardsMilledThisWay({ kind: 'raw', text: 'a land card milled this way' })
    ).toEqual({ cardType: 'land' });
  });

  it('parses Beluna adventure cards from milled cards', () => {
    expect(
      parseMoveZoneAllAdventureCardsFromMilledCards({
        kind: 'raw',
        text: 'all cards that have an Adventure from among the milled cards',
      })
    ).toBe(true);
    expect(
      cardHasAdventureCharacteristics({
        type_line: 'Creature — Human // Instant — Adventure',
        layout: 'adventure',
      })
    ).toBe(true);
  });

  it('parses Wave Goodbye each creature without +1/+1 counter', () => {
    expect(
      parseMoveZoneMassBattlefieldCreatureBounce({
        kind: 'raw',
        text: 'each creature without a +1/+1 counter on it',
      })
    ).toEqual({ eachCreatureWithoutCounter: '+1/+1' });
  });

  it('parses Identity Crisis all cards from hand and graveyard', () => {
    expect(
      parseMoveZoneAllFromTargetPlayerHandAndGraveyard({
        kind: 'raw',
        text: "all cards from target player's hand and graveyard",
      })
    ).toEqual({ cardType: 'any' });
  });

  it('parses Collected Company per-card mana value among-them split', () => {
    expect(
      parseMoveZoneTypedCardFromAmongThem(
        { kind: 'raw', text: 'up to two creature cards with mana value 3 or less from among them' },
        {
          to: 'battlefield',
          toRaw: 'the battlefield',
          raw: 'Put up to two creature cards with mana value 3 or less from among them onto the battlefield. Put the rest on the bottom of your library in any order',
        }
      )
    ).toEqual({
      cardType: 'creature',
      maxCount: 2,
      manaValueLte: 3,
      bfLibraryBottomSplit: true,
      entersTappedFromWhat: false,
    });
  });

  it('executes Sparring Dummy optional land milled this way to hand', () => {
    const steps = [
      {
        kind: 'move_zone' as const,
        what: { kind: 'raw' as const, text: 'a land card milled this way' },
        to: 'hand' as const,
        toRaw: 'your hand',
        raw: 'You may put a land card milled this way into your hand',
        optional: true,
      },
    ];
    const state = {
      players: [
        {
          id: controllerId,
          library: [],
          hand: [],
          graveyard: [{ id: 'gy-land', name: 'Plains', type_line: 'Basic Land — Plains' }],
        },
      ],
      battlefield: [],
    } as GameState;

    const result = applyOracleIRStepsToGameState(state, steps, {
      controllerId,
      sourceId: 'dummy',
      lastMilledCards: [{ id: 'gy-land', name: 'Plains', type_line: 'Basic Land — Plains' }],
      selectorContext: { chosenObjectIds: ['gy-land'] },
    }, { allowOptional: true });

    expect(result.automationGaps?.some((gap) => gap.reasonCode === 'unsupported_selector')).toBe(false);
    const player = result.state?.players.find((entry) => entry.id === controllerId) as any;
    expect(player.hand.length).toBe(1);
  });

  it('executes Wave Goodbye bounce creatures without +1/+1 counters', () => {
    const ir = parseOracleTextToIR(
      "Return each creature without a +1/+1 counter on it to its owner's hand.",
      'Wave Goodbye'
    );
    const steps = ir.abilities[0]?.steps || [];
    const state = {
      players: [{ id: controllerId, library: [], hand: [], graveyard: [] }],
      battlefield: [
        {
          id: 'bf-no-counter',
          name: 'Bear',
          controller: controllerId,
          owner: controllerId,
          type_line: 'Creature — Bear',
          colors: ['G'],
        },
        {
          id: 'bf-with-counter',
          name: 'Elf',
          controller: controllerId,
          owner: controllerId,
          type_line: 'Creature — Elf',
          colors: ['G'],
          counters: { '+1/+1': 2 },
        },
      ],
    } as GameState;

    const result = applyOracleIRStepsToGameState(state, steps, { controllerId, sourceId: 'wave' });
    expect(result.automationGaps?.some((gap) => gap.reasonCode === 'unsupported_selector')).toBe(false);
    expect((result.state?.battlefield || []).map((perm: any) => perm.id)).toEqual(['bf-with-counter']);
  });

  it('executes Phyrexian Grimoire put the other one into hand', () => {
    const steps = [
      {
        kind: 'move_zone' as const,
        what: { kind: 'raw' as const, text: 'the other one' },
        to: 'hand' as const,
        toRaw: 'your hand',
        raw: 'put the other one into your hand',
      },
    ];
    const state = {
      players: [
        {
          id: controllerId,
          library: [],
          hand: [],
          graveyard: [{ id: 'gy-keep', name: 'Keep', type_line: 'Sorcery', cmc: 2 }],
          exile: [{ id: 'gy-exile', name: 'Exiled', type_line: 'Instant', cmc: 1 }],
        },
      ],
      battlefield: [],
    } as GameState;

    const result = applyOracleIRStepsToGameState(state, steps, {
      controllerId,
      sourceId: 'grimoire',
      lastMovedCards: [
        { id: 'gy-exile', name: 'Exiled', type_line: 'Instant', cmc: 1 },
        { id: 'gy-keep', name: 'Keep', type_line: 'Sorcery', cmc: 2 },
      ],
      lastExiledCards: [{ id: 'gy-exile', name: 'Exiled', type_line: 'Instant', cmc: 1 }],
      selectorContext: { chosenObjectIds: ['gy-keep'] },
    });

    expect(result.automationGaps?.some((gap) => gap.reasonCode === 'unsupported_selector')).toBe(false);
    const player = result.state?.players.find((entry) => entry.id === controllerId) as any;
    expect(player.hand.some((card: any) => card.id === 'gy-keep')).toBe(true);
  });

  it('executes Identity Crisis exile all from hand and graveyard', () => {
    const ir = parseOracleTextToIR(
      "Exile all cards from target player's hand and graveyard.",
      'Identity Crisis'
    );
    const steps = ir.abilities[0]?.steps || [];
    const state = {
      players: [
        { id: controllerId, library: [], hand: [], graveyard: [], exile: [] },
        {
          id: opponentId,
          library: [],
          hand: [{ id: 'h-1', name: 'Bolt', type_line: 'Instant' }],
          graveyard: [{ id: 'gy-1', name: 'Zombie', type_line: 'Creature — Zombie' }],
          exile: [],
        },
      ],
      battlefield: [],
    } as GameState;

    const result = applyOracleIRStepsToGameState(state, steps, {
      controllerId,
      sourceId: 'crisis',
      targetPlayerId: opponentId,
      selectorContext: { targetPlayerId: opponentId },
    });

    expect(result.automationGaps?.some((gap) => gap.reasonCode === 'unsupported_selector')).toBe(false);
    const opponent = result.state?.players.find((entry) => entry.id === opponentId) as any;
    expect(opponent.hand.length).toBe(0);
    expect(opponent.graveyard.length).toBe(0);
    expect(opponent.exile.length).toBe(2);
  });
});
