/**
 * server/src/services/tokens.ts
 * 
 * Token data service for loading and querying token definitions.
 * Uses pre-loaded token data from Tokens.json (Scryfall API dump).
 */

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { debug, debugWarn, debugError } from "../utils/debug.js";
import { searchScryfallTokenImage, type ScryfallTokenImageSpec } from './scryfall.js';

// Get __dirname equivalent for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Token card definition from Scryfall
 */
export interface TokenCard {
  id: string;
  name: string;
  oracle_id?: string;
  type_line: string;
  oracle_text?: string;
  power?: string;
  toughness?: string;
  colors: string[];
  color_identity: string[];
  keywords?: string[];
  image_uris?: {
    small?: string;
    normal?: string;
    large?: string;
    art_crop?: string;
  };
}

/**
 * Scryfall token search response structure
 */
interface TokensJsonResponse {
  object: string;
  total_cards: number;
  data: TokenCard[];
}

// In-memory cache of all tokens
let tokenCache: TokenCard[] = [];
let tokensByName: Map<string, TokenCard[]> = new Map();
let tokensByType: Map<string, TokenCard[]> = new Map();
let tokensLoaded = false;

/**
 * Load token data from Tokens.json
 * This is called lazily on first token lookup
 */
function loadTokens(): void {
  if (tokensLoaded) return;
  
  try {
    // Path to Tokens.json - traverse up from server/src/services to project root
    const tokensPath = join(__dirname, '..', '..', '..', 'precon_json', 'Tokens.json');
    
    const fileContent = readFileSync(tokensPath, 'utf-8');
    const tokensData: TokensJsonResponse = JSON.parse(fileContent);
    
    if (Array.isArray(tokensData.data)) {
      tokenCache = tokensData.data;
      
      // Build lookup indices
      for (const token of tokenCache) {
        // Index by normalized name
        const nameLower = token.name.toLowerCase();
        if (!tokensByName.has(nameLower)) {
          tokensByName.set(nameLower, []);
        }
        tokensByName.get(nameLower)!.push(token);
        
        // Index by creature type
        const typeLine = (token.type_line || '').toLowerCase();
        // Extract creature types from type line like "Token Creature — Goblin"
        const typeMatch = typeLine.match(/—\s*(.+)/);
        if (typeMatch) {
          const subtypes = typeMatch[1].split(/\s+/);
          for (const subtype of subtypes) {
            const subtypeLower = subtype.toLowerCase();
            if (!tokensByType.has(subtypeLower)) {
              tokensByType.set(subtypeLower, []);
            }
            tokensByType.get(subtypeLower)!.push(token);
          }
        }
      }
      
      debug(2, `[tokens] Loaded ${tokenCache.length} tokens from Tokens.json`);
    }
    
    tokensLoaded = true;
  } catch (err) {
    debugWarn(1, '[tokens] Failed to load Tokens.json:', err);
    tokensLoaded = true; // Mark as loaded to prevent repeated attempts
  }
}

/**
 * Find a token by exact name
 * Returns the first matching token or undefined
 */
export function findTokenByName(name: string): TokenCard | undefined {
  loadTokens();
  const tokens = tokensByName.get(name.toLowerCase());
  return tokens?.[0];
}

/**
 * Find all tokens matching a name
 * Useful when there are multiple versions of the same token
 */
export function findAllTokensByName(name: string): TokenCard[] {
  loadTokens();
  return tokensByName.get(name.toLowerCase()) || [];
}

/**
 * Find tokens by creature type
 * e.g., findTokensByType("goblin") returns all Goblin tokens
 */
export function findTokensByType(type: string): TokenCard[] {
  loadTokens();
  return tokensByType.get(type.toLowerCase()) || [];
}

/**
 * Search tokens by partial name match
 */
export function searchTokens(query: string): TokenCard[] {
  loadTokens();
  const queryLower = query.toLowerCase();
  return tokenCache.filter(token => 
    token.name.toLowerCase().includes(queryLower) ||
    (token.type_line || '').toLowerCase().includes(queryLower)
  );
}

/**
 * Find the best matching token based on description
 * Matches power/toughness, colors, and creature type
 * 
 * @param description - Description like "1/1 white Soldier creature token with vigilance"
 * @returns Best matching token or undefined
 */
