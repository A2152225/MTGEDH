import type { PlayerID } from '../../../../../shared/src/types.js';
import type { GameContext } from './types.js';
import { uid } from '../../utils.js';
import { debug } from '../../../utils/debug.js';
import { appendEvent } from '../../../db/index.js';
import { detectTargetedTriggers } from '../triggered-abilities.js';
import { orderTriggersByAPNAP } from './ordering.js';

export type AbilityTargetedTriggerEvent = {
  readonly activatedBy: PlayerID;
  readonly sourcePermanentId: string;
  readonly stackItemId: string;
  readonly targetIds: readonly string[];
};

export type SpellTargetedTriggerEvent = {
  readonly castBy: PlayerID;
  readonly stackItemId?: string;
  readonly targetIds: readonly string[];
};

export type TargetedTriggerSourceEvent = AbilityTargetedTriggerEvent | SpellTargetedTriggerEvent;

function isSpellTargetedTriggerEvent(event: TargetedTriggerSourceEvent): event is SpellTargetedTriggerEvent {
  return 'castBy' in event;
}

export type TargetedTriggeredStackItem = {
  id: string;
  type: 'triggered_ability';
  controller: PlayerID;
  source: string;
  permanentId?: string;
  sourceName: string;
  description: string;
  effect: string;
  triggerType: 'targeted';
  mandatory: boolean;
  triggeringPlayer: PlayerID;
  triggeringPermanentId?: string;
  triggeringStackItemId?: string;
  card?: any;
  sourcePermanentSnapshot?: any;
  effectData?: Record<string, unknown>;
};

function normalizeTargetIds(targetIds: readonly string[]): string[] {
  return Array.from(new Set(
    (Array.isArray(targetIds) ? targetIds : [])
      .map((targetId) => String(targetId || '').trim())
      .filter(Boolean),
  ));
}

function isAbilityTargetsOnlyItTrigger(oracleText: string): boolean {
  return /becomes the target of an ability that targets only it/i.test(String(oracleText || ''));
}

