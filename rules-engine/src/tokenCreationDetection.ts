import type { BattlefieldPermanent, PlayerID, KnownCardRef } from '../../shared/src';
import type {
  ETBTriggerInfo,
  TokenCharacteristics,
  TokenTriggerInfo,
} from './tokenCreationTypes';
import { getTokenCharacteristics } from './tokenCreationCatalog';
import { extractCreateTokenGrantedAbilities } from './oracleReminderText';

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
  const abilities = Array.from(
    new Set([
      ...(merged.abilities || []),
      ...(fallback?.abilities || []),
      ...quotedAbilities,
    ]),
  );
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
    'mite', 'dinosaur', 'assassin', 'otter', 'pilot', 'lander', 'vibranium', 'rabbit', 'myr', 'slug',
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
    'lander', 'vibranium',
  ]);
  if (
    subtypes.some((subtype) => artifactOnlySubtypes.has(subtype.toLowerCase())) &&
    !types.includes('Artifact')
  ) {
    types.unshift('Artifact');
  }

  const abilities: string[] = [];
  for (const granted of extractCreateTokenGrantedAbilities(oracleText)) {
    if (!abilities.some((entry) => entry.toLowerCase() === granted.toLowerCase())) {
      abilities.push(granted);
    }
  }
  // Retain toxic N (not in the shared static keyword list) when present on the create clause.
  if (/\btoxic\s+1\b/i.test(lowerText) && !abilities.some((entry) => /\btoxic\s+1\b/i.test(entry))) {
    abilities.push('Toxic 1');
  }
  for (const quoted of quotedAbilities) {
    if (!abilities.some((entry) => entry.toLowerCase() === quoted.toLowerCase())) abilities.push(quoted);
  }

  let name = subtypes.length > 1 ? subtypes.join(' ') : (subtypes[subtypes.length - 1] || 'Token');
  if (descriptors.includes('treasure')) name = 'Treasure';
  if (descriptors.includes('food')) name = 'Food';
  if (descriptors.includes('clue')) name = 'Clue';
  if (descriptors.includes('blood')) name = 'Blood';
  if (descriptors.includes('powerstone')) name = 'Powerstone';
  if (descriptors.includes('lander')) name = 'Lander';
  if (descriptors.includes('vibranium')) name = 'Vibranium';
  const catalogHit = getTokenCharacteristics(name);
  if (catalogHit) {
    return {
      characteristics: {
        ...catalogHit,
        // Keep entersTapped / count handled by caller; abilities come from catalog.
        abilities: Array.from(new Set([...(catalogHit.abilities || []), ...abilities])),
      },
      count,
    };
  }

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
  const extractedFromSources = Array.from(
    new Set([
      ...extractCreateTokenGrantedAbilities(String(tokenHint || '')),
      ...extractCreateTokenGrantedAbilities(String(clauseRaw || '')),
      ...quotedAbilities,
    ]),
  );

  const fromHint = hintParsed.descriptor
    ? parseTokenCreationFromText(`Create a ${hintParsed.descriptor} token`)
    : null;
  const fromClause = clauseParsed.descriptor
    ? parseTokenCreationFromText(String(clauseRaw || '').trim())
    : null;

  // Prefer catalog definitions for named tokens (Treasure, Powerstone, Vibranium, ...).
  // Reminder text on the creating card is not a reliable source of token abilities.
  // Scan known catalog names; skip noise words like Create/Tapped so matching cannot no-op.
  const catalogNameCandidates: string[] = [];
  const pushCandidate = (value: string | undefined | null) => {
    const trimmed = String(value || '').trim();
    if (trimmed) catalogNameCandidates.push(trimmed);
  };
  for (const source of [tokenHint, hintParsed.descriptor, clauseRaw]) {
    const raw = String(source || '').trim();
    if (!raw) continue;
    const tappedNamed = raw.match(/\b(?:tapped(?:\s+and\s+attacking)?\s+)?([A-Za-z][A-Za-z'-]*)\b(?:\s+token)?/i);
    if (tappedNamed) pushCandidate(tappedNamed[1]);
    const named = raw.match(/\b([A-Z][A-Za-z]*(?:\s+[A-Z][A-Za-z]*)*)\b/);
    if (named) pushCandidate(named[1]);
    for (const wordMatch of raw.matchAll(/\b([A-Za-z][A-Za-z'-]*)\b/g)) {
      pushCandidate(wordMatch[1]);
    }
  }
  const seenCandidates = new Set<string>();
  for (const candidate of catalogNameCandidates) {
    const key = candidate.toLowerCase();
    if (seenCandidates.has(key)) continue;
    seenCandidates.add(key);
    // Skip noise words that are never token catalog keys.
    if (/^(?:create|creates|created|a|an|the|tapped|attacking|token|tokens|artifact|creature|enchantment|with|and|or|it|its|it'?s)$/i.test(candidate)) {
      continue;
    }
    const catalog = getTokenCharacteristics(candidate)
      || getTokenCharacteristics(candidate.charAt(0).toUpperCase() + candidate.slice(1));
    if (catalog) {
      const parsed = fromHint?.characteristics || fromClause?.characteristics || null;
      // Never promote artifact-only catalog tokens into creatures via fuzzy parse leftovers.
      const safeParsed = parsed && catalog.isArtifact && !catalog.types.includes('Creature')
        ? { ...parsed, types: parsed.types.filter((type) => type !== 'Creature') }
        : parsed;
      return mergeTokenCharacteristics(
        {
          ...catalog,
          abilities: Array.from(new Set([...(catalog.abilities || []), ...extractedFromSources])),
        },
        safeParsed,
        [],
      );
    }
  }

  if (fromHint) {
    return mergeTokenCharacteristics(
      {
        ...fromHint.characteristics,
        abilities: Array.from(new Set([...(fromHint.characteristics.abilities || []), ...extractedFromSources])),
      },
      fromClause?.characteristics,
      [],
    );
  }

  if (fromClause) {
    return mergeTokenCharacteristics(
      {
        ...fromClause.characteristics,
        abilities: Array.from(new Set([...(fromClause.characteristics.abilities || []), ...extractedFromSources])),
      },
      null,
      [],
    );
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
