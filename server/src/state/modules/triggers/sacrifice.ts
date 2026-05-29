import type { GameContext } from '../../context.js';

import { appendEvent } from '../../../db/index.js';
import { debugWarn } from '../../../utils/debug.js';
import { uid } from '../../utils.js';
import { isInterveningIfSatisfied } from './intervening-if.js';
import { orderTriggersByAPNAP } from './ordering.js';
import { hasUnsupportedTargetRequirement, inferGenericTriggeredAbilityTargetMetadata } from './target-metadata.js';

export interface SacrificeTrigger {
  permanentId: string;
  cardName: string;
  controllerId: string;
  triggerType: 'you_sacrifice' | 'opponent_sacrifices' | 'player_sacrifices';
  oracleClause: string;
  effect: string;
  mandatory: boolean;
  sacrificeFilter: 'any' | 'permanent' | 'token' | 'nontoken' | 'creature' | 'artifact' | 'enchantment' | 'land' | 'nonland';
  excludesSource: boolean;
}

function parseSacrificeFilter(raw: string): Pick<SacrificeTrigger, 'sacrificeFilter' | 'excludesSource'> | null {
  let condition = String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/\bduring your turn\b/g, '')
    .replace(/\bthis turn\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const excludesSource = /\banother\b/.test(condition);
  condition = condition.replace(/\banother\b/g, '').trim();

  if (!condition) return null;
  if (condition.includes('nontoken')) return { sacrificeFilter: 'nontoken', excludesSource };
  if (condition.includes('token')) return { sacrificeFilter: 'token', excludesSource };
  if (condition.includes('nonland')) return { sacrificeFilter: 'nonland', excludesSource };
  if (condition.includes('creature')) return { sacrificeFilter: 'creature', excludesSource };
  if (condition.includes('artifact')) return { sacrificeFilter: 'artifact', excludesSource };
  if (condition.includes('enchantment')) return { sacrificeFilter: 'enchantment', excludesSource };
  if (condition.includes('land')) return { sacrificeFilter: 'land', excludesSource };
  if (condition.includes('permanent')) return { sacrificeFilter: 'permanent', excludesSource };
  return null;
}

export function detectSacrificeTriggers(card: any, permanent: any): SacrificeTrigger[] {
  const triggers: SacrificeTrigger[] = [];
  const oracleText = String(card?.oracle_text || '');
  const permanentId = String(permanent?.id || '');
  const controllerId = String(permanent?.controller || '');
  const cardName = String(card?.name || 'Unknown');

  const addTrigger = (
    triggerType: SacrificeTrigger['triggerType'],
    rawCondition: string,
    effect: string,
    oracleClause: string,
  ) => {
    const parsed = parseSacrificeFilter(rawCondition);
    const cleanEffect = String(effect || '').trim().replace(/\s+/g, ' ');
    if (!parsed || !cleanEffect) return;

    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerType,
      oracleClause: String(oracleClause || '').trim(),
      effect: cleanEffect,
      mandatory: !/^you may\b/i.test(cleanEffect),
      sacrificeFilter: parsed.sacrificeFilter,
      excludesSource: parsed.excludesSource,
    });
  };

  for (const match of oracleText.matchAll(/whenever you (?:create or )?sacrifice (?:a |an |one or more )?([^,]+),\s*([^.]+)/gi)) {
    addTrigger('you_sacrifice', String(match[1] || ''), String(match[2] || ''), String(match[0] || ''));
  }

  for (const match of oracleText.matchAll(/whenever (a player|an opponent) sacrifices? (?:a |an |one or more )?([^,]+),\s*([^.]+)/gi)) {
    const subject = String(match[1] || '').trim().toLowerCase();
    addTrigger(
      subject === 'an opponent' ? 'opponent_sacrifices' : 'player_sacrifices',
      String(match[2] || ''),
      String(match[3] || ''),
      String(match[0] || ''),
    );
  }

  return triggers;
}

function sacrificedPermanentMatchesFilter(permanent: any, filter: SacrificeTrigger['sacrificeFilter']): boolean {
  const typeLine = String(permanent?.card?.type_line || '').toLowerCase();
  const isToken = permanent?.isToken === true || typeLine.includes('token');
  switch (filter) {
    case 'token':
      return isToken;
    case 'nontoken':
      return !isToken;
    case 'creature':
      return typeLine.includes('creature');
    case 'artifact':
      return typeLine.includes('artifact');
    case 'enchantment':
      return typeLine.includes('enchantment');
    case 'land':
      return typeLine.includes('land');
    case 'nonland':
      return !typeLine.includes('land');
    case 'permanent':
    case 'any':
    default:
      return true;
  }
}

export function getSacrificeTriggers(
  ctx: GameContext,
  sacrificingPlayerId: string,
  sacrificedPermanent: any,
): SacrificeTrigger[] {
  const triggers: SacrificeTrigger[] = [];
  const battlefield = Array.isArray(ctx.state?.battlefield) ? ctx.state.battlefield : [];
  const sacrificedPermanentId = String(sacrificedPermanent?.id || '').trim();

  for (const permanent of battlefield) {
    if (!permanent || !permanent.card) continue;

    const permanentController = String(permanent.controller || '');
    const permanentTriggers = detectSacrificeTriggers(permanent.card, permanent);
    for (const trigger of permanentTriggers) {
      if (trigger.excludesSource && sacrificedPermanentId && sacrificedPermanentId === String(trigger.permanentId || '')) {
        continue;
      }
      if (!sacrificedPermanentMatchesFilter(sacrificedPermanent, trigger.sacrificeFilter)) {
        continue;
      }

      const ok = isInterveningIfSatisfied(
        ctx,
        trigger.controllerId || permanentController,
        String(trigger.oracleClause || trigger.effect || ''),
        permanent,
        {
          thatPlayerId: sacrificingPlayerId,
          referencedPlayerId: sacrificingPlayerId,
          theirPlayerId: sacrificingPlayerId,
          thatPermanent: sacrificedPermanent,
          wasSacrificed: true,
        } as any,
      );
      if (ok === false) continue;

      switch (trigger.triggerType) {
        case 'opponent_sacrifices':
          if (sacrificingPlayerId !== permanentController) {
            triggers.push({ ...trigger, controllerId: permanentController });
          }
          break;
        case 'player_sacrifices':
          triggers.push({ ...trigger, controllerId: permanentController });
          break;
        case 'you_sacrifice':
          if (sacrificingPlayerId === permanentController) {
            triggers.push({ ...trigger, controllerId: permanentController });
          }
          break;
      }
    }
  }

  return triggers;
}