export function findTokenByDescription(description: string): TokenCard | undefined {
  loadTokens();
  
  const desc = description.toLowerCase();
  
  // Parse power/toughness
  const ptMatch = desc.match(/(\d+)\/(\d+)/);
  const targetPower = ptMatch ? ptMatch[1] : null;
  const targetToughness = ptMatch ? ptMatch[2] : null;
  
  // Parse colors
  const colors: string[] = [];
  if (desc.includes('white')) colors.push('W');
  if (desc.includes('blue')) colors.push('U');
  if (desc.includes('black')) colors.push('B');
  if (desc.includes('red')) colors.push('R');
  if (desc.includes('green')) colors.push('G');
  if (desc.includes('colorless')) colors.length === 0;
  
  // Parse creature types - common types to look for
  const creatureTypes = [
    'soldier', 'spirit', 'zombie', 'goblin', 'elf', 'human', 'beast',
    'saproling', 'wolf', 'elemental', 'dragon', 'angel', 'demon',
    'vampire', 'cat', 'bird', 'snake', 'insect', 'thopter', 'servo',
    'construct', 'golem', 'warrior', 'knight', 'cleric', 'wizard',
    'treasure', 'food', 'clue', 'blood', 'map', 'powerstone',
    'faerie', 'rogue', 'bat', 'devil', 'eldrazi', 'spawn', 'scion'
  ];
  
  const matchedTypes: string[] = [];
  for (const type of creatureTypes) {
    if (desc.includes(type)) {
      matchedTypes.push(type);
    }
  }
  
  // Parse abilities
  const abilities: string[] = [];
  if (desc.includes('flying')) abilities.push('flying');
  if (desc.includes('vigilance')) abilities.push('vigilance');
  if (desc.includes('haste')) abilities.push('haste');
  if (desc.includes('trample')) abilities.push('trample');
  if (desc.includes('lifelink')) abilities.push('lifelink');
  if (desc.includes('deathtouch')) abilities.push('deathtouch');
  if (desc.includes('first strike')) abilities.push('first strike');
  if (desc.includes('double strike')) abilities.push('double strike');
  if (desc.includes('menace')) abilities.push('menace');
  if (desc.includes('reach')) abilities.push('reach');
  
  // Score each token and find the best match
  let bestMatch: TokenCard | undefined;
  let bestScore = 0;
  
  for (const token of tokenCache) {
    let score = 0;
    
    // Check power/toughness match
    if (targetPower && targetToughness) {
      if (token.power === targetPower && token.toughness === targetToughness) {
        score += 30;
      }
    }
    
    // Check color match
    const tokenColors = token.colors || [];
    if (colors.length === 0 && tokenColors.length === 0) {
      score += 10; // Both colorless
    } else if (colors.length > 0) {
      const colorMatch = colors.every(c => tokenColors.includes(c)) &&
                        tokenColors.every(c => colors.includes(c));
      if (colorMatch) score += 20;
    }
    
    // Check type match
    const tokenTypeLine = (token.type_line || '').toLowerCase();
    for (const type of matchedTypes) {
      if (tokenTypeLine.includes(type)) {
        score += 25;
      }
    }
    
    // Check abilities match
    const tokenOracle = (token.oracle_text || '').toLowerCase();
    const tokenKeywords = (token.keywords || []).map(k => k.toLowerCase());
    for (const ability of abilities) {
      if (tokenOracle.includes(ability) || tokenKeywords.includes(ability)) {
        score += 15;
      }
    }
    
    if (score > bestScore) {
      bestScore = score;
      bestMatch = token;
    }
  }
  
  return bestMatch;
}

/**
 * Get a specific common token by name with preset characteristics
 * Useful for creating tokens from card effects
 */
