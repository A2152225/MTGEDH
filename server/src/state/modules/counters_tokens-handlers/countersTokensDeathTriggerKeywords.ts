// server/src/state/modules/counters_tokens-handlers/countersTokensDeathTriggerKeywords.ts
// Origin parent: server/src/state/modules/counters_tokens.ts
// Cluster moved: getKeywordDeathTriggersForPermanent + mergeDeathTriggers.
// Public entry symbols: getKeywordDeathTriggersForPermanent, mergeDeathTriggers.

import { detectKeywords } from "../keyword-detection.js";

function getKeywordDeathTriggersForPermanent(permanent: any, controllerId: string): any[] {
  const card = permanent?.card;
  if (!card) {
    return [];
  }

  const detection = detectKeywords(String(card?.oracle_text || ''), String(card?.name || ''));
  return detection.keywords
    .filter((keyword) => keyword.timing === 'dies' && (keyword.category === 'triggered' || keyword.category === 'replacement'))
    .map((keyword) => ({
      source: {
        permanentId: String(permanent?.id || ''),
        cardName: String(card?.name || 'Permanent'),
        controllerId: String(controllerId || ''),
      },
      effect: String(keyword.effect || ''),
      triggerType: 'dies',
      mandatory: keyword.mandatory !== false,
      requiresChoice: keyword.requiresChoice === true,
      queueKeywordChoice: keyword.requiresChoice === true,
      value: keyword.value,
    }))
    .filter((trigger) => trigger.source.permanentId && trigger.effect);
}

function mergeDeathTriggers(baseTriggers: any[], keywordTriggers: any[]): any[] {
  const merged: any[] = [];
  const seen = new Map<string, number>();

  for (const trigger of [...baseTriggers, ...keywordTriggers]) {
    const key = [
      String(trigger?.source?.permanentId || ''),
      String(trigger?.triggerType || ''),
      String(trigger?.effect || ''),
      String(trigger?.value ?? ''),
    ].join('::');
    if (!key) continue;

    const existingIndex = seen.get(key);
    if (typeof existingIndex === 'number') {
      const existing = merged[existingIndex];
      if (trigger?.queueKeywordChoice === true && existing?.queueKeywordChoice !== true) {
        merged[existingIndex] = trigger;
      }
      continue;
    }

    seen.set(key, merged.length);
    merged.push(trigger);
  }

  return merged;
}

export { getKeywordDeathTriggersForPermanent, mergeDeathTriggers };
