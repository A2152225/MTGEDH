/**
 * Game emission for round 67 triggers.
 * Origin parent: countersTokensStateBasedActions.ts SBA pass, ETB/attack trigger pushes,
 * combat damage, target choice, and end-of-turn control revert.
 * Public: queueRound67StateTriggers, reactToCausedTrigger, queueChoosesTargetsTrigger,
 *   queueRound67CombatDamage, linkedAttackerIdsFor, noteExactlyTwoAttackers,
 *   armBlockColorWatch, noteLinkedEquipment.
 */
import type { GameContext } from '../../context.js';
import { queueGenericTriggeredAbility, queueParsedSubjectEvent } from '../triggerEmissionFamilyUtils.js';
import { collectMatchingParsedEventLines, parsedEventLinesFor } from './triggerConditionFamilyMatch.js';
import { permanentHasTriggeredAbilities } from './triggeredAbilitySuppression.js';
import { nameFirstPrintedInArabianNights } from './arabianNightsOriginalNames.js';

const COLOR_LETTER: Record<string, string> = {
  white: 'W', w: 'W', blue: 'U', u: 'U', black: 'B', b: 'B', red: 'R', r: 'R', green: 'G', g: 'G',
};

function battlefieldOf(ctx: GameContext): any[] {
  const bf = (ctx as any)?.state?.battlefield;
  return Array.isArray(bf) ? bf : [];
}

function counterCount(perm: any, kind: string): number {
  const wanted = String(kind || '').toLowerCase();
  const counters = perm?.counters;
  if (counters && typeof counters === 'object') {
    for (const [key, value] of Object.entries(counters)) {
      if (key.toLowerCase() === wanted) return Number(value) || 0;
    }
  }
  return Number(perm?.[`${wanted}Counters`]) || 0;
}

function alreadyQueued(state: any, sourceId: string, effect: string): boolean {
  const stack = Array.isArray(state?.stack) ? state.stack : [];
  const want = effect.toLowerCase();
  return stack.some((item: any) => String(item?.permanentId || item?.source || '') === sourceId
    && String(item?.effect || item?.description || '').toLowerCase() === want);
}

function queueLine(ctx: GameContext, source: any, effect: string, triggerType: string, effectData?: Record<string, unknown>): boolean {
  if (alreadyQueued((ctx as any).state, String(source?.id || ''), effect)) return false;
  const item = queueGenericTriggeredAbility(ctx, {
    permanentId: String(source.id || ''),
    controllerId: String(source.controller || ''),
    cardName: String(source.card?.name || 'Unknown'),
    effect,
    description: effect,
    mandatory: !/^you may\b/i.test(effect),
  }, triggerType, effectData);
  if (item && effectData?.triggeringStackItemId) {
    (item as any).triggeringStackItemId = effectData.triggeringStackItemId;
  }
  return Boolean(item);
}

function colorLettersOf(perm: any): string[] {
  const raw = perm?.card?.colors || perm?.colors || perm?.card?.color_identity || [];
  const list = Array.isArray(raw) ? raw : [];
  return list.map((entry) => COLOR_LETTER[String(entry).toLowerCase()] || String(entry).toUpperCase()).filter(Boolean);
}

/** State triggers checked during SBA: counter thresholds, color rank, Arabian Nights presence. */
export function queueRound67StateTriggers(ctx: GameContext): any[] {
  if ((ctx as any)?.isReplaying) return [];
  const state = (ctx as any).state;
  const queued: any[] = [];
  for (const source of battlefieldOf(ctx)) {
    if (!source?.card) continue;
    if (!permanentHasTriggeredAbilities(source, state, { event: 'other' })) continue;
    const oracle = String(source.card.oracle_text || '');
    const name = String(source.card.name || '');
    for (const line of parsedEventLinesFor(oracle, ['source_counter_threshold', 'color_rank', 'set_presence'], name || undefined)) {
      if (line.condition?.event === 'source_counter_threshold') {
        const kind = String(line.condition.sourceCounterKind || '');
        const need = Number(line.condition.sourceCounterAtLeast);
        if (!kind || !Number.isFinite(need) || counterCount(source, kind) < need) continue;
        if (queueLine(ctx, source, line.effect, 'source_counter_threshold')) queued.push(source.id);
      } else if (line.condition?.event === 'color_rank') {
        if (!colorRankFails(state, source)) continue;
        if (queueLine(ctx, source, line.effect, 'color_rank')) queued.push(source.id);
      } else if (line.condition?.event === 'set_presence' && line.condition.originallyPrintedInSet === 'arn') {
        const ids = arabianNightsPermanentIds(state, String(source.id || ''));
        if (ids.length === 0) continue;
        if (queueLine(ctx, source, line.effect, 'set_presence', { sacrificePermanentIds: ids })) queued.push(source.id);
      }
    }
  }
  return queued;
}

