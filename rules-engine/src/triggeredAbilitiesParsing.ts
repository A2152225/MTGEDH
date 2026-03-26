import { parseTriggeredAbility } from './oracleTextParser';
import { parseKeywordTriggeredAbility } from './oracleTextParserKeywordTriggers';
import { detectTriggeredAbilityEvent } from './triggeredAbilitiesEventDetection';
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
    normalizedCondition === 'another creature enters the battlefield under your control' ||
    normalizedCondition === 'this permanent enters the battlefield' ||
    normalizedCondition === 'this creature enters the battlefield' ||
    /^(?:a|an)\s+[a-z][a-z -]*\s+enters(?:\s+the\s+battlefield)?\s+under\s+your\s+control$/.test(normalizedCondition)
  );
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
  const triggerPattern =
    /\b(?:when(?:ever)?|at(?:\s+the\s+beginning\s+of)?)\b[\s\S]*?(?=(?:[.?!]\s+|\n+\s*)(?:when(?:ever)?|at(?:\s+the\s+beginning\s+of)?)\b|$)/gi;

  let match: RegExpExecArray | null;
  while ((match = triggerPattern.exec(normalizedText)) !== null) {
    const rawAbilityText = String(match[0] || '').trim();
    const parsedAbility = parseTriggeredAbility(rawAbilityText);
    if (!parsedAbility?.triggerCondition || !parsedAbility.effect) continue;

    const keyword = parsedAbility.triggerKeyword === 'at'
      ? TriggerKeyword.AT
      : parsedAbility.triggerKeyword === 'whenever'
        ? TriggerKeyword.WHENEVER
        : TriggerKeyword.WHEN;

    const triggerCondition = normalizeSelfNamedTriggerCondition(
      String(parsedAbility.triggerCondition || '').trim(),
      cardName
    );
    let effect = String(parsedAbility.effect || '').trim();
    const normalizedEffect = effect.toLowerCase();
    const normalizedTriggerCondition = triggerCondition.toLowerCase();

    const eventInfo = detectTriggeredAbilityEvent(triggerCondition, TriggerEvent);
    const optional = normalizedEffect.includes('you may') || normalizedEffect.includes('may have');

    let interveningIf = parsedAbility.interveningIf;

    if (!interveningIf) {
      const leadingIf = effect.match(/^if\s+([^,]+),\s*(.+)$/i);
      if (leadingIf) {
        interveningIf = String(leadingIf[1] || '').trim();
        effect = String(leadingIf[2] || '').trim();
      }
    }

    const triggerFilter = eventInfo.filter;
    const preservedTriggerFilter = shouldPreserveTriggerConditionFilter(normalizedTriggerCondition)
      ? triggerCondition
      : undefined;
    const hasInterveningIf = Boolean(interveningIf);

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
      effect,
      optional,
    });
    index += 1;
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
      effect: String(parsedKeyword.effect || '').trim(),
      optional: Boolean(parsedKeyword.isOptional),
    });
    index += 1;
  }

  return abilities;
}
