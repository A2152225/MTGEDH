import { stripLegendaryFromTypeLine } from './copyTokenUtils.js';

export type CopyTokenOverrides = {
  readonly power?: number;
  readonly toughness?: number;
  readonly colors?: readonly string[];
  readonly addCardTypes?: readonly string[];
  readonly addSubtypes?: readonly string[];
  readonly addAbilities?: readonly string[];
  readonly removeManaCost?: boolean;
  readonly removeLegendary?: boolean;
};

const COPY_TOKEN_KEYWORDS = [
  'flying',
  'haste',
  'lifelink',
  'deathtouch',
  'trample',
  'vigilance',
  'menace',
  'reach',
  'first strike',
  'double strike',
  'prowess',
  'ward',
];

const COLOR_WORD_TO_SYMBOL: Record<string, string> = {
  white: 'W',
  blue: 'U',
  black: 'B',
  red: 'R',
  green: 'G',
};

function normalizeExceptionText(value: string | undefined): string {
  return String(value || '')
    .replace(/\u2019/g, "'")
    .toLowerCase()
    .replace(/[.\s]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function dedupeStrings(values: readonly string[]): readonly string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const normalized = String(value || '').trim();
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(normalized);
  }
  return out;
}

function splitTypeLine(typeLine: string): {
  readonly supertypes: readonly string[];
  readonly cardTypes: readonly string[];
  readonly subtypes: readonly string[];
} {
  const normalized = String(typeLine || '').replace(/\s+/g, ' ').trim();
  if (!normalized) return { supertypes: [], cardTypes: [], subtypes: [] };

  const dashSplit = normalized.split(/\s+(?:\u2014|-)\s+/);
  const main = String(dashSplit[0] || '').trim();
  const subtypePart = String(dashSplit[1] || '').trim();
  const mainWords = main.split(/\s+/g).filter(Boolean);
  const supertypeSet = new Set(['Basic', 'Legendary', 'Ongoing', 'Snow', 'World']);
  const cardTypeSet = new Set([
    'Artifact',
    'Battle',
    'Creature',
    'Enchantment',
    'Instant',
    'Kindred',
    'Land',
    'Planeswalker',
    'Sorcery',
    'Tribal',
  ]);

  const supertypes: string[] = [];
  const cardTypes: string[] = [];
  for (const word of mainWords) {
    if (supertypeSet.has(word)) supertypes.push(word);
    else if (cardTypeSet.has(word)) cardTypes.push(word);
  }

  const subtypes = subtypePart ? subtypePart.split(/\s+/g).filter(Boolean) : [];
  return { supertypes, cardTypes, subtypes };
}

function buildTypeLine(parts: {
  readonly supertypes: readonly string[];
  readonly cardTypes: readonly string[];
  readonly subtypes: readonly string[];
}): string {
  const main = [...parts.supertypes, ...parts.cardTypes].filter(Boolean).join(' ').trim();
  const subtypeText = [...parts.subtypes].filter(Boolean).join(' ').trim();
  if (main && subtypeText) return `${main} \u2014 ${subtypeText}`;
  return main || subtypeText || 'Token';
}

function applyTypeLineOverrides(typeLine: string, overrides: CopyTokenOverrides): string {
  const split = splitTypeLine(typeLine);
  const supertypes = overrides.removeLegendary
    ? split.supertypes.filter((type) => type.toLowerCase() !== 'legendary')
    : [...split.supertypes];
  const cardTypes = dedupeStrings([...split.cardTypes, ...(overrides.addCardTypes || [])]);
  const subtypes = dedupeStrings([...split.subtypes, ...(overrides.addSubtypes || [])]);
  return buildTypeLine({ supertypes, cardTypes, subtypes });
}

function capitalizeAbility(value: string): string {
  const raw = String(value || '').trim();
  return raw ? raw.charAt(0).toUpperCase() + raw.slice(1) : raw;
}

