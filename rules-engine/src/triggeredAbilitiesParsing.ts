import { parseTriggeredAbility } from './oracleTextParser';
import { parseKeywordTriggeredAbility } from './oracleTextParserKeywordTriggers';
import { detectTriggeredAbilityEvent } from './triggeredAbilitiesEventDetection';
import { normalizeGameplayEffectText } from './oracleReminderText.js';
import { truncateAtAbilityBoundary } from './triggerEffectTextExtraction.js';
import { TriggerEvent, TriggerKeyword, type TriggeredAbility } from './triggeredAbilitiesTypes';

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildSelfReferenceAliases(cardName: string): readonly string[] {
  const normalized = String(cardName || '').trim();
  if (!normalized) return [];

  const aliases = new Set<string>();
  aliases.add(normalized);

  for (const face of normalized.split(/\s*\/\/\s*/).map(part => part.trim()).filter(Boolean)) {
    aliases.add(face);
    const commaHead = String(face.split(',')[0] || '').trim();
    if (commaHead.length >= 3) aliases.add(commaHead);
  }

  return [...aliases].sort((a, b) => b.length - a.length);
}

function normalizeSelfNamedTriggerCondition(triggerCondition: string, cardName: string): string {
  const trimmed = String(triggerCondition || '').trim();
  if (!trimmed) return trimmed;

  for (const alias of buildSelfReferenceAliases(cardName)) {
    const pattern = new RegExp(`^${escapeRegex(alias)}(?=\\s+(?:dies\\b|is\\s+put\\s+into\\b))`, 'i');
    if (!pattern.test(trimmed)) continue;
    return trimmed.replace(pattern, 'this permanent');
  }

  return trimmed;
}

