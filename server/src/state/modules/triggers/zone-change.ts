import type { GameContext } from '../../context.js';

import { appendEvent } from '../../../db/index.js';
import { debugWarn } from '../../../utils/debug.js';
import { uid } from '../../utils.js';
import { isInterveningIfSatisfied } from './intervening-if.js';
import { orderTriggersByAPNAP } from './ordering.js';
import { hasUnsupportedTargetRequirement, inferGenericTriggeredAbilityTargetMetadata } from './target-metadata.js';

export interface ExiledFromBattlefieldTrigger {
  permanentId: string;
  cardName: string;
  controllerId: string;
  triggerType: 'creature_exiled_from_battlefield' | 'permanent_exiled_from_battlefield';
  oracleClause: string;
  effect: string;
  mandatory: boolean;
  targetFilter: 'creature' | 'permanent';
}

export function detectExiledFromBattlefieldTriggers(card: any, permanent: any): ExiledFromBattlefieldTrigger[] {
  const triggers: ExiledFromBattlefieldTrigger[] = [];
  const oracleText = String(card?.oracle_text || '');
  const permanentId = String(permanent?.id || '');
  const controllerId = String(permanent?.controller || '');
  const cardName = String(card?.name || 'Unknown');

  const matches = oracleText.matchAll(/whenever a (creature|permanent) is exiled from the battlefield,\s*([^.]+)/gi);
  for (const match of matches) {
    const targetFilter = String(match[1] || '').trim().toLowerCase() === 'creature' ? 'creature' : 'permanent';
    const effect = String(match[2] || '').trim().replace(/\s+/g, ' ');
    if (!effect) continue;

    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerType: targetFilter === 'creature' ? 'creature_exiled_from_battlefield' : 'permanent_exiled_from_battlefield',
      oracleClause: String(match[0] || '').trim(),
      effect,
      mandatory: !/^you may\b/i.test(effect),
      targetFilter,
    });
  }

  return triggers;
}

export function getExiledFromBattlefieldTriggers(
  ctx: GameContext,
  exiledPermanent: any,
): ExiledFromBattlefieldTrigger[] {
  const triggers: ExiledFromBattlefieldTrigger[] = [];
  const battlefield = Array.isArray(ctx.state?.battlefield) ? ctx.state.battlefield : [];
  const exiledTypeLine = String(exiledPermanent?.card?.type_line || '').toLowerCase();

  for (const permanent of battlefield) {
    if (!permanent || !permanent.card) continue;

    const permanentTriggers = detectExiledFromBattlefieldTriggers(permanent.card, permanent);
    for (const trigger of permanentTriggers) {
      if (trigger.targetFilter === 'creature' && !exiledTypeLine.includes('creature')) {
        continue;
      }

      const ok = isInterveningIfSatisfied(
        ctx,
        trigger.controllerId,
        String(trigger.oracleClause || trigger.effect || ''),
        permanent,
        {
          thatPermanent: exiledPermanent,
          referencedPermanent: exiledPermanent,
          exiledPermanent,
        } as any,
      );
      if (ok === false) continue;

      triggers.push(trigger);
    }
  }

  return triggers;
}

export function queueExiledFromBattlefieldTriggers(
  ctx: GameContext,
  exiledPermanent: any,
): any[] {
  if (!exiledPermanent?.id) return [];
  if ((ctx as any)?.isReplaying) return [];

  const triggers = orderTriggersByAPNAP(ctx, getExiledFromBattlefieldTriggers(ctx, exiledPermanent));
  if (triggers.length === 0) return [];

  const stateAny = ctx.state as any;
  stateAny.stack = Array.isArray(stateAny.stack) ? stateAny.stack : [];
  const gameId = String((ctx as any).gameId || '').trim();
  const queued: any[] = [];

  for (const trigger of triggers) {
    const effect = String(trigger.effect || '').trim();
    const targetMetadata = inferGenericTriggeredAbilityTargetMetadata(effect);
    if (!effect || hasUnsupportedTargetRequirement(targetMetadata)) continue;

    const triggerId = uid('trigger');
    const exiledPermanentId = String(exiledPermanent.id || '');
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
      triggerType: trigger.triggerType,
      mandatory: trigger.mandatory !== false,
      triggeringPermanent: exiledPermanentId,
      effectData: {
        exiledPermanentId,
        exiledPermanentName: String(exiledPermanent?.card?.name || 'Permanent'),
        exiledPermanentController: String(exiledPermanent?.controller || ''),
        exiledPermanentOwner: String(exiledPermanent?.owner || exiledPermanent?.controller || ''),
        exiledPermanentTypeLine: String(exiledPermanent?.card?.type_line || ''),
        wasToken: exiledPermanent?.isToken === true,
        fromZone: 'battlefield',
        toZone: 'exile',
      },
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
          triggeringPermanent: exiledPermanentId,
          effectData: stackItem.effectData,
        });
      } catch (err) {
        debugWarn(1, '[zoneChangeTrigger] Failed to persist exiled-from-battlefield trigger:', err);
      }
    }
  }

  return queued;
}