function colorRankFails(state: any, source: any): boolean {
  const chosen = COLOR_LETTER[String(source?.chosenColor || source?.card?.chosenColor || '').toLowerCase()] || '';
  const playerId = String(
    source?.chosenPlayer || source?.chosenPlayerId || source?.chosenOpponentId
    || source?.card?.chosenPlayer || source?.card?.chosenOpponentId || '',
  ).trim();
  if (!chosen || !playerId) return false;
  const counts: Record<string, number> = {};
  for (const perm of Array.isArray(state?.battlefield) ? state.battlefield : []) {
    if (!perm?.card || perm.isToken === true || perm.token === true) continue;
    if (String(perm.controller || '') !== playerId) continue;
    for (const color of colorLettersOf(perm)) counts[color] = (counts[color] || 0) + 1;
  }
  const chosenCount = counts[chosen] || 0;
  return Object.entries(counts).some(([color, count]) => color !== chosen && count >= chosenCount)
    || chosenCount === 0;
}

function arabianNightsPermanentIds(state: any, exceptId: string): string[] {
  const ids: string[] = [];
  for (const perm of Array.isArray(state?.battlefield) ? state.battlefield : []) {
    if (!perm?.card || String(perm.id || '') === exceptId) continue;
    if (perm.isToken === true || perm.token === true || perm.card?.isToken === true) continue;
    if (nameFirstPrintedInArabianNights(String(perm.card.name || ''))) ids.push(String(perm.id));
  }
  return ids;
}

/** "Either of those creatures" — the two creatures that attacked with this enchantment's controller. */
export function noteExactlyTwoAttackers(ctx: GameContext, attackers: readonly any[]): void {
  if ((ctx as any)?.isReplaying) return;
  const byController = new Map<string, any[]>();
  for (const attacker of attackers || []) {
    const id = String(attacker?.controller || '');
    if (!id) continue;
    const list = byController.get(id) || [];
    list.push(attacker);
    byController.set(id, list);
  }
  const combat = Number((ctx as any).state?.combatNumber ?? 1);
  for (const source of battlefieldOf(ctx)) {
    if (!source?.card) continue;
    const lines = parsedEventLinesFor(String(source.card.oracle_text || ''), ['deals_combat_damage_to_player'], String(source.card.name || '') || undefined);
    if (!lines.some((line) => line.condition?.eitherOfLinkedAttackers)) continue;
    const group = byController.get(String(source.controller || '')) || [];
    if (group.length !== 2) {
      delete source.thisCombatLinkedAttackerIds;
      continue;
    }
    source.thisCombatLinkedAttackerIds = group.map((attacker) => String(attacker.id || ''));
    source.thisCombatLinkedCombatNumber = combat;
  }
}

export function linkedAttackerIdsFor(source: any, state: any): string[] {
  const combat = Number(state?.combatNumber ?? 1);
  if (Number(source?.thisCombatLinkedCombatNumber) !== combat) return [];
  return Array.isArray(source?.thisCombatLinkedAttackerIds) ? source.thisCombatLinkedAttackerIds.map(String) : [];
}

