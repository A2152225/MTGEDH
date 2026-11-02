import { describe, expect, it } from 'vitest';
import { parseTriggerClause } from '../../rules-engine/src/triggerCondition/index.js';
import { detectAttackTriggers } from '../src/state/modules/triggered-abilities.js';
import { planAttackWatcherQueue } from '../src/state/modules/triggers/attack-watcher-queue.js';
import { recordDilemmaFaced, getDilemmasFacedThisTurn, getBattlefrontCount } from '../src/state/modules/triggers/trekPlayerEventTriggers.js';
import { getCardDrawTriggers } from '../src/state/modules/triggers/card-draw.js';
import { triggerETBEffectsForPermanent } from '../src/state/modules/triggerEtbPermanentEffects.js';
import { stripTurnScopedTriggerSentences } from '../src/state/modules/triggers/turnScopedSpellTriggers.js';

const perm = (id: string, controller: string, card: any, extra: any = {}) => ({ id, controller, owner: controller, tapped: false, counters: {}, card: { id: id + '_c', name: id, ...card }, ...extra });
const creature = (id: string, controller: string, power: number, name = id, type = 'Creature - Human') => perm(id, controller, { name, type_line: type, power: String(power), toughness: '3', oracle_text: '' });
const zone = () => ({ hand: [], graveyard: [] as any[], exile: [], library: [] });
const ctxOf = (battlefield: any[]) => ({ gameId: 'r37', isReplaying: false, state: { battlefield, stack: [] as any[], turnPlayer: 'p1', activePlayer: 'p1', players: [{ id: 'p1' }, { id: 'p2' }, { id: 'p3' }], zones: { p1: zone(), p2: zone(), p3: zone() } } } as any);
const parse = (text: string, name: string): any => (parseTriggerClause as any)(text, name);

const SEVEN = 'Whenever you face a dilemma, draw a card. (You face a dilemma as you choose one or more modes for a spell or ability.)';
const LORCA = 'Whenever you face a dilemma, you may pay {B}. If you do, return this card from your graveyard to your hand. (You face a dilemma as you choose one or more modes for a spell or ability.)';
const TACTICAL = 'Whenever you attack while creatures you control have total power 8 or greater, put a +1/+1 counter on this creature. Untap it.';

