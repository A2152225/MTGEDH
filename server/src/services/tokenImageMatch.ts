/**
 * Origin: server/src/services/tokens.ts (exact/fuzzy image match) and
 * server/src/services/scryfall.ts (online token search post-filter).
 * Cluster: characteristic match for token art.
 * Public: normalizeTokenColors, tokenFieldsMatchSpec, pickPreferredTokenPrinting.
 */

const COLOR_ORDER = ['W', 'U', 'B', 'R', 'G'] as const;

/** Creature keywords that distinguish one token printing from another. */
const DISTINGUISHING_TOKEN_KEYWORDS = new Set([
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
  'training',
  'defender',
  'infect',
  'flash',
  'indestructible',
  'changeling',
  'shroud',
  'protection',
  'landwalk',
  'islandwalk',
  'swampwalk',
  'mountainwalk',
  'forestwalk',
  'plainswalk',
  'firebending',
  'double team',
  'myriad',
]);

export type TokenMatchFields = {
  id?: string;
  name: string;
  power?: string;
  toughness?: string;
  colors?: string[];
  keywords?: string[];
  oracleText?: string;
  typeLine?: string;
  releasedAt?: string;
  hasImage: boolean;
};

export type TokenImageMatchSpec = {
  name: string;
  acceptedNames?: string[];
  power?: number | string;
  toughness?: number | string;
  colors?: string[];
  abilities?: string[];
  /** Printed rules text the token actually has. Empty string means a vanilla token. */
  rulesText?: string;
  isArtifact?: boolean;
  isEnchantment?: boolean;
};

export function normalizeTokenColors(colors?: string[]): string[] {
  const present = new Set(
    (colors || [])
      .map((color) => String(color || '').trim().toUpperCase())
      .filter((color) => COLOR_ORDER.includes(color as (typeof COLOR_ORDER)[number])),
  );
  return COLOR_ORDER.filter((color) => present.has(color));
}

export function scryfallExactColorClause(colors: string[] | undefined): string | undefined {
  if (colors === undefined) return undefined;
  const ordered = normalizeTokenColors(colors).join('').toLowerCase();
  return ordered ? `c=${ordered}` : 'c:c';
}

export function isDistinguishingTokenKeyword(keyword: string): boolean {
  const lower = String(keyword || '').toLowerCase().trim();
  if (!lower) return false;
  if (DISTINGUISHING_TOKEN_KEYWORDS.has(lower)) return true;
  if (/^toxic\b/.test(lower)) return true;
  if (/walk$/.test(lower)) return true;
  return false;
}

function keywordCovers(keyword: string, ability: string): boolean {
  return keyword === ability || ability.startsWith(`${keyword} `) || keyword.startsWith(`${ability} `);
}

/**
 * When abilities is an array (including empty), every requested ability must be on the
 * printing and every distinguishing keyword on the printing must have been requested.
 * Undefined abilities means the caller did not specify, so keywords are not filtered.
 */
export function tokenAbilitiesAlign(
  keywords: string[] | undefined,
  oracleText: string | undefined,
  requested: string[] | undefined,
): boolean {
  if (!Array.isArray(requested)) return true;
  const tokenKeywords = (keywords || []).map((keyword) => keyword.toLowerCase().trim()).filter(Boolean);
  const oracle = String(oracleText || '').toLowerCase();
  const wanted = requested.map((ability) => ability.toLowerCase().trim()).filter(Boolean);

  for (const ability of wanted) {
    const onKeyword = tokenKeywords.some((keyword) => keywordCovers(keyword, ability));
    if (!onKeyword && !oracle.includes(ability)) return false;
  }

  for (const keyword of tokenKeywords) {
    if (!isDistinguishingTokenKeyword(keyword)) continue;
    const covered = wanted.some((ability) => keywordCovers(keyword, ability) || ability.includes(keyword));
    if (!covered) return false;
  }
  return true;
}

function normalizeRulesText(text: string | undefined): string {
  return String(text || '')
    .replace(/\([^)]*\)/g, ' ')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * A vanilla token (empty rules text) must not take a printing that grants rules.
 * A token that does have rules can use a printing whose text is the same or shorter.
 */
export function tokenRulesTextAligns(printingOracle: string | undefined, requested: string | undefined): boolean {
  if (requested === undefined) return true;
  const printing = normalizeRulesText(printingOracle);
  const wanted = normalizeRulesText(requested);
  if (!wanted) return !printing;
  if (!printing) return true;
  return wanted.includes(printing);
}

export function tokenFieldsMatchSpec(token: TokenMatchFields, spec: TokenImageMatchSpec): boolean {
  if (!token.hasImage) return false;
  const accepted = new Set(
    (spec.acceptedNames && spec.acceptedNames.length > 0 ? spec.acceptedNames : [spec.name])
      .map((name) => String(name || '').toLowerCase().trim())
      .filter(Boolean),
  );
  if (!accepted.has(String(token.name || '').toLowerCase())) return false;

  if (spec.power !== undefined && String(token.power ?? '') !== String(spec.power)) return false;
  if (spec.toughness !== undefined && String(token.toughness ?? '') !== String(spec.toughness)) return false;

  if (spec.colors !== undefined) {
    const tokenColors = normalizeTokenColors(token.colors).join(',');
    const specColors = normalizeTokenColors(spec.colors).join(',');
    if (tokenColors !== specColors) return false;
  }

  const typeLine = String(token.typeLine || '').toLowerCase();
  if (spec.isArtifact === true && !typeLine.includes('artifact')) return false;
  if (spec.isArtifact === false && typeLine.includes('artifact')) return false;
  if (spec.isEnchantment === true && !typeLine.includes('enchantment')) return false;
  if (spec.isEnchantment === false && typeLine.includes('enchantment')) return false;

  if (!tokenAbilitiesAlign(token.keywords, token.oracleText, spec.abilities)) return false;
  return tokenRulesTextAligns(token.oracleText, spec.rulesText);
}

function distinguishingKeywordCount(token: TokenMatchFields): number {
  return (token.keywords || []).filter((keyword) => isDistinguishingTokenKeyword(keyword)).length;
}

export function compareTokenPrintingPreference(
  a: TokenMatchFields,
  b: TokenMatchFields,
  spec: TokenImageMatchSpec,
): number {
  if (spec.abilities === undefined) {
    const keywordDelta = distinguishingKeywordCount(a) - distinguishingKeywordCount(b);
    if (keywordDelta !== 0) return keywordDelta;
  }
  if (spec.rulesText === undefined) {
    const aRules = normalizeRulesText(a.oracleText) ? 1 : 0;
    const bRules = normalizeRulesText(b.oracleText) ? 1 : 0;
    if (aRules !== bRules) return aRules - bRules;
  }
  if (spec.isArtifact === undefined) {
    const aArtifact = String(a.typeLine || '').toLowerCase().includes('artifact') ? 1 : 0;
    const bArtifact = String(b.typeLine || '').toLowerCase().includes('artifact') ? 1 : 0;
    if (aArtifact !== bArtifact) return aArtifact - bArtifact;
  }
  const released = String(b.releasedAt || '').localeCompare(String(a.releasedAt || ''));
  if (released !== 0) return released;
  return String(a.id || '').localeCompare(String(b.id || ''));
}

export function pickPreferredTokenPrinting<T extends TokenMatchFields>(
  matches: T[],
  spec: TokenImageMatchSpec,
): T | undefined {
  if (matches.length === 0) return undefined;
  return [...matches].sort((a, b) => compareTokenPrintingPreference(a, b, spec))[0];
}
