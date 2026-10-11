/**
 * Shared subject-phrase parser for the trigger condition IR.
 * Public: parseSubjectPhrase, TRIGGER_SUBJECT_KEYWORDS.
 *
 * The phrase is the object in front of the event ("another Goblin you control",
 * "this creature or another creature with flying"). Returns null unless the
 * phrase is fully described.
 */

import { normalizeCreatureTypeWord } from '../../../shared/src/creatureTypes.js';
import type {
  TriggerConditionEvent,
  TriggerConditionIR,
  TriggerControllerRelation,
  TriggerSourceRelation,
  TriggerSubjectFilter,
  TriggerTokenRestriction,
} from './types.js';

const CARD_TYPE_WORDS: Readonly<Record<string, string>> = {
  creature: 'creature',
  creatures: 'creature',
  artifact: 'artifact',
  artifacts: 'artifact',
  enchantment: 'enchantment',
  enchantments: 'enchantment',
  land: 'land',
  lands: 'land',
  planeswalker: 'planeswalker',
  planeswalkers: 'planeswalker',
  battle: 'battle',
  battles: 'battle',
  permanent: 'permanent',
  permanents: 'permanent',
  aura: 'aura',
  auras: 'aura',
  equipment: 'equipment',
  instant: 'instant',
  instants: 'instant',
  sorcery: 'sorcery',
  sorceries: 'sorcery',
};

const NON_CARD_TYPE: Readonly<Record<string, string>> = {
  nonartifact: 'artifact',
  noncreature: 'creature',
  nonenchantment: 'enchantment',
  nonland: 'land',
  nonplaneswalker: 'planeswalker',
  nonbattle: 'battle',
  nonpermanent: 'permanent',
  nonaura: 'aura',
  noninstant: 'instant',
  nonsorcery: 'sorcery',
};

const SUPERTYPES = new Set(['legendary', 'basic', 'snow', 'world']);

const COLOR_LETTERS: Readonly<Record<string, string>> = {
  white: 'w',
  blue: 'u',
  black: 'b',
  red: 'r',
  green: 'g',
};

/** Longest phrases first so "double strike" wins over "strike". */
export const TRIGGER_SUBJECT_KEYWORDS: readonly string[] = [
  'double strike',
  'first strike',
  'flying',
  'flash',
  'haste',
  'vigilance',
  'trample',
  'menace',
  'deathtouch',
  'lifelink',
  'reach',
  'defender',
  'hexproof',
  'indestructible',
  'shroud',
  'shadow',
  'fear',
  'intimidate',
  'prowess',
  'infect',
  'wither',
];

const REFUSE =
  /\b(?:enchanted|equipped|target|mana|where|unless|whenever|when)\b/i;

interface SubjectChunk {
  types: string[];
  subtypes: string[];
}

interface SubjectQualifiers {
  counters: { name?: string; minimum: number }[];
  stats: { stat: 'power' | 'toughness'; op: 'gte' | 'lte'; value: number }[];
  chosenType: boolean;
  dealtDamageBy?: 'source' | 'equipped';
  faceDown: boolean;
  goaded: boolean;
  attackingOrBlocking: boolean;
  commander: boolean;
  owner: 'any' | 'you' | 'not_you';
  historic: boolean;
  colors: string[];
}

function emptyQualifiers(): SubjectQualifiers {
  return {
    counters: [],
    stats: [],
    chosenType: false,
    faceDown: false,
    goaded: false,
    attackingOrBlocking: false,
    commander: false,
    owner: 'any',
    historic: false,
    colors: [],
  };
}

function applyQualifiers(subject: TriggerSubjectFilter, qualifiers: SubjectQualifiers): TriggerSubjectFilter {
  return {
    ...subject,
    ...(qualifiers.counters.length ? { counters: qualifiers.counters } : {}),
    ...(qualifiers.stats.length ? { stats: qualifiers.stats } : {}),
    ...(qualifiers.chosenType ? { chosenType: true } : {}),
    ...(qualifiers.dealtDamageBy ? { dealtDamageBy: qualifiers.dealtDamageBy } : {}),
    ...(qualifiers.faceDown ? { faceDown: true } : {}),
    ...(qualifiers.goaded ? { goaded: true } : {}),
    ...(qualifiers.attackingOrBlocking ? { attackingOrBlocking: true } : {}),
    ...(qualifiers.commander ? { commander: true } : {}),
    ...(qualifiers.owner !== 'any' ? { owner: qualifiers.owner } : {}),
    ...(qualifiers.historic ? { historic: true } : {}),
    ...(qualifiers.colors.length ? { colors: qualifiers.colors } : {}),
  };
}