function extractCopyGrantedAbilities(exceptionText: string): readonly string[] {
  const raw = String(exceptionText || '').trim();
  if (!raw) return [];

  const quoted = Array.from(raw.matchAll(/"([^"]+)"/g))
    .map((match) => String(match[1] || '').trim())
    .filter(Boolean);

  const unquotedAbilities: string[] = [];
  const hasMatch = raw.match(/\b(?:it|they|the token|the tokens)\s+ha(?:s|ve)\s+(.+)$/i);
  if (hasMatch) {
    const body = String(hasMatch[1] || '')
      .replace(/"[^"]+"/g, ' ')
      .replace(/\b(?:until|at)\b.+$/i, '')
      .replace(/[.]+$/g, '')
      .trim();
    for (const piece of body.split(/\s*,\s*|\s+and\s+/gi)) {
      const normalized = piece.trim().toLowerCase();
      if (!normalized) continue;
      const keyword = COPY_TOKEN_KEYWORDS.find(
        (candidate) => normalized === candidate || normalized.startsWith(`${candidate} `),
      );
      if (keyword) unquotedAbilities.push(capitalizeAbility(keyword));
    }
  }

  for (const keyword of COPY_TOKEN_KEYWORDS) {
    if (new RegExp(`\\b(?:and\\s+)?has\\s+${keyword}\\b`, 'i').test(raw)) {
      unquotedAbilities.push(capitalizeAbility(keyword));
    }
    if (new RegExp(`\\bgains?\\s+${keyword}\\b`, 'i').test(raw)) {
      unquotedAbilities.push(capitalizeAbility(keyword));
    }
  }

  return dedupeStrings([...quoted, ...unquotedAbilities]);
}

/** Parse the "except …" clause from copy-token oracle text (Helm, Delina, etc.). */
export function extractCopyTokenExceptionFromEffect(effectText: string): string {
  const raw = String(effectText || '').trim();
  if (!/\bexcept\b/i.test(raw)) return '';

  const exceptCoreMatch = raw.match(/\bexcept\s+([^.]+)/i);
  if (!exceptCoreMatch) return '';

  let exception = String(exceptCoreMatch[1] || '').trim();
  const grantsSentence = raw.match(
    /\.\s*((?:that|those)\s+tokens?\s+(?:gains?|have)\s+[^.]+)/i,
  );
  const itGrantsSentence = raw.match(/\.\s*it\s+(?:gains?|has)\s+[^.]+/i);
  if (grantsSentence) {
    const grantClause = String(grantsSentence[1] || '').trim();
    if (grantClause) {
      exception = `${exception}. ${grantClause.charAt(0).toUpperCase()}${grantClause.slice(1)}`;
    }
  } else if (itGrantsSentence) {
    const grantClause = String(itGrantsSentence[0] || '').replace(/^\.\s*/i, '').trim();
    if (grantClause) {
      exception = `${exception}. ${grantClause.charAt(0).toUpperCase()}${grantClause.slice(1)}`;
    }
  }

  return exception.replace(/[.\s]+$/g, '').trim();
}

