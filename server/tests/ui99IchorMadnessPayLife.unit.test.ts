import { describe, expect, it } from 'vitest';
import {
  applyIchorPlanarDiceIgnoredIndexes,
  consumeIchorPlanarDicePending,
  formatPlanarDieFaceLabel,
  keptPlanarDieFacesAfterIgnore,
  parseIchorIgnoredFaceIndexes,
  queueIchorPlanarDiceIgnoreChoice,
} from '../src/state/modules/ichorPlanarDiceChoice.js';
import { rollPlanarDie } from '../src/state/modules/planarDie.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';
import {
  buildMadnessOptionChoiceStep,
  formatMadnessCostLabel,
  madnessPayLifeAdditionalCost,
  parseMadnessOffer,
} from '../src/socket/madnessCastOffer.js';
import { declineCastFromExileToGraveyard } from '../src/socket/game-actions-handlers/declineCastFromExileToGraveyard.js';
import {
  AI_PAY_LIFE_REMAINING_MIN,
  chooseAIPayLifeAdditionalCost,
  shouldAIPayLifeAdditionalCost,
} from '../src/socket/ai-handlers/aiPayLifeAdditionalCost.js';

const ICHOR_ORACLE = 'If you would roll one or more planar dice, instead roll that many planar dice plus one and ignore one.';

function chaosCtx(extras?: Record<string, unknown>) {
  return {
    gameId: 'ui99-ichor',
    state: {
      battlefield: [{
        id: 'watcher',
        controller: 'p1',
        card: { name: 'Watcher', type_line: 'Creature', oracle_text: 'Whenever chaos ensues, draw a card.' },
      }],
      stack: [],
      turnNumber: 1,
      ...(extras || {}),
    },
    bumpSeq() {},
  } as any;
}

describe('Ichor Elixir planar-die ignore choice', () => {
  it('labels rolled faces so the picker can tell two blanks apart', () => {
    expect(formatPlanarDieFaceLabel('chaos', 0, 2)).toBe('Chaos (roll 1)');
    expect(formatPlanarDieFaceLabel('blank', 1, 2)).toBe('Blank (roll 2)');
    expect(formatPlanarDieFaceLabel('planeswalk', 0, 1)).toBe('Planeswalk');
  });

  it('keeps the unselected faces and parses ichor-face option ids', () => {
    expect(keptPlanarDieFacesAfterIgnore(['chaos', 'blank', 'planeswalk'], [1])).toEqual(['chaos', 'planeswalk']);
    expect(parseIchorIgnoredFaceIndexes(['ichor-face-0', { id: 'ichor-face-2' }], 3)).toEqual([0, 2]);
  });

  it('consumes pending and applies only the kept face, including chaos', () => {
    const ctx = chaosCtx({
      ichorPlanarDicePending: { playerId: 'p1', ignore: 1, faces: ['chaos', 'blank'] },
    });
    expect(applyIchorPlanarDiceIgnoredIndexes(ctx, [1])).toEqual(['chaos']);
    expect(ctx.state.ichorPlanarDicePending).toBeUndefined();
    expect(ctx.state.lastPlanarDieRoll).toEqual(expect.objectContaining({ playerId: 'p1', face: 'chaos', chaos: true }));
    expect(ctx.state.stack.map((item: any) => item.effect)).toEqual(['draw a card']);
  });

  it('does not queue chaos when the chaos face is the one ignored', () => {
    const ctx = chaosCtx({
      ichorPlanarDicePending: { playerId: 'p1', ignore: 1, faces: ['chaos', 'blank'] },
    });
    expect(applyIchorPlanarDiceIgnoredIndexes(ctx, [0])).toEqual(['blank']);
    expect(ctx.state.lastPlanarDieRoll).toEqual(expect.objectContaining({ face: 'blank', chaos: false }));
    expect(ctx.state.stack).toEqual([]);
    expect(consumeIchorPlanarDicePending(ctx.state)).toBeNull();
  });

  it('stashes both faces and defers chaos until the ignore choice when Ichor Elixir is present', () => {
    const ctx = chaosCtx({
      battlefield: [
        {
          id: 'watcher',
          controller: 'p1',
          card: { name: 'Watcher', type_line: 'Creature', oracle_text: 'Whenever chaos ensues, draw a card.' },
        },
        {
          id: 'i1',
          controller: 'p1',
          name: 'Ichor Elixir',
          oracle_text: ICHOR_ORACLE,
          card: { name: 'Ichor Elixir', oracle_text: ICHOR_ORACLE },
        },
      ],
    });
    expect(rollPlanarDie(ctx, 'p1', 'chaos')).toBe('chaos');
    const pending = ctx.state.ichorPlanarDicePending;
    expect(pending).toEqual(expect.objectContaining({ playerId: 'p1', ignore: 1 }));
    expect(pending.faces).toHaveLength(2);
    expect(pending.faces[0]).toBe('chaos');
    expect(ctx.state.stack).toEqual([]);
    expect(ctx.state.lastPlanarDieRoll).toBeUndefined();

    const queued = ResolutionQueueManager.getStepsForPlayer('ui99-ichor', 'p1' as any)
      .filter((step: any) => step?.ichorPlanarDiceChoice === true);
    expect(queued.length).toBe(1);
    expect(queued[0].type).toBe(ResolutionStepType.OPTION_CHOICE);
    expect(queued[0].minSelections).toBe(1);
    expect(queued[0].maxSelections).toBe(1);
    expect(queued[0].options.map((option: any) => option.id)).toEqual(['ichor-face-0', 'ichor-face-1']);
    expect(queueIchorPlanarDiceIgnoreChoice(ctx)).toBe(true);
    for (const step of ResolutionQueueManager.getStepsForPlayer('ui99-ichor', 'p1' as any)) {
      try {
        ResolutionQueueManager.completeStep('ui99-ichor', (step as any).id, { playerId: 'p1', selections: ['ichor-face-1'] } as any);
      } catch { /* queue cleanup is best-effort */ }
    }
  });

  it('still applies a normal chaos roll immediately when Ichor Elixir is not present', () => {
    const ctx = chaosCtx();
    expect(rollPlanarDie(ctx, 'p1', 'chaos')).toBe('chaos');
    expect(ctx.state.ichorPlanarDicePending).toBeUndefined();
    expect(ctx.state.stack.map((item: any) => item.effect)).toEqual(['draw a card']);
  });
});

