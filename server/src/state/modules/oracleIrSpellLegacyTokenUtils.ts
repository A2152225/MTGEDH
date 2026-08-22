import type { PlayerID } from '../../../../shared/src/index.js';
import type { GameContext } from '../context.js';
import { debug } from '../../utils/debug.js';
import { extractCreateTokenGrantedAbilities } from '../../../../rules-engine/src/oracleReminderText.js';
import { createToken } from './counters_tokens.js';

export interface SpellLegacyTokenSpec {
  count: number;
  power: number;
  toughness: number;
  name: string;
  typeLine: string;
  colors?: string[];
  /** Matched create span (+ same-sentence with / follow-up It has sentences). */
  sourceText?: string;
  /** Abilities extracted from sourceText. */
  abilities?: string[];
}

const SPELL_LEGACY_FOLLOW_UP_PREFIX =
  /^(It(?:['\u2019]?s|\s+has|\s+is|\s+have)|They(?:['\u2019]?re|\s+have|\s+are|\s+has)|That\s+tokens?\s+(?:has|have|is|are)|Those\s+tokens\s+(?:have|are))\b/i;

/**
 * Capture the matched create span from raw oracle, including same-sentence `with …`
 * and immediate follow-up `It has` / `They are` / `That token has` sentences.
 */
function captureSpellLegacyCreateSourceText(
  oracleRaw: string,
  matchIndex: number,
  matchLength: number,
): string {
  const raw = String(oracleRaw || '');
  if (!raw || matchIndex < 0 || matchLength <= 0) return '';

  let end = Math.min(raw.length, matchIndex + matchLength);
  const rest = raw.slice(end);
  const sentenceEnd = rest.search(/[.?!]/);
  if (sentenceEnd >= 0) {
    end = end + sentenceEnd + 1;
  } else {
    const nl = rest.search(/\n/);
    end = nl >= 0 ? end + nl : raw.length;
  }

  let fragment = raw.slice(matchIndex, end).trim();
  let remainder = raw.slice(end).replace(/^\s+/, '');
  while (remainder) {
    if (!SPELL_LEGACY_FOLLOW_UP_PREFIX.test(remainder)) break;
    const followEnd = remainder.search(/[.?!]/);
    let followLen: number;
    if (followEnd >= 0) {
      followLen = followEnd + 1;
    } else {
      const nl = remainder.search(/\n/);
      followLen = nl >= 0 ? nl : remainder.length;
    }
    const follow = remainder.slice(0, followLen).trim();
    if (!follow) break;
    fragment = `${fragment} ${follow}`;
    remainder = remainder.slice(followLen).replace(/^\s+/, '');
  }
  return fragment;
}

/**
 * Parse token creation from spell oracle text
 * Handles patterns like:
 * - "Create two 1/1 blue Merfolk Wizard creature tokens"
 * - "Create X 2/2 green Wolf creature tokens"
 * - "Create a 3/3 green Beast creature token"
 *
 * @param xValue - Optional value of X for X spells like Secure the Wastes
 * @param oracleTextRaw - Optional original (cased) oracle; preferred for sourceText capture
 */
