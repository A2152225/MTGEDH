import { describe, expect, it } from 'vitest';
import type { GameState, PlayerID } from '../../shared/src';
import { applyOracleIRStepsToGameState } from '../src/oracleIRExecutor';
import { parseOracleTextToIR } from '../src/oracleIRParser';
import {
  parseMoveZoneAllFromTargetPlayersLibrary,
  parseMoveZoneCountTargetBattlefieldBounce,
  parseMoveZoneTypedCardFromAmongThem,
} from '../src/oracleIRExecutorZoneOps';

const controllerId = 'p1' as PlayerID;
const opponentId = 'p2' as PlayerID;

describe('Oracle IR gap batch 312 — Wanderwine / Mayael / Jace', () => {
  it('parses Wanderwine one or two target nonland permanents bounce', () => {
    expect(
      parseMoveZoneCountTargetBattlefieldBounce({
        kind: 'raw',
        text: 'one or two target nonland permanents',
      })
    ).toEqual({ count: 2, selectorText: 'target nonland permanents' });
  });

  it('parses Mayael creature with power 5 or greater from among them', () => {
    expect(
      parseMoveZoneTypedCardFromAmongThem(
        {
          kind: 'raw',
          text: 'a creature card with power 5 or greater from among them',
        },
        {
          raw:
            'You may put a creature card with power 5 or greater from among them onto the battlefield. Put the rest on the bottom of your library in any order',
          to: 'battlefield',
        }
      )
    ).toEqual({
      cardType: 'creature',
      powerGte: 5,
      bfLibraryBottomSplit: true,
    });
  });

  it('parses Jace all cards from target player library', () => {
    expect(
      parseMoveZoneAllFromTargetPlayersLibrary({
        kind: 'raw',
        text: "all cards from target player's library",
      })
    ).toEqual({ cardType: 'any' });
  });

  it('executes Wanderwine return one or two target nonland permanents', () => {
    const ir = parseOracleTextToIR(
      "Return one or two target nonland permanents to their owners' hands.",
      'Wanderwine Farewell'
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
          id: 'bf-wanderwine-1',
          name: 'Wanderwine Enchantment',
          controller: opponentId,
          owner: opponentId,
          type_line: 'Enchantment',
          cmc: 2,
        },
        {
          id: 'bf-wanderwine-2',
          name: 'Wanderwine Artifact',
          controller: opponentId,
          owner: opponentId,
          type_line: 'Artifact',
          cmc: 1,
        },
      ],
    } as GameState;

    const result = applyOracleIRStepsToGameState(state, [step!], {
      controllerId,
      sourceId: 'wanderwine-farewell',
      selectorContext: { chosenObjectIds: ['bf-wanderwine-1', 'bf-wanderwine-2'] },
    });
    expect(result.automationGaps?.some((gap) => gap.reasonCode === 'unsupported_selector')).toBe(false);
    expect(result.state?.battlefield?.length).toBe(0);
    const opponent = result.state?.players.find((entry) => entry.id === opponentId) as any;
    expect(opponent.hand.length).toBe(2);
  });

  it('executes Mayael put power 5+ creature from among them and rest to library bottom', () => {
    const ir = parseOracleTextToIR(
      'You may put a creature card with power 5 or greater from among them onto the battlefield. Put the rest on the bottom of your library in any order.',
      'Mayael the Anima'
    );
    const step = ir.abilities[0]?.steps?.find((entry) => entry.kind === 'move_zone');
    expect(step).toBeTruthy();
    const revealed = [
      { id: 'lib-mayael-1', name: 'Small Creature', type_line: 'Creature — Elf', cmc: 1, power: '1', toughness: '1' },
      { id: 'lib-mayael-2', name: 'Big Creature', type_line: 'Creature — Beast', cmc: 6, power: '6', toughness: '6' },
      { id: 'lib-mayael-3', name: 'Another Small', type_line: 'Creature — Goblin', cmc: 2, power: '2', toughness: '2' },
    ];
    const state = {
      players: [
        {
          id: controllerId,
          library: [...revealed],
          hand: [],
          graveyard: [],
          exile: [],
        },
        { id: opponentId, library: [], hand: [], graveyard: [], exile: [] },
      ],
      battlefield: [],
    } as GameState;

    const result = applyOracleIRStepsToGameState(
      state,
      [step!],
      {
        controllerId,
        sourceId: 'mayael-the-anima',
        lastMovedCards: revealed,
        selectorContext: { chosenObjectIds: ['lib-mayael-2'] },
      },
      { allowOptional: true }
    );
    expect(result.automationGaps?.some((gap) => gap.reasonCode === 'unsupported_selector')).toBe(false);
    expect(result.automationGaps?.some((gap) => gap.reasonCode === 'optional_step_requires_player_choice')).toBe(
      false
    );
    expect(result.state?.battlefield?.length).toBe(1);
    const player = result.state?.players.find((entry) => entry.id === controllerId) as any;
    expect(player.library.length).toBe(2);
  });

  it('executes Jace exile all cards from target player library', () => {
    const ir = parseOracleTextToIR(
      "Exile all cards from target player's library.",
      'Jace, the Mind Sculptor'
    );
    const step = ir.abilities[0]?.steps?.[0];
    expect(step?.kind).toBe('move_zone');
    const state = {
      players: [
        { id: controllerId, library: [], hand: [], graveyard: [], exile: [] },
        {
          id: opponentId,
          library: [
            { id: 'lib-jace-1', name: 'Jace Lib One', type_line: 'Instant', cmc: 1 },
            { id: 'lib-jace-2', name: 'Jace Lib Two', type_line: 'Sorcery', cmc: 2 },
            { id: 'lib-jace-3', name: 'Jace Lib Three', type_line: 'Creature — Illusion', cmc: 3 },
          ],
          hand: [],
          graveyard: [],
          exile: [],
        },
      ],
      battlefield: [],
    } as GameState;

    const result = applyOracleIRStepsToGameState(state, [step!], {
      controllerId,
      sourceId: 'jace-mind-sculptor',
      targetPlayerId: opponentId,
    });
    expect(result.automationGaps?.some((gap) => gap.reasonCode === 'unsupported_selector')).toBe(false);
    const opponent = result.state?.players.find((entry) => entry.id === opponentId) as any;
    expect(opponent.library.length).toBe(0);
    expect(opponent.exile.length).toBe(3);
  });
});
