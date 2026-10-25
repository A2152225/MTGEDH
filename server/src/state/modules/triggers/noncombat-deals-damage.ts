/**
 * Oracle IR noncombat "deals damage" (event deals_damage): "Whenever this creature
 * deals damage, ...", "... deals damage to an opponent / a player / a creature, ...".
 * Called from the Oracle IR damage application diff (emitTriggersAfterOracleIRApply)
 * with every recipient of one damage event; each matching line fires once per event.
 * Combat damage stays with the combat detectors. Lines that duplicate a legacy
 * 'deals_damage' trigger already queued by queueDealsDamageToPlayerTriggersFromPermanent
 * (player recipients) are skipped.
 * Spell damage (executeSpellEffectCore) and fights report through emitNoncombatDamageEvent; a
 * spell source off the battlefield is a pseudo-subject built from its stack item ("a source
 * you control deals noncombat damage").
 * Public: queueNoncombatDealsDamageTriggers, emitNoncombatDamageEvent.
 */
import { appendEvent } from '../../../db/index.js';
import { debugWarn } from '../../../utils/debug.js';
import { uid } from '../../utils.js';
import { orderTriggersByAPNAP } from './ordering.js';
import { collectMatchingParsedEventLines, parsedEffectDuplicates } from './triggerConditionFamilyMatch.js';
import { hasUnsupportedTargetRequirement, inferGenericTriggeredAbilityTargetMetadata } from './target-metadata.js';

export type NoncombatDamageRecipients = {
  readonly playerIds: readonly string[];
  readonly permanentIds: readonly string[];
  /** Effects of legacy deals_damage triggers already queued for the damage source (player recipients). */
  readonly legacyEffects?: readonly string[];
  /** Source not on the battlefield (resolving spell): { id, controller, card }. */
  readonly pseudoSource?: any;
};

/**
 * One noncombat damage event from a spell/ability effect or a fight. The source is the
 * battlefield permanent when there is one, else the resolving stack object (or a bare
 * pseudo-source owned by the controller). Legacy deals_damage items already queued for
 * the source permanent are treated as duplicates.
 */
export function emitNoncombatDamageEvent(ctx: any, event: {
  sourcePermanentId?: string;
  sourceId?: string;
  controller?: string;
  sourceName?: string;
  playerIds?: readonly string[];
  permanentIds?: readonly string[];
}): any[] {
  try {
    if (!ctx || ctx.isReplaying) return [];
    const state = ctx.state;
    const battlefield: any[] = Array.isArray(state?.battlefield) ? state.battlefield : [];
    const stack: any[] = Array.isArray(state?.stack) ? state.stack : [];
    const permId = String(event.sourcePermanentId || '').trim();
    const onBattlefield = permId ? battlefield.find((perm: any) => String(perm?.id || '') === permId) : undefined;
    let sourceId = onBattlefield ? permId : String(event.sourceId || '').trim();
    let pseudoSource: any;
    if (!onBattlefield) {
      const stackItem = sourceId ? stack.find((item: any) => String(item?.id || '') === sourceId) : undefined;
      const controller = String(stackItem?.controller || event.controller || '').trim();
      if (!controller) return [];
      sourceId = sourceId || `spell-source:${controller}:${String(event.sourceName || '')}`;
      const card = stackItem?.card || { name: String(event.sourceName || ''), type_line: '' };
      pseudoSource = { id: sourceId, controller, card: { ...card, oracle_text: '' } };
    }
    const legacyEffects = onBattlefield
      ? stack.filter((item: any) => String(item?.source || '') === permId && /damage/i.test(String(item?.triggerType || '')))
        .map((item: any) => String(item?.effect || item?.description || ''))
      : [];
    return queueNoncombatDealsDamageTriggers(ctx, sourceId, {
      playerIds: (event.playerIds || []).map(String),
      permanentIds: (event.permanentIds || []).map(String),
      legacyEffects,
      ...(pseudoSource ? { pseudoSource } : {}),
    });
  } catch (err) {
    debugWarn(1, '[deals-damage] emitNoncombatDamageEvent failed:', err);
    return [];
  }
}

