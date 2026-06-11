import { describe, expect, it } from 'vitest';
import {
  extractTriggerEffectAfterPrefix,
  extractTriggeredEffectFromTimingMatch,
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
});
