import { describe, expect, it } from 'vitest';
import { AbilityType, parseOracleText } from '../src/oracleTextParser';
import { parseOracleTextToIR } from '../src/oracleIRParser';
import { collectSpellResolutionEffectStepsWithOverlay } from '../src/oracleIRCompilerEnvelope';

describe('Threshold / Delirium instead IR fold', () => {
  it('folds Cabal Ritual threshold into conditional with elseSteps', () => {
    const text =
      'Add {B}{B}{B}.\nThreshold — Add {B}{B}{B}{B}{B} instead if there are seven or more cards in your graveyard.';
    const ir = parseOracleTextToIR(text, 'Cabal Ritual');
    const collected = collectSpellResolutionEffectStepsWithOverlay(text, 'Cabal Ritual');
    expect(collected.some((s) => s.kind === 'conditional')).toBe(true);
    const conditional = collected.find((s) => s.kind === 'conditional') as any;
    expect(String(conditional?.condition?.raw || '')).toMatch(/seven or more cards in your graveyard/i);
    expect(Array.isArray(conditional?.elseSteps) && conditional.elseSteps.length > 0).toBe(true);
    expect(conditional?.steps?.some((s: any) => s.kind === 'add_mana')).toBe(true);
    // Must not leave a free-floating base add_mana sibling that always fires.
    const topLevelAddMana = collected.filter((s) => s.kind === 'add_mana');
    expect(topLevelAddMana).toHaveLength(0);
  });

  it('keeps Traverse the Ulvenwald delirium search gated', () => {
    const text =
      'Search your library for a basic land card, reveal it, put it into your hand, then shuffle.\nDelirium — If there are four or more card types among cards in your graveyard, instead search your library for a creature or land card, reveal it, put it into your hand, then shuffle.';
    const collected = collectSpellResolutionEffectStepsWithOverlay(text, 'Traverse the Ulvenwald');
    const searches = collected.filter((s) => s.kind === 'search_library');
    const conditionals = collected.filter((s) => s.kind === 'conditional');
    expect(conditionals.length).toBeGreaterThanOrEqual(1);
    const conditional = conditionals[0] as any;
    expect(String(conditional?.condition?.raw || '')).toMatch(/four or more card types/i);
    expect(Array.isArray(conditional?.elseSteps) && conditional.elseSteps.some((s: any) => s.kind === 'search_library')).toBe(
      true
    );
    // No second ungated search at top level.
    expect(searches).toHaveLength(0);
  });

  it('keeps Whispers of Emrakul discard count gated', () => {
    const text =
      'Target opponent discards a card at random.\nDelirium — If there are four or more card types among cards in your graveyard, that player discards two cards at random instead.';
    const collected = collectSpellResolutionEffectStepsWithOverlay(text, 'Whispers of Emrakul');
    expect(collected.some((s) => s.kind === 'conditional')).toBe(true);
    const conditional = collected.find((s) => s.kind === 'conditional') as any;
    expect(conditional?.steps?.some((s: any) => s.kind === 'discard')).toBe(true);
    expect(Array.isArray(conditional?.elseSteps) && conditional.elseSteps.some((s: any) => s.kind === 'discard')).toBe(
      true
    );
    expect(collected.every((s) => s.kind !== 'grant_static_ability' || !/pass26/i.test(String((s as any).raw || '')))).toBe(
      true
    );
  });

  it('keeps Grim Flayer continuous Delirium typed STATIC', () => {
    const text =
      'Trample\nWhenever this creature deals combat damage to a player, surveil 3.\nDelirium — This creature gets +2/+2 as long as there are four or more card types among cards in your graveyard.';
    const parsed = parseOracleText(text, 'Grim Flayer');
    const delirium = parsed.abilities.find((a) => /delirium/i.test(String(a.text || '')));
    expect(delirium?.type).toBe(AbilityType.STATIC);
  });
});
