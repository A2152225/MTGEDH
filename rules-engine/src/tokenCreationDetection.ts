import type { BattlefieldPermanent, PlayerID, KnownCardRef } from '../../shared/src';
import type {
  ETBTriggerInfo,
  TokenCharacteristics,
  TokenTriggerInfo,
} from './tokenCreationTypes';

function extractQuotedTokenAbilities(text: string): { readonly descriptor: string; readonly quotedAbilities: readonly string[] } {
  const quotedAbilities: string[] = [];
  for (const match of String(text || '').matchAll(/\bwith\s+"([^"]+)"/gi)) {
    const ability = String(match[1] || '').trim();
    if (ability) quotedAbilities.push(ability);
  }
  const descriptor = String(text || '')
    .replace(/\s*,?\s*with\s+"[^"]+"/gi, '')
    .trim();
  return { descriptor, quotedAbilities };
}

function mergeTokenCharacteristics(
  primary: TokenCharacteristics,
  fallback: TokenCharacteristics | null | undefined,
  quotedAbilities: readonly string[],
): TokenCharacteristics {
  let merged = primary;
  if (
    fallback
    && fallback.types.includes('Creature')
    && !merged.types.includes('Creature')
  ) {
    merged = {
      ...merged,
      types: Array.from(new Set([...merged.types, ...fallback.types])),
    };
  }
  if (quotedAbilities.length === 0) return merged;
  const abilities = Array.from(new Set([...(merged.abilities || []), ...quotedAbilities]));
  return { ...merged, abilities };
}

/**
 * Parse token creation from oracle text.
 * Returns token characteristics and count if the text describes token creation.
 */