export function getCommonToken(tokenType: string): {
  name: string;
  type_line: string;
  power: number;
  toughness: number;
  colors: string[];
  abilities: string[];
  imageUrl?: string;
} | undefined {
  const tokenLower = tokenType.toLowerCase();
  
  // Common tokens with their standard characteristics
  const commonTokens: Record<string, {
    name: string;
    type_line: string;
    power: number;
    toughness: number;
    colors: string[];
    abilities: string[];
  }> = {
    // Artifact tokens
    'treasure': {
      name: 'Treasure',
      type_line: 'Token Artifact — Treasure',
      power: 0,
      toughness: 0,
      colors: [],
      abilities: ['Tap, Sacrifice: Add one mana of any color.']
    },
    'food': {
      name: 'Food',
      type_line: 'Token Artifact — Food',
      power: 0,
      toughness: 0,
      colors: [],
      abilities: ['{2}, {T}, Sacrifice: Gain 3 life.']
    },
    'clue': {
      name: 'Clue',
      type_line: 'Token Artifact — Clue',
      power: 0,
      toughness: 0,
      colors: [],
      abilities: ['{2}, Sacrifice: Draw a card.']
    },
    'blood': {
      name: 'Blood',
      type_line: 'Token Artifact — Blood',
      power: 0,
      toughness: 0,
      colors: [],
      abilities: ['{1}, {T}, Discard a card, Sacrifice: Draw a card.']
    },
    'powerstone': {
      name: 'Powerstone',
      type_line: 'Token Artifact — Powerstone',
      power: 0,
      toughness: 0,
      colors: [],
      abilities: ['{T}: Add {C}. This mana can\'t be spent to cast a nonartifact spell.']
    },
    'map': {
      name: 'Map',
      type_line: 'Token Artifact — Map',
      power: 0,
      toughness: 0,
      colors: [],
      abilities: ['{1}, {T}, Sacrifice: Target creature you control explores.']
    },
    
    // White creature tokens
    'soldier': {
      name: 'Soldier',
      type_line: 'Token Creature — Soldier',
      power: 1,
      toughness: 1,
      colors: ['W'],
      abilities: []
    },
    'spirit': {
      name: 'Spirit',
      type_line: 'Token Creature — Spirit',
      power: 1,
      toughness: 1,
      colors: ['W'],
      abilities: ['Flying']
    },
    'angel': {
      name: 'Angel',
      type_line: 'Token Creature — Angel',
      power: 4,
      toughness: 4,
      colors: ['W'],
      abilities: ['Flying']
    },
    'human': {
      name: 'Human',
      type_line: 'Token Creature — Human',
      power: 1,
      toughness: 1,
      colors: ['W'],
      abilities: []
    },
    'cat soldier': {
      name: 'Cat Soldier',
      type_line: 'Token Creature — Cat Soldier',
      power: 1,
      toughness: 1,
      colors: ['W'],
      abilities: ['Vigilance']
    },
    
    // Black creature tokens
    'zombie': {
      name: 'Zombie',
      type_line: 'Token Creature — Zombie',
      power: 2,
      toughness: 2,
      colors: ['B'],
      abilities: []
    },
    'bat': {
      name: 'Bat',
      type_line: 'Token Creature — Bat',
      power: 1,
      toughness: 1,
      colors: ['B'],
      abilities: ['Flying']
    },
    'faerie rogue': {
      name: 'Faerie Rogue',
      type_line: 'Token Creature — Faerie Rogue',
      power: 1,
      toughness: 1,
      colors: ['B'],
      abilities: ['Flying']
    },
    
    // Red creature tokens
    'goblin': {
      name: 'Goblin',
      type_line: 'Token Creature — Goblin',
      power: 1,
      toughness: 1,
      colors: ['R'],
      abilities: []
    },
    'goblin haste': {
      name: 'Goblin',
      type_line: 'Token Creature — Goblin',
      power: 1,
      toughness: 1,
      colors: ['R'],
      abilities: ['Haste']
    },
    'dragon': {
      name: 'Dragon',
      type_line: 'Token Creature — Dragon',
      power: 5,
      toughness: 5,
      colors: ['R'],
      abilities: ['Flying']
    },
    'elemental': {
      name: 'Elemental',
      type_line: 'Token Creature — Elemental',
      power: 1,
      toughness: 1,
      colors: ['R'],
      abilities: ['Haste']
    },
    'devil': {
      name: 'Devil',
      type_line: 'Token Creature — Devil',
      power: 1,
      toughness: 1,
      colors: ['R'],
      abilities: ['When this creature dies, it deals 1 damage to any target.']
    },
    
    // Green creature tokens
    'beast': {
      name: 'Beast',
      type_line: 'Token Creature — Beast',
      power: 3,
      toughness: 3,
      colors: ['G'],
      abilities: []
    },
    'saproling': {
      name: 'Saproling',
      type_line: 'Token Creature — Saproling',
      power: 1,
      toughness: 1,
      colors: ['G'],
      abilities: []
    },
    'wolf': {
      name: 'Wolf',
      type_line: 'Token Creature — Wolf',
      power: 2,
      toughness: 2,
      colors: ['G'],
      abilities: []
    },
    'elf warrior': {
      name: 'Elf Warrior',
      type_line: 'Token Creature — Elf Warrior',
      power: 1,
      toughness: 1,
      colors: ['G'],
      abilities: []
    },
    
    // Colorless creature tokens
    'thopter': {
      name: 'Thopter',
      type_line: 'Token Artifact Creature — Thopter',
      power: 1,
      toughness: 1,
      colors: [],
      abilities: ['Flying']
    },
    'servo': {
      name: 'Servo',
      type_line: 'Token Artifact Creature — Servo',
      power: 1,
      toughness: 1,
      colors: [],
      abilities: []
    },
    'construct': {
      name: 'Construct',
      type_line: 'Token Artifact Creature — Construct',
      power: 1,
      toughness: 1,
      colors: [],
      abilities: []
    },
    'eldrazi spawn': {
      name: 'Eldrazi Spawn',
      type_line: 'Token Creature — Eldrazi Spawn',
      power: 0,
      toughness: 1,
      colors: [],
      abilities: ['Sacrifice: Add {C}.']
    },
    'eldrazi scion': {
      name: 'Eldrazi Scion',
      type_line: 'Token Creature — Eldrazi Scion',
      power: 1,
      toughness: 1,
      colors: [],
      abilities: ['Sacrifice: Add {C}.']
    },
    'rabbit': {
      name: 'Rabbit',
      type_line: 'Token Creature — Rabbit',
      power: 1,
      toughness: 1,
      colors: ['W'],
      abilities: []
    },
  };
  
  const preset = commonTokens[tokenLower];
  if (!preset) return undefined;
  
  // Try to find an image from the loaded token data
  const tokenData = findTokenByName(preset.name);
  
  return {
    ...preset,
    imageUrl: tokenData?.image_uris?.normal || tokenData?.image_uris?.small,
  };
}