describe('round 37: Star Trek trigger wordings', () => {
  it('parses dilemma, total-power and Spacecraft wordings', () => {
    const d = parse(SEVEN, 'Seven of Nine');
    expect(d?.condition?.facesDilemma).toBe(true);
    expect(d?.condition?.legacyRuntimeOnly).toBe(true);
    const p = parse(TACTICAL, 'Tactical Officer');
    expect(p?.condition?.minTotalPower).toBe(8);
    expect(p?.condition?.legacyRuntimeOnly).toBe(true);
    const borg = parse('Whenever this Spacecraft enters or attacks, exile up to one target creature.', 'Borg Cube');
    expect(borg?.condition?.legacyRuntimeOnly).toBeUndefined();
    expect(borg?.condition?.pairedEvent).toBe('attacks');
  });

  it('face a dilemma: counts per choice, triggers your permanents and Lorca from the graveyard', () => {
    const seven = perm('Seven of Nine', 'p1', { type_line: 'Legendary Creature - Human Borg', oracle_text: SEVEN });
    const theirs = perm('Elim Garak', 'p2', { type_line: 'Legendary Creature - Cardassian', oracle_text: 'Whenever you face a dilemma, each opponent loses 2 life and you gain 2 life.' });
    const ctx = ctxOf([seven, theirs]);
    ctx.state.zones.p1.graveyard = [{ id: 'lorca', name: 'Gabriel Lorca, Mirror Menace', type_line: 'Legendary Creature - Human', oracle_text: LORCA }];
    recordDilemmaFaced(ctx, 'p1', 2);
    expect(getDilemmasFacedThisTurn(ctx.state, 'p1')).toBe(1);
    const names = ctx.state.stack.map((s: any) => s.sourceName).sort();
    expect(names).toEqual(['Gabriel Lorca, Mirror Menace', 'Seven of Nine']);
    expect(ctx.state.stack.find((s: any) => s.sourceName === 'Seven of Nine').effect).toBe('draw a card.');
    expect(ctx.state.stack.find((s: any) => s.sourceName.startsWith('Gabriel')).mandatory).toBe(false);
    recordDilemmaFaced(ctx, 'p1', 0);
    expect(getDilemmasFacedThisTurn(ctx.state, 'p1')).toBe(1);
    recordDilemmaFaced(ctx, 'p1', 1);
    expect(getDilemmasFacedThisTurn(ctx.state, 'p1')).toBe(2);
    expect(getDilemmasFacedThisTurn(ctx.state, 'p2')).toBe(0);
  });

  it('battlefront: distinct opponents attacked this turn, self and duplicates ignored', () => {
    const state: any = { attackedPlayersThisTurnByPlayer: { p1: ['p2', 'p3', 'p2', 'p1'] } };
    expect(getBattlefrontCount(state, 'p1')).toBe(2);
    expect(getBattlefrontCount(state, 'p2')).toBe(0);
  });

  it('total power 8: one gated trigger, checked at declaration', () => {
    const officer = perm('Tactical Officer', 'p1', { type_line: 'Creature - Human Officer', power: '2', toughness: '2', oracle_text: TACTICAL });
    const triggers = detectAttackTriggers(officer.card, officer).filter((t: any) => t.triggerType === 'you_attack');
    expect(triggers).toHaveLength(1);
    expect((triggers[0] as any).minTotalPower).toBe(8);
    expect(String(triggers[0].effect)).toMatch(/^put a \+1\/\+1 counter on this creature\. Untap it\.$/i);
    const a = creature('a', 'p1', 3);
    const plan = (bf: any[]) => planAttackWatcherQueue(triggers[0] as any, officer, [a], 'p1', ['p2'], bf, () => 'p2').kind;
    expect(plan([officer, a, creature('b', 'p1', 2), creature('o', 'p2', 9)])).toBe('skip');
    expect(plan([officer, a, creature('b', 'p1', 3)])).toBe('once');
  });

  it('seek out: "draw your second card each turn" fires on any player\'s turn', () => {
    const crusher = perm('Beverly Crusher', 'p1', { type_line: 'Legendary Creature - Human Officer', oracle_text: 'Whenever you draw your second card each turn, put a +1/+1 counter on target creature.' });
    const ctx: any = { state: { battlefield: [crusher], turnPlayer: 'p2', players: [{ id: 'p1' }, { id: 'p2' }] } };
    const fired = (n: number, who = 'p1') => getCardDrawTriggers(ctx, who, undefined, n).filter((t: any) => t.cardName === 'Beverly Crusher').length;
    expect(fired(1)).toBe(0);
    expect(fired(2)).toBe(1);
    expect(fired(3)).toBe(0);
    expect(fired(2, 'p2')).toBe(0);
  });

  const ETB: Array<[string, string]> = [
    ['Captain Jonathan Archer', 'When Captain Archer enters, create Porthos, a legendary 1/1 green Dog creature token.'],
    ['Loran of the Third Path', 'Vigilance\nWhen Loran enters, destroy up to one target artifact or enchantment.'],
    ['Q, Stacking the Deck', 'When Q enters, shuffle your library, then exile cards from the top of your library until you exile a nonland card.'],
    ['Ensign Pavel Chekov', 'When Ensign Chekov enters, each opponent exiles the top X cards of their library, where X is the number of differently named lands you control.'],
    ['Commander Raffi Musiker', 'When Commander Musiker enters, choose one \u2014\n\u2022 Draw a card.\n\u2022 Create a Treasure token.'],
  ];
  for (const [name, text] of ETB) {
    it(name + ': named ETB fires exactly once', () => {
      const p = perm(name, 'p1', { name, type_line: 'Legendary Creature - Human Officer', power: '2', toughness: '2', oracle_text: text });
      const ctx = ctxOf([p]);
      triggerETBEffectsForPermanent(ctx, p, 'p1');
      expect(ctx.state.stack.filter((s: any) => String(s.sourceName || s.cardName || '') === name)).toHaveLength(1);
    });
  }

  it('Gagh Slinger: another Klingon entering fires once', () => {
    const g = perm('Gagh Slinger', 'p1', { type_line: 'Creature - Klingon Warrior', power: '2', toughness: '2', oracle_text: 'Whenever another Klingon or Warrior you control enters, this creature deals 1 damage to each opponent.' });
    const k = creature('k', 'p1', 2, 'Klingon Grunt', 'Creature - Klingon');
    const ctx = ctxOf([g, k]);
    triggerETBEffectsForPermanent(ctx, k, 'p1');
    expect(ctx.state.stack.filter((s: any) => String(s.sourceName || '') === 'Gagh Slinger')).toHaveLength(1);
  });

  it('turn-scoped strip keeps context-bound and batched clauses, drops registered ones', () => {
    expect(stripTurnScopedTriggerSentences('Choose target opponent. Whenever a creature you control deals combat damage to that player this turn, create a tapped Treasure token.')).toBe('Choose target opponent.');
    const forth = 'Create X 2/2 red Human Knight creature tokens with trample and haste.\nWhenever one or more creatures you control deal combat damage to one or more players this turn, you become the monarch.';
    expect(stripTurnScopedTriggerSentences(forth)).toBe(forth);
  });
});
