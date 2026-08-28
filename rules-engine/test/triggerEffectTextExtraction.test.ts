import { describe, expect, it } from 'vitest';
import {
  extractTriggerEffectAfterPrefix,
  extractTriggeredEffectFromTimingMatch,
  findTriggerEffectClauseMatchingFragment,
} from '../src/triggerEffectTextExtraction';

describe('triggerEffectTextExtraction', () => {
  it('captures Kynaios end-step effect beyond the first sentence', () => {
    const oracle =
      "At the beginning of your end step, draw a card. Each player may put a land card from their hand onto the battlefield, then each opponent who didn't draws a card.";
    const match = oracle.match(/at the beginning of your end step,?\s*([^.]+)/i);
    expect(match).not.toBeNull();

    const effect = extractTriggeredEffectFromTimingMatch(oracle, match!);
    expect(effect.toLowerCase()).toContain('draw a card');
    expect(effect.toLowerCase()).toContain('each player may put a land');
    expect(effect.toLowerCase()).toContain("each opponent who didn't");
  });

  it('stops before the next triggered ability on the same card', () => {
    const oracle =
      'When this creature enters, create a 0/1 white Goat creature token.\nWhenever you attack, draw a card.';
    const match = oracle.match(/when this creature enters(?: the battlefield)?,?\s*([^.]+)/i);
    expect(match).not.toBeNull();

    const effect = extractTriggeredEffectFromTimingMatch(oracle, match!);
    expect(effect.toLowerCase()).toBe('create a 0/1 white goat creature token.');
  });

  it('includes follow-up sentences on the same trigger', () => {
    const oracle = 'When this creature enters, create a token. You gain 1 life.';
    const match = oracle.match(/when this creature enters(?: the battlefield)?,?\s*([^.]+)/i);
    expect(match).not.toBeNull();

    const effect = extractTriggeredEffectFromTimingMatch(oracle, match!);
    expect(effect).toBe('create a token. You gain 1 life.');
  });

  it('truncates at activated-ability line boundaries', () => {
    const oracle =
      'When this creature enters, draw a card.\n{2}{B}: Each opponent loses 1 life.';
    const prefix = 'When this creature enters, ';
    const effect = extractTriggerEffectAfterPrefix(oracle, prefix.length);
    expect(effect).toBe('draw a card.');
  });

  it('truncates at keyword-cost activated lines (Waterbend)', () => {
    const oracle =
      "Whenever a creature you control deals combat damage to a player, put a quest counter on this enchantment. Then if it has four or more quest counters on it, draw a card.\nWaterbend {4}: Target creature can't be blocked this turn.";
    const prefix = 'Whenever a creature you control deals combat damage to a player, ';
    const effect = extractTriggerEffectAfterPrefix(oracle, prefix.length);
    expect(effect.toLowerCase()).toContain('put a quest counter');
    expect(effect.toLowerCase()).toContain('draw a card');
    expect(effect.toLowerCase()).not.toContain('waterbend');
    expect(effect.toLowerCase()).not.toContain("can't be blocked");
  });

  it('strips Escape suffix from extracted ETB effects', () => {
    const oracle =
      'When this creature enters, it deals 4 damage divided as you choose among any number of target creatures and/or planeswalkers. Escape—{3}{R}{R}, exile four other cards from your graveyard.';
    const match = oracle.match(/when this creature enters(?: the battlefield)?,?\s*([^.]+)/i);
    expect(match).not.toBeNull();

    const effect = extractTriggeredEffectFromTimingMatch(oracle, match!);
    expect(effect.toLowerCase()).toBe(
      'it deals 4 damage divided as you choose among any number of target creatures and/or planeswalkers.',
    );
  });

  it('keeps reflexive When you do on the same upkeep ability', () => {
    const oracle =
      'At the beginning of your upkeep, create a 2/1 white and black Inkling creature token with flying. When you do, return up to one target Aura or Equipment card from your graveyard to the battlefield attached to that token.';
    const match = oracle.match(/at the beginning of your upkeep,?\s*([^.]+)/i);
    expect(match).not.toBeNull();

    const effect = extractTriggeredEffectFromTimingMatch(oracle, match!);
    expect(effect.toLowerCase()).toContain('create a 2/1');
    expect(effect.toLowerCase()).toContain('inkling');
    expect(effect.toLowerCase()).toContain('when you do');
    expect(effect.toLowerCase()).toContain('aura or equipment');
    expect(effect.toLowerCase()).toContain('attached to that token');
  });

  it('stops Squad reminder ETB at the closing parenthesis, not the next ability', () => {
    const oracle =
      'Squad {1}{G} (As an additional cost to cast this spell, you may pay {1}{G} any number of times. When this creature enters, create that many tokens that are copies of it.)\nOther Elves you control get +1/+1.';
    const match = oracle.match(/when this creature enters(?: the battlefield)?,?\s*([^.]+)/i);
    expect(match).not.toBeNull();

    const effect = extractTriggeredEffectFromTimingMatch(oracle, match!);
    expect(effect.toLowerCase()).toBe('create that many tokens that are copies of it.');
    expect(effect.toLowerCase()).not.toContain('other elves');
  });

  it("keeps Andúril's city's-blessing instead sentence on the attack trigger", () => {
    const oracle =
      "Ascend (If you control ten or more permanents, you get the city's blessing for the rest of the game.)\nWhenever equipped creature attacks, put a +1/+1 counter on each creature you control. If you have the city's blessing, put two +1/+1 counters on each creature you control instead.\nEquip {3}";
    const match = oracle.match(/whenever (?:this creature or )?equipped creature attacks,?\s*([^\n]+)/i);
    expect(match).not.toBeNull();

    const effect = extractTriggeredEffectFromTimingMatch(oracle, match!);
    expect(effect.toLowerCase()).toContain('put a +1/+1 counter on each creature you control');
    expect(effect.toLowerCase()).toContain("if you have the city's blessing");
    expect(effect.toLowerCase()).toContain('put two +1/+1 counters');
    expect(effect.toLowerCase()).toContain('instead');
    expect(effect.toLowerCase()).not.toContain('equip');
  });
});
