import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseOracleTextToIR } from '../src/oracleIRParserParseOracleTextToIR.js';
import {
  COMPREHENSIVE_RULES_KEYWORD_ABILITIES,
  COMPREHENSIVE_RULES_KEYWORD_ACTIONS,
  isComprehensiveRulesKeywordAbility,
  isGrantableKeywordAbility,
} from '../src/comprehensiveRulesKeywordAbilities.js';
import { parseTriggerClause } from '../src/triggerCondition/index.js';

const rulesPath = join(dirname(fileURLToPath(import.meta.url)), '../../MagicCompRules 20261106.txt');

function namesForHeading(title: string): string[] {
  if (title === '∞ (Infinity)') return ['infinity'];
  const halves = title.split(/\s+and\s+/i);
  if (halves.length === 2 && halves.every((part) => part.split(/\s+/).length <= 2)) {
    return halves.map((part) => part.toLowerCase());
  }
  return [title.toLowerCase()];
}

function headings(section: '701' | '702'): string[] {
  const text = readFileSync(rulesPath, 'utf8');
  const titles: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const heading = new RegExp(`^${section}\\.(\\d+)\\. (.+)$`).exec(line.trim());
    if (!heading || heading[1] === '1') continue;
    const title = heading[2].trim();
    if (title.length > 48 || /[.?!]/.test(title)) continue;
    titles.push(title);
  }
  return [...new Set(titles)];
}

describe('Comprehensive Rules 2026-11-06 keywords', () => {
  it('accounts for every section 702 keyword ability and every section 701 keyword action', () => {
    const abilityNames = headings('702').flatMap(namesForHeading);
    const actionNames = headings('701').flatMap(namesForHeading);
    const abilities = new Set(COMPREHENSIVE_RULES_KEYWORD_ABILITIES);
    const actions = new Set(COMPREHENSIVE_RULES_KEYWORD_ACTIONS);
    expect(abilityNames.filter((name) => !abilities.has(name))).toEqual([]);
    expect(actionNames.filter((name) => !actions.has(name))).toEqual([]);
    expect(isComprehensiveRulesKeywordAbility('skulk')).toBe(true);
    expect(isGrantableKeywordAbility('annihilator 2')).toBe(true);
    expect(isGrantableKeywordAbility('islandwalk')).toBe(true);
  });

  it('grants skulk as a keyword ability and matches a creature that has it', () => {
    const ir = parseOracleTextToIR(
      "Target creature an opponent controls with power less than or equal to this permanent's power gains skulk until end of turn.",
      'The Master, Mesmerist',
    );
    const grant = ir.abilities?.[0]?.steps?.[0] as { kind?: string; abilities?: string[]; effectText?: string[] };
    expect(grant.kind).toBe('grant_temporary_ability');
    expect(grant.abilities).toEqual(['skulk']);
    expect(grant.effectText).toBeUndefined();

    const parsed = parseTriggerClause('Whenever a creature with skulk deals combat damage to a player, draw a card.');
    expect(parsed?.condition.alternatives[0].subject.keywordsWith).toEqual(['skulk']);
    const wither = parseTriggerClause('Whenever a creature with wither dies, draw a card.');
    expect(wither?.condition.alternatives[0].subject.keywordsWith).toEqual(['wither']);
  });
});
