import { deriveCreateTokenSourceFragment, extractCreateTokenGrantedAbilities } from '../../../rules-engine/src/oracleReminderText.js';
/**
 * server/src/services/tokens.ts
 * 
 * Token data service for loading and querying token definitions.
 * Uses pre-loaded token data from Tokens.json (Scryfall API dump).
 * Refresh the dump with: node tools/refresh-scryfall-tokens.mjs
 */

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { debug, debugWarn, debugError, isLoopShortcutQuietLogs } from "../utils/debug.js";
import {
  searchScryfallTokenImage,
  stripColorAdjectiveFromTokenName,
  type ScryfallTokenImageSpec,
} from './scryfall.js';
import {
  normalizeTokenColors,
  pickPreferredTokenPrinting,
  tokenFieldsMatchSpec,
  type TokenImageMatchSpec,
  type TokenMatchFields,
} from './tokenImageMatch.js';

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
  released_at?: string;
  set?: string;
  layout?: string;
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

function tokenColorsFromRaw(source: any, parent?: any): string[] {
  if (Array.isArray(source?.colors) && source.colors.length) return source.colors.map((color: unknown) => String(color));
  if (Array.isArray(source?.color_indicator) && source.color_indicator.length) {
    return source.color_indicator.map((color: unknown) => String(color));
  }
  if (parent && parent !== source) return tokenColorsFromRaw(parent);
  return [];
}

function imageUrisFromRaw(source: any): TokenCard['image_uris'] | undefined {
  const uris = source?.image_uris;
  if (!uris?.normal && !uris?.small) return undefined;
  return {
    small: uris.small,
    normal: uris.normal,
    large: uris.large,
    art_crop: uris.art_crop,
  };
}

function materializeOneToken(raw: any, face?: any, faceIndex?: number): TokenCard | undefined {
  const source = face || raw;
  const image = imageUrisFromRaw(source) || (!face ? imageUrisFromRaw(raw?.card_faces?.[0]) : undefined);
  const name = String(source?.name || raw?.name || '').trim();
  if (!image || !name || name.includes('//')) return undefined;
  const keywords = Array.isArray(source?.keywords)
    ? source.keywords.map((keyword: unknown) => String(keyword))
    : Array.isArray(raw?.keywords)
      ? raw.keywords.map((keyword: unknown) => String(keyword))
      : [];
  return {
    id: face ? `${raw.id}#${faceIndex}` : String(raw?.id || name),
    name,
    type_line: String(source?.type_line || raw?.type_line || ''),
    oracle_text: String(source?.oracle_text || raw?.oracle_text || ''),
    power: source?.power ?? raw?.power,
    toughness: source?.toughness ?? raw?.toughness,
    colors: tokenColorsFromRaw(source, raw),
    color_identity: Array.isArray(raw?.color_identity) ? raw.color_identity.map((color: unknown) => String(color)) : [],
    keywords,
    image_uris: image,
    released_at: raw?.released_at ? String(raw.released_at) : undefined,
    set: raw?.set ? String(raw.set) : undefined,
    layout: raw?.layout ? String(raw.layout) : undefined,
  };
}