function findBattlefieldPermanentById(ctx: GameContext, permanentId: string): any | undefined {
  const battlefield = Array.isArray(ctx.state?.battlefield) ? ctx.state.battlefield : [];
  const normalizedPermanentId = String(permanentId || '').trim();
  if (!normalizedPermanentId) return undefined;
  return battlefield.find((permanent: any) => String(permanent?.id || '') === normalizedPermanentId);
}

function snapshotPermanentForSacrificeTrigger(permanent: any): any | undefined {
  if (!permanent || typeof permanent !== 'object') return undefined;

  return {
    id: String(permanent?.id || ''),
    controller: String(permanent?.controller || ''),
    owner: String(permanent?.owner || permanent?.controller || ''),
    tapped: permanent?.tapped === true,
    isToken: permanent?.isToken === true,
    counters: permanent?.counters && typeof permanent.counters === 'object' ? { ...permanent.counters } : undefined,
    card: permanent?.card && typeof permanent.card === 'object' ? { ...(permanent.card as any) } : undefined,
  };
}

export function queueSacrificeTriggers(
  ctx: GameContext,
  sacrificingPlayerId: string,
  sacrificedPermanent: any,
): any[] {
  if (!sacrificingPlayerId || !sacrificedPermanent) {
    return [];
  }
  if ((ctx as any)?.isReplaying) return [];

  const triggers = orderTriggersByAPNAP(ctx, getSacrificeTriggers(ctx, sacrificingPlayerId, sacrificedPermanent));
  if (triggers.length === 0) {
    return [];
  }

  const stateAny = ctx.state as any;
  stateAny.stack = Array.isArray(stateAny.stack) ? stateAny.stack : [];
  const gameId = String((ctx as any).gameId || '').trim();
  const queued: any[] = [];
  const sacrificedPermanentId = String(sacrificedPermanent?.id || '').trim();
  const sacrificedCardName = String(sacrificedPermanent?.card?.name || 'Sacrificed permanent').trim();
  const sacrificedPermanentSnapshot = snapshotPermanentForSacrificeTrigger(sacrificedPermanent);

  for (const trigger of triggers) {
    const effect = String(trigger.effect || '').trim();
    const targetMetadata = inferGenericTriggeredAbilityTargetMetadata(effect);
    if (!effect || hasUnsupportedTargetRequirement(targetMetadata)) {
      continue;
    }

    const triggerId = uid('trigger');
    const sourcePermanentSnapshot = snapshotPermanentForSacrificeTrigger(findBattlefieldPermanentById(ctx, trigger.permanentId));
    const stackItem = {
      id: triggerId,
      type: 'triggered_ability',
      controller: trigger.controllerId,
      source: trigger.permanentId,
      permanentId: trigger.permanentId,
      sourceName: trigger.cardName,
      description: effect,
      effect,
      ...targetMetadata,
      ...(sourcePermanentSnapshot?.card ? { card: sourcePermanentSnapshot.card } : null),
      ...(sourcePermanentSnapshot ? { sourcePermanentSnapshot } : null),
      triggerType: trigger.triggerType,
      mandatory: trigger.mandatory !== false,
      triggeringPlayer: sacrificingPlayerId,
      targetPlayer: sacrificingPlayerId,
      effectData: {
        sacrificingPlayerId,
        sacrificedPermanentId,
        sacrificedCardName,
        sacrificedPermanentWasToken: sacrificedPermanent?.isToken === true,
      },
      ...(sacrificedPermanentSnapshot ? { sacrificedPermanent: sacrificedPermanentSnapshot } : null),
    } as any;

    stateAny.stack.push(stackItem);
    queued.push(stackItem);

    if (gameId && gameId !== 'unknown') {
      try {
        appendEvent(gameId, Number((ctx as any).seq?.value ?? (ctx as any).seq ?? 0), 'pushTriggeredAbility', {
          triggerId,
          sourceId: trigger.permanentId,
          sourceName: trigger.cardName,
          controllerId: trigger.controllerId,
          description: effect,
          triggerType: trigger.triggerType,
          effect,
          ...targetMetadata,
          mandatory: trigger.mandatory !== false,
          targetPlayer: sacrificingPlayerId,
          triggeringPlayer: sacrificingPlayerId,
          ...(sourcePermanentSnapshot?.card ? { card: sourcePermanentSnapshot.card } : null),
          ...(sourcePermanentSnapshot ? { sourcePermanentSnapshot } : null),
          ...(sacrificedPermanentSnapshot ? { sacrificedPermanent: sacrificedPermanentSnapshot } : null),
          effectData: stackItem.effectData,
        });
      } catch (err) {
        debugWarn(1, '[sacrificeTrigger] Failed to persist generic sacrifice trigger:', err);
      }
    }
  }

  return queued;
}