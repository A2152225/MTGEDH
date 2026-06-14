import { describe, expect, it } from 'vitest';
import type { GameState, PlayerID } from '../../shared/src';
import { applyOracleIRStepsToGameState } from '../src/oracleIRExecutor';
import { parseOracleTextToIR } from '../src/oracleIRParser';
import {
  parseMoveZoneAllCardsFromAllOpponentsHandsAndGraveyards,
  parseMoveZoneEachCreatureExcludingListedTypes,
  parseMoveZoneThatManyCreatureCardsFromYourGraveyard,
} from '../src/oracleIRExecutorZoneOps';

const controllerId = 'p1' as PlayerID;
const opponentId = 'p2' as PlayerID;

describe('Oracle IR gap batch 326 — Lich-Knights / Summon Leviathan / Ashiok', () => {
  it('parses Lich-Knights that-many creature cards from graveyard selector', () => {
    expect(
      parseMoveZoneThatManyCreatureCardsFromYourGraveyard({
        kind: 'raw',
        text: 'that many creature cards from your graveyard',
      })
    ).toBe(true);
  });

  it('parses Summon Leviathan exclusion creature selector', () => {
    expect(
      parseMoveZoneEachCreatureExcludingListedTypes({
        kind: 'raw',
        text: "each creature that isn't a Kraken, Leviathan, Merfolk, Octopus, or Serpent",
      })
    ).toEqual({
      excludedCreatureTypes: ['Kraken', 'Leviathan', 'Merfolk', 'Octopus', 'Serpent'],
    });
  });

  it('parses Ashiok opponents hands and graveyards selector', () => {
    expect(
      parseMoveZoneAllCardsFromAllOpponentsHandsAndGraveyards({
        kind: 'raw',
        text: "all cards from all opponents' hands and graveyards",
      })
    ).toBe(true);
  });

  it('executes Lich-Knights returning that many creature cards from graveyard to battlefield', () => {
    const ir = parseOracleTextToIR(
      'Exile all creatures. Then return that many creature cards from your graveyard to the battlefield.',
      "Lich-Knights' Conquest"
    );
    const step = ir.abilities[0]?.steps?.find(
      (entry) =>
        entry.kind === 'move_zone' &&
        String((entry as any).what?.text || '')
          .trim()
          .toLowerCase() === 'that many creature cards from your graveyard'
    );
    expect(step).toBeTruthy();
    const state = {
      players: [
        {
          id: controllerId,
          library: [],
          hand: [],
          graveyard: [
            { id: 'gy-lkc-1', name: 'LKC Zombie', type_line: 'Creature — Zombie', cmc: 3 },
            { id: 'gy-lkc-2', name: 'LKC Elf', type_line: 'Creature — Elf', cmc: 2 },
            { id: 'gy-lkc-3', name: 'LKC Human', type_line: 'Creature — Human', cmc: 1 },
          ],
          exile: [],
        },
      ],
      battlefield: [],
    } as GameState;
    const result = applyOracleIRStepsToGameState(state, [step!], {
      controllerId,
      sourceId: 'test',
      referenceAmount: 2,
      selectorContext: { chosenObjectIds: ['gy-lkc-1', 'gy-lkc-2'] },
    });
    expect(result.automationGaps || []).toHaveLength(0);
    expect((result.state.battlefield || []).length).toBe(2);
    expect((result.state.players[0]?.graveyard || []).length).toBe(1);
  });

  it('executes Summon Leviathan bouncing non-sea creatures to hand', () => {
    const ir = parseOracleTextToIR(
      "I - Return each creature that isn't a Kraken, Leviathan, Merfolk, Octopus, or Serpent to its owner's hand.",
      'Summon: Leviathan'
    );
    const step = ir.abilities[0]?.steps?.find((entry) => entry.kind === 'move_zone');
    expect(step).toBeTruthy();
    const state = {
      players: [
        { id: controllerId, library: [], hand: [], graveyard: [], exile: [] },
        { id: opponentId, library: [], hand: [], graveyard: [], exile: [] },
      ],
      battlefield: [
        {
          id: 'bf-sl-kraken',
          name: 'Sea Kraken',
          controller: opponentId,
          owner: opponentId,
          type_line: 'Creature — Kraken',
          cmc: 8,
          toughness: 8,
          power: 6,
        },
        {
          id: 'bf-sl-human',
          name: 'Human Soldier',
          controller: controllerId,
          owner: controllerId,
          type_line: 'Creature — Human Soldier',
          cmc: 2,
          toughness: 2,
          power: 2,
        },
        {
          id: 'bf-sl-merfolk',
          name: 'Merfolk Scout',
          controller: opponentId,
          owner: opponentId,
          type_line: 'Creature — Merfolk',
          cmc: 1,
          toughness: 1,
          power: 1,
        },
      ],
    } as GameState;
    const result = applyOracleIRStepsToGameState(state, [step!], {
      controllerId,
      sourceId: 'test',
    });
    expect(result.automationGaps || []).toHaveLength(0);
    expect((result.state.battlefield || []).map((perm: any) => perm.id)).toEqual([
      'bf-sl-kraken',
      'bf-sl-merfolk',
    ]);
    expect((result.state.players[0]?.hand || []).length).toBe(1);
    expect((result.state.players[1]?.hand || []).length).toBe(0);
  });

  it('executes Ashiok exiling all cards from opponents hands and graveyards', () => {
    const ir = parseOracleTextToIR(
      "-2: Exile all cards from all opponents' hands and graveyards.",
      'Ashiok, Nightmare Weaver'
    );
    const step = ir.abilities[0]?.steps?.find((entry) => entry.kind === 'move_zone');
    expect(step).toBeTruthy();
    const state = {
      players: [
        {
          id: controllerId,
          library: [],
          hand: [{ id: 'hand-ashiok-p1', name: 'Controller Hand', type_line: 'Instant', cmc: 1 }],
          graveyard: [],
          exile: [],
        },
        {
          id: opponentId,
          library: [],
          hand: [{ id: 'hand-ashiok-p2', name: 'Opponent Hand', type_line: 'Instant', cmc: 1 }],
          graveyard: [{ id: 'gy-ashiok-p2', name: 'Opponent GY', type_line: 'Creature — Zombie', cmc: 2 }],
          exile: [],
        },
      ],
      battlefield: [],
    } as GameState;
    const result = applyOracleIRStepsToGameState(state, [step!], {
      controllerId,
      sourceId: 'test',
    });
    expect(result.automationGaps || []).toHaveLength(0);
    expect((result.state.players[0]?.hand || []).length).toBe(1);
    expect((result.state.players[1]?.hand || []).length).toBe(0);
    expect((result.state.players[1]?.graveyard || []).length).toBe(0);
    expect((result.state.players[1]?.exile || []).length).toBe(2);
  });
});
