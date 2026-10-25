/**
 * Oracle IR "attacks alone" (attacks_alone) and battalion (attacks_in_group).
 * Called by getAttackTriggersForCreatures with the declared attackers. A printed
 * line owns its source: legacy entries (battalion, creature_attacks_alone,
 * typed_attacks_alone, ...) that duplicate it are dropped so each fires once.
 * Public: applyParsedGroupAttackTriggers.
 */
import { collectMatchingParsedEventLines, parsedEffectDuplicates, parsedEventLinesFor } from './triggerConditionFamilyMatch.js';

const GROUP_ATTACK_EVENTS = ['attacks_alone', 'attacks_in_group'] as const;

export function applyParsedGroupAttackTriggers(
  ctx: any,
  triggers: any[],
  attackingCreatures: readonly any[],
  resolveAttackedPlayerId: (attacker: any) => string,
): void {
  const battlefield: any[] = Array.isArray(ctx?.state?.battlefield) ? ctx.state.battlefield : [];
  const attackerCount = attackingCreatures.length;
  const linesBySource = new Map<string, Array<{ effect: string }>>();
  for (const permanent of battlefield) {
    if (!permanent?.card) continue;
    const lines = parsedEventLinesFor(String(permanent.card.oracle_text || ''), GROUP_ATTACK_EVENTS, String(permanent.card.name || '') || undefined);
    if (lines.length > 0) linesBySource.set(String(permanent.id || ''), lines);
  }
  if (linesBySource.size === 0) return;

  const kept = triggers.filter((trigger) => {
    const lines = linesBySource.get(String(trigger?.permanentId || ''));
    if (!lines || String(trigger?.triggerType || '') === 'parsed_attacks') return true;
    return !lines.some((line) => parsedEffectDuplicates([trigger.effect, trigger.description], line));
  });
  triggers.splice(0, triggers.length, ...kept);

  const seen = new Set<string>();
  for (const permanent of battlefield) {
    if (!permanent?.card || !linesBySource.has(String(permanent.id || ''))) continue;
    for (const attacker of attackingCreatures) {
      for (const event of GROUP_ATTACK_EVENTS) {
        for (const line of collectMatchingParsedEventLines({
          ctx,
          oracleText: String(permanent.card.oracle_text || ''),
          event,
          subjectPermanent: attacker,
          subjectControllerId: String(attacker?.controller || ''),
          sourcePermanent: permanent,
          matchContext: { attackerCount },
        })) {
          const key = `${String(permanent.id || '')}|${String(attacker?.id || '')}|${line.effect.toLowerCase()}`;
          if (seen.has(key)) continue;
          seen.add(key);
          const defendingPlayerId = resolveAttackedPlayerId(attacker);
          triggers.push({
            permanentId: String(permanent.id || ''),
            cardName: String(permanent.card?.name || 'Unknown'),
            controllerId: String(permanent.controller || ''),
            triggerType: 'parsed_attacks',
            description: line.effect,
            effect: line.effect,
            mandatory: !/\byou may\b/i.test(line.effect),
            value: { attackingCreatureId: attacker?.id, defendingPlayerId, defendingPlayer: defendingPlayerId },
            ...(line.reflexive ? { reflexiveWhenYouDo: line.reflexive } : {}),
            ...(line.delayed ? { delayedEndStep: line.delayed } : {}),
          });
        }
      }
    }
  }
}
