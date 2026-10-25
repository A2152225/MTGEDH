import { describe, it, expect } from 'vitest';
import {
  parseTurnFaceUpCost, getFaceDownCastKinds, buildFaceDownCardStub, faceDownCastManaCostOverride,
  resolveFaceDownEntryInfo,
} from '../src/state/modules/faceDownCasting.js';
import { validateTurnFaceUp, payNonManaTurnFaceUpCost, getTurnFaceUpCostForPermanent } from '../src/state/modules/turnFaceUpCore.js';
import { maskFaceDownPermanentForViewer, maskFaceDownStackItemForViewer } from '../src/state/modules/faceDownViewMasking.js';
import { collectEvokeOrderableTriggers, maybeQueueEvokeTriggerOrderStep } from '../src/state/modules/evokeTriggerOrdering.js';
import { EVOKE_SACRIFICE_TRIGGER_TYPE } from '../src/state/modules/evokeKeyword.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';
import {
  parseColorSourceTargetingRestriction, isBlockedByColorSourceTargetingRestriction,
} from '../src/rules-engine/targeting-handlers/colorSourceTargetingRestriction.js';

const watcher = { id: 'w', name: 'Watcher of the Roost', oracle_text: 'Flying\nMorph\u2014Reveal a white card in your hand.', mana_cost: '{2}{W}', power: '2', toughness: '1' };
const hoodedHydra = { id: 'h', name: 'Den Protector', oracle_text: 'Megamorph {1}{G}', power: '2', toughness: '1' };
const disguised = { id: 'd', name: 'Fugitive Codebreaker', oracle_text: 'Prowess, haste\nDisguise {5}{R}', power: '1', toughness: '1' };

describe('Batch 13 - face-down casting', () => {
  it('parses morph / megamorph / disguise costs', () => {
    expect(getFaceDownCastKinds(disguised.oracle_text)).toEqual(['disguise']);
    expect(parseTurnFaceUpCost(hoodedHydra.oracle_text, 'megamorph')?.manaCost).toBe('{1}{G}');
    expect(parseTurnFaceUpCost(watcher.oracle_text, 'morph')?.revealColor).toBe('W');
    expect(parseTurnFaceUpCost('Morph\u2014Pay 5 life.', 'morph')?.lifeCost).toBe(5);
  });
  it('casts for {3}', () => {
    expect(faceDownCastManaCostOverride('disguise')).toBe('{3}');
    expect(faceDownCastManaCostOverride('evoke')).toBeUndefined();
  });
  it('stub is a nameless colourless 2/2; disguise has ward {2}', () => {
    const m = buildFaceDownCardStub('morph', 'x');
    expect(m.name).toBe('');
    expect(m.power).toBe('2');
    expect(m.oracle_text || '').toBe('');
    expect(buildFaceDownCardStub('disguise', 'x').wardCost).toBe('{2}'); // Batch 14: granted keyword, not text
  });
  it('detects face-down entry from alternateCostId', () => {
    const info = resolveFaceDownEntryInfo({ alternateCostId: 'disguise' }, disguised);
    expect(info.wasCastFaceDown).toBe(true);
    expect(info.kind).toBe('disguise');
    expect(resolveFaceDownEntryInfo({ alternateCostId: 'evoke' }, disguised).wasCastFaceDown).toBe(false);
  });
});

describe('Batch 13 - turn face up special action', () => {
  const perm = () => ({ id: 'p1', controller: 'a', isFaceDown: true, faceDownType: 'morph', faceUpCard: watcher, card: buildFaceDownCardStub('morph', 'p1') });
  it('validates controller and priority but not the stack', () => {
    const state: any = { battlefield: [perm()], stack: [{ id: 's' }], priority: 'a' };
    expect(validateTurnFaceUp(state, 'a', 'p1').ok).toBe(true);
    expect(validateTurnFaceUp(state, 'b', 'p1').code).toBe('NOT_CONTROLLER');
    expect(validateTurnFaceUp({ ...state, priority: 'b' }, 'a', 'p1').code).toBe('NO_PRIORITY');
  });
  it('reveal cost prompts, then accepts a matching card', () => {
    const state: any = { zones: { a: { hand: [{ id: 'c1', colors: ['W'], name: 'Plains Spell' }, { id: 'c2', colors: ['R'] }] } } };
    const cost = getTurnFaceUpCostForPermanent(perm())!;
    const r1 = payNonManaTurnFaceUpCost(state, 'a', cost);
    expect(r1.code).toBe('NEEDS_REVEAL');
    expect(r1.needsReveal?.candidateCardIds).toEqual(['c1']);
    expect(payNonManaTurnFaceUpCost(state, 'a', cost, 'c2').code).toBe('BAD_REVEAL_CARD');
    expect(payNonManaTurnFaceUpCost(state, 'a', cost, 'c1').ok).toBe(true);
  });
  it('life cost subtracts life', () => {
    const state: any = { life: { a: 10 } };
    const r = payNonManaTurnFaceUpCost(state, 'a', { kind: 'morph', raw: '', lifeCost: 4 } as any);
    expect(r.ok).toBe(true);
    expect(state.life.a).toBe(6);
  });
});