export function queueNoncombatDealsDamageTriggers(ctx: any, damageSourceId: string, recipients: NoncombatDamageRecipients): any[] {
  if (!ctx || ctx.isReplaying) return [];
  const state = ctx.state;
  const battlefield: any[] = Array.isArray(state?.battlefield) ? state.battlefield : [];
  const damageSource = battlefield.find((perm: any) => String(perm?.id || '') === String(damageSourceId || ''))
    || recipients.pseudoSource;
  if (!damageSource) return [];
  const recipientContexts = [
    ...recipients.playerIds.map((playerId) => ({ damageKind: 'noncombat', damageRecipientPlayerId: String(playerId) })),
    ...recipients.permanentIds.map((permanentId) => {
      const perm = battlefield.find((entry: any) => String(entry?.id || '') === String(permanentId));
      return { damageKind: 'noncombat', damageRecipientIsCreature: /\bcreature\b/i.test(String(perm?.card?.type_line || perm?.type_line || '')) };
    }),
  ];
  if (recipientContexts.length === 0) return [];

  const detected: Array<{ permanentId: string; cardName: string; controllerId: string; effect: string; mandatory: boolean; recipientPlayerId?: string }> = [];
  for (const permanent of battlefield) {
    if (!permanent?.card) continue;
    const fired = new Set<string>();
    for (const matchContext of recipientContexts) {
      for (const line of collectMatchingParsedEventLines({
        ctx,
        oracleText: String(permanent.card.oracle_text || ''),
        event: 'deals_damage',
        subjectPermanent: damageSource,
        subjectControllerId: String(damageSource.controller || ''),
        sourcePermanent: permanent,
        damageKind: 'noncombat',
        thatPlayerId: (matchContext as any).damageRecipientPlayerId,
        matchContext,
      })) {
        const key = line.effect.toLowerCase();
        if (fired.has(key)) continue;
        if (String(permanent.id) === String(damageSource.id) && recipients.playerIds.length > 0
          && (recipients.legacyEffects || []).some((effect) => parsedEffectDuplicates(effect, line))) continue;
        fired.add(key);
        detected.push({
          permanentId: String(permanent.id || ''),
          cardName: String(permanent.card?.name || 'Unknown'),
          controllerId: String(permanent.controller || ''),
          effect: line.effect,
          mandatory: !/^you may\b/i.test(line.effect),
          recipientPlayerId: (matchContext as any).damageRecipientPlayerId,
        });
      }
    }
  }
  if (detected.length === 0) return [];

  const gameId = String(ctx.gameId || ctx.id || '').trim();
  const queued: any[] = [];
  state.stack = Array.isArray(state.stack) ? state.stack : [];
  for (const trigger of orderTriggersByAPNAP(ctx, detected)) {
    const effect = String(trigger.effect || '').trim();
    const targetMetadata = inferGenericTriggeredAbilityTargetMetadata(effect);
    if (!effect || hasUnsupportedTargetRequirement(targetMetadata)) continue;
    const triggerId = uid('trigger');
    const sourcePermanent = battlefield.find((perm: any) => String(perm?.id || '') === trigger.permanentId);
    const effectData = {
      sourcePermanentId: String(damageSource.id),
      damageSourcePermanentIds: [String(damageSource.id)],
      ...(trigger.recipientPlayerId ? { damagedPlayerId: trigger.recipientPlayerId } : {}),
      damageKind: 'noncombat',
    };
    const stackItem: any = {
      id: triggerId,
      type: 'triggered_ability',
      controller: trigger.controllerId,
      source: trigger.permanentId,
      permanentId: trigger.permanentId,
      sourceName: trigger.cardName,
      description: effect,
      effect,
      ...targetMetadata,
      ...(sourcePermanent?.card ? { card: { ...sourcePermanent.card } } : null),
      triggerType: 'deals_damage',
      mandatory: trigger.mandatory,
      ...(trigger.recipientPlayerId ? { targetPlayer: trigger.recipientPlayerId } : {}),
      effectData,
    };
    state.stack.push(stackItem);
    queued.push(stackItem);
    if (gameId && gameId !== 'unknown') {
      try {
        appendEvent(gameId, Number(ctx.seq?.value ?? ctx.seq ?? 0), 'pushTriggeredAbility', {
          triggerId,
          sourceId: trigger.permanentId,
          permanentId: trigger.permanentId,
          sourceName: trigger.cardName,
          controllerId: trigger.controllerId,
          description: effect,
          triggerType: 'deals_damage',
          effect,
          ...targetMetadata,
          mandatory: trigger.mandatory,
          ...(sourcePermanent?.card ? { card: { ...sourcePermanent.card } } : null),
          effectData,
        });
      } catch (err) {
        debugWarn(1, '[deals-damage] appendEvent(pushTriggeredAbility) failed:', err);
      }
    }
  }
  return queued;
}