function shouldPreserveTriggerConditionFilter(normalizedCondition: string): boolean {
  return (
    normalizedCondition === "this creature and at least one other creature with power greater than this creature's power attack" ||
    normalizedCondition === 'this and at least two other creatures attack' ||
    normalizedCondition === 'you cast this spell' ||
    normalizedCondition === 'you cast this card' ||
    normalizedCondition === 'you cast this creature' ||
    normalizedCondition === 'you cast a spell that targets this creature' ||
    normalizedCondition === 'you cast a spell that targets this permanent' ||
    normalizedCondition === 'you cast a spell' ||
    normalizedCondition === 'an opponent casts a spell' ||
    normalizedCondition === 'opponent casts a spell' ||
    normalizedCondition === 'you cast a noncreature spell' ||
    normalizedCondition === 'an opponent casts a noncreature spell' ||
    normalizedCondition === 'opponent casts a noncreature spell' ||
    normalizedCondition === 'you cast an instant or sorcery spell' ||
    normalizedCondition === 'an opponent casts an instant or sorcery spell' ||
    normalizedCondition === 'opponent casts an instant or sorcery spell' ||
    normalizedCondition === 'when_you_do' ||
    normalizedCondition === 'you do' ||
    normalizedCondition === 'you cycle this card' ||
    normalizedCondition === 'you draw your second card each turn' ||
    normalizedCondition === 'this creature is turned face up' ||
    /^it regenerates this way$/.test(normalizedCondition) ||
    /^the beginning of (?:your |each player's )?draw step$/.test(normalizedCondition) ||
    /^the beginning of (?:your )?first main phase$/.test(normalizedCondition) ||
    /^you commit a crime$/.test(normalizedCondition) ||
    normalizedCondition === 'commit_a_crime' ||
    normalizedCondition === 'you_cycle_this_card' ||
    /^this creature exploits a creature$/.test(normalizedCondition) ||
    normalizedCondition === 'chaos ensues' ||
    normalizedCondition === 'an opponent casts their first noncreature spell each turn' ||
    normalizedCondition === 'opponent casts their first noncreature spell each turn' ||
    normalizedCondition === 'a player casts a spell' ||
    normalizedCondition === 'a player casts a creature spell' ||
    normalizedCondition === 'a player casts a noncreature spell' ||
    normalizedCondition === 'you cast your first spell each turn' ||
    normalizedCondition === 'you cast your first spell during each opponent\'s turn' ||
    /^an opponent casts (?:a |an )?(?:creature|noncreature) spell$/.test(normalizedCondition) ||
    /^a player casts (?:a |an )?(?:creature|noncreature) spell$/.test(normalizedCondition) ||
    normalizedCondition === 'another creature enters the battlefield under your control' ||
    normalizedCondition === 'this permanent enters the battlefield' ||
    normalizedCondition === 'this creature enters the battlefield' ||
    /^(?:a|an)\s+[a-z][a-z -]*\s+enters(?:\s+the\s+battlefield)?\s+under\s+your\s+control$/.test(normalizedCondition) ||
    /^(?:another\s+)?(?:a|an)\s+[a-z][a-z -]*\s+you\s+control\s+enters(?:\s+the\s+battlefield)?$/.test(normalizedCondition) ||
    normalizedCondition === 'this creature attacks or blocks' ||
    normalizedCondition === 'a creature an opponent controls attacks' ||
    normalizedCondition === 'enchanted creature becomes tapped' ||
    normalizedCondition === 'enchanted creature is dealt damage' ||
    /^another [\w]+ creature you control dies$/.test(normalizedCondition) ||
    /^a [\w]+ creature you control dies$/.test(normalizedCondition) ||
    /^one or more creatures that are enchanted by an aura you control attack$/.test(normalizedCondition)
  );
}

function isInsideParentheses(text: string, index: number): boolean {
  let depth = 0;
  for (let i = 0; i < index; i++) {
    const ch = text[i];
    if (ch === '(') depth += 1;
    else if (ch === ')') depth = Math.max(0, depth - 1);
  }
  return depth > 0;
}

function isInsideQuotes(text: string, index: number): boolean {
  let inQuotes = false;
  for (let i = 0; i < index; i++) {
    if (text[i] === '"') inQuotes = !inQuotes;
  }
  return inQuotes;
}

/** Replaces parenthetical regions with spaces so splice/conspire cast reminders are not parsed as triggers. */
function maskParentheticalRegions(text: string): string {
  let out = '';
  let depth = 0;
  for (const char of text) {
    if (char === '(') {
      depth += 1;
      out += char;
      continue;
    }
    if (char === ')') {
      depth = Math.max(0, depth - 1);
      out += char;
      continue;
    }
    out += depth > 0 ? (char === '\n' ? '\n' : ' ') : char;
  }
  return out;
}

/** Replaces quoted regions with spaces so trigger regex cannot match granted ability text. */
function maskQuotedRegions(text: string): string {
  let out = '';
  let inQuotes = false;
  for (const char of text) {
    if (char === '"') {
      inQuotes = !inQuotes;
      out += char;
      continue;
    }
    out += inQuotes ? (char === '\n' ? '\n' : ' ') : char;
  }
  return out;
}

function shouldSkipParsedTrigger(triggerCondition: string, rawAbilityText: string): boolean {
  const cond = String(triggerCondition || '').trim().toLowerCase();
  const raw = String(rawAbilityText || '').trim().toLowerCase();
  if (/^that mana is spent\b/.test(cond)) return true;
  if (/^(?:the next|you next cast)\b/.test(cond)) return true;
  if (/^when you next cast\b/.test(raw)) return true;
  if (/^when that mana is spent\b/.test(raw)) return true;
  // Static restrictions mis-parsed as triggers (Nullstone Gargoyle, Sentinel Tower, etc.)
  if (/^only\s+one\s+/.test(cond) && /\bis cast\b/.test(cond)) return true;
  if (/^an?\s+/.test(cond) && /\bis cast during your turn\b/.test(cond)) return true;
  if (/^noncreature spells cost\b/.test(raw)) return true;
  // Activated scry-then-next-cast riders (Elminster, Narset, etc.)
  if (/\{[0-9bwurgcx\/]+\}/.test(raw) && /\byou scry\b/.test(raw) && /\bnext\b.*\bcast\b/.test(raw)) return true;
  if (/^you scry\b/.test(raw) && /\bnext\b.*\bcast\b/.test(raw)) return true;
  // Embedded delayed triggers inside activated abilities (Planeswalker's Mischief, Psychic Theft, etc.)
  if (/\bactivate only\b/.test(raw) && /\bat the beginning of\b.*\bend step\b/.test(raw)) return true;
  if (/^\{[^}]+\}/.test(raw) && /\bat the beginning of\b.*\bend step\b/.test(raw)) return true;
  // Cast riders on other effects, not standalone triggers
  if (/^if you cast (?:a |an )?(?:creature )?spell this way\b/.test(cond)) return true;
  if (/^when you cast it this turn\b/.test(cond) && /\{[^}]+\}/.test(raw)) return true;
  // Permission text, not triggers (Ian Malcolm, etc.)
  if (/^during each player's turn\b/.test(cond) && /\bmay cast\b/.test(raw)) return true;
  if (/^that player may cast\b/.test(cond)) return true;
  // Granted ability text on other objects (Alaundo time counter grant)
  if (/\bif you cast (?:a |an )?(?:creature )?spell this way\b/.test(cond)) return true;
  if (/\bthe last time counter is removed\b/.test(cond)) return true;
  if (/\bwhen the last time counter is removed\b/.test(cond)) return true;
  if (/\byou may cast (?:it|that card|the exiled card|that spell) without paying its mana cost\b/.test(cond)) {
    if (/,/.test(cond) || /\b(?:exile|attacks|draw|play lands)\b/.test(cond)) return true;
    if (!/^you cast this spell\b/.test(cond)) return true;
  }
  if (/\bwhen you cast this spell,\s*exile cards from the top\b/.test(cond)) return true;
  if (/\bleaves the battlefield\b/.test(cond) && /\breturn target\b/.test(cond)) return true;
  if (/^you cast a creature spell from this\b/.test(cond)) return true;
  if (/^you cast a spell from that\b/.test(cond)) return true;
  // Delayed trigger on the cast spell, not this permanent (Ogre Battlecaster haste rider)
  if (/^(?:when )?you cast that spell\b/.test(cond)) return true;
  if (/\bwhen you cast that spell\b/.test(raw) && /\battacks\b/.test(raw)) return true;
  // Splice/conspire/cascade keyword reminders and delayed exile riders
  if (/\bsplice onto\b/.test(cond) || /\bconspire\s*\(/.test(cond)) return true;
  if (/^the beginning of the next end step\b/.test(cond)) return true;
  if (/\bas you cast an arcane spell\b/.test(cond)) return true;
  if (/^you spend this mana\b/.test(cond)) return true;
  // Replacement effects mis-parsed as triggers
  if (/^if a source you control would\b/.test(raw) || /^if a source would\b/.test(raw)) return true;
  // Permission riders (Ian Malcolm cast-from-exile permission)
  if (/^during each player's turn\b/.test(cond) && /\bmay cast\b/.test(raw)) return true;
  if (/^that player may cast\b/.test(cond)) return true;
  // Static restrictions (Nullstone-style mis-parse from reminder text)
  if (/\bcan be cast each turn\b/.test(cond) && !/\bwhenever\b/.test(raw)) return true;
  // Fight aftermath / delayed triggers on one-shot spells (Rhino's Rampage, etc.)
  if (/^excess damage is dealt\b/.test(cond)) return true;
  if (/\bthis way\b/.test(cond) && /\bexcess damage\b/.test(cond)) return true;
  // Keyword ability lines mis-parsed as triggers (station, augment)
  if (/^station\s+\d+\+?(?:\s*\|)?/i.test(cond)) return true;
  if (/^augment\s+\{/i.test(cond)) return true;
  return false;
}

function isOnLoyaltyAbilityLine(text: string, matchIndex: number): boolean {
  const lineStart = text.lastIndexOf('\n', Math.max(0, matchIndex - 1)) + 1;
  const lineHead = text.slice(lineStart, matchIndex + 1);
  if (/^(?:[+−\-]?\d+|0)\s*:/u.test(text.slice(lineStart))) return true;
  return /[+−\-]\d+\s*:/.test(lineHead);
}

function truncateTriggeredAbilityText(text: string): string {
  const loyaltyBreak = text.search(/\n[+−\-]\d+\s*:/u);
  const withoutLoyalty = loyaltyBreak >= 0 ? text.slice(0, loyaltyBreak) : text;
  return truncateAtAbilityBoundary(withoutLoyalty);
}

function splitCompoundTriggerConditions(condition: string): string[] {
  const normalized = String(condition || '').trim();
  if (!/\s+or\s+/i.test(normalized)) return [normalized];

  const parts = normalized.split(/\s+or\s+/i).map((part) => part.trim()).filter(Boolean);
  if (parts.length < 2) return [normalized];

  const isTriggerLike = (part: string) =>
    /\b(cast|enters|dies|attacks|leaves|discarded|drawn|sacrificed|blocks|mutates)\b/i.test(part);

  if (!parts.every(isTriggerLike)) return [normalized];

  const expanded: string[] = [];
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (/^(?:attacks|blocks|dies|enters(?: the battlefield)?)$/i.test(part) && i > 0) {
      const prevPart = parts[i - 1];
      const sharedSubject = prevPart
        .replace(/\s+(?:enters(?:\s+the\s+battlefield)?|dies|attacks|blocks)\s*$/i, '')
        .trim();
      if (sharedSubject) {
        expanded.push(`${sharedSubject} ${part}`);
        continue;
      }
    }
    expanded.push(part);
  }

  return expanded;
}

function normalizeTriggeredEffectTextCase(effectText: string): string {
  let inQuotes = false;
  let normalized = '';

  for (const char of String(effectText || '')) {
    if (char === '"') {
      inQuotes = !inQuotes;
      normalized += char;
      continue;
    }

    normalized += inQuotes ? char : char.toLowerCase();
  }

  return normalized;
}

/**
 * Parse triggered abilities from oracle text.
 * Returns all triggers found in the text.
 */
export function parseTriggeredAbilitiesFromText(
  oracleText: string,
  permanentId: string,
  controllerId: string,
  cardName: string
): TriggeredAbility[] {
  const abilities: TriggeredAbility[] = [];
  let index = 0;

  const normalizedText = String(oracleText || '').replace(/\r/g, '').trim();
  const searchableText = maskParentheticalRegions(maskQuotedRegions(normalizedText));
  const triggerPattern =
    /\b(?:when(?:ever)?|at\s+the\s+beginning\s+of)\b[\s\S]*?(?=(?:[.?!]\s+|\n+\s*)(?:when(?:ever)?|at\s+the\s+beginning\s+of)\b|$)/gi;

  let match: RegExpExecArray | null;
  while ((match = triggerPattern.exec(searchableText)) !== null) {
    if (typeof match.index === 'number' && isOnLoyaltyAbilityLine(normalizedText, match.index)) {
      continue;
    }

    const rawAbilityText = truncateTriggeredAbilityText(
      String(normalizedText.slice(match.index, match.index + match[0].length) || '').trim(),
    );
    if (typeof match.index === 'number' && (isInsideParentheses(normalizedText, match.index) || isInsideQuotes(normalizedText, match.index))) {
      continue;
    }

    const parsedAbility = parseTriggeredAbility(rawAbilityText);
    if (!parsedAbility?.triggerCondition || !parsedAbility.effect) continue;

    const triggerCondition = normalizeSelfNamedTriggerCondition(
      String(parsedAbility.triggerCondition || '').trim(),
      cardName
    );
    if (shouldSkipParsedTrigger(triggerCondition, rawAbilityText)) continue;

    const keyword = parsedAbility.triggerKeyword === 'at'
      ? TriggerKeyword.AT
      : parsedAbility.triggerKeyword === 'whenever'
        ? TriggerKeyword.WHENEVER
        : TriggerKeyword.WHEN;

    let effect = normalizeGameplayEffectText(String(parsedAbility.effect || '').trim());
    const normalizedEffect = effect.toLowerCase();
    const normalizedTriggerCondition = triggerCondition.toLowerCase();

    let interveningIf = parsedAbility.interveningIf;

    if (!interveningIf) {
      const leadingIf = effect.match(/^if\s+([^,]+),\s*(.+)$/i);
      if (leadingIf) {
        interveningIf = String(leadingIf[1] || '').trim();
        effect = String(leadingIf[2] || '').trim();
      }
    }

    const hasInterveningIf = Boolean(interveningIf);
    const compoundConditions = splitCompoundTriggerConditions(triggerCondition);

    for (const clauseCondition of compoundConditions) {
      const normalizedClauseCondition = clauseCondition.toLowerCase();
      const eventInfo = detectTriggeredAbilityEvent(clauseCondition, TriggerEvent);
      const optional = normalizedEffect.includes('you may') || normalizedEffect.includes('may have');
      const triggerFilter = eventInfo.filter;
      const preservedTriggerFilter = shouldPreserveTriggerConditionFilter(normalizedClauseCondition)
        ? clauseCondition
        : undefined;

      abilities.push({
        id: `${permanentId}-trigger-${index}`,
        sourceId: permanentId,
        sourceName: cardName,
        controllerId,
        keyword,
        event: eventInfo.event,
        condition: preservedTriggerFilter || triggerFilter || interveningIf,
        ...(preservedTriggerFilter || triggerFilter
          ? { triggerFilter: preservedTriggerFilter || triggerFilter }
          : {}),
        ...(interveningIf ? { interveningIfClause: interveningIf } : {}),
        ...(hasInterveningIf ? { hasInterveningIf } : {}),
        effect: normalizeTriggeredEffectTextCase(effect),
        optional,
      });
      index += 1;
    }
  }

  const lines = normalizedText
    .split(/\n+/)
    .map(line => String(line || '').trim())
    .filter(Boolean);
  for (const line of lines) {
    const parsedKeyword = parseKeywordTriggeredAbility(line);
    if (!parsedKeyword?.triggerCondition || !parsedKeyword.effect) continue;
    const keyword = parsedKeyword.triggerKeyword === 'at'
      ? TriggerKeyword.AT
      : parsedKeyword.triggerKeyword === 'when'
        ? TriggerKeyword.WHEN
        : TriggerKeyword.WHENEVER;
    const eventInfo = detectTriggeredAbilityEvent(parsedKeyword.triggerCondition, TriggerEvent);
    const interveningIf = String(parsedKeyword.interveningIf || '').trim() || undefined;
    const normalizedKeywordTriggerCondition = String(parsedKeyword.triggerCondition || '').trim().toLowerCase();
    const preservedKeywordTriggerFilter = shouldPreserveTriggerConditionFilter(normalizedKeywordTriggerCondition)
      ? String(parsedKeyword.triggerCondition || '').trim()
      : undefined;

    abilities.push({
      id: `${permanentId}-trigger-${index}`,
      sourceId: permanentId,
      sourceName: cardName,
      controllerId,
      keyword,
      event: eventInfo.event,
      condition: preservedKeywordTriggerFilter || eventInfo.filter || interveningIf,
      ...(preservedKeywordTriggerFilter || eventInfo.filter
        ? { triggerFilter: preservedKeywordTriggerFilter || eventInfo.filter }
        : {}),
      ...(interveningIf ? { interveningIfClause: interveningIf, hasInterveningIf: true } : {}),
      effect: normalizeTriggeredEffectTextCase(
        normalizeGameplayEffectText(String(parsedKeyword.effect || '').trim()),
      ),
      optional: Boolean(parsedKeyword.isOptional),
    });
    index += 1;
  }

  return abilities;
}