export interface PutIntoGraveyardTrigger {
  permanentId: string;
  cardName: string;
  controllerId: string;
  triggerType: 'card_put_into_graveyard';
  oracleClause: string;
  effect: string;
  mandatory: boolean;
  graveyardScope: 'your' | 'opponent' | 'player' | 'any';
  creatureCardOnly: boolean;
  nonblackOnly: boolean;
  excludesBattlefield: boolean;
}

export interface LeftGraveyardTrigger {
  permanentId: string;
  cardName: string;
  controllerId: string;
  triggerType: 'card_left_graveyard';
  oracleClause: string;
  effect: string;
  mandatory: boolean;
  graveyardScope: 'your' | 'opponent' | 'player' | 'any';
  creatureCardOnly: boolean;
  oneOrMore: boolean;
}

export function detectPutIntoGraveyardTriggers(card: any, permanent: any): PutIntoGraveyardTrigger[] {
  const triggers: PutIntoGraveyardTrigger[] = [];
  const oracleText = String(card?.oracle_text || '');
  const permanentId = String(permanent?.id || '');
  const controllerId = String(permanent?.controller || '');
  const cardName = String(card?.name || 'Unknown');

  const matches = oracleText.matchAll(
    /(?:whenever|or) (?:a|one or more) ((?:nonblack\s+)?(?:creature\s+)?cards?) (?:is|are) put into (an opponent's|a player's|a|any|your) graveyard from anywhere( other than the battlefield)?,\s*([^.]+)/gi,
  );
  for (const match of matches) {
    const subject = String(match[1] || '').toLowerCase();
    const scopeText = String(match[2] || '').toLowerCase();
    let effect = String(match[4] || '').trim().replace(/\s+/g, ' ');
    if (/^or\b/i.test(effect) && effect.includes(',')) {
      effect = effect.slice(effect.lastIndexOf(',') + 1).trim();
    }
    if (!effect) continue;

    const graveyardScope: PutIntoGraveyardTrigger['graveyardScope'] = scopeText.includes('opponent')
      ? 'opponent'
      : scopeText === 'your'
        ? 'your'
        : scopeText.includes('player')
          ? 'player'
          : 'any';

    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerType: 'card_put_into_graveyard',
      oracleClause: String(match[0] || '').trim(),
      effect,
      mandatory: !/^you may\b/i.test(effect),
      graveyardScope,
      creatureCardOnly: /\bcreature\s+card/.test(subject),
      nonblackOnly: /\bnonblack\b/.test(subject),
      excludesBattlefield: Boolean(match[3]),
    });
  }

  return triggers;
}

function cardMatchesPutIntoGraveyardTrigger(card: any, trigger: PutIntoGraveyardTrigger): boolean {
  const typeLine = String(card?.type_line || '').toLowerCase();
  if (trigger.creatureCardOnly && !typeLine.includes('creature')) return false;

  if (trigger.nonblackOnly) {
    const colors = Array.isArray(card?.colors) ? card.colors.map((value: any) => String(value).toUpperCase()) : [];
    const colorIdentity = Array.isArray(card?.color_identity) ? card.color_identity.map((value: any) => String(value).toUpperCase()) : [];
    if (colors.includes('B') || (!colors.length && colorIdentity.includes('B'))) {
      return false;
    }
  }

  return true;
}

