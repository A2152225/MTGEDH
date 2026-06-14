import { describe, expect, it } from 'vitest';
import type { GameState, PlayerID } from '../../shared/src';
import { applyOracleIRStepsToGameState } from '../src/oracleIRExecutor';
import { parseOracleTextToIR } from '../src/oracleIRParser';
import {
  parseMoveZoneAllCardsDestroyedThisWayFromYourGraveyard,
  parseMoveZoneAnyNumberFromYourHandFaceDown,
  parseMoveZoneCompoundArtifactCreatureLandGyHandsExile,
  parseMoveZoneThatManyCardsFromTopOfLibrary,
} from '../src/oracleIRExecutorZoneOps';

const controllerId = 'p1' as PlayerID;
const opponentId = 'p2' as PlayerID;

describe('Oracle IR gap batch 307 — Scroll Rack / Cleansing Meditation / Decree of Annihilation', () => {
  it('parses Scroll Rack hand face-down exile selector', () => {
    expect(
      parseMoveZoneAnyNumberFromYourHandFaceDown({
        kind: 'raw',
        text: 'any number of cards from your hand face down',
      })
    ).toEqual({ cardType: 'any' });
  });

  it('parses Scroll Rack that-many library top to hand selector', () => {
    expect(
      parseMoveZoneThatManyCardsFromTopOfLibrary({
        kind: 'raw',
        text: 'that many cards from the top of your library',
      })
    ).toBe(true);
  });

  it('parses Cleansing Meditation destroyed-this-way graveyard return', () => {
    expect(
      parseMoveZoneAllCardsDestroyedThisWayFromYourGraveyard({
        kind: 'raw',
        text: 'all cards in your graveyard destroyed this way',
      })
    ).toBe(true);
  });

  it('parses Decree of Annihilation compound mass exile selector', () => {
    expect(
      parseMoveZoneCompoundArtifactCreatureLandGyHandsExile({
        kind: 'raw',
        text:
          'all artifacts, creatures, and lands from the battlefield, all cards from all graveyards, and all cards from all hands',
      })
    ).toBe(true);
  });

  it('executes Scroll Rack exile hand face down and sets reference amount', () => {
    const ir = parseOracleTextToIR(
      '{1}, {T}: Exile any number of cards from your hand face down. Put that many cards from the top of your library into your hand.',
      'Scroll Rack'
    );
    const step = ir.abilities[0]?.steps?.find(
      (entry) =>
        entry.kind === 'move_zone' &&
        String((entry as any).what?.text || '').includes('any number of cards from your hand face down')
    );
    expect(step).toBeTruthy();
    const state = {
      players: [
        {
          id: controllerId,
          library: [{ id: 'lib-1', name: 'Top One', type_line: 'Instant', cmc: 1 }],
          hand: [
            { id: 'scroll-hand-1', name: 'Scroll Hand One', type_line: 'Instant', cmc: 1 },
            { id: 'scroll-hand-2', name: 'Scroll Hand Two', type_line: 'Instant', cmc: 1 },
          ],
          graveyard: [],
          exile: [],
        },
        { id: opponentId, library: [], hand: [], graveyard: [], exile: [] },
      ],
      battlefield: [],
    } as GameState;

    const result = applyOracleIRStepsToGameState(state, [step!], {
      controllerId,
      sourceId: 'scroll-rack',
      selectorContext: { chosenObjectIds: ['scroll-hand-1', 'scroll-hand-2'] },
    });
    expect(result.automationGaps?.some((gap) => gap.reasonCode === 'unsupported_selector')).toBe(false);
    const player = result.state?.players.find((entry) => entry.id === controllerId) as any;
    expect(player.hand.length).toBe(0);
    expect(player.exile.length).toBe(2);
    expect(player.exile.every((card: any) => card.faceDown === true)).toBe(true);
  });

  it('executes Scroll Rack put that many library top cards into hand', () => {
    const ir = parseOracleTextToIR(
      '{1}, {T}: Exile any number of cards from your hand face down. Put that many cards from the top of your library into your hand.',
      'Scroll Rack'
    );
    const step = ir.abilities[0]?.steps?.find(
      (entry) =>
        entry.kind === 'move_zone' &&
        String((entry as any).what?.text || '').includes('that many cards from the top of your library') &&
        (entry as any).to === 'hand'
    );
    expect(step).toBeTruthy();
    const state = {
      players: [
        {
          id: controllerId,
          library: [
            { id: 'scroll-lib-1', name: 'Scroll Top One', type_line: 'Instant', cmc: 1 },
            { id: 'scroll-lib-2', name: 'Scroll Top Two', type_line: 'Instant', cmc: 1 },
            { id: 'scroll-lib-3', name: 'Scroll Top Three', type_line: 'Instant', cmc: 1 },
          ],
          hand: [],
          graveyard: [],
          exile: [],
        },
        { id: opponentId, library: [], hand: [], graveyard: [], exile: [] },
      ],
      battlefield: [],
    } as GameState;

    const result = applyOracleIRStepsToGameState(state, [step!], {
      controllerId,
      sourceId: 'scroll-rack',
      referenceAmount: 2,
    });
    expect(result.automationGaps?.some((gap) => gap.reasonCode === 'unsupported_selector')).toBe(false);
    const player = result.state?.players.find((entry) => entry.id === controllerId) as any;
    expect(player.hand.map((card: any) => card.id)).toEqual(['scroll-lib-1', 'scroll-lib-2']);
    expect(player.library.map((card: any) => card.id)).toEqual(['scroll-lib-3']);
  });

  it('executes Cleansing Meditation return destroyed-this-way cards from graveyard', () => {
    const ir = parseOracleTextToIR(
      'Destroy all artifacts. Then destroy all enchantments. Then return all cards in your graveyard destroyed this way to the battlefield.',
      'Cleansing Meditation'
    );
    const step = ir.abilities[0]?.steps?.find(
      (entry) =>
        entry.kind === 'move_zone' &&
        String((entry as any).what?.text || '').includes('all cards in your graveyard destroyed this way')
    );
    expect(step).toBeTruthy();
    const destroyedFixtures = [
      { id: 'cleanse-gy-artifact', name: 'Cleanse Artifact', type_line: 'Artifact', cmc: 2 },
      { id: 'cleanse-gy-enchant', name: 'Cleanse Enchant', type_line: 'Enchantment', cmc: 3 },
    ];
    const state = {
      players: [
        {
          id: controllerId,
          library: [],
          hand: [],
          graveyard: [...destroyedFixtures],
          exile: [],
        },
        { id: opponentId, library: [], hand: [], graveyard: [], exile: [] },
      ],
      battlefield: [],
    } as GameState;

    const result = applyOracleIRStepsToGameState(state, [step!], {
      controllerId,
      sourceId: 'cleansing-meditation',
      lastMovedCards: destroyedFixtures,
    });
    expect(result.automationGaps?.some((gap) => gap.reasonCode === 'unsupported_selector')).toBe(false);
    const player = result.state?.players.find((entry) => entry.id === controllerId) as any;
    expect(player.graveyard.length).toBe(0);
    expect(result.state?.battlefield?.length).toBe(2);
  });

  it('executes Decree of Annihilation compound mass exile', () => {
    const ir = parseOracleTextToIR(
      'Exile all artifacts, creatures, and lands from the battlefield, all cards from all graveyards, and all cards from all hands.',
      'Decree of Annihilation'
    );
    const step = ir.abilities[0]?.steps?.[0];
    expect(step?.kind).toBe('move_zone');
    const state = {
      players: [
        {
          id: controllerId,
          library: [],
          hand: [{ id: 'decree-p1-hand', name: 'Decree Hand', type_line: 'Instant', cmc: 1 }],
          graveyard: [{ id: 'decree-p1-gy', name: 'Decree GY', type_line: 'Creature — Bear', cmc: 2 }],
          exile: [],
        },
        {
          id: opponentId,
          library: [],
          hand: [{ id: 'decree-p2-hand', name: 'Decree Opp Hand', type_line: 'Instant', cmc: 1 }],
          graveyard: [{ id: 'decree-p2-gy', name: 'Decree Opp GY', type_line: 'Instant', cmc: 1 }],
          exile: [],
        },
      ],
      battlefield: [
        {
          id: 'decree-bf-art',
          name: 'Decree Sol Ring',
          controller: controllerId,
          owner: controllerId,
          type_line: 'Artifact',
          cmc: 1,
        },
        {
          id: 'decree-bf-creature',
          name: 'Decree Bear',
          controller: controllerId,
          owner: controllerId,
          type_line: 'Creature — Bear',
          cmc: 2,
          colors: ['G'],
        },
        {
          id: 'decree-bf-land',
          name: 'Decree Forest',
          controller: opponentId,
          owner: opponentId,
          type_line: 'Basic Land — Forest',
          cmc: 0,
        },
      ],
    } as GameState;

    const result = applyOracleIRStepsToGameState(state, [step!], {
      controllerId,
      sourceId: 'decree-of-annihilation',
    });
    expect(result.automationGaps?.some((gap) => gap.reasonCode === 'unsupported_selector')).toBe(false);
    expect(result.state?.battlefield?.length).toBe(0);
    for (const player of result.state?.players || []) {
      const entry = player as any;
      expect(entry.hand.length).toBe(0);
      expect(entry.graveyard.length).toBe(0);
    }
    const totalExiled =
      (result.state?.players || []).reduce((sum, player) => sum + ((player as any).exile?.length || 0), 0) || 0;
    expect(totalExiled).toBeGreaterThanOrEqual(7);
  });
});
