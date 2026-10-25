import { describe, it, expect, beforeEach, vi } from 'vitest';
vi.mock('../src/components/ToastHost', () => ({ toast: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
import { toast } from '../src/components/ToastHost';
import { parseAlternateCosts } from '../src/components/CastSpellModal-handlers/castSpellModalParseAlternateCosts';
import { describeGameRuleError } from '../src/utils/gameRuleErrorToast';
import * as fd from '../src/utils/faceDownUi';

function fakeSocket() {
  const h: Record<string, (p: any) => void> = {};
  const emitted: any[] = [];
  return { h, emitted, on: (e: string, fn: any) => { h[e] = fn; }, emit: (e: string, p: any) => { emitted.push([e, p]); } };
}

describe('face-down cast options', () => {
  it('adds morph at {3}', () => {
    const c = parseAlternateCosts('Morph {4}{U}{U}', '{3}{U}{U}', 'Exalted Angel').find(x => x.id === 'morph');
    expect(c?.manaCost).toBe('{3}');
    expect(c?.label).toBe('Morph (cast face down)');
  });
  it('megamorph does not also add morph', () => {
    const ids = parseAlternateCosts('Megamorph {5}{G}', '{4}{G}', 'X').map(c => c.id);
    expect(ids).toContain('megamorph');
    expect(ids).not.toContain('morph');
  });
  it('disguise mentions ward', () => {
    const c = parseAlternateCosts('Disguise {2}{W}', '{1}{W}', 'X').find(x => x.id === 'disguise');
    expect(c?.description).toMatch(/ward \{2\}/);
  });
  it('no entry for plain cards', () => {
    expect(parseAlternateCosts('Flying', '{1}{W}', 'X').map(c => c.id)).toEqual(['normal']);
  });
});

describe('turn face up', () => {
  beforeEach(() => fd.__resetFaceDownUiForTests());
  it('cost labels', () => {
    expect(fd.describeTurnFaceUpCostLabel({ kind: 'mana', manaCost: '{2}{U}' })).toBe('{2}{U}');
    expect(fd.describeTurnFaceUpCostLabel({ kind: 'reveal', revealColorWord: 'red' })).toBe('reveal a red card');
    expect(fd.describeTurnFaceUpCostLabel({ kind: 'life', lifeCost: 4 })).toBe('4 life');
    expect(fd.describeTurnFaceUpCostLabel(null)).toBe('');
  });
  it('emits turnFaceUp with captured gameId and handles reveal prompt', () => {
    const s = fakeSocket();
    fd.installFaceDownListeners(s);
    s.h.state({ gameId: 'g1', view: { zones: { p1: { hand: [{ id: 'c1', name: 'Shock' }] } } } });
    expect(fd.requestTurnFaceUp('perm1')).toBe(true);
    expect(s.emitted[0]).toEqual(['turnFaceUp', { gameId: 'g1', permanentId: 'perm1' }]);
    const seen: any[] = [];
    fd.subscribeRevealPrompt(p => seen.push(p));
    s.h.turnFaceUpRevealPrompt({ gameId: 'g1', permanentId: 'perm1', colorWord: 'red', candidateCardIds: ['c1'] });
    expect(fd.getPendingRevealPrompt()?.candidateCardIds).toEqual(['c1']);
    expect(fd.lookupKnownCard('c1')?.name).toBe('Shock');
    fd.requestTurnFaceUp('perm1', 'c1');
    expect(s.emitted[1]).toEqual(['turnFaceUp', { gameId: 'g1', permanentId: 'perm1', revealCardId: 'c1' }]);
    fd.clearRevealPrompt();
    expect(seen[seen.length - 1]).toBeNull();
  });
  it('merges turn_face_up + turn_face_up_cost into one toast', () => {
    vi.useFakeTimers();
    (toast.info as any).mockClear();
    const s = fakeSocket();
    fd.installFaceDownListeners(s);
    s.h.cardRevealed({ reason: 'other' });
    s.h.cardRevealed({ reason: 'turn_face_up', permanentId: 'p1', cardName: 'Hidden Dragon', card: { name: 'Hidden Dragon' } });
    s.h.cardRevealed({ reason: 'turn_face_up_cost', permanentId: 'p1', cardName: 'Hidden Dragon', card: { name: 'Shock' } });
    vi.advanceTimersByTime(200);
    expect((toast.info as any).mock.calls).toEqual([['Hidden Dragon was turned face up (revealed Shock).']]);
    vi.useRealTimers();
  });
  it('multi-part cost prompts accumulate costChoices', () => {
    const s = fakeSocket();
    fd.installFaceDownListeners(s);
    s.h.state({ gameId: 'g', view: { battlefield: [{ id: 'b1', card: { name: 'Bear' } }] } });
    expect(fd.lookupKnownCard('b1')?.isPermanent).toBe(true);
    s.h.turnFaceUpCostPrompt({ gameId: 'g', permanentId: 'm', component: 'return', description: 'Return a creature', count: 1, candidateIds: ['b1'] });
    expect(fd.getPendingRevealPrompt()?.component).toBe('return');
    fd.answerCostPrompt(['b1']);
    expect(s.emitted[0]).toEqual(['turnFaceUp', { gameId: 'g', permanentId: 'm', costChoices: { return: ['b1'] } }]);
    s.h.turnFaceUpCostPrompt({ gameId: 'g', permanentId: 'm', component: 'discard', description: 'Discard two', count: 2, candidateIds: ['h1', 'h2', 'h3'] });
    expect(fd.getPendingRevealPrompt()?.count).toBe(2);
    fd.answerCostPrompt(['h1', 'h3']);
    expect(s.emitted[1][1].costChoices).toEqual({ return: ['b1'], discard: ['h1', 'h3'] });
    expect(fd.getPendingRevealPrompt()).toBeNull();
  });
  it('mergeCostChoice reveal is a single id', () => {
    expect(fd.mergeCostChoice({ sacrifice: ['a'] }, 'reveal', ['c'])).toEqual({ sacrifice: ['a'], reveal: 'c' });
  });
  it('faceDownReveals: first state seeds silently, new entries toast once', () => {
    (toast.info as any).mockClear();
    const s = fakeSocket();
    fd.installFaceDownListeners(s);
    const e1 = { revealId: 'r1', reason: 'left_battlefield', card: { name: 'Old' } };
    const e2 = { revealId: 'r2', reason: 'left_battlefield', card: { name: 'Exalted Angel' } };
    s.h.state({ gameId: 'g', view: { faceDownReveals: [e1] } });
    s.h.state({ gameId: 'g', view: { faceDownReveals: [e1, e2] } });
    s.h.state({ gameId: 'g', view: { faceDownReveals: [e1, e2] } });
    expect((toast.info as any).mock.calls).toEqual([['Face-down permanent left the battlefield: it was Exalted Angel.']]);
    expect(fd.describeFaceDownRevealEntry({ reason: 'game_end', card: { name: 'X' } })).toMatch(/game end: X/);
  });
  it('reveal toast names the turned-up card and revealed card', () => {
    expect(fd.describeTurnFaceUpReveal({ cardName: 'Exalted Angel' })).toBe('Exalted Angel was turned face up.');
    expect(fd.describeTurnFaceUpReveal({ cardName: 'Hidden Dragon', card: { name: 'Shock' } })).toBe('Hidden Dragon was turned face up (revealed Shock).');
    expect(fd.describeTurnFaceUpReveal({})).toBe('A face-down permanent was turned face up.');
  });
  it('isFaceDownPermanent', () => {
    expect(fd.isFaceDownPermanent({ isFaceDown: true })).toBe(true);
    expect(fd.isFaceDownPermanent({ card: { isFaceDownStub: true } })).toBe(true);
    expect(fd.isFaceDownPermanent({ card: { name: 'Bear' } })).toBe(false);
  });
  it('friendly error toasts for every code', () => {
    for (const code of ['NOT_FACE_DOWN','NOT_CONTROLLER','NO_PRIORITY','NO_TURN_UP_COST','CANNOT_PAY_TURN_FACE_UP','NO_REVEAL_CARD','BAD_REVEAL_CARD','CANNOT_PAY_LIFE','BAD_COST_CHOICE']) {
      expect(describeGameRuleError({ code, message: 'raw' })).toMatch(/^Can't turn face up: (?!raw)/);
    }
  });
});