function graveyardScopeMatches(trigger: PutIntoGraveyardTrigger, sourceControllerId: string, graveyardOwnerId: string): boolean {
  switch (trigger.graveyardScope) {
    case 'opponent':
      return Boolean(sourceControllerId && graveyardOwnerId && sourceControllerId !== graveyardOwnerId);
    case 'your':
      return Boolean(sourceControllerId && graveyardOwnerId && sourceControllerId === graveyardOwnerId);
    case 'player':
    case 'any':
    default:
      return true;
  }
}

export function getPutIntoGraveyardTriggers(
  ctx: GameContext,
  graveyardOwnerId: string,
  card: any,
  options?: { fromBattlefield?: boolean; controllerId?: string },
): PutIntoGraveyardTrigger[] {
  const battlefield = Array.isArray(ctx.state?.battlefield) ? ctx.state.battlefield : [];
  const ownerId = String(graveyardOwnerId || '').trim();
  const triggers: PutIntoGraveyardTrigger[] = [];

  for (const permanent of battlefield) {
    if (!permanent || !permanent.card) continue;

    for (const trigger of detectPutIntoGraveyardTriggers(permanent.card, permanent)) {
      if (trigger.excludesBattlefield && options?.fromBattlefield) continue;
      if (!cardMatchesPutIntoGraveyardTrigger(card, trigger)) continue;
      if (!graveyardScopeMatches(trigger, String(permanent.controller || ''), ownerId)) continue;

      const ok = isInterveningIfSatisfied(
        ctx,
        trigger.controllerId,
        trigger.oracleClause,
        permanent,
        {
          thatCard: card,
          referencedCard: card,
          graveyardOwnerId: ownerId,
          targetPlayerId: ownerId,
          thatPlayerId: ownerId,
        } as any,
      );
      if (ok === false) continue;

      triggers.push(trigger);
    }
  }

  return triggers;
}

export function queuePutIntoGraveyardTriggers(
  ctx: GameContext,
  graveyardOwnerId: string,
  card: any,
  options?: { fromBattlefield?: boolean; controllerId?: string },
): any[] {
  const ownerId = String(graveyardOwnerId || '').trim();
  if (!ownerId || !card) return [];
  if ((ctx as any)?.isReplaying) return [];

  const triggers = orderTriggersByAPNAP(ctx, getPutIntoGraveyardTriggers(ctx, ownerId, card, options));
  if (triggers.length === 0) return [];

  const stateAny = ctx.state as any;
  stateAny.stack = Array.isArray(stateAny.stack) ? stateAny.stack : [];
  const gameId = String((ctx as any).gameId || '').trim();
  const queued: any[] = [];

  for (const trigger of triggers) {
    const effect = String(trigger.effect || '').trim();
    const targetMetadata = inferGenericTriggeredAbilityTargetMetadata(effect);
    if (!effect || hasUnsupportedTargetRequirement(targetMetadata)) continue;

    const triggerId = uid('trigger');
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
      triggerType: trigger.triggerType,
      mandatory: trigger.mandatory !== false,
      effectData: {
        graveyardCardId: String(card?.id || ''),
        graveyardCardName: String(card?.name || 'Card'),
        graveyardCardOwner: ownerId,
        graveyardCardController: String(options?.controllerId || ownerId),
        graveyardCardTypeLine: String(card?.type_line || ''),
        fromZone: options?.fromBattlefield ? 'battlefield' : 'nonbattlefield',
        toZone: 'graveyard',
      },
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
          effectData: stackItem.effectData,
        });
      } catch (err) {
        debugWarn(1, '[zoneChangeTrigger] Failed to persist put-into-graveyard trigger:', err);
      }
    }
  }

  return queued;
}

