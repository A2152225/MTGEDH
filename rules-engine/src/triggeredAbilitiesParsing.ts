import { parseTriggeredAbility } from './oracleTextParser';
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
    const hasInterveningIf = Boolean(interveningIf);

    abilities.push({
      id: `${permanentId}-trigger-${index}`,
      sourceId: permanentId,
      sourceName: cardName,
      controllerId,
      keyword,
      event: eventInfo.event,
      condition: triggerFilter || interveningIf,
      ...(triggerFilter ? { triggerFilter } : {}),
      ...(interveningIf ? { interveningIfClause: interveningIf } : {}),
      ...(hasInterveningIf ? { hasInterveningIf } : {}),
      effect,
      optional,
    });
    index += 1;
  }

  return abilities;
}