function qualifiersAreRestrictive(qualifiers: SubjectQualifiers): boolean {
  return qualifiers.counters.length > 0
    || qualifiers.stats.length > 0
    || qualifiers.chosenType
    || Boolean(qualifiers.dealtDamageBy)
    || qualifiers.faceDown
    || qualifiers.goaded
    || qualifiers.attackingOrBlocking
    || qualifiers.commander
    || qualifiers.historic
    || qualifiers.colors.length > 0;
}

function stripSubjectQualifiers(tokens: readonly string[]): { tokens: string[]; qualifiers: SubjectQualifiers } | null {
  const qualifiers = emptyQualifiers();
  const kept: string[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    const next = tokens[index + 1];
    if (token === 'face-down' || (token === 'face' && next === 'down')) {
      qualifiers.faceDown = true;
      if (token === 'face') index += 1;
      continue;
    }
    if (token === 'goaded') {
      qualifiers.goaded = true;
      continue;
    }
    if (token === 'commander' || token === 'commanders') {
      qualifiers.commander = true;
      continue;
    }
    if (token === 'historic') {
      qualifiers.historic = true;
      continue;
    }
    if (COLOR_LETTERS[token]) {
      qualifiers.colors.push(COLOR_LETTERS[token]);
      continue;
    }
    if (token === 'attacking' && next === 'or' && tokens[index + 2] === 'blocking') {
      qualifiers.attackingOrBlocking = true;
      index += 2;
      continue;
    }
    if (token === 'of' && next === 'the' && tokens[index + 2] === 'chosen' && (tokens[index + 3] === 'type' || (tokens[index + 3] === 'creature' && tokens[index + 4] === 'type'))) {
      qualifiers.chosenType = true;
      index += tokens[index + 3] === 'creature' ? 4 : 3;
      continue;
    }
    if (token === 'dealt' && next === 'damage' && tokens[index + 2] === 'by' && tokens[index + 3] === 'this' && tokens[index + 4] === 'creature' && tokens[index + 5] === 'this' && tokens[index + 6] === 'turn') {
      qualifiers.dealtDamageBy = 'source';
      index += 6;
      continue;
    }
    if (token === 'dealt' && next === 'damage' && tokens[index + 2] === 'by' && tokens[index + 3] === 'equipped' && tokens[index + 4] === 'creature' && tokens[index + 5] === 'this' && tokens[index + 6] === 'turn') {
      qualifiers.dealtDamageBy = 'equipped';
      index += 6;
      continue;
    }
    if (token === 'with' && (next === 'power' || next === 'toughness')) {
      const value = Number(tokens[index + 2]);
      const orWord = tokens[index + 3];
      const bound = tokens[index + 4];
      if (!Number.isFinite(value) || orWord !== 'or' || (bound !== 'greater' && bound !== 'more' && bound !== 'less')) return null;
      qualifiers.stats.push({
        stat: next,
        op: bound === 'less' ? 'lte' : 'gte',
        value,
      });
      index += 4;
      continue;
    }
    if (token === 'with' && next === 'counters') {
      qualifiers.counters.push({ minimum: 1 });
      index += 1;
      if (tokens[index + 1] === 'on' && tokens[index + 2] === 'it') index += 2;
      continue;
    }
    if (token === 'with' && (next === 'a' || next === 'an') && tokens[index + 3] === 'counter') {
      const name = String(tokens[index + 2] || '');
      if (!name || name === 'or') return null;
      qualifiers.counters.push({ name, minimum: 1 });
      index += 3;
      if (tokens[index + 1] === 'on' && tokens[index + 2] === 'it') index += 2;
      continue;
    }
    kept.push(token);
  }
  return { tokens: kept, qualifiers };
}

