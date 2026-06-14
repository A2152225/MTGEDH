import { describe, expect, it } from 'vitest';
import type { GameState, PlayerID } from '../../shared/src';
import { applyOracleIRStepsToGameState } from '../src/oracleIRExecutor';
import { parseOracleTextToIR } from '../src/oracleIRParser';
import {
  parseMoveZoneThisPermanentAndTheExiledCard,
  parseMoveZoneUpToTargetCountFromYourGraveyard,
  parseMoveZoneYourGraveyardAndHand,
} from '../src/oracleIRExecutorZoneOps';

const controllerId = 'p1' as PlayerID;
const opponentId = 'p2' as PlayerID;

describe('Oracle IR gap batch 309 — Trenzalore / Aesir / Uncle\'s Musings', () => {
  it('parses Trenzalore your graveyard and hand shuffle selector', () => {
    expect(
      parseMoveZoneYourGraveyardAndHand({
        kind: 'raw',
        text: 'your graveyard and hand',
      })
    ).toBe(true);
  });

  it('parses Aesir this saga and the exiled card selector', () => {
    expect(
      parseMoveZoneThisPermanentAndTheExiledCard({
        kind: 'raw',
        text: 'this Saga and the exiled card',
      })
    ).toBe(true);
  });

  it('parses Uncle\'s Musings up to X permanent cards from graveyard', () => {
    expect(
      parseMoveZoneUpToTargetCountFromYourGraveyard({
        kind: 'raw',
        text: 'up to X permanent cards from your graveyard',
      })
    ).toEqual({
      maxCount: 0,
      criteria: { cardType: 'permanent' },
      useXValue: true,
    });
  });

  it('executes Trenzalore shuffle hand and graveyard into library', () => {
    const ir = parseOracleTextToIR('Shuffle your graveyard and hand into your library.', 'Trenzalore Clocktower');
    const step = ir.abilities[0]?.steps?.[0];
    expect(step?.kind).toBe('move_zone');
    const state = {
      players: [
        {
          id: controllerId,
          library: [{ id: 'lib-1', name: 'Lib One', type_line: 'Instant', cmc: 1 }],
          hand: [
            { id: 'trenz-hand-1', name: 'Trenz Hand One', type_line: 'Instant', cmc: 1 },
            { id: 'trenz-hand-2', name: 'Trenz Hand Two', type_line: 'Creature — Bear', cmc: 2 },
          ],
          graveyard: [
            { id: 'trenz-gy-1', name: 'Trenz GY One', type_line: 'Creature — Zombie', cmc: 2 },
            { id: 'trenz-gy-2', name: 'Trenz GY Two', type_line: 'Artifact', cmc: 1 },
          ],
          exile: [],
        },
        { id: opponentId, library: [], hand: [], graveyard: [], exile: [] },
      ],
      battlefield: [],
    } as GameState;

    const result = applyOracleIRStepsToGameState(state, [step!], {
      controllerId,
      sourceId: 'trenzalore',
    });
    expect(result.automationGaps?.some((gap) => gap.reasonCode === 'unsupported_selector')).toBe(false);
    const player = result.state?.players.find((entry) => entry.id === controllerId) as any;
    expect(player.hand.length).toBe(0);
    expect(player.graveyard.length).toBe(0);
    expect(player.library.length).toBe(5);
  });

  it('executes Aesir return saga and exiled card to hand', () => {
    const ir = parseOracleTextToIR(
      "(As this Saga enters and after your draw step, add a lore counter.)\nIII — Return this Saga and the exiled card to their owner's hand.",
      'The Aesir Escape Valhalla'
    );
    const step = ir.abilities[0]?.steps?.find(
      (entry) =>
        entry.kind === 'move_zone' &&
        String((entry as any).what?.text || '').includes('this Saga and the exiled card')
    );
    expect(step).toBeTruthy();
    const sourceId = 'bf-aesir-saga';
    const state = {
      players: [
        {
          id: controllerId,
          library: [],
          hand: [],
          graveyard: [],
          exile: [
            {
              id: 'exile-aesir-1',
              name: 'Aesir Exiled Card',
              type_line: 'Instant',
              cmc: 1,
              exiledWith: sourceId,
              exiledWithSourceId: sourceId,
            },
          ],
        },
        { id: opponentId, library: [], hand: [], graveyard: [], exile: [] },
      ],
      battlefield: [
        {
          id: sourceId,
          name: 'The Aesir Escape Valhalla',
          controller: controllerId,
          owner: controllerId,
          type_line: 'Enchantment — Saga',
          cmc: 4,
        },
      ],
    } as GameState;

    const result = applyOracleIRStepsToGameState(state, [step!], {
      controllerId,
      sourceId,
      sourceName: 'The Aesir Escape Valhalla',
      selectorContext: { chosenObjectIds: ['exile-aesir-1', sourceId] },
    });
    expect(result.automationGaps?.some((gap) => gap.reasonCode === 'unsupported_selector')).toBe(false);
    expect(result.state?.battlefield?.length).toBe(0);
    const player = result.state?.players.find((entry) => entry.id === controllerId) as any;
    expect(player.hand.length).toBe(2);
    expect(player.exile.length).toBe(0);
  });

  it('executes Uncle\'s Musings return up to X permanents from graveyard', () => {
    const ir = parseOracleTextToIR(
      'Converge — Return up to X permanent cards from your graveyard to your hand, where X is the number of colors of mana spent to cast this spell.',
      "Uncle's Musings"
    );
    const step = ir.abilities[0]?.steps?.find(
      (entry) =>
        entry.kind === 'move_zone' &&
        String((entry as any).what?.text || '').includes('up to X permanent cards from your graveyard')
    );
    expect(step).toBeTruthy();
    const state = {
      players: [
        {
          id: controllerId,
          library: [],
          hand: [],
          graveyard: [
            { id: 'uncle-gy-creature', name: 'Uncle Bear', type_line: 'Creature — Bear', cmc: 2 },
            { id: 'uncle-gy-artifact', name: 'Uncle Ring', type_line: 'Artifact', cmc: 1 },
            { id: 'uncle-gy-instant', name: 'Uncle Bolt', type_line: 'Instant', cmc: 1 },
          ],
          exile: [],
        },
        { id: opponentId, library: [], hand: [], graveyard: [], exile: [] },
      ],
      battlefield: [],
    } as GameState;

    const result = applyOracleIRStepsToGameState(state, [step!], {
      controllerId,
      sourceId: 'uncles-musings',
      xValue: 3,
      selectorContext: { chosenObjectIds: ['uncle-gy-creature', 'uncle-gy-artifact'] },
    });
    expect(result.automationGaps?.some((gap) => gap.reasonCode === 'unsupported_selector')).toBe(false);
    const player = result.state?.players.find((entry) => entry.id === controllerId) as any;
    expect(player.hand.map((card: any) => card.id)).toEqual(['uncle-gy-creature', 'uncle-gy-artifact']);
    expect(player.graveyard.map((card: any) => card.id)).toEqual(['uncle-gy-instant']);
  });
});