function escapeRegex(value: string): string {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Observer triggers (Cowardice, etc.) watch other permanents becoming targeted.
 * Self (~ / card name) and attachment (enchanted/equipped) triggers are excluded.
 */
function isObserverStyleTargetedWhenClause(oracleText: string, cardName?: string): boolean {
  const text = String(oracleText || '');
  if (!/becomes the target of/i.test(text)) return false;
  if (isAbilityTargetsOnlyItTrigger(text)) return false;

  if (/\bwhen(?:ever)? (~|this creature|this permanent|this artifact|this enchantment|this equipment|this aura|this planeswalker|this land|this vehicle|this token|this battle)\b/i.test(text)) {
    return false;
  }
  if (/\bwhen(?:ever)? enchanted creature\b/i.test(text)) return false;
  if (/\bwhen(?:ever)? equipped creature\b/i.test(text)) return false;
  if (/\bwhen (?:the )?chosen player\b/i.test(text)) return false;

  const trimmedName = String(cardName || '').trim();
  if (trimmedName && new RegExp(`\\bwhenever ${escapeRegex(trimmedName)}\\b`, 'i').test(text)) {
    return false;
  }

  return /\bwhenever (?:a |an |another |you and\/or |you or )/i.test(text);
}

function isAttachmentStyleTargetedWhenClause(oracleText: string): boolean {
  const text = String(oracleText || '');
  return /\bwhen(?:ever)? enchanted creature becomes the target of/i.test(text)
    || /\bwhen(?:ever)? equipped creature becomes the target of/i.test(text);
}

function resolveAttachmentsForTargetedPermanent(battlefield: any[], targetedPermanent: any): any[] {
  const targetedId = String(targetedPermanent?.id || '').trim();
  if (!targetedId) return [];

  const attachments: any[] = [];
  const seen = new Set<string>();

  for (const perm of battlefield) {
    const permId = String(perm?.id || '').trim();
    if (!permId || seen.has(permId)) continue;
    if (String(perm?.attachedTo || '').trim() !== targetedId) continue;
    seen.add(permId);
    attachments.push(perm);
  }

  const attachedEquipment = Array.isArray(targetedPermanent?.attachedEquipment)
    ? targetedPermanent.attachedEquipment
    : [];
  for (const equipmentId of attachedEquipment) {
    const id = String(equipmentId || '').trim();
    if (!id || seen.has(id)) continue;
    const equipment = battlefield.find((perm: any) => String(perm?.id || '') === id);
    if (!equipment) continue;
    seen.add(id);
    attachments.push(equipment);
  }

  return attachments;
}

function extractTargetingWhenText(oracleText: string): string {
  const text = String(oracleText || '');
  const sentence = text.split(/\.\s+/).find((part) => /becomes the target of/i.test(part));
  return sentence || text;
}

function targetedTriggerAppliesToEvent(
  oracleText: string,
  triggerControllerSource: any,
  targetedPermanent: any,
  event: TargetedTriggerSourceEvent,
): boolean {
  const targetingWhenText = extractTargetingWhenText(oracleText);
  const fullText = String(oracleText || '');
  const typeLine = String(targetedPermanent?.card?.type_line || '').toLowerCase();
  const triggerController = String(triggerControllerSource?.controller || '').trim();
  const triggeringPlayer = isSpellTargetedTriggerEvent(event)
    ? String(event.castBy || '').trim()
    : String(event.activatedBy || '').trim();

  if (/whenever a creature\b/i.test(targetingWhenText) || /whenever (?:a |an )?creature becomes/i.test(targetingWhenText)) {
    if (!typeLine.includes('creature')) return false;
  }

  const isSelfTargetingWhenClause = /\bwhen(?:ever)? (~|this creature|this permanent|this artifact|this enchantment|this equipment|this aura|this planeswalker|this land|this vehicle|this token|this battle)\b/i.test(fullText);

  if (/creature you control/i.test(targetingWhenText) || /permanent you control/i.test(targetingWhenText)) {
    if (!isSelfTargetingWhenClause && String(targetedPermanent?.controller || '').trim() !== triggerController) {
      return false;
    }
  }

  if (/another creature you control/i.test(targetingWhenText)) {
    if (String(targetedPermanent?.controller || '').trim() !== triggerController) return false;
  }

  if (/an opponent controls/i.test(targetingWhenText) || /an opponent controls/i.test(fullText)) {
    if (!triggeringPlayer || triggeringPlayer === triggerController) return false;
  }

  if (/spell or ability you control/i.test(targetingWhenText) || /spell or ability you control/i.test(fullText)) {
    if (!triggeringPlayer || triggeringPlayer !== triggerController) return false;
  }

  return true;
}

function targetedTriggerDedupKey(item: TargetedTriggeredStackItem): string {
  const subjectId = String(item.effectData?.targetedPermanentId || item.source || '').trim();
  return `${String(item.source || '')}::${String(item.description || '')}::${subjectId}`;
}

function dedupeTargetedTriggers(items: TargetedTriggeredStackItem[]): TargetedTriggeredStackItem[] {
  const seen = new Set<string>();
  const deduped: TargetedTriggeredStackItem[] = [];
  for (const item of items) {
    const key = targetedTriggerDedupKey(item);
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(item);
  }
  return deduped;
}

function shouldFireTargetedTriggerForEvent(
  oracleText: string,
  eventKind: 'ability' | 'spell',
  singleTargetAbility: boolean,
): boolean {
  if (isAbilityTargetsOnlyItTrigger(oracleText)) {
    return eventKind === 'ability' && singleTargetAbility;
  }
  if (/becomes the target of (?:a |an )?spell or ability/i.test(String(oracleText || ''))) {
    return true;
  }
  if (/becomes the target of (?:a |an )?spell(?!\s+or\s+ability)/i.test(String(oracleText || ''))) {
    return eventKind === 'spell';
  }
  return false;
}

function collectTargetedTriggersForTargetedPermanent(
  ctx: GameContext,
  triggerSource: any,
  event: TargetedTriggerSourceEvent,
  eventKind: 'ability' | 'spell',
  singleTargetAbility: boolean,
): TargetedTriggeredStackItem[] {
  const created: TargetedTriggeredStackItem[] = [];
  if (!triggerSource?.card?.oracle_text) return created;

  const oracleText = String(triggerSource.card.oracle_text || '');
  if (isObserverStyleTargetedWhenClause(oracleText, String(triggerSource.card.name || ''))) {
    return created;
  }
  if (!shouldFireTargetedTriggerForEvent(oracleText, eventKind, singleTargetAbility)) {
    return created;
  }
  if (!targetedTriggerAppliesToEvent(oracleText, triggerSource, triggerSource, event)) {
    return created;
  }

  const detected = detectTargetedTriggers(triggerSource.card, triggerSource);
  const trigger = detected.find((entry) => String(entry.effect || entry.description || '').trim());
  if (!trigger) return created;

  const effectText = String(trigger.effect || trigger.description || '').trim();
  if (created.some((item) =>
    String(item.source || '') === String(triggerSource.id || '')
    && String(item.description || '') === effectText,
  )) {
    return created;
  }

  const controller = String(triggerSource.controller || '').trim() as PlayerID;
  if (!controller) return created;

  created.push(buildTargetedTriggeredStackItem(ctx, triggerSource, controller, effectText, effectText, event));

  return created;
}

function collectObserverTargetedTriggersForTargetedPermanent(
  ctx: GameContext,
  observerSource: any,
  targetedPermanent: any,
  event: TargetedTriggerSourceEvent,
  eventKind: 'ability' | 'spell',
  singleTargetAbility: boolean,
): TargetedTriggeredStackItem[] {
  const created: TargetedTriggeredStackItem[] = [];
  if (!observerSource?.card?.oracle_text || !targetedPermanent?.id) return created;

  const oracleText = String(observerSource.card.oracle_text || '');
  if (!isObserverStyleTargetedWhenClause(oracleText, String(observerSource.card.name || ''))) {
    return created;
  }
  if (!shouldFireTargetedTriggerForEvent(oracleText, eventKind, singleTargetAbility)) {
    return created;
  }
  if (!targetedTriggerAppliesToEvent(oracleText, observerSource, targetedPermanent, event)) {
    return created;
  }

  const detected = detectTargetedTriggers(observerSource.card, observerSource);
  const trigger = detected.find((entry) => String(entry.effect || entry.description || '').trim());
  if (!trigger) return created;

  const effectText = String(trigger.effect || trigger.description || '').trim();
  const controller = String(observerSource.controller || '').trim() as PlayerID;
  if (!controller) return created;

  created.push(buildTargetedTriggeredStackItem(
    ctx,
    observerSource,
    controller,
    effectText,
    effectText,
    event,
    { targetedSubjectPermanentId: String(targetedPermanent.id || '').trim() || undefined },
  ));

  return created;
}

function collectAttachmentTargetedTriggersForTargetedPermanent(
  ctx: GameContext,
  attachmentSource: any,
  targetedPermanent: any,
  event: TargetedTriggerSourceEvent,
  eventKind: 'ability' | 'spell',
  singleTargetAbility: boolean,
): TargetedTriggeredStackItem[] {
  const created: TargetedTriggeredStackItem[] = [];
  if (!attachmentSource?.card?.oracle_text || !targetedPermanent?.id) return created;

  const oracleText = String(attachmentSource.card.oracle_text || '');
  if (!isAttachmentStyleTargetedWhenClause(oracleText)) return created;
  if (!shouldFireTargetedTriggerForEvent(oracleText, eventKind, singleTargetAbility)) return created;
  if (!targetedTriggerAppliesToEvent(oracleText, attachmentSource, targetedPermanent, event)) return created;

  const detected = detectTargetedTriggers(attachmentSource.card, attachmentSource);
  const trigger = detected.find((entry) => String(entry.effect || entry.description || '').trim());
  if (!trigger) return created;

  const effectText = String(trigger.effect || trigger.description || '').trim();
  const controller = String(attachmentSource.controller || '').trim() as PlayerID;
  if (!controller) return created;

  created.push(buildTargetedTriggeredStackItem(
    ctx,
    attachmentSource,
    controller,
    effectText,
    effectText,
    event,
    { targetedSubjectPermanentId: String(targetedPermanent.id || '').trim() || undefined },
  ));

  return created;
}

function collectAttachmentTargetedTriggersForEvent(
  ctx: GameContext,
  event: TargetedTriggerSourceEvent,
  eventKind: 'ability' | 'spell',
  singleTargetAbility: boolean,
  normalizedTargetIds: readonly string[],
): TargetedTriggeredStackItem[] {
  const state: any = ctx.state as any;
  const battlefield: any[] = Array.isArray(state?.battlefield) ? state.battlefield : [];
  const created: TargetedTriggeredStackItem[] = [];

  for (const targetId of normalizedTargetIds) {
    const targetedPermanent = battlefield.find((perm: any) => String(perm?.id || '') === String(targetId));
    if (!targetedPermanent) continue;

    for (const attachmentSource of resolveAttachmentsForTargetedPermanent(battlefield, targetedPermanent)) {
      const queued = collectAttachmentTargetedTriggersForTargetedPermanent(
        ctx,
        attachmentSource,
        targetedPermanent,
        event,
        eventKind,
        singleTargetAbility,
      );
      for (const item of queued) {
        debug(2, `[targeted] ${String(attachmentSource.card?.name || 'Attachment')} attachment trigger queued for ${String(targetedPermanent.card?.name || targetId)} from ${eventKind} ${String(event.stackItemId || '')}`);
      }
      created.push(...queued);
    }
  }

  return created;
}

function collectObserverTargetedTriggersForEvent(
  ctx: GameContext,
  event: TargetedTriggerSourceEvent,
  eventKind: 'ability' | 'spell',
  singleTargetAbility: boolean,
  normalizedTargetIds: readonly string[],
): TargetedTriggeredStackItem[] {
  const state: any = ctx.state as any;
  const battlefield: any[] = Array.isArray(state?.battlefield) ? state.battlefield : [];
  const created: TargetedTriggeredStackItem[] = [];

  for (const targetId of normalizedTargetIds) {
    const targetedPermanent = battlefield.find((perm: any) => String(perm?.id || '') === String(targetId));
    if (!targetedPermanent) continue;

    for (const observerSource of battlefield) {
      if (String(observerSource?.id || '') === String(targetId)) continue;
      const queued = collectObserverTargetedTriggersForTargetedPermanent(
        ctx,
        observerSource,
        targetedPermanent,
        event,
        eventKind,
        singleTargetAbility,
      );
      for (const item of queued) {
        debug(2, `[targeted] ${String(observerSource.card?.name || 'Permanent')} observer trigger queued for ${String(targetedPermanent.card?.name || targetId)} from ${eventKind} ${String(event.stackItemId || '')}`);
      }
      created.push(...queued);
    }
  }

  return created;
}

function pushTargetedTriggersOntoStack(ctx: GameContext, createdTriggers: TargetedTriggeredStackItem[]): TargetedTriggeredStackItem[] {
  const orderedTriggers = orderTriggersByAPNAP(
    ctx,
    createdTriggers.map((item) => ({ controllerId: String(item.controller || ''), item })),
  ).map((entry) => entry.item);

  if (orderedTriggers.length > 0) {
    const state: any = ctx.state as any;
    state.stack = state.stack || [];
    state.stack.push(...orderedTriggers as any[]);
  }

  return orderedTriggers;
}

function clonePermanentSnapshot(permanent: any): any | undefined {
  if (!permanent || typeof permanent !== 'object') return undefined;
  return {
    ...permanent,
    ...(permanent.card && typeof permanent.card === 'object' ? { card: { ...permanent.card } } : null),
    ...(permanent.counters && typeof permanent.counters === 'object' ? { counters: { ...permanent.counters } } : null),
  };
}

function buildTargetedTriggeredStackItem(
  ctx: GameContext,
  triggerSource: any,
  controller: PlayerID,
  description: string,
  effectText: string,
  event: TargetedTriggerSourceEvent,
  options?: { targetedSubjectPermanentId?: string },
): TargetedTriggeredStackItem {
  const triggerSourceId = String(triggerSource?.id || '').trim();
  const targetedSubjectPermanentId = String(options?.targetedSubjectPermanentId || triggerSourceId || '').trim() || undefined;
  const sourcePermanentSnapshot = clonePermanentSnapshot(triggerSource);
  const triggeringPlayer = isSpellTargetedTriggerEvent(event)
    ? event.castBy
    : event.activatedBy;
  const triggeringPermanentId = isSpellTargetedTriggerEvent(event)
    ? undefined
    : String(event.sourcePermanentId || '').trim() || undefined;
  const triggeringStackItemId = String(event.stackItemId || '').trim() || undefined;

  return {
    id: uid('trigger'),
    type: 'triggered_ability',
    controller,
    source: triggerSourceId,
    ...(triggerSourceId ? { permanentId: triggerSourceId } : {}),
    sourceName: String(triggerSource?.card?.name || 'Triggered ability').trim() || 'Triggered ability',
    description,
    // Persist the complete triggered-effect clause, never the source's entire
    // oracle text. The latter prevents Oracle IR from seeing this trigger's
    // payment/continuation chain during stack resolution.
    effect: effectText,
    triggerType: 'targeted',
    mandatory: !String(description || '').toLowerCase().includes('you may'),
    triggeringPlayer,
    triggeringPermanentId,
    triggeringStackItemId,
    ...(triggerSource?.card && typeof triggerSource.card === 'object' ? { card: { ...triggerSource.card } } : {}),
    ...(sourcePermanentSnapshot ? { sourcePermanentSnapshot } : {}),
    effectData: {
      triggeringStackItemId,
      targetedPermanentId: targetedSubjectPermanentId,
      ...(isSpellTargetedTriggerEvent(event)
        ? { triggeringSpellCastController: String(event.castBy || '').trim() || undefined }
        : { activatedAbilitySourcePermanentId: String(event.sourcePermanentId || '').trim() || undefined }),
    },
  };
}

export function serializeTargetedTriggeredStackItem(triggerItem: TargetedTriggeredStackItem): Record<string, unknown> {
  return {
    triggerId: triggerItem.id,
    sourceId: triggerItem.source,
    ...(triggerItem.permanentId || triggerItem.source ? { permanentId: triggerItem.permanentId || triggerItem.source } : {}),
    sourceName: triggerItem.sourceName,
    controllerId: triggerItem.controller,
    description: triggerItem.description,
    triggerType: triggerItem.triggerType,
    effect: triggerItem.effect,
    mandatory: triggerItem.mandatory,
    triggeringPlayer: triggerItem.triggeringPlayer,
    triggeringPermanentId: triggerItem.triggeringPermanentId,
    triggeringStackItemId: triggerItem.triggeringStackItemId,
    ...(triggerItem.card && typeof triggerItem.card === 'object' ? { card: { ...triggerItem.card } } : {}),
    ...(triggerItem.sourcePermanentSnapshot && typeof triggerItem.sourcePermanentSnapshot === 'object'
      ? { sourcePermanentSnapshot: triggerItem.sourcePermanentSnapshot }
      : {}),
    ...(triggerItem.effectData && typeof triggerItem.effectData === 'object' ? { effectData: triggerItem.effectData } : {}),
  };
}

export function persistTargetedTriggeredStackItems(
  gameId: string,
  game: any,
  triggeredAbilities: readonly TargetedTriggeredStackItem[],
): void {
  if (!gameId || gameId === 'unknown') return;
  for (const triggeredAbility of triggeredAbilities) {
    try {
      appendEvent(
        gameId,
        Number((game as any)?.seq?.value ?? (game as any)?.seq ?? (game as any)?.state?.seq ?? 0),
        'pushTriggeredAbility',
        serializeTargetedTriggeredStackItem(triggeredAbility),
      );
    } catch {
      // replay persistence is best-effort
    }
  }
}

/**
 * Fire becomes-the-target triggers when an activated ability gains targets on the stack.
 */
export function triggerPermanentTargetedTriggersFromAbility(
  ctx: GameContext,
  event: AbilityTargetedTriggerEvent,
): TargetedTriggeredStackItem[] {
  if ((ctx as any).isReplaying) return [];

  const normalizedTargetIds = normalizeTargetIds(event.targetIds);
  if (normalizedTargetIds.length === 0) return [];

  const state: any = ctx.state as any;
  const battlefield: any[] = Array.isArray(state?.battlefield) ? state.battlefield : [];
  const singleTargetAbility = normalizedTargetIds.length === 1;
  const createdTriggers: TargetedTriggeredStackItem[] = [];

  for (const targetId of normalizedTargetIds) {
    for (const triggerSource of battlefield) {
      if (String(triggerSource?.id || '') !== String(targetId)) continue;
      const queued = collectTargetedTriggersForTargetedPermanent(
        ctx,
        triggerSource,
        event,
        'ability',
        singleTargetAbility,
      );
      for (const item of queued) {
        debug(2, `[targeted] ${String(triggerSource.card?.name || 'Permanent')} targeted trigger queued from ability ${String(event.stackItemId || '')}`);
      }
      createdTriggers.push(...queued);
    }
  }

  createdTriggers.push(...collectObserverTargetedTriggersForEvent(
    ctx,
    event,
    'ability',
    singleTargetAbility,
    normalizedTargetIds,
  ));

  createdTriggers.push(...collectAttachmentTargetedTriggersForEvent(
    ctx,
    event,
    'ability',
    singleTargetAbility,
    normalizedTargetIds,
  ));

  return pushTargetedTriggersOntoStack(ctx, dedupeTargetedTriggers(createdTriggers));
}

/**
 * Fire becomes-the-target triggers on targeted permanents and observer permanents when a spell gains targets.
 */
export function triggerPermanentTargetedTriggersFromSpell(
  ctx: GameContext,
  event: SpellTargetedTriggerEvent,
): TargetedTriggeredStackItem[] {
  if ((ctx as any).isReplaying) return [];

  const normalizedTargetIds = normalizeTargetIds(event.targetIds);
  if (normalizedTargetIds.length === 0) return [];

  const state: any = ctx.state as any;
  const battlefield: any[] = Array.isArray(state?.battlefield) ? state.battlefield : [];
  const createdTriggers: TargetedTriggeredStackItem[] = [];

  for (const targetId of normalizedTargetIds) {
    const triggerSource = battlefield.find((perm: any) => String(perm?.id || '') === String(targetId));
    if (!triggerSource) continue;
    createdTriggers.push(...collectTargetedTriggersForTargetedPermanent(
      ctx,
      triggerSource,
      event,
      'spell',
      false,
    ));
  }

  createdTriggers.push(...collectObserverTargetedTriggersForEvent(
    ctx,
    event,
    'spell',
    false,
    normalizedTargetIds,
  ));

  createdTriggers.push(...collectAttachmentTargetedTriggersForEvent(
    ctx,
    event,
    'spell',
    false,
    normalizedTargetIds,
  ));

  return pushTargetedTriggersOntoStack(ctx, dedupeTargetedTriggers(createdTriggers));
}

export function extractStackItemTargetIds(stackItem: any): string[] {
  if (!stackItem || !Array.isArray(stackItem.targets)) return [];
  return normalizeTargetIds(stackItem.targets.map((target: any) => (
    typeof target === 'string' ? target : String(target?.id || '')
  )));
}