export type TokenImageSpec = ScryfallTokenImageSpec & {
  typeLine?: string;
};

function normalizeTokenImageColors(colors?: string[]): string[] {
  return (colors || [])
    .map((color) => String(color || '').trim().toUpperCase())
    .filter(Boolean)
    .sort();
}

export function buildTokenImageSpec(input: {
  name: string;
  power?: number | string;
  toughness?: number | string;
  colors?: string[];
  abilities?: string[];
  typeLine?: string;
  isArtifact?: boolean;
  isEnchantment?: boolean;
}): TokenImageSpec {
  const typeLine = String(input.typeLine || '');
  return {
    name: String(input.name || 'Token'),
    power: input.power,
    toughness: input.toughness,
    colors: input.colors,
    abilities: input.abilities,
    typeLine,
    isArtifact: input.isArtifact ?? /\bartifact\b/i.test(typeLine),
    isEnchantment: input.isEnchantment ?? /\benchantment\b/i.test(typeLine),
  };
}

function tokenHasImage(token: TokenCard): boolean {
  return Boolean(token.image_uris?.normal || token.image_uris?.small);
}

function tokenMatchesImageSpecExactly(token: TokenCard, spec: TokenImageSpec): boolean {
  if (String(token.name || '').toLowerCase() !== spec.name.toLowerCase()) return false;
  if (spec.power !== undefined && String(token.power ?? '') !== String(spec.power)) return false;
  if (spec.toughness !== undefined && String(token.toughness ?? '') !== String(spec.toughness)) return false;

  if (spec.colors !== undefined) {
    const tokenColors = normalizeTokenImageColors(token.colors);
    const specColors = normalizeTokenImageColors(spec.colors);
    if (tokenColors.join(',') !== specColors.join(',')) return false;
  }

  const typeLine = String(token.type_line || '').toLowerCase();
  if (spec.isArtifact === true && !typeLine.includes('artifact')) return false;
  if (spec.isArtifact === false && typeLine.includes('artifact')) return false;
  if (spec.isEnchantment === true && !typeLine.includes('enchantment')) return false;

  if (spec.abilities && spec.abilities.length > 0) {
    const tokenKeywords = (token.keywords || []).map((keyword) => keyword.toLowerCase());
    const tokenOracleText = String(token.oracle_text || '').toLowerCase();
    for (const ability of spec.abilities) {
      const abilityLower = ability.toLowerCase();
      if (!tokenKeywords.includes(abilityLower) && !tokenOracleText.includes(abilityLower)) {
        return false;
      }
    }
  }

  return tokenHasImage(token);
}