export function parseTokenCreationFromText(
  oracleText: string
): { characteristics: TokenCharacteristics; count: number } | null {
  const { descriptor, quotedAbilities } = extractQuotedTokenAbilities(oracleText);
  const lowerText = descriptor.toLowerCase();
  const wordCounts: Record<string, number> = {
    a: 1,
    an: 1,
    one: 1,
    two: 2,
    three: 3,
    four: 4,
    five: 5,
    six: 6,
    seven: 7,
    eight: 8,
    nine: 9,
    ten: 10,
    eleven: 11,
    twelve: 12,
    thirteen: 13,
    fourteen: 14,
    fifteen: 15,
    sixteen: 16,
    seventeen: 17,
    eighteen: 18,
    nineteen: 19,
    twenty: 20,
  };

  const createMatch = lowerText.match(
    /creates?\s+(twice\s+x|x|a\s+number\s+of|a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|\d+)\s+(\d+\/\d+)?\s*([a-z,\s]+?)(?:\s+(artifact|creature|enchantment|land))?(?:\s+tokens?)?/i
  );

  if (!createMatch) return null;

  const countRaw = String(createMatch[1] || 'a').trim().toLowerCase();
  const count = /^\d+$/.test(countRaw) ? parseInt(countRaw, 10) : (wordCounts[countRaw] || 1);
  const ptMatch = createMatch[2]?.match(/(\d+)\/(\d+)/);
  const power = ptMatch ? parseInt(ptMatch[1], 10) : undefined;
  const toughness = ptMatch ? parseInt(ptMatch[2], 10) : undefined;
  const descriptors = createMatch[3]?.trim() || '';
  const mainType = createMatch[4]?.trim() || '';

  const colors: string[] = [];
  if (lowerText.includes('white')) colors.push('W');
  if (lowerText.includes('blue')) colors.push('U');
  if (lowerText.includes('black')) colors.push('B');
  if (lowerText.includes('red')) colors.push('R');
  if (lowerText.includes('green')) colors.push('G');

  const types: string[] = [];
  if (mainType.includes('artifact') || descriptors.includes('artifact') || /\bartifact\b/.test(lowerText)) {
    types.push('Artifact');
  }
  if (mainType.includes('creature') || power !== undefined || /\bcreature\b/.test(lowerText)) {
    types.push('Creature');
  }
  if (mainType.includes('enchantment') || descriptors.includes('enchantment') || /\benchantment\b/.test(lowerText)) {
    types.push('Enchantment');
  }
  if (mainType.includes('land') || descriptors.includes('land') || /\bland\b/.test(lowerText)) {
    types.push('Land');
  }
  if (types.length === 0 && power !== undefined) {
    types.push('Creature');
  }

  const subtypes: string[] = [];
  const knownCreatureTypes = [
    'soldier', 'zombie', 'orc', 'army', 'goblin', 'beast', 'spirit', 'angel', 'demon', 'dragon',
    'elf', 'human', 'vampire', 'wolf', 'bird', 'cat', 'rat', 'bat', 'elemental',
    'saproling', 'servo', 'thopter', 'clue', 'treasure', 'food', 'blood', 'warrior',
    'knight', 'wizard', 'rogue', 'cleric', 'horror', 'insect', 'spider', 'snake', 'merfolk',
    'phyrexian', 'germ', 'wurm', 'gnome', 'fish', 'pegasus', 'pest', 'dryad', 'forest',
    'mite', 'dinosaur', 'assassin', 'otter', 'pilot', 'lander', 'rabbit', 'myr', 'slug',
    'kobold', 'samurai', 'monk', 'citizen', 'construct', 'plant', 'serpent', 'golem', 'goat',
  ];
  const subtypeSource = lowerText
    .replace(/^.*?\bcreates?\s+(?:twice\s+x|x|a\s+number\s+of|a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|\d+)\s+/, '')
    .replace(/^\d+\/\d+\s+/, '')
    .replace(/\b(?:white|blue|black|red|green|colorless)\b/g, ' ')
    .replace(/\b(?:artifact|creature|enchantment|token|tokens)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const subtypeMatches: Array<{ index: number; subtype: string }> = [];
  for (const type of knownCreatureTypes) {
    const index = subtypeSource.indexOf(type);
    if (index >= 0) {
      subtypeMatches.push({ index, subtype: type.charAt(0).toUpperCase() + type.slice(1) });
    }
  }
  subtypeMatches.sort((left, right) => left.index - right.index);
  for (const entry of subtypeMatches) {
    subtypes.push(entry.subtype);
  }

  if (subtypes.length === 0 && subtypeSource) {
    const leftover = subtypeSource.split(/\s+/).filter(Boolean);
    if (leftover.length === 1 && /^[a-z]+$/i.test(leftover[0])) {
      subtypes.push(leftover[0].charAt(0).toUpperCase() + leftover[0].slice(1));
    } else if (leftover.length > 1) {
      for (const word of leftover) {
        if (/^[a-z]+$/i.test(word)) {
          subtypes.push(word.charAt(0).toUpperCase() + word.slice(1));
        }
      }
    }
  }

  const artifactOnlySubtypes = new Set([
    'treasure', 'food', 'clue', 'blood', 'powerstone', 'map', 'junk', 'gold', 'incubator', 'mutagen',
  ]);
  if (
    subtypes.some((subtype) => artifactOnlySubtypes.has(subtype.toLowerCase())) &&
    !types.includes('Artifact')
  ) {
    types.unshift('Artifact');
  }

  const abilities: string[] = [];
  if (lowerText.includes('flying')) abilities.push('Flying');
  if (lowerText.includes('haste')) abilities.push('Haste');
  if (lowerText.includes('lifelink')) abilities.push('Lifelink');
  if (lowerText.includes('deathtouch')) abilities.push('Deathtouch');
  if (lowerText.includes('trample')) abilities.push('Trample');
  if (lowerText.includes('vigilance')) abilities.push('Vigilance');
  if (lowerText.includes('menace')) abilities.push('Menace');
  if (lowerText.includes('first strike')) abilities.push('First strike');
  if (lowerText.includes('double strike')) abilities.push('Double strike');
  if (lowerText.includes('reach')) abilities.push('Reach');
  if (lowerText.includes('prowess')) abilities.push('Prowess');
  if (lowerText.includes('decayed')) abilities.push('Decayed');
  if (lowerText.includes('toxic 1')) abilities.push('Toxic 1');
  // Grant Training only when the creation clause says "with training" (e.g. Torens), not
  // from unrelated keyword lines elsewhere on the source card.
  if (/\bwith\s+training\b/i.test(lowerText)) abilities.push('Training');
  for (const quoted of quotedAbilities) {
    if (!abilities.includes(quoted)) abilities.push(quoted);
  }

  let name = subtypes.length > 1 ? subtypes.join(' ') : (subtypes[subtypes.length - 1] || 'Token');
  if (descriptors.includes('treasure')) name = 'Treasure';
  if (descriptors.includes('food')) name = 'Food';
  if (descriptors.includes('clue')) name = 'Clue';
  if (descriptors.includes('blood')) name = 'Blood';

  return {
    characteristics: {
      name,
      colors,
      types,
      subtypes,
      power,
      toughness,
      abilities,
      isArtifact: types.includes('Artifact'),
    },
    count,
  };
}

/**
 * Resolve token characteristics from the IR token hint (what the creating card
 * specifies) with clause text as fallback. Never fuzzy-matches catalog entries.
 */
export function resolveTokenCharacteristicsFromOracleStep(
  tokenHint: string,
  clauseRaw: string,
): TokenCharacteristics | null {
  const hintParsed = extractQuotedTokenAbilities(String(tokenHint || '').trim());
  const clauseParsed = extractQuotedTokenAbilities(String(clauseRaw || '').trim());
  const quotedAbilities = Array.from(new Set([...hintParsed.quotedAbilities, ...clauseParsed.quotedAbilities]));

  const fromHint = hintParsed.descriptor
    ? parseTokenCreationFromText(`Create a ${hintParsed.descriptor} token`)
    : null;
  const fromClause = clauseParsed.descriptor
    ? parseTokenCreationFromText(String(clauseRaw || '').trim())
    : null;

  if (fromHint) {
    return mergeTokenCharacteristics(fromHint.characteristics, fromClause?.characteristics, quotedAbilities);
  }

  if (fromClause) {
    return mergeTokenCharacteristics(fromClause.characteristics, null, quotedAbilities);
  }

  return null;
}

/**
 * Detect ETB triggers from token abilities.
 */
export function detectTokenETBTriggers(
  token: BattlefieldPermanent,
  controllerId: PlayerID
): ETBTriggerInfo[] {
  const triggers: ETBTriggerInfo[] = [];
  const oracleText = (token.card as KnownCardRef)?.oracle_text?.toLowerCase() || '';
  const tokenName = (token.card as KnownCardRef)?.name || 'Token';

  const etbMatch = oracleText.match(/when .* enters the battlefield,?\s*([^.]+)/i);
  if (!etbMatch) return triggers;

  const effect = etbMatch[1].trim();
  const requiresChoice = effect.includes('may') || effect.includes('choose') || effect.includes('target');

  let choiceType: 'target' | 'may' | 'choice' | undefined;
  if (effect.includes('may')) choiceType = 'may';
  else if (effect.includes('target')) choiceType = 'target';
  else if (effect.includes('choose')) choiceType = 'choice';

  triggers.push({
    tokenId: token.id,
    tokenName,
    controllerId,
    effect,
    requiresChoice,
    choiceType,
  });

  return triggers;
}

/**
 * Detect "whenever a token enters" triggers on battlefield permanents.
 */
export function detectTokenCreationTriggers(
  battlefield: readonly BattlefieldPermanent[],
  newTokenId: string,
  tokenControllerId: PlayerID
): TokenTriggerInfo[] {
  const triggers: TokenTriggerInfo[] = [];

  for (const perm of battlefield) {
    const oracleText = (perm.card as KnownCardRef)?.oracle_text?.toLowerCase() || '';
    const permName = (perm.card as KnownCardRef)?.name || 'Permanent';

    if (!oracleText.includes('whenever') || (!oracleText.includes('token') && !oracleText.includes('creature enters'))) {
      continue;
    }

    const tokenEntersMatch = oracleText.match(
      /whenever (?:a|an)?\s*(?:creature|artifact)?\s*tokens?\s*(?:you control\s*)?enters/i
    );

    const creatureEntersMatch = oracleText.match(
      /whenever (?:a|an)?\s*(?:creature|nontoken creature)\s*enters/i
    );

    if (creatureEntersMatch && oracleText.includes('nontoken')) {
      continue;
    }

    if (!tokenEntersMatch && !(creatureEntersMatch && !oracleText.includes('nontoken'))) {
      continue;
    }

    const youControl = oracleText.includes('you control');
    const opponentControl = oracleText.includes('opponent controls');
    const permController = perm.controller;
    const shouldTrigger =
      (!youControl && !opponentControl) ||
      (youControl && permController === tokenControllerId) ||
      (opponentControl && permController !== tokenControllerId);

    if (!shouldTrigger) continue;

    const effectMatch = oracleText.match(/whenever[^,]+,\s*([^.]+)/i);
    const effect = effectMatch ? effectMatch[1].trim() : 'trigger effect';

    triggers.push({
      sourceId: perm.id,
      sourceName: permName,
      controllerId: perm.controller,
      effect,
      triggeredByTokenId: newTokenId,
      requiresChoice: effect.includes('may') || effect.includes('target'),
    });
  }

  return triggers;
}