export function normalizeTriggerClause(clause: string): string {
  return String(clause || '')
    .replace(/[’]/g, "'")
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function consumeController(tokens: readonly string[]): { controller: TriggerControllerRelation; owner: 'any' | 'you' | 'not_you'; rest: string[] } | null {
  const rest = [...tokens];
  let owner: 'any' | 'you' | 'not_you' = 'any';
  const endsWith = (...words: string[]): boolean => {
    if (rest.length < words.length) return false;
    const tail = rest.slice(rest.length - words.length);
    return words.every((word, index) => tail[index] === word);
  };
  if (endsWith('but', "don't", 'own') || endsWith('but', 'dont', 'own')) {
    rest.splice(rest.length - 3, 3);
    owner = 'not_you';
  } else if (endsWith('but', 'do', 'not', 'own')) {
    rest.splice(rest.length - 4, 4);
    owner = 'not_you';
  } else if (endsWith('you', "don't", 'own') || endsWith('you', 'dont', 'own')) {
    rest.splice(rest.length - 3, 3);
    owner = 'not_you';
  } else if (endsWith('you', 'do', 'not', 'own')) {
    rest.splice(rest.length - 4, 4);
    owner = 'not_you';
  } else if (endsWith('you', 'own')) {
    rest.splice(rest.length - 2, 2);
    owner = 'you';
  }
  if (endsWith('you', "don't", 'control') || endsWith('you', 'dont', 'control')) {
    rest.splice(rest.length - 3, 3);
    return { controller: 'not_you', owner, rest };
  }
  if (endsWith('you', 'do', 'not', 'control')) {
    rest.splice(rest.length - 4, 4);
    return { controller: 'not_you', owner, rest };
  }
  if (endsWith('an', 'opponent', 'controls')) {
    rest.splice(rest.length - 3, 3);
    return { controller: 'not_you', owner, rest };
  }
  if (endsWith('you', 'control')) {
    rest.splice(rest.length - 2, 2);
    return { controller: 'you', owner, rest };
  }
  return { controller: 'any', owner, rest };
}

function excludedWord(token: string): string | null {
  if (NON_CARD_TYPE[token]) return NON_CARD_TYPE[token];
  const hyphen = /^non-([a-z]+)$/.exec(token);
  if (!hyphen || hyphen[1].endsWith('s')) return null;
  return hyphen[1];
}

function keywordAt(tokens: readonly string[], index: number): { keyword: string; consumed: number } | null {
  const rest = tokens.slice(index).join(' ');
  for (const keyword of TRIGGER_SUBJECT_KEYWORDS) {
    if (rest === keyword || rest.startsWith(`${keyword} `)) {
      return { keyword, consumed: keyword.split(' ').length };
    }
  }
  return null;
}

function splitSubjectAlternatives(clause: string): string[] {
  const parts: string[] = [];
  let rest = clause;
  while (rest) {
    const match = / or (?=(?:this|another|other|a|an|one)\b)/.exec(rest);
    if (!match || match.index < 0) {
      parts.push(rest);
      break;
    }
    parts.push(rest.slice(0, match.index));
    rest = rest.slice(match.index + ' or '.length);
  }
  return parts.map((part) => part.trim()).filter(Boolean);
}

function shareCardTypes(chunks: SubjectChunk[]): void {
  const typed = chunks.filter((chunk) => chunk.types.length > 0);
  const untyped = chunks.filter((chunk) => chunk.types.length === 0 && chunk.subtypes.length > 0);
  if (typed.length === 0 || untyped.length === 0) return;
  const signature = typed[0].types.join('|');
  if (!typed.every((chunk) => chunk.types.join('|') === signature)) return;
  for (const chunk of untyped) chunk.types = [...typed[0].types];
}

function parseOneSubject(clause: string, event: TriggerConditionEvent, quantity: TriggerConditionIR['quantity']): TriggerConditionIR | null {
  const normalized = normalizeTriggerClause(clause);
  if (!normalized || REFUSE.test(normalized)) return null;

  let tokens = normalized.split(' ').filter(Boolean);
  let source: TriggerSourceRelation = 'any';
  if (tokens[0] === 'this' || tokens[0] === '~') {
    source = 'self';
    tokens = tokens.slice(1);
  } else if (tokens[0] === 'another' || tokens[0] === 'other') {
    source = 'another';
    tokens = tokens.slice(1);
  }

  const controllerParsed = consumeController(tokens);
  if (!controllerParsed) return null;
  tokens = controllerParsed.rest;
  const stripped = stripSubjectQualifiers(tokens);
  if (!stripped) return null;
  tokens = stripped.tokens;
  if (controllerParsed.owner !== 'any') stripped.qualifiers.owner = controllerParsed.owner;

  let tokenRestriction: TriggerTokenRestriction = 'any';
  const excludedWords: string[] = [];
  const supertypes: string[] = [];
  const keywordsWith: string[] = [];
  const keywordsWithout: string[] = [];
  const chunks: SubjectChunk[] = [{ types: [], subtypes: [] }];

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === 'a' || token === 'an' || token === 'the') continue;
    if (token === 'or') {
      if (chunks[chunks.length - 1].types.length === 0 && chunks[chunks.length - 1].subtypes.length === 0) return null;
      chunks.push({ types: [], subtypes: [] });
      continue;
    }
    if (token === 'with' || token === 'without') {
      const bucket = token === 'with' ? keywordsWith : keywordsWithout;
      let cursor = index + 1;
      const found = keywordAt(tokens, cursor);
      if (!found) return null;
      bucket.push(found.keyword);
      cursor += found.consumed;
      while (tokens[cursor] === 'and' || tokens[cursor] === 'or') {
        const next = keywordAt(tokens, cursor + 1);
        if (!next) return null;
        bucket.push(next.keyword);
        cursor += 1 + next.consumed;
      }
      index = cursor - 1;
      continue;
    }
    if (token === 'nontoken' || token === 'non-token') {
      if (tokenRestriction !== 'any') return null;
      tokenRestriction = 'nontoken';
      continue;
    }
    if (token === 'token' || token === 'tokens') {
      if (tokenRestriction !== 'any') return null;
      tokenRestriction = 'token';
      continue;
    }
    const excluded = excludedWord(token);
    if (excluded) {
      excludedWords.push(excluded);
      continue;
    }
    if (SUPERTYPES.has(token)) {
      supertypes.push(token);
      continue;
    }
    const typeWord = CARD_TYPE_WORDS[token];
    const chunk = chunks[chunks.length - 1];
    if (typeWord) {
      chunk.types.push(typeWord);
      continue;
    }
    const subtype = normalizeCreatureTypeWord(token);
    if (!subtype) return null;
    chunk.subtypes.push(subtype);
  }

  if (chunks.some((chunk) => chunk.types.length === 0 && chunk.subtypes.length === 0)) {
    const tokenOnly = tokenRestriction !== 'any';
    if (!qualifiersAreRestrictive(stripped.qualifiers) && !tokenOnly && excludedWords.length === 0 && supertypes.length === 0) return null;
    chunks.splice(0, chunks.length, { types: ['permanent'], subtypes: [] });
  }
  shareCardTypes(chunks);

  const anyObject = chunks.some((chunk) => chunk.types.includes('permanent'));
  const subtypeGroups = anyObject
    ? [chunks.flatMap((chunk) => chunk.subtypes)].filter((group) => group.length > 0)
    : chunks.map((chunk) => chunk.subtypes);
  const subject = applyQualifiers({
    anyObject,
    typeGroups: anyObject ? [] : chunks.map((chunk) => chunk.types),
    subtypeGroups,
    excludedWords,
    supertypes,
    keywordsWith,
    keywordsWithout,
    token: tokenRestriction,
  }, stripped.qualifiers);

  const hasFilter = subject.anyObject
    || subject.typeGroups.some((group) => group.length > 0)
    || subject.subtypeGroups.some((group) => group.length > 0)
    || qualifiersAreRestrictive(stripped.qualifiers);
  if (!hasFilter) return null;

  return {
    event,
    quantity,
    alternatives: [{
      controller: controllerParsed.controller,
      source,
      subject,
    }],
  };
}

export function parseSubjectPhrase(clause: string, event: TriggerConditionEvent): TriggerConditionIR | null {
  const normalized = normalizeTriggerClause(clause);
  if (!normalized || REFUSE.test(normalized)) return null;

  let quantity: TriggerConditionIR['quantity'] = 'one';
  let text = normalized;
  if (text.startsWith('one or more ')) {
    quantity = 'one_or_more';
    text = text.slice('one or more '.length);
  }

  const parts = splitSubjectAlternatives(text);
  const parsed = parts.map((part) => parseOneSubject(part, event, quantity));
  if (parsed.some((entry) => !entry)) return null;
  return {
    event,
    quantity,
    alternatives: parsed.flatMap((entry) => entry!.alternatives),
  };
}