function findExactTokenImageInCache(spec: TokenImageSpec): TokenCard | undefined {
  loadTokens();
  const candidates = tokensByName.get(spec.name.toLowerCase()) || [];
  return candidates.find((token) => tokenMatchesImageSpecExactly(token, spec));
}

function findFuzzyTokenImageInCache(spec: TokenImageSpec): TokenCard | undefined {
  loadTokens();

  const nameLower = spec.name.toLowerCase();
  const abilitiesLower = spec.abilities?.map((ability) => ability.toLowerCase()) || [];
  const abilitiesSet = new Set(abilitiesLower);
  const requestedColors = spec.colors !== undefined ? normalizeTokenImageColors(spec.colors) : undefined;

  let searchTokens = tokensByName.get(nameLower) || [];
  if (searchTokens.length === 0) {
    searchTokens = tokensByType.get(nameLower) || [];
  }

  const NO_MATCH_SCORE = -1;
  let bestMatch: TokenCard | undefined;
  let bestScore = NO_MATCH_SCORE;

  for (const token of searchTokens) {
    if (!tokenHasImage(token)) continue;

    let score = 0;
    if (spec.power !== undefined && token.power === String(spec.power)) score += 2;
    if (spec.toughness !== undefined && token.toughness === String(spec.toughness)) score += 2;

    const tokenColors = normalizeTokenImageColors(token.colors);
    if (requestedColors !== undefined) {
      if (requestedColors.length === 0) {
        score += tokenColors.length === 0 ? 3 : -2;
      } else if (tokenColors.join(',') === requestedColors.join(',')) {
        score += 3;
      }
    }

    if (abilitiesLower.length > 0) {
      const tokenKeywords = (token.keywords || []).map((keyword) => keyword.toLowerCase());
      const tokenOracleText = String(token.oracle_text || '').toLowerCase();
      let abilityMatchCount = 0;
      for (const ability of abilitiesLower) {
        if (tokenKeywords.includes(ability) || tokenOracleText.includes(ability)) {
          abilityMatchCount += 1;
        }
      }
      score += abilityMatchCount * 4;
      if (abilityMatchCount === abilitiesLower.length) score += 5;
      for (const keyword of tokenKeywords) {
        if (!abilitiesSet.has(keyword)) score -= 1;
      }
    } else if ((token.keywords || []).length === 0) {
      score += 1;
    }

    const tokenTypeLine = String(token.type_line || '').toLowerCase();
    if (spec.isArtifact === true) {
      score += tokenTypeLine.includes('artifact') ? 6 : -4;
    } else if (spec.isArtifact === false && tokenTypeLine.includes('artifact')) {
      score -= 2;
    }

    if ((token.name || '').toLowerCase() === nameLower) score += 3;
    if (score > bestScore) {
      bestScore = score;
      bestMatch = token;
    }
  }

  if (bestMatch) {
    debug(1, `[tokens] Fuzzy token image fallback for ${spec.name}: ${bestMatch.name} (score: ${bestScore})`);
  }
  return bestMatch;
}

function getHardcodedTokenImageFallback(
  spec: TokenImageSpec,
): { small?: string; normal?: string; large?: string; art_crop?: string } | undefined {
  const colorArr = normalizeTokenImageColors(spec.colors);
  const isWhite = colorArr.includes('W');
  const isColorless = colorArr.length === 0;
  const power = spec.power !== undefined ? String(spec.power) : '1';
  const toughness = spec.toughness !== undefined ? String(spec.toughness) : '1';
  const nameLower = spec.name.toLowerCase();

  const FALLBACK_TOKEN_URLS: Record<string, { small?: string; normal?: string; large?: string; art_crop?: string }> = {
    soldier_white_1_1: {
      small: 'https://cards.scryfall.io/small/front/b/1/b1032d62-f64a-4b27-9a59-a5125625bf1f.jpg?1654171530',
      normal: 'https://cards.scryfall.io/normal/front/b/1/b1032d62-f64a-4b27-9a59-a5125625bf1f.jpg?1654171530',
      large: 'https://cards.scryfall.io/large/front/b/1/b1032d62-f64a-4b27-9a59-a5125625bf1f.jpg?1654171530',
    },
  };

  const fallbackKey = `${nameLower.includes('soldier') ? 'soldier' : nameLower}_${isWhite ? 'white' : isColorless ? 'colorless' : 'multi'}_${power}_${toughness}`;
  if (FALLBACK_TOKEN_URLS[fallbackKey]) return FALLBACK_TOKEN_URLS[fallbackKey];
  if (nameLower.includes('soldier') && isWhite && power === '1' && toughness === '1') {
    return FALLBACK_TOKEN_URLS.soldier_white_1_1;
  }
  return undefined;
}