/** Flat printings, plus one record per face when a double-faced token has no top-level image. */
function materializeTokenRecords(raw: any): TokenCard[] {
  const faces = Array.isArray(raw?.card_faces) ? raw.card_faces : [];
  const topImage = imageUrisFromRaw(raw);
  const combinedName = String(raw?.name || '').includes('//');
  if (faces.length > 0 && (!topImage || combinedName)) {
    return faces
      .map((face: any, index: number) => materializeOneToken(raw, face, index))
      .filter((token: TokenCard | undefined): token is TokenCard => Boolean(token));
  }
  const one = materializeOneToken(raw);
  return one ? [one] : [];
}

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
      tokenCache = [];
      for (const raw of tokensData.data) {
        tokenCache.push(...materializeTokenRecords(raw));
      }
      
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
    'treasure', 'food', 'clue', 'blood', 'map', 'powerstone', 'vibranium', 'heartwood',
    'faerie', 'rogue', 'bat', 'devil', 'eldrazi', 'spawn', 'scion'
  ];
  
  const matchedTypes: string[] = [];
  for (const type of creatureTypes) {
    if (desc.includes(type)) {
      matchedTypes.push(type);
    }
  }
  
  // Parse abilities via shared create-token grant extractor (plus bare keyword scan for image matching).
  const abilities: string[] = extractCreateTokenGrantedAbilities(
    /\bcreates?\b/i.test(description) ? description : `Create a token ${description}`,
  ).map((ability) => ability.toLowerCase());
  for (const keyword of [
    'flying', 'vigilance', 'haste', 'trample', 'lifelink', 'deathtouch',
    'first strike', 'double strike', 'menace', 'reach', 'indestructible', 'hexproof',
  ]) {
    if (desc.includes(keyword) && !abilities.includes(keyword)) abilities.push(keyword);
  }
  
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
    'vibranium': {
      name: 'Vibranium',
      type_line: 'Token Artifact — Vibranium',
      power: 0,
      toughness: 0,
      colors: [],
      abilities: [
        'Indestructible',
        '{T}: Add {C}. This mana can\'t be spent to cast a nonartifact spell.',
      ],
    },
    'heartwood': {
      name: 'Heartwood',
      type_line: 'Token Artifact — Heartwood',
      power: 0,
      toughness: 0,
      colors: ['R', 'G'],
      abilities: ['{T}: Add {R} or {G}.'],
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
  rulesText?: string;
};

export type TokenPrintingMatchKind = 'exact' | 'scryfall' | 'fuzzy' | 'fallback';

export type TokenPrintingResolution = {
  image_uris?: {
    small?: string;
    normal?: string;
    large?: string;
    art_crop?: string;
  };
  printing?: TokenCard;
  matchKind?: TokenPrintingMatchKind;
};

const TOKEN_IMAGE_KEYWORD_HINTS = [
  'training',
  'flying',
  'vigilance',
  'menace',
  'deathtouch',
  'lifelink',
  'ward',
  'haste',
  'reach',
  'hexproof',
  'trample',
  'first strike',
  'double strike',
  'prowess',
  'decayed',
  'toxic',
] as const;

