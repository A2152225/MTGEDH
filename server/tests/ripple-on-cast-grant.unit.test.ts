import { afterEach, describe, expect, it } from 'vitest';
import { resolveOnCastSpellTriggerDescriptions } from '../src/state/modules/onCastSpellTriggerUtils.js';
import { applyStackRippleTrigger, parseRippleOnCastEffect } from '../src/state/modules/rippleTrigger.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';

const THRUMMING = 'Spells you cast have ripple 4. (Whenever you cast a spell, you may reveal the top four cards of your library. You may cast spells with the same name as that spell from among the revealed cards without paying their mana costs. Put the rest on the bottom of your library.)';
const PRINTED = 'Surging Flame deals 2 damage to any target.\nRipple 4 (When you cast this spell, you may reveal the top four cards of your library. You may cast spells with the same name as this spell from among the revealed cards without paying their mana costs. Put the rest on the bottom of your library in any order.)';
const stone = { id: 'ts', controller: 'p1', owner: 'p1', card: { name: 'Thrumming Stone', type_line: 'Legendary Artifact', oracle_text: THRUMMING } };
const GAME = 'ripple_t1';

afterEach(() => ResolutionQueueManager.removeQueue(GAME));

describe('ripple on cast (Thrumming Stone grant and printed)', () => {
  const bolt = { id: 'b1', name: 'Lightning Bolt', type_line: 'Instant', oracle_text: 'Lightning Bolt deals 3 damage to any target.' };

  it('a granted ripple 4 adds an on-cast ripple trigger the card does not print', () => {
    const state: any = { battlefield: [stone] };
    expect(resolveOnCastSpellTriggerDescriptions(bolt)).toEqual([]);
    const granted = resolveOnCastSpellTriggerDescriptions(bolt, { state, playerId: 'p1' });
    expect(granted).toHaveLength(1);
    expect(parseRippleOnCastEffect(granted[0].effect)).toBe(4);
    // Opponent's spells are not granted ripple.
    expect(resolveOnCastSpellTriggerDescriptions(bolt, { state, playerId: 'p2' })).toEqual([]);
  });

  it('printed ripple parses to the same N, and a printed + granted spell triggers twice', () => {
    const flame = { id: 'f1', name: 'Surging Flame', type_line: 'Instant', oracle_text: PRINTED };
    const printed = resolveOnCastSpellTriggerDescriptions(flame);
    expect(printed.map((t) => parseRippleOnCastEffect(t.effect))).toEqual([4]);
    const both = resolveOnCastSpellTriggerDescriptions(flame, { state: { battlefield: [stone] }, playerId: 'p1' });
    expect(both.map((t) => parseRippleOnCastEffect(t.effect))).toEqual([4, 4]);
  });

  const lib = (...names: string[]) => names.map((name, i) => ({ id: `c${i}`, name, type_line: 'Instant', zone: 'library' }));
  const resolve = (library: any[], spellName = 'Lightning Bolt', count = 4) => {
    const ctx: any = { gameId: GAME, isReplaying: false, libraries: new Map([['p1', library]]), state: {} };
    const handled = applyStackRippleTrigger({ ctx, controller: 'p1', sourceName: spellName, triggerItem: { triggerType: 'ripple', effectData: { rippleCount: count, triggeringSpell: { name: spellName } } } });
    return { handled, steps: ResolutionQueueManager.getQueue(GAME).steps as any[] };
  };

  it('resolution prompts a free cast for each same-name card among the top N and bottoms the rest after the last', () => {
    const { handled, steps } = resolve(lib('Island', 'Lightning Bolt', 'Mountain', 'Lightning Bolt', 'Swamp'));
    expect(handled).toBe(true);
    expect(steps).toHaveLength(2);
    expect(steps.every((s) => s.castRevealedFromLibraryChoice === true && s.options.some((o: any) => o.id === 'cast'))).toBe(true);
    expect(steps[0].castRevealedFromLibraryCard.name).toBe('Lightning Bolt');
    expect(steps[0].castRevealedFromLibraryOtherCards).toEqual([]);
    expect(steps[1].castRevealedFromLibraryOtherCards.map((c: any) => c.name)).toEqual(['Island', 'Mountain']);
  });

  it('with no same-name card the revealed cards still go to the bottom; only the top N are revealed', () => {
    const { steps } = resolve(lib('Island', 'Mountain', 'Swamp', 'Forest', 'Lightning Bolt'));
    expect(steps).toHaveLength(1);
    expect(steps[0].options.map((o: any) => o.id)).toEqual(['decline']);
    expect([steps[0].castRevealedFromLibraryCard, ...steps[0].castRevealedFromLibraryOtherCards].map((c: any) => c.name)).toEqual(['Island', 'Mountain', 'Swamp', 'Forest']);
  });

  it('ignores non-ripple triggers and replay', () => {
    const ctx: any = { gameId: GAME, isReplaying: true, libraries: new Map([['p1', lib('Lightning Bolt')]]), state: {} };
    expect(applyStackRippleTrigger({ ctx, controller: 'p1', sourceName: 'x', triggerItem: { triggerType: 'etb' } })).toBe(false);
    expect(applyStackRippleTrigger({ ctx, controller: 'p1', sourceName: 'x', triggerItem: { triggerType: 'ripple', effectData: { rippleCount: 4, triggeringSpell: { name: 'Lightning Bolt' } } } })).toBe(true);
    expect(ResolutionQueueManager.getQueue(GAME).steps).toHaveLength(0);
  });
});