describe('Batch 13 - hidden information', () => {
  it('only the controller sees the real card', () => {
    const p: any = { id: 'p1', controller: 'a', isFaceDown: true, faceDownType: 'morph', faceUpCard: watcher, morphCost: 'x', card: buildFaceDownCardStub('morph', 'p1') };
    const opp: any = maskFaceDownPermanentForViewer(p, 'b');
    expect(opp.faceUpCard).toBeUndefined();
    expect(opp.morphCost).toBeUndefined();
    expect(opp.card.name).toBe('');
    const own: any = maskFaceDownPermanentForViewer(p, 'a');
    expect(own.faceUpCard.name).toBe('Watcher of the Roost');
    expect(own.canTurnFaceUp).toBe(true);
  });
  it('face-down spells are masked on the stack', () => {
    const item: any = { id: 's1', type: 'spell', controller: 'a', alternateCostId: 'morph', card: watcher };
    expect((maskFaceDownStackItemForViewer(item, 'b') as any).card.name).not.toBe('Watcher of the Roost');
    expect((maskFaceDownStackItemForViewer(item, 'a') as any).card.name).toBe('Watcher of the Roost');
    const normal: any = { id: 's2', type: 'spell', controller: 'a', card: watcher };
    expect((maskFaceDownStackItemForViewer(normal, 'b') as any).card.name).toBe('Watcher of the Roost');
  });
});

describe('Batch 13 - evoke trigger ordering', () => {
  it('queues TRIGGER_ORDER for evoke + ETB triggers', () => {
    const gameId = 'b13_evoke_' + Date.now();
    const state: any = {
      stack: [
        { id: 'old', type: 'triggered_ability', controller: 'a' },
        { id: 'evoke_sac_p1', type: 'triggered_ability', controller: 'a', source: 'p1', triggerType: EVOKE_SACRIFICE_TRIGGER_TYPE, sourceName: 'Mulldrifter' },
        { id: 'etb1', type: 'triggered_ability', controller: 'a', source: 'p1', sourceName: 'Mulldrifter', description: 'draw two' },
      ],
    };
    expect(collectEvokeOrderableTriggers(state, 'p1', 'a').map((s: any) => s.id)).toEqual(['evoke_sac_p1', 'etb1']);
    const ctx: any = { state, gameId, isReplaying: true };
    expect(maybeQueueEvokeTriggerOrderStep(ctx, { id: 'p1', card: { name: 'Mulldrifter' } }, 'a')).toBe(false);
    ctx.isReplaying = false;
    expect(maybeQueueEvokeTriggerOrderStep(ctx, { id: 'p1', card: { name: 'Mulldrifter' } }, 'a')).toBe(true);
    const steps = (ResolutionQueueManager.getQueue(gameId) as any).steps.filter((s: any) => s.type === ResolutionStepType.TRIGGER_ORDER);
    expect(steps).toHaveLength(1);
    expect(steps[0].triggers.map((t: any) => t.id)).toEqual(['evoke_sac_p1', 'etb1']);
    expect(maybeQueueEvokeTriggerOrderStep(ctx, { id: 'p1' }, 'a')).toBe(false);
  });
});

describe('Batch 13 - colour-sourced targeting (census #23)', () => {
  const raiding = { id: 'rp', controller: 'a', card: { name: 'Raiding Party', oracle_text: "Raiding Party can't be the target of white spells or abilities from white sources." } };
  it('parses the colour', () => {
    expect(parseColorSourceTargetingRestriction(raiding.card.oracle_text)).toEqual(['W']);
  });
  it('blocks white sources only', () => {
    const state: any = { battlefield: [raiding], stack: [{ id: 'sw', card: { colors: ['W'] } }, { id: 'sr', card: { mana_cost: '{R}' } }] };
    expect(isBlockedByColorSourceTargetingRestriction(raiding, state, 'sw')).toBe(true);
    expect(isBlockedByColorSourceTargetingRestriction(raiding, state, 'sr')).toBe(false);
    expect(isBlockedByColorSourceTargetingRestriction(raiding, state, undefined)).toBe(false);
  });
});