import { afterEach, describe, expect, it } from 'vitest';

import { applyPermanentBecomeCopyOfTargetPermanent } from '../src/state/modules/permanent-copy.js';
import { resolveLegendRuleChoice, runSBA } from '../src/state/modules/counters_tokens.js';
import { ResolutionQueueManager } from '../src/state/resolution/ResolutionQueueManager.js';

const gameId = 'legend_rule_lands_unit';

const ACADEMY_RUINS_ORACLE =
  '{T}: Add {C}.\n{1}{U}, {T}: Put target artifact card from your graveyard on top of your library.';
const VESUVA_ORACLE = 'You may have this land enter tapped as a copy of any land on the battlefield.';

afterEach(() => {
  ResolutionQueueManager.clearAllSteps(gameId);
});

function emptyZones() {
  return {
    hand: [],
    graveyard: [],
    exile: [],
    library: [],
    handCount: 0,
    graveyardCount: 0,
    exileCount: 0,
  };
}

function makeLand(id: string, name: string, typeLine: string, oracleText: string) {
  return {
    id,
    controller: 'p1',
    owner: 'p1',
    tapped: false,
    card: {
      id: `${id}-card`,
      name,
      type_line: typeLine,
      oracle_text: oracleText,
    },
  };
}

function makeCtx(battlefield: any[]) {
  const state: any = {
    battlefield,
    players: [{ id: 'p1', name: 'P1', life: 40 }],
    zones: { p1: emptyZones() },
    life: { p1: 40 },
    manaPool: {},
    commandZone: {},
    emblems: [],
    conspiracies: [],
    stack: [],
    turnPlayer: 'p1',
  };
  return {
    state,
    gameId,
    libraries: new Map([['p1', []]]),
    bumpSeq: () => {},
    rng: () => 0.5,
  };
}

function expectLegendRuleChoice(ctx: any, candidateIds: string[]) {
  const step = ResolutionQueueManager.getStepsForPlayer(gameId, 'p1' as any)[0] as any;
  expect(step).toMatchObject({
    type: 'option_choice',
    legendRuleChoice: true,
    mandatory: true,
    minSelections: 1,
    maxSelections: 1,
  });
  expect(step.options.map((option: any) => option.id).sort()).toEqual([...candidateIds].sort());

  const keepId = candidateIds[0];
  const result = resolveLegendRuleChoice(ctx, {
    batchId: step.legendRuleBatchId,
    groupKey: step.legendRuleGroupKey,
    playerId: 'p1',
    selectedPermanentId: keepId,
  });
  expect(result.accepted).toBe(true);
  expect(result.complete).toBe(true);
  expect(ctx.state.battlefield.map((permanent: any) => permanent.id)).toEqual([keepId]);
}

describe('legend rule for legendary lands', () => {
  it('queues a keep-one choice for two legendary lands with the same name', () => {
    const original = makeLand('ruins_1', 'Academy Ruins', 'Legendary Land', ACADEMY_RUINS_ORACLE);
    const duplicate = makeLand('ruins_2', 'Academy Ruins', 'Legendary Land', ACADEMY_RUINS_ORACLE);
    const ctx = makeCtx([original, duplicate]);

    runSBA(ctx as any);

    expectLegendRuleChoice(ctx, ['ruins_1', 'ruins_2']);
  });

  it('applies after Vesuva becomes a copy of a legendary land', () => {
    const ruins = makeLand('ruins_1', 'Academy Ruins', 'Legendary Land', ACADEMY_RUINS_ORACLE);
    const vesuva = makeLand('vesuva_1', 'Vesuva', 'Land', VESUVA_ORACLE);
    const ctx = makeCtx([ruins, vesuva]);

    const copied = applyPermanentBecomeCopyOfTargetPermanent(ctx.state, 'vesuva_1', 'ruins_1');
    expect(copied.applied).toBe(true);
    expect(vesuva.card.name).toBe('Academy Ruins');
    expect(String(vesuva.card.type_line)).toBe('Legendary Land');

    runSBA(ctx as any);

    expectLegendRuleChoice(ctx, ['ruins_1', 'vesuva_1']);
  });
});
