import { describe, expect, it } from 'vitest';
import { getDrawStepTriggers } from '../src/state/modules/triggers/turn-phases.js';
import { getLandfallTriggers } from '../src/state/modules/triggers/landfall.js';
import { collectMatchingParsedEventLines } from '../src/state/modules/triggers/triggerConditionFamilyMatch.js';

function perm(id: string, controller: string, card: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  return { id, controller, owner: controller, tapped: false, counters: {}, card: { id: `${id}_card`, name: id, ...card }, ...extra };
}

function ctxFor(battlefield: any[]) {
  const state: any = {
    seq: 1, stack: [], battlefield, turnPlayer: 'p1', activePlayer: 'p1', phase: 'beginning', step: 'DRAW',
    players: [{ id: 'p1', life: 40 }, { id: 'p2', life: 40 }],
    zones: {
      p1: { hand: [], graveyard: [], exile: [], handCount: 0, graveyardCount: 0, exileCount: 0, libraryCount: 30 },
      p2: { hand: [], graveyard: [], exile: [], handCount: 0, graveyardCount: 0, exileCount: 0, libraryCount: 30 },
    },
  };
  return { state, gameId: 'trigger_census_fallbacks', bumpSeq() { state.seq += 1; }, isReplaying: false } as any;
}

const humility = () => perm('Humility', 'p2', {
  type_line: 'Enchantment', oracle_text: 'All creatures lose all abilities and have base power and toughness 1/1.',
});
const drawWatcher = (oracle = 'At the beginning of your draw step, you gain 1 life.') =>
  perm('Draw Watcher', 'p1', { type_line: 'Creature \u2014 Spirit', power: '1', toughness: '1', oracle_text: oracle });

describe('draw-step triggers', () => {
  it('fire normally', () => {
    expect(getDrawStepTriggers(ctxFor([drawWatcher()]), 'p1').length).toBeGreaterThan(0);
  });

  it('do not fire when the draw step is skipped (Necropotence)', () => {
    const necro = perm('Necropotence', 'p1', { type_line: 'Enchantment', oracle_text: 'Skip your draw step.\nWhenever you discard a card, exile that card from your graveyard.' });
    expect(getDrawStepTriggers(ctxFor([drawWatcher(), necro]), 'p1')).toEqual([]);
  });

  it('do not fire from a creature under Humility (parsed path included)', () => {
    expect(getDrawStepTriggers(ctxFor([drawWatcher(), humility()]), 'p1')).toEqual([]);
  });
});

describe('collectMatchingParsedEventLines suppression gate', () => {
  it('returns nothing for an abilityless battlefield source', () => {
    const watcher = perm('Card Watcher', 'p1', { type_line: 'Creature \u2014 Human', power: '1', toughness: '1', oracle_text: 'Whenever you draw a card, you gain 1 life.' });
    const args = (ctx: any) => ({ ctx, oracleText: String(watcher.card.oracle_text), event: 'draws_card' as const, subjectPermanent: null, subjectControllerId: 'p1', sourcePermanent: watcher });
    expect(collectMatchingParsedEventLines(args(ctxFor([watcher])))).toHaveLength(1);
    expect(collectMatchingParsedEventLines(args(ctxFor([watcher, humility()])))).toEqual([]);
  });
});

describe('landfall: "nontoken land" triggers', () => {
  const watcher = () => perm('Nontoken Watcher', 'p1', { type_line: 'Enchantment', oracle_text: 'Whenever a nontoken land you control enters, you gain 1 life.' });
  const forest = (extra: Record<string, unknown> = {}) => perm('Forest', 'p1', { type_line: 'Basic Land \u2014 Forest', oracle_text: '({T}: Add {G}.)' }, extra);

  it('a played land fires the trigger', () => {
    const land = forest();
    expect(getLandfallTriggers(ctxFor([watcher(), land]), 'p1', land)).toHaveLength(1);
  });

  it('a land token does not', () => {
    const land = forest({ isToken: true });
    expect(getLandfallTriggers(ctxFor([watcher(), land]), 'p1', land)).toHaveLength(0);
  });
});
