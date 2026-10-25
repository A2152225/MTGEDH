import { describe, expect, it } from 'vitest';
import { getPermanentRulesStatusChips, conditionalPtBonusLines, displayTypeLine } from '../src/components/PermanentRulesStatusBadges';
import { buildPTTooltip } from '../src/components/FreeField-handlers/freeFieldDisplayUtils';
import { readPlayerRadCounters } from '../src/utils/playerRadCounters';
import { createStateEventTracker, collectStateEventToasts } from '../src/utils/stateEventToasts';
import { isCurrentlyCreature } from '../src/utils/creatureUtils';

const moonHost = { id: 'c1', notCreature: true, card: { name: 'Bear', type_line: 'Creature \u2014 Bear' },
  rulesStatus: { typeOverride: { typeLine: 'Land', colorless: true, isCreature: false, sourceName: 'Imprisoned in the Moon' } } };

describe('type override / conditional P/T / rad / damage replacement UI', () => {
  it('type-set host shows override type line chip and is not a creature', () => {
    const chip = getPermanentRulesStatusChips(moonHost).find((c) => c.key === 'typeset')!;
    expect(chip.label).toContain('Land');
    expect(chip.title).toMatch(/Imprisoned in the Moon.*Land, colorless.*not a creature/);
    expect(displayTypeLine(moonHost)).toBe('Land');
    expect(isCurrentlyCreature(moonHost as any)).toBe(false);
  });
  it('Imprisoned + later Ensoul shows Land Creature with P/T, colourless, struck abilities', () => {
    const p: any = { id: 'h', isCreature: true, effectivePower: 5, effectiveToughness: 5,
      card: { name: 'Thalia', type_line: 'Legendary Creature \u2014 Human', oracle_text: 'First strike' },
      rulesStatus: { abilitiesLost: true, typeOverride: { typeLine: 'Legendary Land Creature', colorless: true, isCreature: true } } };
    const chip = getPermanentRulesStatusChips(p).find((c) => c.key === 'typeset')!;
    expect(chip.label).toBe('\u21BB Legendary Land Creature 5/5 \u25C7');
    expect(chip.title).toContain('colorless');
    expect(chip.title).toContain('Abilities removed:\nF\u0336i\u0336');
    expect(isCurrentlyCreature(p)).toBe(true);
  });
  it('shows Otherwise bonuses with their condition', () => {
    const lines = conditionalPtBonusLines({ rulesStatus: { conditionalPtBonuses: [
      { sourceName: "Serra's Boon", power: 1, toughness: 2, active: false, condition: "it's white" },
      { sourceName: "Serra's Boon", power: -2, toughness: -1, active: true, condition: "it's white", otherwise: true }] } });
    expect(lines).toEqual(["Serra's Boon: +1/+2 while it's white (inactive)", "Serra's Boon: -2/-1 otherwise (unless it's white) (active)"]);
  });
  it('Ensoul host gets a creature chip and counts as a creature', () => {
    const p: any = { id: 'r', isCreature: true, card: { name: 'Sol Ring', type_line: 'Artifact' }, rulesStatus: { animatedByAttachment: true } };
    expect(getPermanentRulesStatusChips(p).some((c) => c.key === 'animated')).toBe(true);
    expect(isCurrentlyCreature(p)).toBe(true);
  });
  it('P/T tooltip lists conditional bonuses with active markers', () => {
    const p = { rulesStatus: { conditionalPtBonuses: [
      { sourceName: 'Black Scarab', power: 2, toughness: 2, active: false },
      { sourceName: 'Twisted Embrace', power: 1, toughness: 1, active: true }] } };
    const lines = conditionalPtBonusLines(p);
    expect(lines[0]).toMatch(/^Black Scarab: \+2\/\+2 \(inactive/);
    expect(lines[1]).toBe('Twisted Embrace: +1/+1 (active)');
    const tip = buildPTTooltip({ baseP: 2, baseT: 2, plusCounters: 0, minusCounters: 0, conditionalLines: lines })!;
    expect(tip).toContain('Conditional:');
    expect(tip).toContain('Twisted Embrace: +1/+1 (active)');
    const withSrc = buildPTTooltip({ baseP: 2, baseT: 2, plusCounters: 0, minusCounters: 0, conditionalLines: lines,
      ptSources: [{ name: 'Twisted Embrace', power: 1, toughness: 1 }, { name: 'Anthem', power: 1, toughness: 1 }] })!;
    expect(withSrc.split('Twisted Embrace').length - 1).toBe(1);
    expect(withSrc).toContain('Anthem: +1/+1');
  });
  it('reads rad counters from any server field', () => {
    expect(readPlayerRadCounters({ id: 'p1', counters: { rad: 3 } })).toBe(3);
    expect(readPlayerRadCounters({ id: 'p1', radCounters: 2 })).toBe(2);
    expect(readPlayerRadCounters({ id: 'p1' }, { radCounters: { p1: 4 } })).toBe(4);
    expect(readPlayerRadCounters({ id: 'p1' })).toBe(0);
  });
  it('toasts Stranglehold skips and draw replacements', () => {
    const tr = createStateEventTracker();
    const players = [{ id: 'p1', name: 'Alice' }, { id: 'p2', name: 'Bob' }];
    const base: any = { id: 'g2', players, skippedExtraTurns: [], batch18DrawReplacements: [] };
    expect(collectStateEventToasts(tr, base)).toEqual([]);
    const next = { ...base, skippedExtraTurns: [{ playerId: 'p2', sourceName: 'Stranglehold', timestamp: 3 }],
      batch18DrawReplacements: [{ playerId: 'p1', sourceName: 'Ormos, Archive Keeper', effect: 'put 1 +1/+1 counter(s) instead of drawing', timestamp: 4 }] };
    expect(collectStateEventToasts(tr, next)).toEqual([
      "Bob's extra turn was skipped (Stranglehold).",
      'Alice (Ormos, Archive Keeper): put 1 +1/+1 counter(s) instead of drawing.',
    ]);
    expect(collectStateEventToasts(tr, next)).toEqual([]);
  });
  it('toasts damage side-effect modifier messages', () => {
    const tr = createStateEventTracker();
    const base: any = { id: 'g3', players: [], damageReplacementLog: [] };
    collectStateEventToasts(tr, base);
    const next = { ...base, damageReplacementLog: [{ messages: ['Vigor: prevented 3 noncombat damage', 'put 3 +1/+1 counters'], timestamp: 9 }] };
    expect(collectStateEventToasts(tr, next)).toEqual(['Damage replaced \u2014 Vigor: prevented 3 noncombat damage; put 3 +1/+1 counters']);
  });
  it('toasts new damage replacement log entries (seeded silently)', () => {
    const tr = createStateEventTracker();
    const base: any = { id: 'g', players: [], damageReplacementLog: [{ messages: ['old'], timestamp: 1 }] };
    expect(collectStateEventToasts(tr, base)).toEqual([]);
    const next = { ...base, damageReplacementLog: [...base.damageReplacementLog, { messages: ['Furnace of Rath: doubled (2 -> 4)'], timestamp: 2 }] };
    expect(collectStateEventToasts(tr, next)).toEqual(['Damage replaced \u2014 Furnace of Rath: doubled (2 -> 4)']);
  });
});