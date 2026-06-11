import type { PlayerID } from '../../../../shared/src/index.js';
import type { GameContext } from '../context.js';
import { debug } from '../../utils/debug.js';
import { createToken } from './counters_tokens.js';

export interface SpellLegacyTokenSpec {
  count: number;
  power: number;
  toughness: number;
  name: string;
  typeLine: string;
  colors?: string[];
}

/**
 * Parse token creation from spell oracle text
 * Handles patterns like:
 * - "Create two 1/1 blue Merfolk Wizard creature tokens"
 * - "Create X 2/2 green Wolf creature tokens"
 * - "Create a 3/3 green Beast creature token"
 *
 * @param xValue - Optional value of X for X spells like Secure the Wastes
 */
export function parseSpellLegacyTokenCreation(
  cardName: string,
  oracleTextLower: string,
  _controller: PlayerID,
  _state: any,
  xValue?: number,
): SpellLegacyTokenSpec | null {
  if (!oracleTextLower.includes('create') || !oracleTextLower.includes('token')) {
    return null;
  }

  if (oracleTextLower.includes('its controller creates')) {
    return null;
  }

  const nameLower = (cardName || '').toLowerCase();

  if (nameLower.includes('summon the school')) {
    return {
      count: 2,
      power: 1,
      toughness: 1,
      name: 'Merfolk Wizard',
      typeLine: 'Token Creature — Merfolk Wizard',
      colors: ['blue'],
    };
  }

  const tokenPatterns = [
    /create\s+(a|one|two|three|four|five|six|seven|eight|nine|ten|\d+|x)\s+(\d+)\/(\d+)\s+(\w+(?:\s+\w+)*)\s+creature\s+tokens?/i,
    /create\s+(a|one|two|three|four|five|six|seven|eight|nine|ten|\d+|x)\s+(\d+)\/(\d+)\s+(\w+)\s+(\w+)\s+creature\s+tokens?/i,
  ];

  for (const pattern of tokenPatterns) {
    const match = oracleTextLower.match(pattern);
    if (!match) continue;

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

    return {
      count,
      power,
      toughness,
      name: normalizedCreatureType || 'Token',
      typeLine: `Token Creature — ${normalizedCreatureType || 'Token'}`,
      colors: foundColors.length > 0 ? foundColors : undefined,
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
  });

  debug(2, `[createBeastToken] Created ${power}/${toughness} ${color || 'green'} ${name} token for ${controller}`);
}