/** Parse modifiers from a copy-token "except …" fragment. */
export function parseCopyTokenOverrides(exceptionText: string): CopyTokenOverrides {
  const structuralException = String(exceptionText || '')
    .split(/\.\s*(?:it|that|those)\s+(?:gains?|has)\b/i)[0]
    .trim();
  const normalized = normalizeExceptionText(structuralException);
  const directAbilities = extractCopyGrantedAbilities(exceptionText);
  const removeLegendary =
    /\bisn'?t legendary\b/i.test(normalized) ||
    /\b(?:it'?s|they'?re|the tokens?|the token)\s+not\s+legendary\b/i.test(normalized) ||
    /\bnot\s+legendary\b/i.test(normalized);
  if (!normalized) return {};

  const ptAdditionalCreatureMatch = normalized.match(
    /^(?:it's|it is|they're|they are|the token is|the tokens are)\s+(?:a\s+)?(\d+)\/(\d+)\s+(.+?)\s+creatures?\s+in addition to (?:its|their) other types(?:,?\s+and\s+(?:it|they)\s+ha(?:s|ve)\s+(.+?))?$/,
  );
  if (ptAdditionalCreatureMatch) {
    const descriptorWords = String(ptAdditionalCreatureMatch[3] || '')
      .split(/\s+/g)
      .map((word) => word.trim())
      .filter(Boolean);
    const colors: string[] = [];
    const subtypeWords: string[] = [];
    for (const word of descriptorWords) {
      const color = COLOR_WORD_TO_SYMBOL[word];
      if (color) colors.push(color);
      else if (word !== 'and') subtypeWords.push(word);
    }

    const abilities = dedupeStrings([
      ...directAbilities,
      ...String(ptAdditionalCreatureMatch[4] || '')
        .split(/\s*,\s*|\s+and\s+/gi)
        .map((part) => part.trim())
        .filter(Boolean)
        .map(capitalizeAbility),
    ]);

    return {
      power: Number.parseInt(String(ptAdditionalCreatureMatch[1] || ''), 10),
      toughness: Number.parseInt(String(ptAdditionalCreatureMatch[2] || ''), 10),
      ...(colors.length > 0 ? { colors } : {}),
      addCardTypes: ['Creature'],
      ...(subtypeWords.length > 0
        ? {
            addSubtypes: dedupeStrings(
              subtypeWords.map((word) => word.charAt(0).toUpperCase() + word.slice(1)),
            ),
          }
        : {}),
      ...(abilities.length > 0 ? { addAbilities: abilities } : {}),
      ...(removeLegendary ? { removeLegendary: true } : {}),
    };
  }

  const ptCreatureMatch = normalized.match(
    /^(?:it's|it is|they're|they are|the token is|the tokens are)\s+a\s+(\d+)\/(\d+)\s+(.+?)\s+creatures?(?:\s+with\s+(.+?))?(?:\s+in addition to (?:its|their) other types)?$/,
  );
  if (ptCreatureMatch) {
    const descriptorWords = String(ptCreatureMatch[3] || '')
      .split(/\s+/g)
      .map((word) => word.trim())
      .filter(Boolean);
    const colors: string[] = [];
    const subtypeWords: string[] = [];
    for (const word of descriptorWords) {
      const color = COLOR_WORD_TO_SYMBOL[word];
      if (color) colors.push(color);
      else if (word !== 'and') subtypeWords.push(word);
    }

    const abilities = dedupeStrings([
      ...directAbilities,
      ...String(ptCreatureMatch[4] || '')
        .split(/\s*,\s*|\s+and\s+/gi)
        .map((part) => part.trim())
        .filter(Boolean)
        .map(capitalizeAbility),
    ]);

    return {
      power: Number.parseInt(String(ptCreatureMatch[1] || ''), 10),
      toughness: Number.parseInt(String(ptCreatureMatch[2] || ''), 10),
      ...(colors.length > 0 ? { colors: dedupeStrings(colors) } : {}),
      addCardTypes: ['Creature'],
      ...(subtypeWords.length > 0
        ? {
            addSubtypes: dedupeStrings(
              subtypeWords.map((word) => word.charAt(0).toUpperCase() + word.slice(1)),
            ),
          }
        : {}),
      ...(abilities.length > 0 ? { addAbilities: abilities } : {}),
      ...(removeLegendary ? { removeLegendary: true } : {}),
    };
  }

  const removeManaCost = /\bhas no mana cost\b/i.test(normalized);
  const colors = Array.from(
    new Set(
      Array.from(normalized.matchAll(/\bit'?s?\s+(white|blue|black|red|green)\b/g))
        .map((match) => COLOR_WORD_TO_SYMBOL[String(match[1] || '').trim().toLowerCase()])
        .filter(Boolean),
    ),
  );
  const ptMatch = normalized.match(/\bit'?s?(?:\s+a)?\s+(\d+)\/(\d+)\b/);
  const ptColorSubtypeMatch = normalized.match(
    /\bit'?s?\s+a\s+(\d+)\/(\d+)\s+((?:white|blue|black|red|green)(?:\s+and\s+(?:white|blue|black|red|green))*)\s+([a-z][a-z ]*?)\s*$/,
  );
  const ptBareSubtypeMatch = normalized.match(/\bit'?s?\s+a\s+(\d+)\/(\d+)\s+([a-z][a-z ]*?)\s*$/);
  const subtypeMatch = normalized.match(
    /\bit'?s?\s+a\s+([a-z][a-z ]*)\s+in addition to its other types\b/,
  );
  const addArtifact = /\bit'?s?\s+an?\s+artifact\b/i.test(normalized);

  let power: number | undefined;
  let toughness: number | undefined;
  let addSubtypes = subtypeMatch
    ? dedupeStrings(
        String(subtypeMatch[1] || '')
          .split(/\s+and\s+|\s+/g)
          .map((word) => word.trim())
          .filter(Boolean)
          .map((word) => word.charAt(0).toUpperCase() + word.slice(1)),
      )
    : undefined;

  if (ptColorSubtypeMatch) {
    power = Number.parseInt(String(ptColorSubtypeMatch[1] || ''), 10);
    toughness = Number.parseInt(String(ptColorSubtypeMatch[2] || ''), 10);
    const colorPhrase = String(ptColorSubtypeMatch[3] || '').trim().toLowerCase();
    for (const word of colorPhrase.split(/\s+and\s+|\s+/g)) {
      const color = COLOR_WORD_TO_SYMBOL[word.trim()];
      if (color && !colors.includes(color)) colors.push(color);
    }
    const subtypeRaw = String(ptColorSubtypeMatch[4] || '').trim();
    if (subtypeRaw) {
      addSubtypes = dedupeStrings([
        ...(addSubtypes || []),
        ...subtypeRaw
          .split(/\s+and\s+|\s+/g)
          .map((word) => word.trim())
          .filter(Boolean)
          .map((word) => word.charAt(0).toUpperCase() + word.slice(1)),
      ]);
    }
  } else if (ptBareSubtypeMatch) {
    const descriptor = String(ptBareSubtypeMatch[3] || '').trim().toLowerCase();
    power = Number.parseInt(String(ptBareSubtypeMatch[1] || ''), 10);
    toughness = Number.parseInt(String(ptBareSubtypeMatch[2] || ''), 10);
    const firstWord = descriptor.split(/\s+/)[0] || '';
    const color = COLOR_WORD_TO_SYMBOL[firstWord];
    if (color && !colors.includes(color)) {
      colors.push(color);
    }
    const subtypeWords = descriptor
      .split(/\s+/g)
      .filter((word) => word && !COLOR_WORD_TO_SYMBOL[word]);
    if (subtypeWords.length > 0) {
      addSubtypes = dedupeStrings([
        ...(addSubtypes || []),
        ...subtypeWords.map((word) => word.charAt(0).toUpperCase() + word.slice(1)),
      ]);
    }
  } else if (ptMatch) {
    power = Number.parseInt(String(ptMatch[1] || ''), 10);
    toughness = Number.parseInt(String(ptMatch[2] || ''), 10);
  }

  if (
    removeLegendary
    || directAbilities.length > 0
    || removeManaCost
    || colors.length > 0
    || power != null
    || (addSubtypes && addSubtypes.length > 0)
    || addArtifact
  ) {
    return {
      ...(removeLegendary ? { removeLegendary: true } : {}),
      ...(directAbilities.length > 0 ? { addAbilities: directAbilities } : {}),
      ...(removeManaCost ? { removeManaCost: true } : {}),
      ...(colors.length > 0 ? { colors: dedupeStrings(colors) } : {}),
      ...(power != null ? { power } : {}),
      ...(toughness != null ? { toughness } : {}),
      ...(addSubtypes && addSubtypes.length > 0 ? { addSubtypes } : {}),
      ...(addArtifact ? { addCardTypes: ['Artifact'] } : {}),
    };
  }

  return {};
}

export function parseCopyTokenOverridesFromEffect(effectText: string): CopyTokenOverrides {
  return parseCopyTokenOverrides(extractCopyTokenExceptionFromEffect(effectText));
}

function appendAbilityToOracle(oracleText: string, abilities: readonly string[]): string {
  const base = String(oracleText || '').trim();
  const additions = abilities
    .map((ability) => String(ability || '').trim())
    .filter(Boolean)
    .filter((ability) => !base.toLowerCase().includes(ability.toLowerCase()));
  if (additions.length === 0) return base;
  return [base, ...additions].filter(Boolean).join('\n');
}

/** Apply parsed copy modifiers onto a token card + optional permanent shell. */
export function applyCopyTokenOverrides(
  card: Record<string, unknown>,
  overrides: CopyTokenOverrides,
  permanent?: Record<string, unknown> | null,
): void {
  if (overrides.removeLegendary) {
    if (card.type_line) {
      card.type_line = stripLegendaryFromTypeLine(String(card.type_line));
    }
    if (permanent?.type_line) {
      permanent.type_line = stripLegendaryFromTypeLine(String(permanent.type_line));
    }
    if (permanent?.cardType) {
      permanent.cardType = stripLegendaryFromTypeLine(String(permanent.cardType));
    }
  }

  if (
    (overrides.addCardTypes && overrides.addCardTypes.length > 0)
    || (overrides.addSubtypes && overrides.addSubtypes.length > 0)
    || overrides.removeLegendary
  ) {
    const nextTypeLine = applyTypeLineOverrides(String(card.type_line || 'Creature'), overrides);
    card.type_line = nextTypeLine;
    if (permanent) {
      permanent.type_line = nextTypeLine;
      permanent.cardType = nextTypeLine;
    }
  }

  if (overrides.power != null) {
    card.power = String(overrides.power);
    if (permanent) permanent.basePower = overrides.power;
  }
  if (overrides.toughness != null) {
    card.toughness = String(overrides.toughness);
    if (permanent) permanent.baseToughness = overrides.toughness;
  }

  if (overrides.removeManaCost) {
    card.mana_cost = '';
    card.manaCost = '';
  }

  if (overrides.colors && overrides.colors.length > 0) {
    card.colors = [...overrides.colors];
  }

  const addAbilities = overrides.addAbilities || [];
  if (addAbilities.length > 0) {
    const keywords = Array.isArray(card.keywords) ? [...(card.keywords as string[])] : [];
    for (const ability of addAbilities) {
      if (!keywords.some((k) => String(k).toLowerCase() === ability.toLowerCase())) {
        keywords.push(ability);
      }
    }
    card.keywords = keywords;
    card.oracle_text = appendAbilityToOracle(String(card.oracle_text || ''), addAbilities);
    if (permanent) {
      permanent.oracle_text = card.oracle_text;
    }
  }

  if (permanent && card.type_line) {
    permanent.type_line = card.type_line;
    permanent.cardType = card.type_line;
  }
}

export function reapplyStoredCopyTokenOverrides(permanent: unknown): void {
  if (!permanent || typeof permanent !== 'object') return;
  const perm = permanent as Record<string, unknown>;
  const overrides = perm.copyTokenOverrides as CopyTokenOverrides | undefined;
  if (!overrides || typeof overrides !== 'object') return;
  const card = perm.card;
  if (!card || typeof card !== 'object' || Array.isArray(card)) return;
  applyCopyTokenOverrides(card as Record<string, unknown>, overrides, perm);
}