function capitalizeKeywordToken(value: string): string {
  const trimmed = String(value || '').trim();
  if (!trimmed) return '';
  if (/^toxic\s+\d+$/i.test(trimmed)) {
    const match = trimmed.match(/^toxic\s+(\d+)$/i);
    return match ? `Toxic ${match[1]}` : trimmed;
  }
  return trimmed
    .split(/\s+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ');
}

export function extractTokenImageAbilitiesFromCard(card: Record<string, unknown>): string[] {
  const abilities = new Set<string>();
  const keywords = Array.isArray(card.keywords) ? card.keywords : [];
  for (const keyword of keywords) {
    const normalized = capitalizeKeywordToken(String(keyword || ''));
    if (normalized) abilities.add(normalized);
  }

  const oracleText = String(card.oracle_text || '').toLowerCase();
  for (const hint of TOKEN_IMAGE_KEYWORD_HINTS) {
    if (!oracleText.includes(hint)) continue;
    if (hint === 'training' && !/\bwith\s+training\b/i.test(oracleText) && !/^training\b/i.test(oracleText.trim())) {
      continue;
    }
    abilities.add(capitalizeKeywordToken(hint));
  }

  return Array.from(abilities);
}

export function buildTokenImageSpecFromCard(card: Record<string, unknown>): TokenImageSpec {
  const abilities = extractTokenImageAbilitiesFromCard(card);
  return buildTokenImageSpec({
    name: String(card.name || 'Token'),
    power: card.power as string | number | undefined,
    toughness: card.toughness as string | number | undefined,
    colors: Array.isArray(card.colors) ? card.colors.map((color) => String(color)) : undefined,
    abilities: abilities.length > 0 ? abilities : [],
    rulesText: String(card.oracle_text || ''),
    typeLine: String(card.type_line || ''),
  });
}

export function lookupExactTokenPrinting(spec: TokenImageSpec): TokenCard | undefined {
  return findExactTokenImageInCache(spec);
}

export function buildTokenImageSpec(input: {
  name: string;
  power?: number | string;
  toughness?: number | string;
  colors?: string[];
  abilities?: string[];
  rulesText?: string;
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
    rulesText: input.rulesText !== undefined
      ? input.rulesText
      : (Array.isArray(input.abilities) ? input.abilities.join('\n') : undefined),
    typeLine,
    // Omitted means "unknown". Coercing that to false hid every artifact token
    // (Treasure, Clue, Food) from callers that only pass a name.
    isArtifact: input.isArtifact !== undefined
      ? input.isArtifact
      : (typeLine ? /\bartifact\b/i.test(typeLine) : undefined),
    isEnchantment: input.isEnchantment !== undefined
      ? input.isEnchantment
      : (typeLine ? /\benchantment\b/i.test(typeLine) : undefined),
  };
}

function tokenHasImage(token: TokenCard): boolean {
  return Boolean(token.image_uris?.normal || token.image_uris?.small);
}

function toTokenMatchFields(token: TokenCard): TokenMatchFields {
  return {
    id: token.id,
    name: token.name,
    power: token.power,
    toughness: token.toughness,
    colors: token.colors,
    keywords: token.keywords,
    oracleText: token.oracle_text,
    typeLine: token.type_line,
    releasedAt: token.released_at,
    hasImage: tokenHasImage(token),
  };
}

function matchSpecForName(spec: TokenImageSpec, name: string): TokenImageMatchSpec {
  return {
    name,
    acceptedNames: [name],
    power: spec.power,
    toughness: spec.toughness,
    colors: spec.colors,
    abilities: spec.abilities,
    rulesText: spec.rulesText,
    isArtifact: spec.isArtifact,
    isEnchantment: spec.isEnchantment,
  };
}

function findExactTokenImageInCache(spec: TokenImageSpec): TokenCard | undefined {
  loadTokens();
  const namesToTry = Array.from(
    new Set(
      [spec.name, stripColorAdjectiveFromTokenName(spec.name)]
        .map((n) => String(n || '').toLowerCase().trim())
        .filter(Boolean),
    ),
  );
  for (const nameLower of namesToTry) {
    const candidates = tokensByName.get(nameLower) || [];
    // Match against a spec whose name matches the candidate bucket (color-stripped names).
    const matchName = nameLower === spec.name.toLowerCase()
      ? spec.name
      : stripColorAdjectiveFromTokenName(spec.name);
    const matchSpec = matchSpecForName(spec, matchName);
    const hits = candidates.filter((token) => tokenFieldsMatchSpec(toTokenMatchFields(token), matchSpec));
    const hit = pickPreferredTokenPrinting(hits.map(toTokenMatchFields), matchSpec);
    if (hit) return candidates.find((token) => token.id === hit.id);
  }
  return undefined;
}

function findFuzzyTokenImageInCache(spec: TokenImageSpec): TokenCard | undefined {
  // Loop batches create hundreds of identical tokens — skip fuzzy scan.
  if (isLoopShortcutQuietLogs()) return undefined;
  loadTokens();

  const nameLower = spec.name.toLowerCase();
  const strippedName = stripColorAdjectiveFromTokenName(spec.name).toLowerCase();
  let searchTokens = tokensByName.get(nameLower) || [];
  if (searchTokens.length === 0 && strippedName && strippedName !== nameLower) {
    searchTokens = tokensByName.get(strippedName) || [];
  }
  if (searchTokens.length === 0) {
    searchTokens = tokensByType.get(nameLower) || tokensByType.get(strippedName) || [];
  }

  // Same characteristic filters as an exact match, but the name may come from a type bucket.
  const hits = searchTokens.filter((token) => tokenFieldsMatchSpec(
    toTokenMatchFields(token),
    matchSpecForName(spec, token.name),
  ));
  const preferred = pickPreferredTokenPrinting(hits.map(toTokenMatchFields), matchSpecForName(spec, spec.name));
  const bestMatch = preferred ? hits.find((token) => token.id === preferred.id) : undefined;

  if (bestMatch) {
    debug(1, `[tokens] Fuzzy token image fallback for ${spec.name}: ${bestMatch.name}`);
  }
  return bestMatch;
}

function getHardcodedTokenImageFallback(
  spec: TokenImageSpec,
): { small?: string; normal?: string; large?: string; art_crop?: string } | undefined {
  const colorArr = normalizeTokenColors(spec.colors);
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
export async function resolveTokenPrinting(
  spec: TokenImageSpec,
): Promise<TokenPrintingResolution | undefined> {
  const exact = findExactTokenImageInCache(spec);
  if (exact?.image_uris) {
    debug(2, `[tokens] Exact token image match: ${exact.name}`);
    return { image_uris: exact.image_uris, printing: exact, matchKind: 'exact' };
  }

  const online = await searchScryfallTokenImage(spec);
  if (online?.normal || online?.small) {
    debug(2, `[tokens] Scryfall token image match: ${spec.name}`);
    return { image_uris: online, matchKind: 'scryfall' };
  }

  const fuzzy = findFuzzyTokenImageInCache(spec);
  if (fuzzy?.image_uris) {
    return { image_uris: fuzzy.image_uris, printing: fuzzy, matchKind: 'fuzzy' };
  }

  const fallback = getHardcodedTokenImageFallback(spec);
  if (fallback) {
    return { image_uris: fallback, matchKind: 'fallback' };
  }

  return undefined;
}

export function applyTokenPrintingToCard(
  card: Record<string, any>,
  resolution: TokenPrintingResolution,
): void {
  if (resolution.image_uris) {
    card.image_uris = resolution.image_uris;
  }
  // Image only. Never copy P/T, colors, keywords, or oracle text from a printing:
  // a fuzzy/exact cache hit on the wrong Insect (green infect vs white flying 2/1)
  // must not rewrite the oracle-derived token characteristics.
}

export async function resolveTokenImageUrls(
  spec: TokenImageSpec,
): Promise<{ small?: string; normal?: string; large?: string; art_crop?: string } | undefined> {
  const resolved = await resolveTokenPrinting(spec);
  return resolved?.image_uris;
}

export async function enrichTokenCardImages(cards: Array<Record<string, any>>): Promise<void> {
  await Promise.all(
    cards.map(async (card) => {
      if (!card || card.image_uris?.normal || card.image_uris?.small) return;

      const spec = buildTokenImageSpecFromCard(card);
      const syncExact = lookupExactTokenPrinting(spec);
      if (syncExact?.image_uris) {
        applyTokenPrintingToCard(card, {
          image_uris: syncExact.image_uris,
          printing: syncExact,
          matchKind: 'exact',
        });
        return;
      }

      const resolved = await resolveTokenPrinting(spec);
      if (resolved) {
        applyTokenPrintingToCard(card, resolved);
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
  /** Optional create-clause / description for ability extraction. */
  sourceText?: string;
  description?: string;
  /**
   * Full source-card oracle. Used only when sourceText/description are absent:
   * deriveCreateTokenSourceFragment picks the matching create clause.
   */
  sourceOracleText?: string;
}): any {
  let sourceText = String(options.sourceText || options.description || '').trim();
  if (!sourceText) {
    const sourceOracleText = String(options.sourceOracleText || '').trim();
    if (sourceOracleText) {
      const powerNum = Number(options.power);
      const toughnessNum = Number(options.toughness);
      sourceText = deriveCreateTokenSourceFragment(
        options.name,
        sourceOracleText,
        Number.isFinite(powerNum) ? powerNum : undefined,
        Number.isFinite(toughnessNum) ? toughnessNum : undefined,
      );
    }
  }
  if (!sourceText) {
    sourceText = String(options.oracle_text || '').trim();
  }
  const extracted = sourceText ? extractCreateTokenGrantedAbilities(sourceText) : [];
  const catalog = getCommonToken(options.name);
  const mergedKeywords: string[] = [];
  for (const value of [
    ...(Array.isArray(options.keywords) ? options.keywords : []),
    ...(Array.isArray(catalog?.abilities) ? catalog.abilities : []),
    ...extracted,
  ]) {
    const normalized = String(value || '').trim();
    if (!normalized) continue;
    if (!mergedKeywords.some((entry) => entry.toLowerCase() === normalized.toLowerCase())) {
      mergedKeywords.push(normalized);
    }
  }
  const oracleText = String(options.oracle_text || '').trim() || mergedKeywords.join('\n');
  const imageUrls = getTokenImageUrls(
    options.name, 
    options.power, 
    options.toughness, 
    options.colors,
    mergedKeywords,
    /\bartifact\b/i.test(String(options.type_line || '')),
  );
  
  return {
    id: options.id,
    name: options.name,
    type_line: options.type_line,
    power: String(options.power),
    toughness: String(options.toughness),
    colors: options.colors || [],
    oracle_text: oracleText,
    keywords: mergedKeywords,
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

