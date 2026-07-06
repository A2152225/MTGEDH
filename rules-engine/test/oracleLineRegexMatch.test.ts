import { describe, expect, it } from 'vitest';
import {
  findFirstRegexMatchAcrossOracleLines,
  globalizeLineRegexMatch,
  resolveGlobalTimingMatchIndex,
} from '../src/oracleLineRegexMatch';
import { extractTriggeredEffectFromTimingMatch } from '../src/triggerEffectTextExtraction';

describe('oracleLineRegexMatch', () => {
  it('globalizes line-local match.index for later lines', () => {
    const oracle =
      "During your turn, opponents can't cast spells.\nWhenever Myrel attacks, create X 1/1 colorless Soldier artifact creature tokens.";
    const line = 'Whenever Myrel attacks, create X 1/1 colorless Soldier artifact creature tokens.';
    const lineStart = oracle.indexOf(line);
    const lineMatch = line.match(/whenever myrel attacks,?\s*(.+)$/i);
    expect(lineMatch).not.toBeNull();
    expect(lineMatch!.index).toBe(0);

    const globalMatch = globalizeLineRegexMatch(oracle, line, lineStart, lineMatch!);
    expect(globalMatch.index).toBe(lineStart);

    const effect = extractTriggeredEffectFromTimingMatch(oracle, globalMatch);
    expect(effect.toLowerCase()).toContain('create x 1/1 colorless soldier');
    expect(effect.toLowerCase()).not.toContain("can't cast");
  });

  it('resolveGlobalTimingMatchIndex repairs forgotten line-local indices', () => {
    const oracle =
      "During your turn, opponents can't cast spells.\nWhenever Myrel attacks, create X 1/1 colorless Soldier artifact creature tokens.";
    const line = 'Whenever Myrel attacks, create X 1/1 colorless Soldier artifact creature tokens.';
    const lineMatch = line.match(/whenever myrel attacks,?\s*(.+)$/i);
    expect(lineMatch).not.toBeNull();

    const repairedIndex = resolveGlobalTimingMatchIndex(oracle, lineMatch!);
    expect(repairedIndex).toBe(oracle.toLowerCase().indexOf('whenever myrel attacks'));

    const effect = extractTriggeredEffectFromTimingMatch(oracle, lineMatch!);
    expect(effect.toLowerCase()).toContain('create x 1/1 colorless soldier');
    expect(effect.toLowerCase()).not.toContain('pponents');
  });

  it('findFirstRegexMatchAcrossOracleLines skips reminder lines and returns global index', () => {
    const oracle =
      'Melee\nWhenever Brimaz blocks a creature, create a 1/1 white Cat Soldier creature token.';
    const match = findFirstRegexMatchAcrossOracleLines(
      oracle,
      (line) => /^melee\b/i.test(line),
      [/whenever brimaz blocks a creature,?\s*(.+)$/i],
    );
    expect(match).not.toBeNull();
    expect(match!.index).toBe(oracle.toLowerCase().indexOf('whenever brimaz blocks'));

    const effect = extractTriggeredEffectFromTimingMatch(oracle, match!);
    expect(effect.toLowerCase()).toContain('create a 1/1 white cat soldier');
  });
});
