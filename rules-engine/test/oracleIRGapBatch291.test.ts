import { describe, expect, it } from 'vitest';
import type { GameState, PlayerID } from '../../shared/src';
import { applyOracleIRStepsToGameState } from '../src/oracleIRExecutor';
import { parseOracleTextToIR } from '../src/oracleIRParser';
import {
  cardHasNonManaActivatedAbility,
  parseMoveZoneCardFromChosenPile,
  parseMoveZoneCompoundBattlefieldAndGraveyardMassReturn,
  parseMoveZoneOpponentChoiceFromTargetPlayersGraveyard,
  parseMoveZoneSingleTargetFromYourGraveyard,
} from '../src/oracleIRExecutorZoneOps';

const controllerId = 'p1' as PlayerID;
const opponentId = 'p2' as PlayerID;

describe('Oracle IR gap batch 291 — selector cluster fixes', () => {
  it('parses Tamiyo nonland permanent MV X from graveyard', () => {
    expect(
      parseMoveZoneSingleTargetFromYourGraveyard({
        kind: 'raw',
        text: 'target nonland permanent card with mana value X from your graveyard',
      })
    ).toEqual({
      cardType: 'permanent',
      typeLineTermsNoneOf: ['creature', 'land'],
      manaValueLte: -1,
    });
  });

  it('parses Visions of Dread opponent choice graveyard creature', () => {
    expect(
      parseMoveZoneOpponentChoiceFromTargetPlayersGraveyard({
        kind: 'raw',
        text: "a creature card of target opponent's choice from target opponent's graveyard",
      })
    ).toEqual({ cardType: 'creature', fromHandOrGraveyardOwner: 'target_player' });
  });

  it('parses Soulquake compound battlefield and graveyard return', () => {
    expect(
      parseMoveZoneCompoundBattlefieldAndGraveyardMassReturn({
        kind: 'raw',
        text: 'all creatures on the battlefield and all creature cards in graveyards',
      })
    ).toEqual({ cardType: 'creature' });
  });

  it('parses Truth or Tale card from chosen pile', () => {
    expect(parseMoveZoneCardFromChosenPile({ kind: 'raw', text: 'a card from the chosen pile' })).toBe(true);
  });

  it('detects non-mana activated abilities on creature cards', () => {
    expect(
      cardHasNonManaActivatedAbility({
        type_line: 'Creature — Human',
        oracle_text: '{T}: Draw a card.',
      })
    ).toBe(true);
    expect(
      cardHasNonManaActivatedAbility({
        type_line: 'Creature — Elf',
        oracle_text: 'Vigilance',
      })
    ).toBe(false);
  });

  it('executes Tamiyo exile target nonland permanent from graveyard', () => {
    const steps = [
      {
        kind: 'move_zone' as const,
        what: { kind: 'raw' as const, text: 'target nonland permanent card with mana value X from your graveyard' },
        to: 'exile' as const,
        toRaw: 'exile',
        raw: 'Exile target nonland permanent card with mana value X from your graveyard',
      },
    ];
    const state = {
      players: [
        {
          id: controllerId,
          library: [],
          hand: [],
          graveyard: [{ id: 'gy-art', name: 'Sol Ring', type_line: 'Artifact', cmc: 1 }],
          exile: [],
        },
      ],
      battlefield: [],
    } as GameState;

    const result = applyOracleIRStepsToGameState(state, steps, {
      controllerId,
      sourceId: 'tamiyo',
      xValue: 3,
      selectorContext: { chosenObjectIds: ['gy-art'] },
    });

    expect(result.automationGaps?.some((gap) => gap.reasonCode === 'unsupported_selector')).toBe(false);
    const player = result.state?.players.find((entry) => entry.id === controllerId) as any;
    expect(player.exile.length).toBe(1);
  });

  it('executes Soulquake mass return from battlefield and graveyards', () => {
    const ir = parseOracleTextToIR(
      "Return all creatures on the battlefield and all creature cards in graveyards to their owners' hands.",
      'Soulquake'
    );
    const steps = ir.abilities[0]?.steps || [];
    const state = {
      players: [
        {
          id: controllerId,
          library: [],
          hand: [],
          graveyard: [{ id: 'gy-1', name: 'Zombie', type_line: 'Creature — Zombie' }],
        },
      ],
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

    const result = applyOracleIRStepsToGameState(state, steps, { controllerId, sourceId: 'soulquake' });
    expect(result.automationGaps?.some((gap) => gap.reasonCode === 'unsupported_selector')).toBe(false);
    expect((result.state?.battlefield || []).length).toBe(0);
    const player = result.state?.players.find((entry) => entry.id === controllerId) as any;
    expect(player.hand.length).toBe(2);
  });

  it('executes Visions of Dread opponent choice creature to battlefield', () => {
    const steps = [
      {
        kind: 'move_zone' as const,
        what: {
          kind: 'raw' as const,
          text: "a creature card of target opponent's choice from target opponent's graveyard",
        },
        to: 'battlefield' as const,
        toRaw: 'the battlefield',
        battlefieldController: { kind: 'you' as const },
        raw: "Target opponent puts a creature card of their choice from their graveyard onto the battlefield under your control",
      },
    ];
    const state = {
      players: [
        { id: controllerId, library: [], hand: [], graveyard: [] },
        {
          id: opponentId,
          library: [],
          hand: [],
          graveyard: [{ id: 'gy-zombie', name: 'Zombie', type_line: 'Creature — Zombie', cmc: 2 }],
        },
      ],
      battlefield: [],
    } as GameState;

    const result = applyOracleIRStepsToGameState(state, steps, {
      controllerId,
      sourceId: 'visions',
      targetPlayerId: opponentId,
      selectorContext: { targetPlayerId: opponentId, chosenObjectIds: ['gy-zombie'] },
    });

    expect(result.automationGaps?.some((gap) => gap.reasonCode === 'unsupported_selector')).toBe(false);
    expect((result.state?.battlefield || []).length).toBe(1);
  });
});
