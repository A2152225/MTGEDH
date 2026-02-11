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

/**
 * Get token image URLs for a given token name or type
 * Useful for enriching token data with proper Scryfall images
 * 
 * @param tokenName - Name like "Rabbit", "Soldier", "Treasure"
 * @param power - Optional power to help match specific tokens
 * @param toughness - Optional toughness to help match specific tokens
 * @param colors - Optional colors to help match specific tokens
 * @param abilities - Optional abilities/keywords to help match specific tokens (e.g., ['vigilance', 'lifelink'])
 * @returns Image URLs object or undefined
 */
export function getTokenImageUrls(
  tokenName: string, 
  power?: number | string, 
  toughness?: number | string,
  colors?: string[],
  abilities?: string[]
): { small?: string; normal?: string; large?: string; art_crop?: string } | undefined {
  try {
    loadTokens();
    
    const nameLower = tokenName.toLowerCase();
    const abilitiesLower = abilities?.map(a => a.toLowerCase()) || [];
    const abilitiesSet = new Set(abilitiesLower); // Use Set for O(1) lookup

    const requestedColors = Array.isArray(colors)
      ? colors
          .map((c) => String(c || '').trim())
          .filter(Boolean)
          .map((c) => c.toUpperCase())
      : undefined;
    
    debug(2, `[tokens] getTokenImageUrls: name=${tokenName}, power=${power}, toughness=${toughness}, colors=${JSON.stringify(colors)}, abilities=${JSON.stringify(abilities)}`);
  
  // DYNAMIC TOKEN MATCHING
  // The primary method is to search Tokens.json with a scoring system
  // that matches on name, power/toughness, colors, and abilities
  // Fallback URLs are only used as a last resort if no match is found
  
    const tokens = tokensByName.get(nameLower) || [];
  
  // Also search by type if name doesn't match directly
    let searchTokens = tokens;
    if (tokens.length === 0) {
      const byType = tokensByType.get(nameLower) || [];
      searchTokens = byType;
    }
  
  // If we still have no tokens, try partial name matching
  // This handles cases like "Cat Soldier" where we might have tokens indexed differently
    if (searchTokens.length === 0) {
      // Search through all tokens for partial name matches
      for (const [key, tokenList] of tokensByName.entries()) {
        if (key.includes(nameLower) || nameLower.includes(key)) {
          searchTokens = [...searchTokens, ...tokenList];
        }
      }
    }
  
    if (searchTokens.length > 0) {
      // Score each token for best match
      const NO_MATCH_SCORE = -1;
      let bestMatch = searchTokens[0];
      let bestScore = NO_MATCH_SCORE;
      
      for (const token of searchTokens) {
        let score = 0;
      
      // Match power/toughness (2 points each)
      if (power !== undefined && token.power === String(power)) score += 2;
      if (toughness !== undefined && token.toughness === String(toughness)) score += 2;
      
        // Match colors - handle colorless case explicitly (3 points)
        const rawTokenColors = (token as any).colors;
        const tokenColors = Array.isArray(rawTokenColors)
          ? rawTokenColors
              .map((c: any) => String(c || '').trim())
              .filter(Boolean)
              .map((c: string) => c.toUpperCase())
          : typeof rawTokenColors === 'string'
            ? [rawTokenColors.trim().toUpperCase()].filter(Boolean)
            : [];

        if (requestedColors !== undefined) {
          if (requestedColors.length === 0) {
            // Looking for colorless - prefer tokens with no colors
            if (tokenColors.length === 0) {
              score += 3;
            }
          } else {
            // Looking for specific colors (exact match)
            const tokenColorSet = new Set(tokenColors);
            let allPresent = true;
            for (const c of requestedColors) {
              if (!tokenColorSet.has(c)) {
                allPresent = false;
                break;
              }
            }
            if (allPresent && tokenColors.length === requestedColors.length) {
              score += 3;
            }
          }
        }
      
      // Match abilities/keywords (4 points each match, 5 bonus for all matches)
      if (abilitiesLower.length > 0) {
        const tokenKeywords = (token.keywords || []).map((k: string) => k.toLowerCase());
        const tokenOracleText = (token.oracle_text || '').toLowerCase();
        
        let abilityMatchCount = 0;
        
        for (const ability of abilitiesLower) {
          const hasAbility = tokenKeywords.includes(ability) || 
                            tokenOracleText.includes(ability);
          if (hasAbility) {
            abilityMatchCount++;
          }
        }
        
        // Significant bonus for matching abilities
        score += abilityMatchCount * 4;
        
        // Extra bonus if ALL requested abilities match
        if (abilityMatchCount === abilitiesLower.length && abilitiesLower.length > 0) {
          score += 5;
        }
        
        // Penalty for extra unwanted abilities (use Set for O(1) lookup)
        for (const keyword of tokenKeywords) {
          if (!abilitiesSet.has(keyword)) {
            score -= 1;
          }
        }
      } else {
        // If no abilities requested, slightly prefer tokens without keywords
        const tokenKeywords = token.keywords || [];
        if (tokenKeywords.length === 0) {
          score += 1;
        }
      }
      
      // Prefer tokens with images (1 point)
      if (token.image_uris?.normal || token.image_uris?.small) score += 1;
      
      // Exact name match bonus (3 points)
      if ((token.name || '').toLowerCase() === nameLower) {
        score += 3;
      }
      
        if (score > bestScore) {
          bestScore = score;
          bestMatch = token;
        }
      }
      
      debug(2, `[tokens] Best dynamic match for ${nameLower}: ${bestMatch?.name} (score: ${bestScore})`);
      
      // If bestMatch has an image, return it
      if (bestMatch?.image_uris?.normal || bestMatch?.image_uris?.small) {
        return bestMatch.image_uris;
      }
      
      // Try to find any match that has an image
      const anyWithImage = searchTokens.find(t => t.image_uris?.normal || t.image_uris?.small);
      if (anyWithImage) {
        debug(2, `[tokens] Using fallback token with image: ${anyWithImage.name}`);
        return anyWithImage.image_uris;
      }
    }
  
  // FALLBACK: Only if dynamic matching completely fails
  // These are direct Scryfall URLs for specific token printings that may not be in Tokens.json
    debug(2, `[tokens] Dynamic matching failed for ${nameLower}, trying fallback URLs`);
  
  // Build a dynamic fallback key based on characteristics
    const colorArr = requestedColors || [];
  const isWhite = colorArr.some(c => c.toUpperCase() === 'W' || c.toLowerCase() === 'white');
  const isColorless = colorArr.length === 0;
    const p = power !== undefined ? String(power) : '1';
    const t = toughness !== undefined ? String(toughness) : '1';
  
  // Minimal fallback URLs - only for tokens that are commonly missing from Tokens.json
    const FALLBACK_TOKEN_URLS: Record<string, { small?: string; normal?: string; large?: string; art_crop?: string }> = {
    // White 1/1 Soldier
    'soldier_white_1_1': {
      small: 'https://cards.scryfall.io/small/front/b/1/b1032d62-f64a-4b27-9a59-a5125625bf1f.jpg?1654171530',
      normal: 'https://cards.scryfall.io/normal/front/b/1/b1032d62-f64a-4b27-9a59-a5125625bf1f.jpg?1654171530',
      large: 'https://cards.scryfall.io/large/front/b/1/b1032d62-f64a-4b27-9a59-a5125625bf1f.jpg?1654171530',
    },
    };

    const fallbackKey = `${tokenName.toLowerCase().includes('soldier') ? 'soldier' : nameLower}_${isWhite ? 'white' : isColorless ? 'colorless' : 'multi'}_${p}_${t}`;
    const fallback = FALLBACK_TOKEN_URLS[fallbackKey];
    if (fallback) return fallback;

    // Special-case: soldier tokens are very common and may be missing in some token datasets.
    if (nameLower.includes('soldier') && isWhite && p === '1' && t === '1') {
      return FALLBACK_TOKEN_URLS['soldier_white_1_1'];
    }

    return undefined;
  } catch (err) {
    debugWarn(1, '[tokens] getTokenImageUrls failed (non-fatal):', {
      tokenName,
      power,
      toughness,
    }, err);
    return undefined;
  }
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
    options.keywords  // Pass abilities for better matching
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