export function parseSpellLegacyTokenCreation(
  cardName: string,
  oracleTextLower: string,
  _controller: PlayerID,
  _state: any,
  xValue?: number,
  oracleTextRaw?: string,
): SpellLegacyTokenSpec | null {
  if (!oracleTextLower.includes('create') || !oracleTextLower.includes('token')) {
    return null;
  }

  if (oracleTextLower.includes('its controller creates')) {
    return null;
  }

  const tokenPatterns = [
    /create\s+(a|one|two|three|four|five|six|seven|eight|nine|ten|\d+|x)\s+(\d+)\/(\d+)\s+(\w+(?:\s+\w+)*)\s+creature\s+tokens?/i,
    /create\s+(a|one|two|three|four|five|six|seven|eight|nine|ten|\d+|x)\s+(\d+)\/(\d+)\s+(\w+)\s+(\w+)\s+creature\s+tokens?/i,
  ];

  const rawOracle = String(oracleTextRaw || oracleTextLower || '');

  for (const pattern of tokenPatterns) {
    const match = oracleTextLower.match(pattern);
    if (!match || match.index == null) continue;

    // Prefer a case-preserving match from the raw oracle when available.
    const rawMatch = rawOracle.match(pattern);
    const matchIndex = rawMatch && rawMatch.index != null ? rawMatch.index : match.index;
    const matchLength = rawMatch ? rawMatch[0].length : match[0].length;

    const countWord = match[1].toLowerCase();
    let count = 1;

    const wordToNumber: Record<string, number> = {
      a: 1, one: 1, two: 2, three: 3, four: 4, five: 5,
      six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
    };

    if (wordToNumber[countWord]) {
      count = wordToNumber[countWord];
    } else if (/^\d+$/.test(countWord)) {
      count = parseInt(countWord, 10);
    } else if (countWord === 'x') {
      count = xValue !== undefined && xValue >= 0 ? xValue : 1;
    }

    const power = parseInt(match[2], 10);
    const toughness = parseInt(match[3], 10);
    const typeInfo = match[4];

    const colorNames = ['white', 'blue', 'black', 'red', 'green'];
    const foundColors: string[] = [];
    let creatureType = typeInfo;

    for (const color of colorNames) {
      if (typeInfo.toLowerCase().includes(color)) {
        foundColors.push(color);
        creatureType = creatureType.replace(new RegExp(color, 'gi'), '').trim();
      }
    }

    if (typeInfo.toLowerCase().includes('colorless')) {
      creatureType = creatureType.replace(/colorless/gi, '').trim();
    }

    const normalizedCreatureType = creatureType
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join(' ');

    const sourceText = captureSpellLegacyCreateSourceText(rawOracle, matchIndex, matchLength);
    const abilities = sourceText ? extractCreateTokenGrantedAbilities(sourceText) : [];

    return {
      count,
      power,
      toughness,
      name: normalizedCreatureType || 'Token',
      typeLine: `Token Creature — ${normalizedCreatureType || 'Token'}`,
      colors: foundColors.length > 0 ? foundColors : undefined,
      ...(sourceText ? { sourceText } : {}),
      ...(abilities.length > 0 ? { abilities } : {}),
    };
  }

  return null;
}

export function createSpellLegacyTokenFromSpec(
  ctx: GameContext,
  controller: PlayerID,
  spec: SpellLegacyTokenSpec,
): void {
  createToken(
    ctx as any,
    controller,
    spec.name,
    spec.count,
    spec.power,
    spec.toughness,
    {
      colors: spec.colors,
      typeLine: spec.typeLine,
      ...(spec.sourceText ? { sourceText: spec.sourceText } : {}),
      ...(spec.abilities && spec.abilities.length > 0 ? { abilities: spec.abilities } : {}),
    },
  );
}

export function createBeastToken(
  ctx: GameContext,
  controller: PlayerID,
  name: string,
  power: number,
  toughness: number,
  color?: string,
  options?: { sourceText?: string; sourceOracleText?: string },
): void {
  const creatureType = name.replace(/\s*Token\s*/i, '').trim() || 'Beast';
  const typeLine = `Token Creature — ${creatureType}`;

  const colorMap: Record<string, string> = {
    white: 'W',
    w: 'W',
    blue: 'U',
    u: 'U',
    black: 'B',
    b: 'B',
    red: 'R',
    r: 'R',
    green: 'G',
    g: 'G',
    colorless: 'C',
    c: 'C',
  };
  const lowerColor = (color || 'green').toLowerCase();
  const colorLetter = colorMap[lowerColor] || colorMap[lowerColor.charAt(0)] || 'G';

  createToken(ctx as any, controller, name, 1, power, toughness, {
    colors: [colorLetter],
    typeLine,
    ...(options?.sourceText ? { sourceText: options.sourceText } : {}),
    ...(options?.sourceOracleText ? { sourceOracleText: options.sourceOracleText } : {}),
  });

  debug(2, `[createBeastToken] Created ${power}/${toughness} ${color || 'green'} ${name} token for ${controller}`);
}
