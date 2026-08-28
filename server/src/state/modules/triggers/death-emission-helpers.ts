/**
 * Origin: server/src/state/modules/triggered-abilities.ts
 * Cluster: leftover death-emission helpers and DeathTriggerResult
 * Public: DeathTriggerResult, getPermanentRulesTextFragments,
 *   countControlledAurasAttachedTo, dyingCreatureIsEnchanted,
 *   deathTriggerClauseMatchesDyingCreature, appendDetectedDeathWatcherTriggers,
 *   appendDetectedSelfDeathTriggers, appendHauntLeaveDeathTriggers
 */

import type { GameContext } from "../../context.js";
import { detectDeathTriggers } from "./death-detection.js";
import { permanentHasCreatureTypeNow } from "../../creatureTypeNow.js";
import { getCurrentGoaders } from "../goad-effects.js";

// ============================================================================
// Death Trigger System
// ============================================================================

export interface DeathTriggerResult {
  source: {
    permanentId: string;
    cardName: string;
    controllerId: string;
    /** True when the trigger source is an emblem (not a battlefield permanent). */
    isEmblem?: boolean;
  };
  effect: string;
  targets?: string[]; // Player IDs affected
  requiresChoice?: boolean;
  modalOptions?: string[];
  requiresSacrificeSelection?: boolean;
  sacrificeFrom?: string; // Player ID who must sacrifice
  returnsUnderControl?: boolean; // For Grave Betrayal - return under your control
  dyingCreatureCard?: any; // The card that died, for reanimation effects
  /** Snapshotted "for each" amount (e.g. Auras attached as the creature died). */
  referenceAmount?: number;
  value?: any;
  triggerType?: string;
}

export function getPermanentRulesTextFragments(perm: any): string[] {
  const fragments: string[] = [];

  const oracleText = String(perm?.card?.oracle_text || '').trim().toLowerCase();
  if (oracleText) {
    fragments.push(oracleText);
  }

  const grantedAbilities = Array.isArray(perm?.grantedAbilities) ? perm.grantedAbilities : [];
  for (const ability of grantedAbilities) {
    const text = String(ability || '').trim().toLowerCase();
    if (text) {
      fragments.push(text);
    }
  }

  const temporaryAbilities = Array.isArray(perm?.temporaryAbilities) ? perm.temporaryAbilities : [];
  for (const entry of temporaryAbilities) {
    const text = typeof entry === 'string'
      ? String(entry || '').trim().toLowerCase()
      : String(entry?.ability || '').trim().toLowerCase();
    if (text) {
      fragments.push(text);
    }
  }

  return fragments;
}

function deathTriggerPermanentHasKeyword(perm: any, keywordLower: string): boolean {
  const wanted = String(keywordLower || '').toLowerCase().trim();
  if (!wanted) return false;

  const counters = perm?.counters && typeof perm.counters === 'object' ? perm.counters : {};
  if (wanted === 'flying' && Number(counters?.flying || 0) > 0) {
    return true;
  }

  const keywordSets = [
    Array.isArray(perm?.keywords) ? perm.keywords : [],
    Array.isArray(perm?.grantedKeywords) ? perm.grantedKeywords : [],
    Array.isArray(perm?.card?.keywords) ? perm.card.keywords : [],
  ];
  for (const keywords of keywordSets) {
    if (keywords.some((keyword: any) => String(keyword || '').toLowerCase() === wanted)) {
      return true;
    }
  }

  return getPermanentRulesTextFragments(perm).some((text) => text.toLowerCase().includes(wanted));
}

