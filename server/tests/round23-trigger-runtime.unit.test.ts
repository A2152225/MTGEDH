import { describe, it, expect } from 'vitest';
import { getCounterPlacedTriggers } from '../src/state/modules/triggers/counters.js';
import { getCardDrawTriggers } from '../src/state/modules/triggers/card-draw.js';
import { counterTargetSubjectMatches } from '../src/state/modules/triggers/counterTargetSubject.js';
import { findSourceNextCastRiderText } from '../src/state/modules/stackResolveTopOfStackDispatchUtils.js';

const perm = (id: string, name: string, typeLine: string, oracle: string, extra: any = {}) => ({
  id, controller: 'p1', owner: 'p1', card: { id: id + 'c', name, type_line: typeLine, oracle_text: oracle, ...extra },
});

describe('round 23: counters_put_on_target subject', () => {
  const aragorn = perm('a', 'Aragorn, King of Gondor', 'Legendary Creature', 'Whenever you put one or more +1/+1 counters on Aragorn, draw a card.');
  const bear = perm('b', 'Grizzly Bears', 'Creature \u2014 Bear', '');
  it('named self only fires for the watcher', () => {
    expect(counterTargetSubjectMatches('Whenever you put one or more +1/+1 counters on Aragorn, draw a card', aragorn, bear)).toBe(false);
    expect(counterTargetSubjectMatches('Whenever you put one or more +1/+1 counters on Aragorn, draw a card', aragorn, aragorn)).toBe(true);
  });
  it('type lists and another', () => {
    const goblin = perm('g', 'Goblin Guide', 'Creature \u2014 Goblin Scout', '');
    const w = perm('w', 'The Great Goblin', 'Legendary Creature \u2014 Goblin', '');
    const clause = 'Whenever you put one or more counters on a Goblin, Orc, or Army you control, draw';
    expect(counterTargetSubjectMatches(clause, w, goblin)).toBe(true);
    expect(counterTargetSubjectMatches(clause, w, bear)).toBe(false);
    const omar = perm('o', 'Omarthis', 'Legendary Artifact Creature', '', { colors: [] });
    const golem = perm('x', 'Golem', 'Artifact Creature \u2014 Golem', '', { colors: [] });
    const c2 = 'Whenever you put one or more +1/+1 counters on another colorless creature, scry 1';
    expect(counterTargetSubjectMatches(c2, omar, golem)).toBe(true);
    expect(counterTargetSubjectMatches(c2, omar, omar)).toBe(false);
    expect(counterTargetSubjectMatches(c2, omar, { ...bear, card: { ...bear.card, colors: ['G'] } })).toBe(false);
  });
  it('getCounterPlacedTriggers ignores other permanents for a self-named watcher', () => {
    const ctx: any = { state: { battlefield: [aragorn, bear] } };
    const onBear = getCounterPlacedTriggers(ctx, bear, { '+1/+1': 1 }).filter((t: any) => t.cardName === aragorn.card.name);
    expect(onBear).toHaveLength(0);
  });
});

describe('round 23: reveal first draw this way', () => {
  const keranosText = "Reveal the first card you draw on each of your turns. Whenever you reveal a land card this way, draw a card. Whenever you reveal a nonland card this way, Keranos deals 3 damage to any target.";
  const keranos = perm('k', 'Keranos, God of Storms', 'Legendary Enchantment Creature \u2014 God', keranosText);
  const ctx: any = { state: { battlefield: [keranos], turnPlayer: 'p1', activePlayer: 'p1', zones: {} } };
  const reveals = (card: any, n = 1) => getCardDrawTriggers(ctx, 'p1', undefined, n, card).filter((t: any) => t.triggerType === 'reveal_this_way');
  it('land vs nonland on first draw', () => {
    const land = reveals({ type_line: 'Basic Land \u2014 Island' });
    expect(land).toHaveLength(1);
    expect(String(land[0].effect).toLowerCase()).toContain('draw a card');
    const spell = reveals({ type_line: 'Instant' });
    expect(spell).toHaveLength(1);
    expect(String(spell[0].effect).toLowerCase()).toContain('3 damage');
  });
  it('not on second draw or opponent turn', () => {
    expect(reveals({ type_line: 'Instant' }, 2)).toHaveLength(0);
    ctx.state.turnPlayer = 'p2'; ctx.state.activePlayer = 'p2';
    expect(reveals({ type_line: 'Instant' })).toHaveLength(0);
    ctx.state.turnPlayer = 'p1'; ctx.state.activePlayer = 'p1';
  });
  it('Primitive Etchings creature reveal', () => {
    const pe = perm('pe', 'Primitive Etchings', 'Enchantment', 'Reveal the first card you draw each turn. Whenever you reveal a creature card this way, draw a card.');
    const c2: any = { state: { battlefield: [pe], turnPlayer: 'p2', zones: {} } };
    const got = (card: any) => getCardDrawTriggers(c2, 'p1', undefined, 1, card).filter((t: any) => /reveal/.test(String(t.triggerType)));
    expect(got({ type_line: 'Creature \u2014 Elf' })).toHaveLength(1);
    expect(got({ type_line: 'Sorcery' })).toHaveLength(0);
  });
});

describe('round 23: Sword of Wealth and Power rider recovery', () => {
  it('recovers the next-cast rider from oracle text', () => {
    const oracle = 'Equipped creature gets +2/+2.\nWhenever equipped creature deals combat damage to a player, create a Treasure token. When you next cast an instant or sorcery spell this turn, copy that spell.';
    const text = findSourceNextCastRiderText(oracle, 'create a Treasure token');
    expect(String(text || '').toLowerCase()).toContain('when you next cast');
  });
});
