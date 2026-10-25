import { describe, it, expect } from 'vitest';
import { parseTurnFaceUpCost, buildFaceDownCardStub, describeTurnFaceUpCost } from '../src/state/modules/faceDownCasting.js';
import { planTurnFaceUpNonManaCost, applyTurnFaceUpCostEffects } from '../src/state/modules/turnFaceUpCostPayment.js';
import { maskFaceDownPermanentForViewer } from '../src/state/modules/faceDownViewMasking.js';
import { recordFaceDownReveal } from '../src/state/modules/faceDownRevealLog.js';
import { faceDownSpellCastView } from '../src/state/modules/faceDownCastTriggerView.js';
import { getPermanentWardCost } from '../src/state/modules/faceDownWardKeyword.js';
import { movePermanentToHand } from '../src/state/modules/zones.js';
import { resolveTargetingSourceColors } from '../src/rules-engine/targeting-handlers/colorSourceTargetingRestriction.js';

const ctxOf = (state: any) => ({ gameId: 'g', state, bumpSeq: () => {}, commandZone: {}, libraries: new Map() } as any);
const real = { id: 'r1', name: 'Echo Tracer', type_line: 'Creature \u2014 Human Wizard', oracle_text: 'Morph {2}{U}', mana_cost: '{2}{U}', colors: ['U'] };
const fd = (extra: any = {}) => ({ id: 'p1', controller: 'a', owner: 'a', isFaceDown: true, faceDownType: 'morph', faceUpCard: real, card: buildFaceDownCardStub('morph', 'p1'), ...extra });

describe('Batch 14 - turn-face-up cost components', () => {
  it('parses non-mana and mixed costs', () => {
    const bird = parseTurnFaceUpCost("Morph\u2014Return a Bird you control to its owner's hand.", 'morph');
    expect(bird?.components).toEqual([{ type: 'return', count: 1, filter: 'Bird' }]);
    const mixed = parseTurnFaceUpCost('Morph\u2014{1}{B}, Pay 2 life.', 'morph');
    expect(mixed?.manaCost).toBe('{1}{B}');
    expect(mixed?.components?.map((c) => c.type)).toEqual(['mana', 'life']);
    expect(describeTurnFaceUpCost(mixed)).toBe('{1}{B}, Pay 2 life');
    expect(parseTurnFaceUpCost('Morph\u2014Sacrifice a creature.', 'morph')?.components?.[0]).toEqual({ type: 'sacrifice', count: 1, filter: 'creature' });
    expect(parseTurnFaceUpCost('Morph\u2014Discard a card.', 'morph')?.components?.[0].type).toBe('discard');
    expect(parseTurnFaceUpCost('Morph\u2014Exile a spell from a graveyard.', 'morph')).toBeNull();
  });
  it('prompts for and pays "return a Bird" (not itself)', () => {
    const birdPerm = { id: 'b1', controller: 'a', owner: 'a', card: { id: 'bc', name: 'Bird', type_line: 'Creature \u2014 Bird' } };
    const state: any = { battlefield: [fd({ faceUpCard: { ...real, type_line: 'Creature \u2014 Bird' } }), birdPerm], zones: { a: { hand: [], graveyard: [] } }, life: { a: 20 } };
    const comps = parseTurnFaceUpCost("Morph\u2014Return a Bird you control to its owner's hand.", 'morph')!.components!;
    const ask = planTurnFaceUpNonManaCost(state, 'a', 'p1', comps);
    expect(ask.code).toBe('NEEDS_COST_CHOICE');
    expect(ask.prompt?.candidateIds).toEqual(['b1']);
    const ok = planTurnFaceUpNonManaCost(state, 'a', 'p1', comps, { return: ['b1'] });
    expect(ok.ok).toBe(true);
    applyTurnFaceUpCostEffects(ctxOf(state), 'a', ok.effects);
    expect(state.battlefield.map((p: any) => p.id)).toEqual(['p1']);
    expect(state.zones.a.hand.map((c: any) => c.id)).toEqual(['bc']);
  });
  it('rejects bad choices and unaffordable life', () => {
    const state: any = { battlefield: [fd()], zones: { a: { hand: [{ id: 'h1', type_line: 'Land' }] } }, life: { a: 1 } };
    const disc = parseTurnFaceUpCost('Morph\u2014Discard a card.', 'morph')!.components!;
    expect(planTurnFaceUpNonManaCost(state, 'a', 'p1', disc, { discard: ['nope'] }).code).toBe('BAD_COST_CHOICE');
    const life = parseTurnFaceUpCost('Morph\u2014Pay 5 life.', 'morph')!.components!;
    expect(planTurnFaceUpNonManaCost(state, 'a', 'p1', life).code).toBe('CANNOT_PAY_LIFE');
  });
});