/** Combat damage from a permanent source to a permanent. The damaged permanent's own lines only. */
export function queueRound67CombatDamage(ctx: GameContext, damaged: any, damageSource: any): any[] {
  if ((ctx as any)?.isReplaying || !damaged?.card || !damageSource) return [];
  const queued: any[] = [];
  for (const line of collectMatchingParsedEventLines({
    ctx,
    oracleText: String(damaged.card.oracle_text || ''),
    event: 'deals_damage',
    subjectPermanent: damageSource,
    subjectControllerId: String(damageSource.controller || ''),
    sourcePermanent: damaged,
    matchContext: {
      damageRecipientIsSource: true,
      damageKind: 'combat',
      damagedPermanentId: String(damaged.id || ''),
    },
  })) {
    if (queueLine(ctx, damaged, line.effect, 'deals_damage', {
      damagedPermanentId: String(damaged.id || ''),
      damageSourceId: String(damageSource.id || ''),
    })) queued.push(damaged.id);
  }
  return queued;
}

export function reactToCausedTrigger(
  ctx: GameContext,
  causedItem: any,
  cause: { event: 'etb' | 'attack'; permanent: any },
): any[] {
  if ((ctx as any)?.isReplaying || (ctx as any)?._queueingCausedTrigger || !causedItem || !cause?.permanent) return [];
  (ctx as any)._queueingCausedTrigger = true;
  try {
    const creature = /\bcreature\b/i.test(String(cause.permanent?.card?.type_line || cause.permanent?.type_line || ''));
    const queued: any[] = [];
    for (const source of battlefieldOf(ctx)) {
      if (!source?.card) continue;
      if (String(source.id || '') === String(causedItem.permanentId || causedItem.source || '') && String(causedItem.triggerType || '') === 'caused_trigger') continue;
      for (const line of collectMatchingParsedEventLines({
        ctx,
        oracleText: String(source.card.oracle_text || ''),
        event: 'caused_trigger',
        subjectPermanent: cause.permanent,
        subjectControllerId: String(cause.permanent.controller || ''),
        sourcePermanent: source,
        matchContext: {
          causeEvent: cause.event,
          causedSourceId: String(cause.permanent.id || ''),
          causedSourceControllerId: String(cause.permanent.controller || ''),
          causedSourceIsCreature: creature,
          causedAbilitySourceId: String(causedItem.permanentId || causedItem.source || ''),
        },
      })) {
        if (queueLine(ctx, source, line.effect, 'caused_trigger', { triggeringStackItemId: String(causedItem.id || '') })) {
          queued.push(source.id);
        }
      }
    }
    return queued;
  } finally {
    delete (ctx as any)._queueingCausedTrigger;
  }
}

export function queueChoosesTargetsTrigger(ctx: GameContext, playerId: string, stackItemId?: string): any[] {
  if ((ctx as any)?.isReplaying || (ctx as any)?.suppressChoosesTargets) return [];
  const subject = { id: '', typeLine: '', controllerId: playerId, controller: playerId };
  const linked = String(stackItemId || '').trim();
  return queueParsedSubjectEvent(ctx, {
    event: 'chooses_targets',
    subjectPermanent: subject,
    subjectControllerId: playerId,
    triggerType: 'chooses_targets',
    ...(linked ? { effectData: { triggeringStackItemId: linked } } : {}),
  });
}

export function armBlockColorWatch(permanent: any, state: any): void {
  const oracle = String(permanent?.card?.oracle_text || '').toLowerCase();
  if (!/becomes blocked by a creature of that colou?r this turn/.test(oracle)) return;
  permanent.blockColorWatchTurn = Number(state?.turnNumber ?? state?.turn ?? 0);
}

/** "When the chosen creature leaves the battlefield" keeps the chosen id on the source. */
export function rememberChosenCreature(state: any, sourcePermanentId: string, targetId: string): void {
  const source = (Array.isArray(state?.battlefield) ? state.battlefield : []).find((perm: any) => String(perm?.id || '') === String(sourcePermanentId || ''));
  if (!source || !targetId) return;
  if (!/when the chosen creature leaves the battlefield/i.test(String(source?.card?.oracle_text || ''))) return;
  source.chosenCreatureId = String(targetId);
}

export function noteLinkedEquipment(state: any, equipment: any, thiefPermanentId: string): void {
  if (!equipment || !/\bequipment\b/i.test(String(equipment?.card?.type_line || ''))) return;
  const thief = (Array.isArray(state?.battlefield) ? state.battlefield : []).find((perm: any) => String(perm?.id || '') === thiefPermanentId);
  if (thief) thief.linkedEquipmentId = String(equipment.id || '');
}
