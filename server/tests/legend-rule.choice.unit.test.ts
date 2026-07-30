import { afterEach, describe, expect, it } from 'vitest';

import { ResolutionQueueManager } from '../src/state/resolution/ResolutionQueueManager.js';
import { resolveLegendRuleChoice, runSBA } from '../src/state/modules/counters_tokens.js';

const gameId = 'legend_rule_choice_unit';

afterEach(() => {
  ResolutionQueueManager.clearAllSteps(gameId);
});

describe('legend rule controller choice', () => {
  it('ignores owner-only shells for permanents that have already left play', () => {
    const makeLegend = (id: string, controller?: string) => ({
      id,
      ...(controller ? { controller } : {}),
      owner: 'p1',
      card: {
        id: `${id}-card`,
        name: 'Neera, Wild Mage',
        type_line: 'Legendary Creature — Human Elf Shaman',
        oracle_text: '',
        power: '2',
        toughness: '7',
      },
    });
    const state: any = {
      battlefield: [makeLegend('neera-stale'), makeLegend('neera-live', 'p1')],
      players: [{ id: 'p1', name: 'P1', life: 40 }],
      zones: {
        p1: {
          hand: [],
          graveyard: [],
          exile: [],
          library: [],
          handCount: 0,
          graveyardCount: 0,
          exileCount: 0,
        },
      },
      life: { p1: 40 },
      manaPool: {},
      commandZone: {},
      emblems: [],
      conspiracies: [],
      stack: [],
      turnPlayer: 'p1',
    };
    const ctx: any = {
      state,
      gameId,
      libraries: new Map([['p1', []]]),
      bumpSeq: () => {},
      rng: () => 0.5,
    };

    runSBA(ctx);

    const steps = ResolutionQueueManager.getStepsForPlayer(gameId, 'p1' as any);
    expect(steps).toHaveLength(0);
    expect((state as any)._legendRuleChoiceBatch).toBeUndefined();
  });

  it('lets the controller keep the real card and clearly marks the token option', () => {
    const original = {
      id: 'mihail-card',
      controller: 'p1',
      owner: 'p1',
      tapped: false,
      card: {
        id: 'mihail-card-object',
        name: 'Emperor Mihail II',
        type_line: 'Legendary Creature — Merfolk Noble',
        oracle_text: '',
        image_uris: { small: 'https://example.test/mihail.jpg' },
        power: '3',
        toughness: '3',
      },
    };
    const token = {
      id: 'mihail-token',
      controller: 'p1',
      owner: 'p1',
      tapped: false,
      isToken: true,
      isCopy: true,
      card: {
        id: 'mihail-token-object',
        name: 'Emperor Mihail II',
        type_line: 'Legendary Creature — Merfolk Noble',
        oracle_text: '',
        isToken: true,
        isCopy: true,
        power: '3',
        toughness: '3',
      },
    };
    const state: any = {
      battlefield: [original, token],
      players: [{ id: 'p1', name: 'P1', life: 40 }],
      zones: {
        p1: {
          hand: [],
          graveyard: [],
          exile: [],
          library: [],
          handCount: 0,
          graveyardCount: 0,
          exileCount: 0,
        },
      },
      life: { p1: 40 },
      manaPool: {},
      commandZone: {},
      emblems: [],
      conspiracies: [],
      stack: [],
      turnPlayer: 'p1',
    };
    const ctx: any = {
      state,
      gameId,
      libraries: new Map([['p1', []]]),
      bumpSeq: () => {},
      rng: () => 0.5,
    };

    runSBA(ctx);

    const step = ResolutionQueueManager.getStepsForPlayer(gameId, 'p1' as any)[0] as any;
    expect(step).toMatchObject({
      type: 'option_choice',
      legendRuleChoice: true,
      mandatory: true,
      minSelections: 1,
      maxSelections: 1,
    });
    expect(step.options).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'mihail-card', label: 'Emperor Mihail II (Card)', isToken: false }),
      expect.objectContaining({ id: 'mihail-token', label: 'Emperor Mihail II (Token)', isToken: true }),
    ]));

    const result = resolveLegendRuleChoice(ctx, {
      batchId: step.legendRuleBatchId,
      groupKey: step.legendRuleGroupKey,
      playerId: 'p1',
      selectedPermanentId: 'mihail-card',
    });

    expect(result).toMatchObject({ accepted: true, complete: true, removedIds: ['mihail-token'] });
    expect(state.battlefield.map((permanent: any) => permanent.id)).toEqual(['mihail-card']);
    expect(state.zones.p1.graveyard).toEqual([]);
    expect(state._legendRuleChoiceBatch).toBeUndefined();
  });
});