describe('Batch 14 - reveals', () => {
  it('bounced face-down permanent goes to hand as the real card and is revealed', () => {
    const state: any = { battlefield: [fd()], zones: { a: { hand: [], graveyard: [] } }, turn: 3 };
    movePermanentToHand(ctxOf(state), 'p1');
    expect(state.zones.a.hand[0].name).toBe('Echo Tracer');
    expect(state.faceDownReveals[0]).toMatchObject({ permanentId: 'p1', reason: 'left_battlefield', card: { name: 'Echo Tracer' } });
  });
  it('reveal log is capped and ignores face-up permanents', () => {
    const state: any = {};
    expect(recordFaceDownReveal(state, { id: 'x', isFaceDown: false })).toBeNull();
    for (let i = 0; i < 40; i++) recordFaceDownReveal(state, fd({ id: `p${i}` }));
    expect(state.faceDownReveals.length).toBe(30);
  });
  it('game end unmasks face-down permanents for everyone', () => {
    const p = fd();
    expect(maskFaceDownPermanentForViewer(p, 'b').faceUpCard).toBeUndefined();
    expect(maskFaceDownPermanentForViewer(p, 'b', true).faceUpCard?.name).toBe('Echo Tracer');
  });
  it('controller view lists cost components', () => {
    expect(maskFaceDownPermanentForViewer(fd(), 'a').turnFaceUpCostComponents).toEqual([{ type: 'mana', manaCost: '{2}{U}' }]);
  });
});

describe('Batch 14 - cast triggers, ward, colours', () => {
  it('cast triggers see a face-down spell as a characteristic-less 2/2', () => {
    const state: any = { stack: [{ id: 's1', controller: 'a', alternateCostId: 'morph', card: real }] };
    const v = faceDownSpellCastView(state, 'a', real, 's1');
    expect(v).toMatchObject({ id: 'r1', name: '', power: '2', toughness: '2', mana_cost: '', faceDownSpell: true });
    expect(v.colors).toEqual([]);
    expect(faceDownSpellCastView({ stack: [{ id: 's2', controller: 'a', card: real }] }, 'a', real, 's2')).toBe(real);
  });
  it('disguise ward is a keyword, not oracle text', () => {
    const stub = buildFaceDownCardStub('disguise', 'q');
    expect(stub.oracle_text).toBe('');
    expect(stub.keywords).toEqual(['Ward']);
    expect(getPermanentWardCost({ isFaceDown: true, faceDownType: 'disguise', card: stub })).toBe('{2}');
    expect(getPermanentWardCost({ isFaceDown: true, faceDownType: 'morph', card: { oracle_text: 'Ward {3}' } })).toBeNull();
    expect(getPermanentWardCost({ card: { oracle_text: 'Ward {1}' } })).toBe('{1}');
  });
  it('abilities use the source permanent\'s current colours', () => {
    const src = { id: 'src', controller: 'a', colors: ['R'], card: { id: 'c', colors: ['G'], mana_cost: '{G}' } };
    const state: any = { battlefield: [src], stack: [{ id: 'ab', type: 'ability', source: 'src' }] };
    expect(resolveTargetingSourceColors(state, 'ab')).toEqual(['R']);
    (src as any).isFaceDown = true;
    expect(resolveTargetingSourceColors(state, 'ab')).toEqual([]);
    state.battlefield = [];
    state.stack[0].sourceColors = ['W'];
    expect(resolveTargetingSourceColors(state, 'ab')).toEqual(['W']);
  });
});