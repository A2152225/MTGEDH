import { describe, expect, it } from 'vitest';
import type { GameState, PlayerID } from '../../shared/src';
import { applyOracleIRStepsToGameState } from '../src/oracleIRExecutor';
import { parseOracleTextToIR } from '../src/oracleIRParser';
import {
  parseMoveZoneAnyNumberFromYourGraveyard,
  parseMoveZoneCardPutIntoGraveyardThisWay,
  parseMoveZoneCountCardsExiledWithThisPermanent,
  selectGraveyardCardIdsWithDifferentNames,
} from '../src/oracleIRExecutorZoneOps';

const controllerId = 'p1' as PlayerID;

describe('Oracle IR gap batch 304 — any-number different names / count exiled-with / each GY-this-way', () => {
  it('parses Eerie Ultimatum any number permanent different names', () => {
    expect(
      parseMoveZoneAnyNumberFromYourGraveyard({
        kind: 'raw',
        text: 'any number of permanent cards with different names from your graveyard',
      })
    ).toEqual({ cardType: 'permanent', differentNames: true });
  });

  it('parses Vault 13 two cards exiled with this Saga', () => {
    expect(
      parseMoveZoneCountCardsExiledWithThisPermanent(
        { kind: 'raw', text: 'two cards exiled with this Saga' },
        {
          toRaw:
            "the battlefield under their owners' control and put the rest on the bottom of their owners' libraries",
        }
      )
    ).toEqual({ count: 2, cardType: 'any', withRestToOwnersLibraryBottom: true });
  });

  it('parses Sorin each card put into a graveyard this way', () => {
    expect(
      parseMoveZoneCardPutIntoGraveyardThisWay(
        { kind: 'raw', text: 'each card put into a graveyard this way' },
        'Return each card put into a graveyard this way to the battlefield under your control'
      )
    ).toEqual({ cardType: 'any', putIntoGraveyardThisTurn: true });
  });

  it('dedupes different-names graveyard selection by card name', () => {
    const graveyard = [
      { id: 'gy-1', name: 'Bear', type_line: 'Creature — Bear', cmc: 2 },
      { id: 'gy-2', name: 'Elf', type_line: 'Creature — Elf', cmc: 1 },
      { id: 'gy-3', name: 'Bear', type_line: 'Creature — Bear', cmc: 2 },
    ];
    expect(
      selectGraveyardCardIdsWithDifferentNames(
        graveyard,
        { cardType: 'permanent', differentNames: true },
        ['gy-1', 'gy-2', 'gy-3']
      )
    ).toEqual(['gy-1', 'gy-2']);
  });

  it('executes Eerie Ultimatum return any number permanent different names', () => {
    const ir = parseOracleTextToIR(
      'Return any number of permanent cards with different names from your graveyard to the battlefield.',
      'Eerie Ultimatum'
    );
    const step = ir.abilities[0]?.steps?.[0];
    const state = {
      players: [
        {
          id: controllerId,
          library: [],
          hand: [],
          graveyard: [
            { id: 'gy-bear-1', name: 'Bear', type_line: 'Creature — Bear', cmc: 2 },
            { id: 'gy-elf-1', name: 'Elf', type_line: 'Creature — Elf', cmc: 1 },
            { id: 'gy-bear-2', name: 'Bear', type_line: 'Creature — Bear', cmc: 2 },
          ],
        },
      ],
      battlefield: [],
    } as GameState;

    const result = applyOracleIRStepsToGameState(state, [step], {
      controllerId,
      sourceId: 'eerie',
      selectorContext: { chosenObjectIds: ['gy-bear-1', 'gy-elf-1', 'gy-bear-2'] },
    });
    expect(result.automationGaps?.some((gap) => gap.reasonCode === 'unsupported_selector')).toBe(false);
    expect(result.state?.battlefield?.length).toBe(2);
  });

  it('executes Vault 13 return two exiled-with saga and rest to library bottom', () => {
    const ir = parseOracleTextToIR(
      "III - Return two cards exiled with this Saga to the battlefield under their owners' control and put the rest on the bottom of their owners' libraries.",
      "Vault 13: Dweller's Journey"
    );
    const step = ir.abilities[0]?.steps?.[0];
    const state = {
      players: [
        {
          id: controllerId,
          library: [{ id: 'lib-1', name: 'Forest', type_line: 'Basic Land — Forest', cmc: 0 }],
          hand: [],
          graveyard: [],
          exile: [
            {
              id: 'exile-vault-1',
              name: 'Exiled One',
              type_line: 'Creature — Human',
              cmc: 2,
              exiledWith: 'vault-saga',
            },
            {
              id: 'exile-vault-2',
              name: 'Exiled Two',
              type_line: 'Creature — Zombie',
              cmc: 3,
              exiledWith: 'vault-saga',
            },
            {
              id: 'exile-vault-3',
              name: 'Exiled Three',
              type_line: 'Instant',
              cmc: 1,
              exiledWith: 'vault-saga',
            },
          ],
        },
      ],
      battlefield: [
        { id: 'vault-saga', name: 'Vault 13', type_line: 'Enchantment — Saga', cmc: 3, ownerId: controllerId },
      ],
    } as GameState;

    const result = applyOracleIRStepsToGameState(state, [step], {
      controllerId,
      sourceId: 'vault-saga',
      selectorContext: { chosenObjectIds: ['exile-vault-1', 'exile-vault-2'] },
    });
    expect(result.automationGaps?.some((gap) => gap.reasonCode === 'unsupported_selector')).toBe(false);
    expect(result.state?.battlefield?.length).toBe(3);
    const player = result.state?.players.find((entry) => entry.id === controllerId) as any;
    expect(player.exile.length).toBe(0);
    expect(player.library.length).toBe(2);
  });

  it('executes Sorin return each card put into graveyard this way', () => {
    const ir = parseOracleTextToIR(
      'Return each card put into a graveyard this way to the battlefield under your control.',
      'Sorin, Lord of Innistrad'
    );
    const step = ir.abilities[0]?.steps?.[0];
    const state = {
      players: [
        {
          id: controllerId,
          library: [],
          hand: [],
          graveyard: [
            {
              id: 'gy-sorin-1',
              name: 'Discarded Bear',
              type_line: 'Creature — Bear',
              cmc: 2,
              putIntoGraveyardTurn: 3,
            },
            {
              id: 'gy-sorin-2',
              name: 'Discarded Elf',
              type_line: 'Creature — Elf',
              cmc: 1,
              putIntoGraveyardTurn: 3,
            },
            {
              id: 'gy-plain-1',
              name: 'Old Plains',
              type_line: 'Basic Land — Plains',
              cmc: 0,
            },
          ],
        },
      ],
      battlefield: [],
      turn: 3,
    } as GameState;

    const result = applyOracleIRStepsToGameState(state, [step], {
      controllerId,
      sourceId: 'sorin',
    });
    expect(result.automationGaps?.some((gap) => gap.reasonCode === 'unsupported_selector')).toBe(false);
    expect(result.state?.battlefield?.length).toBe(2);
    const player = result.state?.players.find((entry) => entry.id === controllerId) as any;
    expect(player.graveyard.some((card: any) => card.id === 'gy-plain-1')).toBe(true);
  });
});
