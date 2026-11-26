/**
 * Shared trigger-condition matcher.
 * Public: triggerConditionMatches.
 * Subject filters live in matchSubjectFilter.ts and condition qualifiers in matchQualifiers.ts.
 *
 * Compares a parsed condition to the event's subject and source. It does not
 * read oracle text.
 */

import { playerBindingsMatch } from './matchPlayerBindings.js';
import { matchRound67Filters } from './matchRound67.js';
import type { TriggerConditionIR, TriggerMatchContext, TriggerMatchPermanent, TriggerMatchSource } from './types.js';
import { subjectFilterMatches } from './matchSubjectFilter.js';
import { qualifiersMatch } from './matchQualifiers.js';

function alternativeMatches(
  alternative: TriggerConditionIR['alternatives'][number],
  subject: TriggerMatchPermanent,
  source: TriggerMatchSource,
  context: TriggerMatchContext | undefined,
): boolean {
  const subjectId = String(subject.id || '').trim();
  const sourceId = String(source.id || '').trim();
  if (alternative.source === 'another' && subjectId && sourceId && subjectId === sourceId) {
    return false;
  }
  if (alternative.source === 'self' && (!subjectId || !sourceId || subjectId !== sourceId)) {
    return false;
  }
  if (alternative.source === 'self_or_another' && (!subjectId || !sourceId)) {
    return false;
  }
  if (alternative.source === 'enchanted' || alternative.source === 'equipped') {
    const attachedToId = String(source.attachedToId || '').trim();
    if (!attachedToId || !subjectId || attachedToId !== subjectId) return false;
  }

  const subjectController = String(subject.controllerId || '').trim();
  const sourceController = String(source.controllerId || '').trim();
  if (alternative.controller === 'you' && subjectController !== sourceController) return false;
  if (alternative.controller === 'not_you' && subjectController === sourceController) return false;
  if (alternative.controller === 'enchanted_player') {
    const enchanted = String(context?.enchantedPlayerId || '').trim();
    if (!enchanted || subjectController !== enchanted) return false;
  }

  return subjectFilterMatches(alternative.subject, subject, source, context);
}

function libraryOwnerMatches(
  condition: TriggerConditionIR,
  subject: TriggerMatchPermanent,
  source: TriggerMatchSource,
  context: TriggerMatchContext | undefined,
): boolean {
  if (!condition.libraryOwner || condition.libraryOwner === 'any') return true;
  const libraryOwnerId = String(context?.libraryOwnerId || '').trim();
  const wanted = condition.libraryOwner === 'source'
    ? String(source.controllerId || '').trim()
    : String(subject.controllerId || '').trim();
  return Boolean(libraryOwnerId && wanted && libraryOwnerId === wanted);
}

export function triggerConditionMatches(
  condition: TriggerConditionIR,
  subject: TriggerMatchPermanent,
  source: TriggerMatchSource,
  context?: TriggerMatchContext,
): boolean {
  if (!qualifiersMatch(condition, subject, source, context)) return false;
  if (condition.requireEquippedAttacker) {
    const ok = (context as any)?.attackerEquipped === true || subject.equipped === true;
    if (!ok) return false;
  }
  if (condition.requireToken) {
    const ok = (context as any)?.subjectIsToken === true || subject.isToken === true;
    if (!ok) return false;
  }
  if (condition.hasXInCost) {
    const fromCtx = (context as any)?.hasXInCost === true || (context as any)?.spellHasXInCost === true;
    const cost = String((subject as any)?.manaCost || (subject as any)?.mana_cost || '').toLowerCase();
    if (!fromCtx && !/\{x\}/i.test(cost)) return false;
  }
  if (condition.entersTapped && subject.tapped !== true) return false;
  if (condition.entersUntapped && subject.tapped !== false) return false;
  if (condition.hasAdventure && !subject.hasAdventure) return false;
  if (condition.playerSubject) {
    if (!context?.subjectIsPlayer) return false;
  } else if (context?.subjectIsPlayer) {
    if (!condition.orControllerPlayer) return false;
    const sourceController = String(source.controllerId || '').trim();
    if (!sourceController || String(subject.controllerId || '').trim() !== sourceController) return false;
  }
  if (!libraryOwnerMatches(condition, subject, source, context)) return false;
  if (condition.requireAttackerName) {
    const n = String((subject as any).name || (subject as any).cardName || '').toLowerCase();
    if (n !== String(condition.requireAttackerName).toLowerCase()) return false;
  }
  if (condition.chosenPlayer) {
    const chosen = String(context?.chosenPlayerId || '').trim();
    if (!chosen || String(subject.controllerId || '').trim() !== chosen) return false;
  }
  if (condition.orPlayerSubject) {
    // Subject may be a player or a permanent; accept either.
  }
  if (condition.damageRecipientOwner) {
    const owner = String(subject.ownerId || '').trim();
    const damaged = String(context?.damagedPlayerId || '').trim();
    if (!owner || !damaged || owner !== damaged) return false;
  }
  if (condition.blockPartnerLesserPower) {
    const partner = context?.blockPartner;
    const subjPower = Number((subject as any).power);
    const partnerPower = Number(partner?.power);
    if (!partner || !Number.isFinite(subjPower) || !Number.isFinite(partnerPower) || !(partnerPower < subjPower)) return false;
  }
  if (condition.requireSubjectName) {
    const want = String(condition.requireSubjectName).toLowerCase();
    const got = String(subject.name || '').toLowerCase();
    if (!want || !got || (got !== want && !got.startsWith(want + ",") && !got.startsWith(want + " "))) return false;
  }
  if (condition.sameNameAsSource) {
    const sn = String((subject as any).name || (subject as any).cardName || '').toLowerCase();
    const srcName = String((source as any).name || (source as any).cardName || '').toLowerCase();
    if (!sn || !srcName || sn !== srcName) return false;
  }
  if (condition.controllerNotOwner) {
    const owner = String(subject.ownerId || '').trim();
    const ctrl = String(subject.controllerId || '').trim();
    if (!owner || !ctrl || owner === ctrl) return false;
  }
  if (!matchRound67Filters(condition, subject, source, context)) return false;
  if (!playerBindingsMatch(condition, subject, source, context)) return false;
  if (condition.alternatives.length === 0) return Boolean(condition.whoseTurn);
  return condition.alternatives.some((alternative) => alternativeMatches(alternative, subject, source, context));
}