describe('Madness pay-life (Shadowgrange Archfiend)', () => {
  const shadowOracle = 'Madness—{2}{B}, Pay 8 life.';

  it('parses the mana half and the life half for the madness offer label', () => {
    expect(parseMadnessOffer(shadowOracle)).toEqual({
      mana: '{2}{B}',
      life: 8,
      label: '{2}{B}, Pay 8 life',
    });
    expect(parseMadnessOffer('Madness {1}{B}')).toEqual({
      mana: '{1}{B}',
      life: 0,
      label: '{1}{B}',
    });
    expect(formatMadnessCostLabel('{2}{B}', 8)).toBe('{2}{B}, Pay 8 life');
  });

  it('exposes pay_life as the additional cost only for a forced madness cast', () => {
    expect(madnessPayLifeAdditionalCost(shadowOracle, 'madness')).toEqual({ type: 'pay_life', amount: 8 });
    expect(madnessPayLifeAdditionalCost(shadowOracle, 'dash')).toBeNull();
    expect(madnessPayLifeAdditionalCost('Madness {1}{B}', 'madness')).toBeNull();
  });

  it('builds an OPTION_CHOICE that includes the life half and declines to the graveyard', () => {
    const step = buildMadnessOptionChoiceStep({
      playerId: 'p1',
      exiledCard: { id: 'c1', name: 'Shadowgrange Archfiend', oracle_text: shadowOracle },
    });
    expect(step.type).toBe(ResolutionStepType.OPTION_CHOICE);
    expect(step.madnessPrompt).toBe(true);
    expect(step.madnessLife).toBe(8);
    expect(step.madnessCost).toBe('{2}{B}, Pay 8 life');
    expect(step.options[0].label).toBe('Cast for Madness ({2}{B}, Pay 8 life)');
    expect(step.castFromExileForcedAlternateCostId).toBe('madness');
    expect(step.castFromExileDeclineDestination).toBe('graveyard');
  });

  it('moves the exiled card to the graveyard when madness is declined', () => {
    const card = { id: 'c1', name: 'Shadowgrange Archfiend', oracle_text: shadowOracle, zone: 'exile' };
    const game = {
      state: {
        zones: {
          p1: { exile: [card], exileCount: 1, graveyard: [], graveyardCount: 0 },
        },
        pendingSpellCasts: { x: { cardId: 'c1' } },
      },
    };
    expect(declineCastFromExileToGraveyard(game, 'p1', 'c1')).toBe(true);
    expect(game.state.zones.p1.exile).toEqual([]);
    expect(game.state.zones.p1.graveyard.map((entry: any) => entry.id)).toEqual(['c1']);
    expect(game.state.pendingSpellCasts.x).toBeUndefined();
  });
});

describe('AI additional-cost pay_life policy', () => {
  it('pays only when remaining life stays comfortably at or above the comfort floor', () => {
    expect(AI_PAY_LIFE_REMAINING_MIN).toBe(6);
    expect(shouldAIPayLifeAdditionalCost(40, 8)).toBe(true);
    expect(shouldAIPayLifeAdditionalCost(14, 8)).toBe(true);
    expect(shouldAIPayLifeAdditionalCost(13, 8)).toBe(false);
    expect(shouldAIPayLifeAdditionalCost(10, 8)).toBe(false);
    expect(shouldAIPayLifeAdditionalCost(6, 0)).toBe(true);
  });

  it('accepts or declines a pay_life step from current life', () => {
    const step = { costType: 'pay_life', amount: 8 };
    expect(chooseAIPayLifeAdditionalCost({ state: { life: { p1: 40 }, startingLife: 40 } }, 'p1', step)).toBe('pay');
    expect(chooseAIPayLifeAdditionalCost({ state: { life: { p1: 10 }, startingLife: 40 } }, 'p1', step)).toBe('decline');
  });
});
