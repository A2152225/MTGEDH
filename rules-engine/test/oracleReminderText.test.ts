import { describe, expect, it } from 'vitest';
import {
  isStandardOracleFragmentOnly,
  normalizeGameplayEffectText,
  normalizeOracleForGameplay,
  normalizeOracleForParsing,
  stripKeywordAbilitySuffixes,
  stripReminderParentheticals,
  stripStandardOracleFragments,
  stripTokenTypeReminders,
} from '../src/oracleReminderText';

describe('oracleReminderText', () => {
  it('strips Escape em-dash suffix from ETB gameplay text', () => {
    const text =
      "It deals 4 damage divided as you choose among any number of target creatures and/or planeswalkers. Escape—{3}{R}{R}, exile four other cards from your graveyard.";
    expect(normalizeGameplayEffectText(text).toLowerCase()).toBe(
      'it deals 4 damage divided as you choose among any number of target creatures and/or planeswalkers.',
    );
  });

  it('strips Evoke and Eternalize suffixes', () => {
    const text =
      'You gain life equal to its power. Eternalize—{2}{W}{W}, Discard a card.';
    expect(normalizeGameplayEffectText(text).toLowerCase()).toBe('you gain life equal to its power.');
  });

  it('strips flying reminder parentheticals but keeps gameplay parens', () => {
    const withReminder = 'Flying (This creature can\'t be blocked except by creatures with flying.)';
    expect(stripReminderParentheticals(withReminder).toLowerCase()).toBe('flying');

    const saga = '(As this Saga enters and after your draw step, add a lore counter.) At the beginning of your upkeep, draw a card.';
    expect(stripReminderParentheticals(saga)).toContain('As this Saga enters');
  });

  it('strips Food token type reminders', () => {
    const text =
      'Create a Food token. (It\'s an artifact with "{2}, {T}, Sacrifice this token: You gain 3 life.")';
    expect(stripTokenTypeReminders(text)).toBe('Create a Food token.');
  });

  it('preserves multi-sentence gameplay continuations', () => {
    const text =
      'You may sacrifice a nontoken creature. If you do, draw X cards, then mill X cards, where X is that creature\'s mana value.';
    expect(normalizeGameplayEffectText(text).toLowerCase()).toContain('if you do');
    expect(normalizeGameplayEffectText(text).toLowerCase()).toContain('mill x cards');
  });

  it('strips equip activation tails from attack triggers', () => {
    const text =
      'Put a +1/+1 counter on target attacking creature with lesser power. (Target creatures with power less than this creature\'s power.)';
    const normalized = normalizeGameplayEffectText(text);
    expect(normalized.toLowerCase()).toContain('put a +1/+1 counter');
    expect(normalized.toLowerCase()).not.toContain('less than this creature');
  });

  it('stripKeywordAbilitySuffixes handles Craft blocks', () => {
    const text =
      'Tap up to one target artifact or creature and put two stun counters on it. Craft with artifact {2}{U} ({2}{U}, Exile this artifact, return it transformed.)';
    const stripped = stripKeywordAbilitySuffixes(text);
    expect(stripped.toLowerCase()).toBe(
      'tap up to one target artifact or creature and put two stun counters on it',
    );
  });

  it('preserves standalone support keyword actions as gameplay effects', () => {
    expect(normalizeGameplayEffectText('support 2').toLowerCase()).toBe('support 2.');
    expect(normalizeGameplayEffectText('Support 6.').toLowerCase()).toBe('support 6.');
    expect(stripKeywordAbilitySuffixes('fabricate 3')).toBe('fabricate 3');
    expect(normalizeGameplayEffectText('explore-clash').toLowerCase()).toBe('explore-clash.');
    expect(normalizeGameplayEffectText(
      'explore-clash. If you win the explore-clash, gain 3 life.',
    ).toLowerCase()).toBe('explore-clash. if you win the explore-clash, gain 3 life.');
  });

  it('strips Room DFC modal footers from unlock-door effects', () => {
    const text =
      'When you unlock this door, this Room deals 6 damage to target creature an opponent controls. You may cast either half. That door unlocks on the battlefield.';
    expect(normalizeGameplayEffectText(text).toLowerCase()).toBe(
      'when you unlock this door, this room deals 6 damage to target creature an opponent controls.',
    );
  });

  it('recognizes standalone Room and Siege boilerplate lines', () => {
    expect(isStandardOracleFragmentOnly('You may cast either half.')).toBe(true);
    expect(isStandardOracleFragmentOnly('That door unlocks on the battlefield.')).toBe(true);
    expect(
      isStandardOracleFragmentOnly(
        "(As a Siege enters, choose an opponent to protect it. You and others can attack it. When it's defeated, exalt its controller and they draw cards equal to its defense.)",
      ),
    ).toBe(true);
    expect(isStandardOracleFragmentOnly('When you unlock this door, draw a card.')).toBe(false);
  });

  it('strips Siege intro parentheticals from mixed effect text', () => {
    const text =
      "Draw a card. (As a Siege enters, choose an opponent to protect it. You and others can attack it. When it's defeated, exalt its controller and they draw cards equal to its defense.)";
    expect(stripStandardOracleFragments(text).toLowerCase()).toBe('draw a card.');
    expect(stripReminderParentheticals(text).toLowerCase()).toBe('draw a card.');
  });

  it('strips craft transform footers without removing gameplay text', () => {
    const text =
      'Scry 2, then draw a card. Return this card transformed under its owner\'s control. Craft only as a sorcery.';
    expect(stripStandardOracleFragments(text).toLowerCase()).toBe('scry 2, then draw a card.');
  });

  it('normalizeOracleForParsing preserves keyword costs while stripping reminders', () => {
    const oracle = [
      'Flying (This creature can\'t be blocked except by creatures with flying.)',
      'Fortify {3}',
      'You may cast either half.',
    ].join('\n');
    expect(normalizeOracleForParsing(oracle)).toBe('Flying\nFortify {3}');
  });

  it('normalizeOracleForParsing preserves cycling while stripping its reminder', () => {
    const oracle =
      'When you cycle this card and when this creature dies, you may exile target card from a graveyard.\n'
      + 'Cycling {2}{B} (Discard this card: Draw a card.)';
    expect(normalizeOracleForParsing(oracle)).toBe(
      'When you cycle this card and when this creature dies, you may exile target card from a graveyard.\nCycling {2}{B}',
    );
  });

  it('normalizeOracleForParsing preserves Station ability parens with inline threshold reminder', () => {
    const oracle =
      "Station (Tap another creature you control: Put charge counters equal to its power on this Spacecraft. Station only as a sorcery. It's an artifact creature at 12+.)";
    expect(normalizeOracleForParsing(oracle)).toBe(oracle);
  });

  it('normalizeOracleForGameplay drops boilerplate-only lines', () => {
    const oracle = [
      'When you unlock this door, destroy target creature.',
      'You may cast either half.',
      'That door unlocks on the battlefield.',
    ].join('\n');
    expect(normalizeOracleForGameplay(oracle).toLowerCase()).toBe(
      'when you unlock this door, destroy target creature.',
    );
  });
});