function getPermanentSubtypeWords(typeLineValue: string): string[] {
  const typeLine = String(typeLineValue || '').toLowerCase();
  const subtypeSection = typeLine.includes('—')
    ? typeLine.split('—').slice(1).join(' ')
    : typeLine.includes('-')
      ? typeLine.split('-').slice(1).join(' ')
      : '';
  if (!subtypeSection) {
    return [];
  }

  return subtypeSection
    .split(/[^a-z0-9']+/i)
    .map((part) => part.trim())
    .filter(Boolean);
}

function sourcePermanentIdDamagedDyingCreatureThisTurn(ctx: GameContext, sourcePermanentId: string, dyingCreature: any): boolean {
  const sourceId = String(sourcePermanentId || '').trim();
  const dyingPermanentId = String(dyingCreature?.id || '').trim();
  if (!sourceId || !dyingPermanentId) {
    return false;
  }

  const damaged = (ctx as any)?.state?.creaturesDamagedByThisCreatureThisTurn;
  if (!damaged || typeof damaged !== 'object') {
    return false;
  }

  const victims = (damaged as any)[sourceId];
  return !!(victims && typeof victims === 'object' && victims[dyingPermanentId]);
}

function sourceDamagedDyingCreatureThisTurn(ctx: GameContext, sourcePermanent: any, dyingCreature: any): boolean {
  return sourcePermanentIdDamagedDyingCreatureThisTurn(ctx, String(sourcePermanent?.id || ''), dyingCreature);
}

function equippedCreatureDamagedDyingCreatureThisTurn(ctx: GameContext, sourcePermanent: any, dyingCreature: any): boolean {
  const equippedCreatureId = String((sourcePermanent as any)?.attachedTo || (sourcePermanent as any)?.equippedCreatureId || '').trim();
  if (!equippedCreatureId) {
    return false;
  }

  return sourcePermanentIdDamagedDyingCreatureThisTurn(ctx, equippedCreatureId, dyingCreature);
}

function deathTriggerDyingCreatureWasAttackingOrBlocking(dyingCreature: any): boolean {
  if (!dyingCreature) return false;

  const wasAttacking =
    (typeof dyingCreature.attacking === 'string' && dyingCreature.attacking.trim() !== '') ||
    dyingCreature.attacking === true ||
    dyingCreature.isAttacking === true ||
    dyingCreature.attackedThisTurn === true;

  const blocking = dyingCreature.blocking;
  const wasBlocking =
    (Array.isArray(blocking) && blocking.length > 0) ||
    (typeof blocking === 'string' && blocking.trim() !== '') ||
    blocking === true ||
    dyingCreature.blockedThisTurn === true;

  return wasAttacking || wasBlocking;
}

function isAuraPermanent(permanent: any): boolean {
  const typeLine = String(permanent?.card?.type_line || permanent?.type_line || '').toLowerCase();
  return typeLine.includes('aura');
}

function hasAnyDyingCounter(counters: Record<string, unknown> | object): boolean {
  for (const value of Object.values(counters as Record<string, unknown>)) {
    if (typeof value === 'number' && value > 0) return true;
  }
  return false;
}

export function countControlledAurasAttachedTo(
  ctx: GameContext,
  controllerId: string,
  hostId: string,
): number {
  const battlefield = ctx.state?.battlefield || [];
  const host = String(hostId || '').trim();
  const controller = String(controllerId || '').trim();
  if (!host || !controller) return 0;
  return battlefield.filter((perm: any) => {
    if (!isAuraPermanent(perm)) return false;
    if (String(perm?.attachedTo || '').trim() !== host) return false;
    return String(perm?.controller || '').trim() === controller;
  }).length;
}

export function dyingCreatureIsEnchanted(ctx: GameContext, dyingCreature: any): boolean {
  const dyingId = String(dyingCreature?.id || '').trim();
  if (!dyingId) return false;
  const battlefield = ctx.state?.battlefield || [];
  if (battlefield.some((perm: any) => isAuraPermanent(perm) && String(perm?.attachedTo || '').trim() === dyingId)) {
    return true;
  }
  const attachmentIds = Array.isArray(dyingCreature?.attachments) ? dyingCreature.attachments : [];
  if (attachmentIds.some((id: unknown) => {
    const attachmentId = String(id || '').trim();
    if (!attachmentId) return false;
    const attachment = battlefield.find((perm: any) => String(perm?.id || '') === attachmentId);
    return !attachment || isAuraPermanent(attachment);
  })) {
    return true;
  }
  return false;
}

export function deathTriggerClauseMatchesDyingCreature(
  ctx: GameContext,
  clauseText: string,
  sourcePermanent: any,
  dyingCreature: any,
  dyingCreatureController: string,
): boolean {
  const clause = String(clauseText || '').replace(/[’]/g, "'").toLowerCase();
  if (!clause) return false;

  const damageMarkedDiesClause = /^a\s+creature\s+dealt\s+damage\s+by\s+this\s+creature\s+this\s+turn$/i.test(clause);
  const equippedDamageMarkedDiesClause = /^a\s+creature\s+dealt\s+damage\s+by\s+equipped\s+creature\s+this\s+turn$/i.test(clause);
  if (clause.includes('enchanted creature') || clause.includes('equipped creature')) {
    if (/^an?\s+enchanted creature$/.test(clause)) {
      if (!dyingCreatureIsEnchanted(ctx, dyingCreature)) return false;
    } else if (!equippedDamageMarkedDiesClause) {
      return false;
    }
  }
  const isThisOrAnotherControlledClause =
    /\bthis creature or another (?:nontoken )?creature you control\b/i.test(clause);
  if (
    !damageMarkedDiesClause
    && !isThisOrAnotherControlledClause
    && (clause.includes('this creature') || clause.includes('this permanent') || clause.includes('~'))
  ) {
    return false;
  }

  const sourceCardName = String(sourcePermanent?.card?.name || '').trim().toLowerCase();
  const isNamedOrAnotherClause = /\bor\s+another\b/i.test(clause);
  if (sourceCardName && clause.includes(sourceCardName) && !isNamedOrAnotherClause) return false;

  const sourcePermanentId = String(sourcePermanent?.id || '').trim();
  const dyingPermanentId = String(dyingCreature?.id || '').trim();
  if (clause.includes('another') && !isNamedOrAnotherClause && sourcePermanentId && sourcePermanentId === dyingPermanentId) return false;

  const sourceController = String(sourcePermanent?.controller || '').trim();
  if (clause.includes('you control') && dyingCreatureController !== sourceController) return false;
  if ((clause.includes("you don't control") || clause.includes('an opponent controls')) && dyingCreatureController === sourceController) return false;

  if (damageMarkedDiesClause && !sourceDamagedDyingCreatureThisTurn(ctx, sourcePermanent, dyingCreature)) return false;
  if (equippedDamageMarkedDiesClause && !equippedCreatureDamagedDyingCreatureThisTurn(ctx, sourcePermanent, dyingCreature)) return false;

  const typeLine = String(dyingCreature?.card?.type_line || '').toLowerCase();
  const subtypeWords = getPermanentSubtypeWords(typeLine);
  const clauseMentionsSubtype = subtypeWords.some((subtype) => clause.includes(subtype));
  const wantsCreature = /\bcreatures?\b/.test(clause);
  const wantsArtifact = /\bartifacts?\b/.test(clause);
  const wantsEnchantment = /\benchantments?\b/.test(clause);
  const wantsLand = /\blands?\b/.test(clause);
  const wantsPlaneswalker = /\bplaneswalkers?\b/.test(clause);
  const wantsVehicle = /\bvehicles?\b/.test(clause);
  const wantsPermanent = /\bpermanents?\b/.test(clause);
  const wantsCommander = /\bcommanders?\b/.test(clause);
  const typeOk =
    wantsPermanent
    || wantsCommander
    || (wantsCreature && typeLine.includes('creature'))
    || (wantsArtifact && typeLine.includes('artifact'))
    || (wantsEnchantment && typeLine.includes('enchantment'))
    || (wantsLand && typeLine.includes('land'))
    || (wantsPlaneswalker && typeLine.includes('planeswalker'))
    || (wantsVehicle && typeLine.includes('vehicle'))
    || clauseMentionsSubtype;
  if (!typeOk) return false;
  const counters = dyingCreature?.counters && typeof dyingCreature.counters === 'object' ? dyingCreature.counters : {};
  const ownerId = String(dyingCreature?.owner || dyingCreature?.card?.owner || '').trim();
  const isToken = Boolean(dyingCreature?.isToken || dyingCreature?.token || dyingCreature?.card?.isToken || dyingCreature?.card?.token);
  const isFaceDown = Boolean(dyingCreature?.faceDown || dyingCreature?.isFaceDown || dyingCreature?.card?.faceDown || dyingCreature?.card?.isFaceDown);

  if (clause.includes('nontoken') && isToken) return false;
  if (clause.includes('nonartifact') && typeLine.includes('artifact')) return false;
  {
    const nonSubtype = clause.match(/\bnon-([a-z]+)\b/);
    const excluded = String(nonSubtype?.[1] || '').toLowerCase();
    if (excluded && typeLine.includes(excluded)) return false;
  }
  if (clause.includes("but don't own") && ownerId && ownerId === sourceController) return false;
  if (clause.includes('without flying') && deathTriggerPermanentHasKeyword(dyingCreature, 'flying')) return false;
  if (clause.includes('with a +1/+1 counter on it') && Number(counters['+1/+1'] || counters.plus1plus1 || 0) <= 0) return false;
  const namedCounter = clause.match(/with an? ([+\w/-]+) counter on it/);
  if (namedCounter) {
    const counterName = String(namedCounter[1] || '').trim().toLowerCase();
    if (counterName && counterName !== '+1/+1') {
      const count = Number(
        counters[counterName]
        || counters[String(namedCounter[1] || '')]
        || 0,
      );
      if (count <= 0) return false;
    }
  }
  if (/\bwith counters on it\b/.test(clause) && !hasAnyDyingCounter(counters)) return false;
  if (clause.includes('with defender') && !deathTriggerPermanentHasKeyword(dyingCreature, 'defender')) return false;
  if (/\bcommanders?\b/.test(clause)) {
    const isCommander = Boolean(
      dyingCreature?.isCommander
      || dyingCreature?.commander
      || dyingCreature?.card?.isCommander
    );
    if (!isCommander) return false;
  }
  if (clause.includes('face-down') && !isFaceDown) return false;

  if (clause.includes('of the chosen type')) {
    const chosenType = String(sourcePermanent?.chosenCreatureType || '').trim();
    if (!chosenType) return false;
    return permanentHasCreatureTypeNow(dyingCreature, chosenType);
  }

  if (clause.includes('goaded')) {
    const battlefield = ctx.state?.battlefield || [];
    const currentTurn = ctx.state?.turn;
    if (getCurrentGoaders(dyingCreature, battlefield, currentTurn).length === 0) return false;
  }

  if (clause.includes('attacking or blocking')) {
    if (!deathTriggerDyingCreatureWasAttackingOrBlocking(dyingCreature)) return false;
  }

  return true;
}

function deathTriggerEffectKey(sourceId: string, effect: string): string {
  return `${String(sourceId || '')}::${String(effect || '').toLowerCase().replace(/\s+/g, ' ').trim()}`;
}

function deathResultsHaveEffect(results: DeathTriggerResult[], sourceId: string, effect: string): boolean {
  const key = deathTriggerEffectKey(sourceId, effect);
  return results.some((result) => (
    deathTriggerEffectKey(String(result?.source?.permanentId || ''), String(result?.effect || '')) === key
  ));
}

function pushDetectedDeathTrigger(
  results: DeathTriggerResult[],
  trigger: { permanentId?: string; cardName?: string; effect?: string; description?: string; triggerType?: string },
  controllerId: string,
  dyingCreatureCard?: any,
  extras?: Partial<DeathTriggerResult>,
): void {
  const effect = String(trigger.effect || trigger.description || '').trim();
  const sourceId = String(trigger.permanentId || '');
  if (!effect || !sourceId) return;
  if (deathResultsHaveEffect(results, sourceId, effect)) return;
  results.push({
    source: {
      permanentId: sourceId,
      cardName: String(trigger.cardName || 'Unknown'),
      controllerId: String(controllerId || ''),
    },
    effect,
    requiresSacrificeSelection: effect.toLowerCase().includes('sacrifice'),
    ...(trigger.triggerType ? { triggerType: String(trigger.triggerType) } : null),
    ...(dyingCreatureCard ? { dyingCreatureCard } : null),
    ...(extras || null),
  });
}

function extractDeathEventSubject(oracleText: string): string | null {
  const text = String(oracleText || '');
  const graveyardMatch = text.match(
    /when(?:ever)?\s+(.+?)\s+(?:is )?put into (?:a |your |its owner's )?graveyard(?: from (?:the battlefield|anywhere))?/i,
  );
  if (graveyardMatch?.[1]) {
    return String(graveyardMatch[1]).trim();
  }
  const diesMatch = text.match(/when(?:ever)?\s+(.+?)\s+dies/i);
  if (diesMatch?.[1]) {
    return String(diesMatch[1]).trim();
  }
  return null;
}

function extractDeathEventSubjects(oracleText: string): string[] {
  const chunks = String(oracleText || '').split(/(?:\n+|(?<=[.!?])\s+)/);
  const subjects: string[] = [];
  const seen = new Set<string>();
  for (const chunk of chunks) {
    const subject = extractDeathEventSubject(chunk);
    if (!subject) continue;
    const key = subject.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    subjects.push(subject);
  }
  return subjects;
}

function isSelfOnlyDeathTriggerType(triggerType: string): boolean {
  return triggerType === 'dies'
    || triggerType === 'enters_or_dies'
    || triggerType === 'put_into_graveyard_from_anywhere';
}

function shouldQueueDetectedDeathTrigger(
  ctx: GameContext,
  trigger: { triggerType?: string },
  sourcePermanent: any,
  dyingCreature: any,
  dyingCreatureController: string,
): boolean {
  const triggerType = String(trigger?.triggerType || '').trim();
  if (!triggerType) return false;
  if (
    triggerType === 'undying'
    || triggerType === 'persist'
    || triggerType === 'haunts_creature_dies'
    || triggerType === 'put_into_graveyard_this_turn'
    || triggerType === 'control_none_sacrifice'
    || triggerType === 'that_creature_dies'
    || triggerType === 'graveyard_zone_creature_dies'
    || triggerType === 'typed_permanent_card_your_graveyard_not_battlefield'
    || triggerType === 'black_card_opponent_graveyard_from_anywhere'
  ) {
    return false;
  }
  if (isSelfOnlyDeathTriggerType(triggerType)) {
    return false;
  }

  const sourceId = String(sourcePermanent?.id || '').trim();
  const dyingId = String(dyingCreature?.id || '').trim();
  const isSelf = Boolean(sourceId && dyingId && sourceId === dyingId);
  if (isSelf) {
    const selfAndOtherTypes = new Set([
      'this_or_another_creature_dies',
      'this_or_another_creature_dies_any',
      'this_or_another_typed_creature_dies',
      'this_or_another_typed_creature_dies_any',
      'this_or_another_power_creature_dies',
      'named_or_another_creature_dies',
      'named_or_another_typed_creature_dies',
      'named_or_another_keyword_creature_dies',
      'named_or_nontoken_dies_or_combat_damage_to_player',
    ]);
    if (!selfAndOtherTypes.has(triggerType)) {
      return false;
    }
    const oracle = String(sourcePermanent?.card?.oracle_text || '');
    if (
      triggerType === 'this_or_another_typed_creature_dies'
      && /whenever this creature or another creature you control dies/i.test(oracle)
    ) {
      return false;
    }
    if (
      triggerType === 'named_or_another_typed_creature_dies'
      && /or another creature(?:s)?(?: you control)? dies/i.test(oracle)
    ) {
      return false;
    }
  }

  if (triggerType === 'attachment_dies') {
    const attachedTo = String((sourcePermanent as any)?.attachedTo || '').trim();
    if (attachedTo && attachedTo === dyingId) {
      return true;
    }
    const oracle = String(sourcePermanent?.card?.oracle_text || '');
    if (/an enchanted (?:creature|permanent|land) dies/i.test(oracle)) {
      return dyingCreatureIsEnchanted(ctx, dyingCreature);
    }
    return false;
  }

  if (triggerType === 'dealt_damage_dies') {
    const oracle = String(sourcePermanent?.card?.oracle_text || '').toLowerCase();
    if (oracle.includes('equipped creature')) {
      return equippedCreatureDamagedDyingCreatureThisTurn(ctx, sourcePermanent, dyingCreature);
    }
    return sourceDamagedDyingCreatureThisTurn(ctx, sourcePermanent, dyingCreature);
  }

  const clauses = extractDeathEventSubjects(String(sourcePermanent?.card?.oracle_text || ''));
  if (clauses.length === 0) return false;
  return clauses.some((clause) => deathTriggerClauseMatchesDyingCreature(
    ctx,
    clause,
    sourcePermanent,
    dyingCreature,
    dyingCreatureController,
  ));
}

export function appendDetectedDeathWatcherTriggers(
  ctx: GameContext,
  results: DeathTriggerResult[],
  permanentsToScan: any[],
  dyingCreature: any,
  dyingCreatureController: string,
): void {
  for (const permanent of permanentsToScan) {
    if (!permanent?.card) continue;
    const controllerId = String(permanent.controller || dyingCreatureController || '');
    for (const trigger of detectDeathTriggers(permanent.card, permanent)) {
      if (!shouldQueueDetectedDeathTrigger(ctx, trigger, permanent, dyingCreature, dyingCreatureController)) {
        continue;
      }
      const extras: Partial<DeathTriggerResult> = {};
      const effect = String(trigger.effect || trigger.description || '');
      if (/for each aura/i.test(effect) && dyingCreatureIsEnchanted(ctx, dyingCreature)) {
        extras.referenceAmount = countControlledAurasAttachedTo(
          ctx,
          controllerId,
          String(dyingCreature?.id || ''),
        );
        extras.value = {
          attachedAuraCount: extras.referenceAmount,
          dyingPermanentId: String(dyingCreature?.id || ''),
        };
      }
      const returnsUnderControl = /return/i.test(effect) && /under your control/i.test(effect);
      if (returnsUnderControl) {
        extras.returnsUnderControl = true;
        extras.dyingCreatureCard = dyingCreature?.card;
      }
      pushDetectedDeathTrigger(
        results,
        { ...trigger, permanentId: String(permanent.id || trigger.permanentId || '') },
        controllerId,
        dyingCreature?.card,
        extras,
      );
    }
  }
}

export function appendDetectedSelfDeathTriggers(
  results: DeathTriggerResult[],
  dyingPermanent: any,
  dyingController: string,
): void {
  const card = dyingPermanent?.card;
  if (!card) return;
  const isCreature = String(card?.type_line || '').toLowerCase().includes('creature');
  for (const trigger of detectDeathTriggers(card, dyingPermanent)) {
    const triggerType = String(trigger.triggerType || '');
    if (triggerType === 'enters_or_dies') {
      pushDetectedDeathTrigger(results, trigger, dyingController);
      continue;
    }
    // "This/NAME or another creature you control dies" is a self-and-other
    // trigger. The live self-dies scan only matches NAME immediately before
    // "dies", so queue these here when the dying creature is the source.
    if (
      triggerType === 'this_or_another_creature_dies'
      || triggerType === 'this_or_another_creature_dies_any'
      || triggerType === 'this_or_another_typed_creature_dies'
      || triggerType === 'this_or_another_typed_creature_dies_any'
      || triggerType === 'named_or_another_creature_dies'
      || triggerType === 'named_or_another_typed_creature_dies'
      || triggerType === 'named_or_another_keyword_creature_dies'
    ) {
      pushDetectedDeathTrigger(results, trigger, dyingController);
      continue;
    }
    // Artifact/enchantment "enters or is put into a graveyard" uses triggerType `dies`.
    // Creature "When this creature dies" is already collected by the live self-dies scan.
    if (triggerType === 'dies' && !isCreature) {
      pushDetectedDeathTrigger(results, trigger, dyingController);
    }
  }
}

function hauntingTargetIdFromCard(cardOrPerm: any): string {
  return String(
    cardOrPerm?.hauntingPermanentId
    || cardOrPerm?.hauntedCard
    || cardOrPerm?.hauntingTargetId
    || cardOrPerm?.card?.hauntingPermanentId
    || cardOrPerm?.card?.hauntedCard
    || cardOrPerm?.card?.hauntingTargetId
    || '',
  ).trim();
}

export function appendHauntLeaveDeathTriggers(
  ctx: GameContext,
  results: DeathTriggerResult[],
  dyingCreature: any,
): void {
  const dyingId = String(dyingCreature?.id || '').trim();
  if (!dyingId) return;

  const zones = (ctx.state as any)?.zones && typeof (ctx.state as any).zones === 'object'
    ? Object.values((ctx.state as any).zones)
    : [];
  for (const zone of zones) {
    const exile = Array.isArray((zone as any)?.exile) ? (zone as any).exile : [];
    for (const candidate of exile) {
      if (!candidate) continue;
      const targetId = hauntingTargetIdFromCard(candidate);
      if (!targetId || targetId !== dyingId) continue;
      const card = candidate?.oracle_text ? candidate : candidate?.card;
      if (!card?.oracle_text) continue;
      const sourceId = String(candidate?.id || card?.id || '');
      const controllerId = String(candidate?.owner || candidate?.controller || card?.owner || '');
      for (const trigger of detectDeathTriggers(card, { id: sourceId, controller: controllerId, card })) {
        if (String(trigger.triggerType || '') !== 'haunts_creature_dies') continue;
        pushDetectedDeathTrigger(
          results,
          { ...trigger, permanentId: sourceId },
          controllerId,
          dyingCreature?.card,
        );
      }
    }
  }
}
