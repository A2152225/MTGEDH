import { describe, expect, it } from 'vitest';
import type { GameState, PlayerID } from '../../shared/src';
import { applyOracleIRStepsToGameState } from '../src/oracleIRExecutor';
import { parseOracleTextToIR } from '../src/oracleIRParser';
import {
  parseMoveZoneAllTappedCreatures,
  parseMoveZoneSingleTargetInstantOrSorceryFromGraveyardOrOwnedFlashbackExile,
  parseMoveZoneTypedCardFromAmongThem,
} from '../src/oracleIRExecutorZoneOps';

const controllerId = 'p1' as PlayerID;

describe('Oracle IR gap batch 319 — Glacial Revelation / Time of Ice / Sorceress\'s Schemes', () => {
  it('parses Glacial Revelation snow permanent among-them selector', () => {
    expect(
      parseMoveZoneTypedCardFromAmongThem(
        {
          kind: 'raw',
          text: 'any number of snow permanent cards from among them',
        },
        { to: 'hand', raw: 'Put the rest on the bottom of your library in a random order.' }
      )
    ).toMatchObject({
      cardType: 'permanent',
      typeLineTermsAnyOf: ['snow'],
      anyNumber: true,
    });
  });

  it('parses Time of Ice all tapped creatures bounce', () => {
    expect(
      parseMoveZoneAllTappedCreatures({
        kind: 'raw',
        text: 'all tapped creatures',
      })
    ).toBe(true);
  });

  it('parses Sorceress\'s Schemes graveyard or owned flashback exile return', () => {
    expect(
      parseMoveZoneSingleTargetInstantOrSorceryFromGraveyardOrOwnedFlashbackExile({
        kind: 'raw',
        text: 'target instant or sorcery card from your graveyard or exiled card with flashback you own',
      })
    ).toEqual({ cardType: 'instant_or_sorcery' });
  });

  it('executes Glacial Revelation putting chosen snow cards into hand', () => {
    const ir = parseOracleTextToIR(
      'Look at the top four cards of your library. You may put any number of snow permanent cards from among them into your hand. Put the rest on the bottom of your library in a random order.',
      'Glacial Revelation'
    );
    const step = ir.abilities[0]?.steps?.find((entry) => entry.kind === 'move_zone');
    expect(step).toBeTruthy();
    const revealedCards = [
      { id: 'lib-gr-snow-1', name: 'Snow Plains', type_line: 'Basic Snow Land — Plains', cmc: 0 },
      { id: 'lib-gr-snow-2', name: 'Snow Creature', type_line: 'Snow Creature — Human', cmc: 2 },
      { id: 'lib-gr-nonsnow-1', name: 'Regular Bolt', type_line: 'Instant', cmc: 1 },
      { id: 'lib-gr-nonsnow-2', name: 'Regular Forest', type_line: 'Basic Land — Forest', cmc: 0 },
    ];
    const state = {
      players: [
        {
          id: controllerId,
          library: [...revealedCards],
          hand: [],
          graveyard: [],
          exile: [],
        },
      ],
      battlefield: [],
    } as GameState;
    const result = applyOracleIRStepsToGameState(state, [step!], {
      controllerId,
      sourceId: 'test',
      lastMovedCards: revealedCards,
      selectorContext: { chosenObjectIds: ['lib-gr-snow-1', 'lib-gr-snow-2'] },
    }, { allowOptional: true });
    expect(result.automationGaps || []).toHaveLength(0);
    const handIds = (result.state.players[0]?.hand || []).map((card: any) => String(card?.id || ''));
    expect(handIds).toEqual(expect.arrayContaining(['lib-gr-snow-1', 'lib-gr-snow-2']));
    expect(handIds).not.toContain('lib-gr-nonsnow-1');
  });

  it('executes Time of Ice bouncing only tapped creatures', () => {
    const ir = parseOracleTextToIR("III - Return all tapped creatures to their owners' hands.", 'Time of Ice');
    const step = ir.abilities[0]?.steps?.find((entry) => entry.kind === 'move_zone');
    expect(step).toBeTruthy();
    const state = {
      players: [{ id: controllerId, library: [], hand: [], graveyard: [], exile: [] }],
      battlefield: [
        {
          id: 'bf-toi-tapped',
          name: 'Tapped Goblin',
          controller: controllerId,
          owner: controllerId,
          type_line: 'Creature — Goblin',
          cmc: 1,
          tapped: true,
        },
        {
          id: 'bf-toi-untapped',
          name: 'Untapped Elf',
          controller: controllerId,
          owner: controllerId,
          type_line: 'Creature — Elf',
          cmc: 1,
        },
      ],
    } as GameState;
    const result = applyOracleIRStepsToGameState(state, [step!], { controllerId, sourceId: 'test' });
    expect(result.automationGaps || []).toHaveLength(0);
    expect((result.state.battlefield || []).map((perm: any) => perm.id)).toEqual(['bf-toi-untapped']);
    expect((result.state.players[0]?.hand || []).length).toBe(1);
  });

  it('executes Sorceress\'s Schemes returning instant from graveyard', () => {
    const ir = parseOracleTextToIR(
      'Return target instant or sorcery card from your graveyard or exiled card with flashback you own to your hand.',
      "Sorceress's Schemes"
    );
    const step = ir.abilities[0]?.steps?.find((entry) => entry.kind === 'move_zone');
    expect(step).toBeTruthy();
    const state = {
      players: [
        {
          id: controllerId,
          library: [],
          hand: [],
          graveyard: [{ id: 'gy-schemes-instant', name: 'Shock', type_line: 'Instant', cmc: 1 }],
          exile: [],
        },
      ],
      battlefield: [],
    } as GameState;
    const result = applyOracleIRStepsToGameState(state, [step!], {
      controllerId,
      sourceId: 'test',
      selectorContext: { chosenObjectIds: ['gy-schemes-instant'] },
    });
    expect(result.automationGaps || []).toHaveLength(0);
    expect((result.state.players[0]?.hand || []).length).toBe(1);
    expect((result.state.players[0]?.graveyard || []).length).toBe(0);
  });

  it('executes Sorceress\'s Schemes returning flashback card from exile', () => {
    const ir = parseOracleTextToIR(
      'Return target instant or sorcery card from your graveyard or exiled card with flashback you own to your hand.',
      "Sorceress's Schemes"
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
          exile: [
            {
              id: 'ex-schemes-flashback',
              name: 'Faithless Looting',
              type_line: 'Sorcery',
              cmc: 1,
              keywords: ['Flashback'],
            },
          ],
        },
      ],
      battlefield: [],
    } as GameState;
    const result = applyOracleIRStepsToGameState(state, [step!], {
      controllerId,
      sourceId: 'test',
      selectorContext: { chosenObjectIds: ['ex-schemes-flashback'] },
    });
    expect(result.automationGaps || []).toHaveLength(0);
    expect((result.state.players[0]?.hand || []).length).toBe(1);
    expect((result.state.players[0]?.exile || []).length).toBe(0);
  });
});
