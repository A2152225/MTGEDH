import { detectTriggeredAbilityEvent } from './triggeredAbilitiesEventDetection';
import { TriggerEvent, TriggerKeyword, type TriggeredAbility } from './triggeredAbilitiesTypes';

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
  const text = oracleText.toLowerCase();

  const triggerPattern =
    /\b(when(?:ever)?|at(?:\s+the\s+beginning\s+of)?)\s+([^,]+),\s*([\s\S]*?)(?=(?:\bwhen(?:ever)?|\bat(?:\s+the\s+beginning\s+of)?)\s+[^,]+,|$)/gi;

  let match;
  let index = 0;

  while ((match = triggerPattern.exec(text)) !== null) {
    const keyword = match[1].toLowerCase().startsWith('at')
      ? TriggerKeyword.AT
      : match[1].toLowerCase() === 'whenever'
        ? TriggerKeyword.WHENEVER
        : TriggerKeyword.WHEN;

    const triggerCondition = match[2].trim();
    let effect = match[3].trim();

    const eventInfo = detectTriggeredAbilityEvent(triggerCondition, TriggerEvent);
    const optional = effect.includes('you may') || effect.includes('may have');

    let interveningIf = triggerCondition.includes(' if ')
      ? triggerCondition.split(' if ')[1]
      : undefined;

    if (!interveningIf) {
      const leadingIf = effect.match(/^if\s+([^,]+),\s*(.+)$/i);
      if (leadingIf) {
        interveningIf = String(leadingIf[1] || '').trim();
        effect = String(leadingIf[2] || '').trim();
      }
    }

    const selfTrigger = triggerCondition.includes('this creature') ||
      triggerCondition.includes('this permanent') ||
      triggerCondition.includes(`${cardName.toLowerCase()}`);

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

    index++;
  }

  return abilities;
}