export function detectLeftGraveyardTriggers(card: any, permanent: any): LeftGraveyardTrigger[] {
  const triggers: LeftGraveyardTrigger[] = [];
  const oracleText = String(card?.oracle_text || '');
  const permanentId = String(permanent?.id || '');
  const controllerId = String(permanent?.controller || '');
  const cardName = String(card?.name || 'Unknown');

  const matches = oracleText.matchAll(
    /(?:whenever|or) (a|one or more) ((?:creature\s+)?cards?) leaves? (an opponent's|a player's|a|any|your) graveyard,\s*([^.]+)/gi,
  );

  for (const match of matches) {
    const countText = String(match[1] || '').toLowerCase();
    const subject = String(match[2] || '').toLowerCase();
    const scopeText = String(match[3] || '').toLowerCase();
    const effect = String(match[4] || '').trim().replace(/\s+/g, ' ');
    if (!effect) continue;

    const graveyardScope: LeftGraveyardTrigger['graveyardScope'] = scopeText.includes('opponent')
      ? 'opponent'
      : scopeText === 'your'
        ? 'your'
        : scopeText.includes('player')
          ? 'player'
          : 'any';

    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerType: 'card_left_graveyard',
      oracleClause: String(match[0] || '').trim(),
      effect,
      mandatory: !/^you may\b/i.test(effect),
      graveyardScope,
      creatureCardOnly: /\bcreature\s+card/.test(subject),
      oneOrMore: countText === 'one or more',
    });
  }

  return triggers;
}

function graveyardLeftScopeMatches(trigger: LeftGraveyardTrigger, sourceControllerId: string, graveyardOwnerId: string): boolean {
  switch (trigger.graveyardScope) {
    case 'opponent':
      return Boolean(sourceControllerId && graveyardOwnerId && sourceControllerId !== graveyardOwnerId);
    case 'your':
      return Boolean(sourceControllerId && graveyardOwnerId && sourceControllerId === graveyardOwnerId);
    case 'player':
    case 'any':
    default:
      return true;
  }
}

export function getLeftGraveyardTriggers(
  ctx: GameContext,
  graveyardOwnerId: string,
  card: any,
): LeftGraveyardTrigger[] {
  const battlefield = Array.isArray(ctx.state?.battlefield) ? ctx.state.battlefield : [];
  const ownerId = String(graveyardOwnerId || '').trim();
  const typeLine = String(card?.type_line || card?.card?.type_line || '').toLowerCase();
  const triggers: LeftGraveyardTrigger[] = [];

  for (const permanent of battlefield) {
    if (!permanent || !permanent.card) continue;

    for (const trigger of detectLeftGraveyardTriggers(permanent.card, permanent)) {
      if (trigger.creatureCardOnly && !typeLine.includes('creature')) continue;
      if (!graveyardLeftScopeMatches(trigger, String(permanent.controller || ''), ownerId)) continue;

      const ok = isInterveningIfSatisfied(
        ctx,
        trigger.controllerId,
        trigger.oracleClause,
        permanent,
        {
          thatCard: card,
          referencedCard: card,
          graveyardOwnerId: ownerId,
          targetPlayerId: ownerId,
          thatPlayerId: ownerId,
        } as any,
      );
      if (ok === false) continue;

      triggers.push(trigger);
    }
  }

  return triggers;
}

export function queueLeftGraveyardTriggers(
  ctx: GameContext,
  graveyardOwnerId: string,
  card: any,
): any[] {
  const ownerId = String(graveyardOwnerId || '').trim();
  if (!ownerId || !card) return [];
  if ((ctx as any)?.isReplaying) return [];

  const triggers = orderTriggersByAPNAP(ctx, getLeftGraveyardTriggers(ctx, ownerId, card));
  if (triggers.length === 0) return [];

  const stateAny = ctx.state as any;
  stateAny.stack = Array.isArray(stateAny.stack) ? stateAny.stack : [];
  const gameId = String((ctx as any).gameId || '').trim();
  const queued: any[] = [];

  for (const trigger of triggers) {
    const effect = String(trigger.effect || '').trim();
    const targetMetadata = inferGenericTriggeredAbilityTargetMetadata(effect);
    if (!effect || hasUnsupportedTargetRequirement(targetMetadata)) continue;

    const triggerId = uid('trigger');
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
      triggerType: trigger.triggerType,
      mandatory: trigger.mandatory !== false,
      effectData: {
        leftGraveyardCardId: String(card?.id || ''),
        leftGraveyardCardName: String(card?.name || 'Card'),
        leftGraveyardOwner: ownerId,
        leftGraveyardCardTypeLine: String(card?.type_line || card?.card?.type_line || ''),
        fromZone: 'graveyard',
        toZone: 'unknown',
      },
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
          effectData: stackItem.effectData,
        });
      } catch (err) {
        debugWarn(1, '[zoneChangeTrigger] Failed to persist left-graveyard trigger:', err);
      }
    }
  }

  return queued;
}