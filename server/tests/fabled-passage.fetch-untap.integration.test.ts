import { describe, expect, it } from 'vitest';

import type { PlayerID } from '../../shared/src/index.js';
import { createInitialGameState } from '../src/state/gameState.js';
import { collectActivatedAbilitySteps } from '../src/state/modules/oracleIrAbilityExecution.js';
import {
  maybeApplyOracleIrChoiceStepFromResolution,
  maybeResumeOracleIRStepsAfterResolution,
} from '../src/state/modules/oracleIrServerZoneSync.js';
import { resolveTopOfStack } from '../src/state/modules/stackResolveTopOfStackUtils.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';

const FABLED_ORACLE =
  '{T}, Sacrifice this land: Search your library for a basic land card, put it onto the battlefield tapped, then shuffle. Then if you control four or more lands, untap that land.';

function landPermanent(id: string, controller: string, name: string) {
  return {
    id,
    controller,
    owner: controller,
    tapped: false,
    type_line: 'Basic Land — Forest',
    card: {
      id: `${id}_card`,
      name,
      type_line: 'Basic Land — Forest',
      oracle_text: '{T}: Add {G}.',
    },
  };
}

function seedFetchResolve(gameId: string, existingLandCount: number) {
  const game = createInitialGameState(gameId);
  const p1 = 'p1' as PlayerID;
  game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
  (game as any).gameId = gameId;

  const forest = {
    id: 'fetched_forest',
    name: 'Forest',
    type_line: 'Basic Land — Forest',
    oracle_text: '{T}: Add {G}.',
    zone: 'library',
  };
  const existingLands = Array.from({ length: existingLandCount }, (_, index) =>
    landPermanent(`land_${index + 1}`, p1, 'Forest'),
  );

  (game.state as any).battlefield = existingLands;
  (game.state as any).zones = {
    [p1]: {
      hand: [],
      handCount: 0,
      graveyard: [],
      graveyardCount: 0,
      library: [forest],
      libraryCount: 1,
    },
  };
  const player = (game.state as any).players.find((entry: any) => entry.id === p1);
  player.library = [{ ...forest }];
  (game as any).libraries = new Map([[p1, [{ ...forest }]]]);

  (game.state as any).stack = [{
    id: 'fetch_ability_1',
    type: 'ability',
    controller: p1,
    source: 'passage_1',
    sourceName: "Fabled Passage",
    abilityType: 'fetch-land',
    activatedAbilityText: FABLED_ORACLE,
    description: 'Search your library for a basic land card, put it onto the battlefield tapped, then shuffle',
    searchParams: {
      filter: { types: ['land'], supertypes: ['basic'] },
      searchDescription: 'a basic land card',
      entersTapped: true,
      maxSelections: 1,
    },
  }];

  ResolutionQueueManager.removeQueue(gameId);
  return { game, p1 };
}

function completeFetchSearch(game: any, p1: PlayerID) {
  const gameId = String((game as any).gameId);
  resolveTopOfStack(game as any);

  const searchStep = ResolutionQueueManager.getStepsForPlayer(gameId, p1)
    .find((step) => step.type === ResolutionStepType.LIBRARY_SEARCH) as any;
  expect(searchStep).toBeTruthy();
  expect(String(searchStep?.oracleIrChoiceStepJson || '')).toContain('search_library');
  expect((searchStep?.availableCards || []).map((card: any) => String(card.id || ''))).toContain('fetched_forest');

  const completed = ResolutionQueueManager.completeStep(gameId, String(searchStep!.id), {
    stepId: String(searchStep!.id),
    playerId: p1,
    selections: ['fetched_forest'],
    cancelled: false,
    timestamp: Date.now(),
  });
  const resumed = maybeApplyOracleIrChoiceStepFromResolution(game as any, completed, completed!.response!);
  expect(resumed).not.toBeNull();
  expect(resumed?.appliedSteps?.some((step) => step.kind === 'search_library')).toBe(true);
  // Live LIBRARY_SEARCH IR resume also runs remaining steps after the search choice.
  const continued = maybeResumeOracleIRStepsAfterResolution(game as any, completed);
  expect(continued).not.toBeNull();
  return resumed;
}

function findFetchedLand(game: any) {
  const battlefield = ((game.state as any).battlefield || []) as Array<any>;
  return battlefield.find((perm) =>
    String(perm?.id || '') === 'fetched_forest'
    || String(perm?.card?.id || '') === 'fetched_forest'
    || (String(perm?.card?.name || perm?.name || '') === 'Forest' && !String(perm?.id || '').startsWith('land_')),
  );
}

describe("Fabled Passage fetch untap", () => {
  it('parses search-then-conditional-untap from the activated ability', () => {
    const steps = collectActivatedAbilitySteps(FABLED_ORACLE, "Fabled Passage");
    expect(steps.map((step) => step.kind)).toEqual(['search_library', 'conditional']);
    expect((steps[0] as { entersTapped?: boolean }).entersTapped).toBe(true);
    expect((steps[0] as { destination?: string }).destination).toBe('battlefield');
    const inner = (steps[1] as { condition?: { raw?: string }; steps?: Array<{ kind?: string; mode?: string; target?: { text?: string } }> });
    expect(String(inner.condition?.raw || '')).toMatch(/you control four or more lands/i);
    expect(inner.steps?.[0]?.kind).toBe('tap_or_untap');
    expect(inner.steps?.[0]?.mode).toBe('untap');
    expect(String(inner.steps?.[0]?.target?.text || '')).toMatch(/that land/i);
  });

  it('untaps the fetched land when you control four or more lands after it enters', () => {
    const gameId = 'fabled_passage_untap_four';
    const { game, p1 } = seedFetchResolve(gameId, 3);
    completeFetchSearch(game, p1);

    const fetched = findFetchedLand(game);
    expect(fetched).toBeTruthy();
    expect(Boolean(fetched?.tapped)).toBe(false);
    expect(((game.state as any).battlefield || []).length).toBe(4);
  });

  it('leaves the fetched land tapped when you control fewer than four lands', () => {
    const gameId = 'fabled_passage_stay_tapped';
    const { game, p1 } = seedFetchResolve(gameId, 2);
    completeFetchSearch(game, p1);

    const fetched = findFetchedLand(game);
    expect(fetched).toBeTruthy();
    expect(Boolean(fetched?.tapped)).toBe(true);
    expect(((game.state as any).battlefield || []).length).toBe(3);
  });
});