/**
 * Synchronous lookup: exact local cache match only.
 */
export function getTokenImageUrls(
  tokenName: string,
  power?: number | string,
  toughness?: number | string,
  colors?: string[],
  abilities?: string[],
  isArtifact?: boolean,
): { small?: string; normal?: string; large?: string; art_crop?: string } | undefined {
  try {
    const spec = buildTokenImageSpec({
      name: tokenName,
      power,
      toughness,
      colors,
      abilities,
      isArtifact,
    });
    debug(2, `[tokens] getTokenImageUrls (exact): ${JSON.stringify(spec)}`);
    return findExactTokenImageInCache(spec)?.image_uris;
  } catch (err) {
    debugWarn(1, '[tokens] getTokenImageUrls failed (non-fatal):', { tokenName, power, toughness }, err);
    return undefined;
  }
}

/**
 * Full image resolution pipeline:
 * 1) exact local cache  2) Scryfall search  3) fuzzy local cache  4) hardcoded fallback
 */
export async function resolveTokenImageUrls(
  spec: TokenImageSpec,
): Promise<{ small?: string; normal?: string; large?: string; art_crop?: string } | undefined> {
  const exact = findExactTokenImageInCache(spec);
  if (exact?.image_uris) {
    debug(2, `[tokens] Exact token image match: ${exact.name}`);
    return exact.image_uris;
  }

  const online = await searchScryfallTokenImage(spec);
  if (online?.normal || online?.small) {
    debug(2, `[tokens] Scryfall token image match: ${spec.name}`);
    return online;
  }

  const fuzzy = findFuzzyTokenImageInCache(spec);
  if (fuzzy?.image_uris) {
    return fuzzy.image_uris;
  }

  return getHardcodedTokenImageFallback(spec);
}

export async function enrichTokenCardImages(cards: Array<Record<string, any>>): Promise<void> {
  await Promise.all(
    cards.map(async (card) => {
      if (!card || card.image_uris?.normal || card.image_uris?.small) return;

      const oracleText = String(card.oracle_text || '').toLowerCase();
      const abilities = ['hexproof', 'flying', 'vigilance', 'menace', 'deathtouch', 'lifelink', 'ward', 'haste', 'reach']
        .filter((keyword) => oracleText.includes(keyword));

      const spec = buildTokenImageSpec({
        name: String(card.name || 'Token'),
        power: card.power,
        toughness: card.toughness,
        colors: Array.isArray(card.colors) ? card.colors : undefined,
        abilities: abilities.length > 0 ? abilities : undefined,
        typeLine: String(card.type_line || ''),
      });

      const syncExact = findExactTokenImageInCache(spec)?.image_uris;
      if (syncExact) {
        card.image_uris = syncExact;
        return;
      }

      const resolved = await resolveTokenImageUrls(spec);
      if (resolved) {
        card.image_uris = resolved;
      }
    }),
  );
}

/**
 * Create a complete token card object with proper images
 * This is the recommended way to create tokens in game logic
 * 
 * @param options - Token creation options
 * @returns Complete token card object ready for battlefield
 */
export function createTokenCard(options: {
  id: string;
  name: string;
  type_line: string;
  power: number | string;
  toughness: number | string;
  colors?: string[];
  oracle_text?: string;
  keywords?: string[];
}): any {
  const imageUrls = getTokenImageUrls(
    options.name, 
    options.power, 
    options.toughness, 
    options.colors,
    options.keywords,
    /\bartifact\b/i.test(String(options.type_line || '')),
  );
  
  return {
    id: options.id,
    name: options.name,
    type_line: options.type_line,
    power: String(options.power),
    toughness: String(options.toughness),
    colors: options.colors || [],
    oracle_text: options.oracle_text || '',
    keywords: options.keywords || [],
    zone: 'battlefield',
    image_uris: imageUrls || undefined,
  };
}

/**
 * Get all loaded tokens (for UI listing)
 */
export function getAllTokens(): TokenCard[] {
  loadTokens();
  return [...tokenCache];
}

/**
 * Get unique token types (creature types) for filtering
 */
export function getTokenTypes(): string[] {
  loadTokens();
  return Array.from(tokensByType.keys()).sort();
}

