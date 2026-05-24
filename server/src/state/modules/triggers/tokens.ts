import type { GameContext } from '../../context.js';

import { appendEvent } from '../../../db/index.js';
import { debugWarn } from '../../../utils/debug.js';
import { uid } from '../../utils.js';
import { orderTriggersByAPNAP } from './ordering.js';
import { hasUnsupportedTargetRequirement, inferGenericTriggeredAbilityTargetMetadata } from './target-metadata.js';

export interface TokenCreatedTrigger {
  permanentId: string;
  cardName: string;
  controllerId: string;
  triggerType: 'token_created';
  oracleClause: string;
  effect: string;
  mandatory: boolean;
  perToken: boolean;
}

function normalizeOracleText(text: string): string {
  return String(text || '').replace(/[’]/g, "'").replace(/\s+/g, ' ').trim();
}

export function detectTokenCreatedTriggers(card: any, permanent: any): TokenCreatedTrigger[] {
  const triggers: TokenCreatedTrigger[] = [];
  const oracleText = normalizeOracleText(card?.oracle_text || '');
  const permanentId = String(permanent?.id || '');
  const controllerId = String(permanent?.controller || '');
  const cardName = String(card?.name || 'Unknown');

  const createOrSacrificeMatches = oracleText.matchAll(/whenever\s+you\s+create\s+or\s+sacrifice\s+(a|one or more)\s+tokens?,?\s*([^.]+)/gi);
  for (const match of createOrSacrificeMatches) {
    const effect = String(match[2] || '').trim();
    if (!effect) continue;
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerType: 'token_created',
      oracleClause: String(match[0] || '').trim(),
      effect,
      mandatory: !/^you may\b/i.test(effect),
      perToken: String(match[1] || '').toLowerCase() !== 'one or more',
    });
  }

  const youCreateMatches = oracleText.matchAll(/whenever\s+you\s+create\s+(one or more\s+)?tokens?,?\s*([^.]+)/gi);
  for (const match of youCreateMatches) {
    const effect = String(match[2] || '').trim();
    if (!effect) continue;
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerType: 'token_created',
      oracleClause: String(match[0] || '').trim(),
      effect,
      mandatory: !/^you may\b/i.test(effect),
      perToken: !match[1],
    });
  }

  const underControlMatches = oracleText.matchAll(/whenever\s+one\s+or\s+more\s+tokens?\s+(?:are|is)\s+created\s+under\s+your\s+control,?\s*([^.]+)/gi);
  for (const match of underControlMatches) {
    const effect = String(match[1] || '').trim();
    if (!effect) continue;
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerType: 'token_created',
      oracleClause: String(match[0] || '').trim(),
      effect,
      mandatory: !/^you may\b/i.test(effect),
      perToken: false,
    });
  }

  return triggers;
}

export function getTokenCreatedTriggers(
  ctx: GameContext,
  tokenControllerId: string,
): TokenCreatedTrigger[] {
  const stateAny = ctx.state as any;
  const battlefield = Array.isArray(stateAny?.battlefield) ? stateAny.battlefield : [];
  const controllerId = String(tokenControllerId || '').trim();
  if (!controllerId) return [];

  const triggers: TokenCreatedTrigger[] = [];
  for (const permanent of battlefield) {
    if (!permanent?.card) continue;
    if (String(permanent.controller || '') !== controllerId) continue;
    triggers.push(...detectTokenCreatedTriggers(permanent.card, permanent));
  }
  return triggers;
}

export function queueTokenCreatedTriggers(
  ctx: GameContext,
  tokenControllerId: string,
  createdTokenIds: string[],
  tokenSnapshot: { name?: string; typeLine?: string } = {},
): any[] {
  const controllerId = String(tokenControllerId || '').trim();
  const tokenIds = (Array.isArray(createdTokenIds) ? createdTokenIds : []).map((id) => String(id || '').trim()).filter(Boolean);
  if (!controllerId || tokenIds.length === 0) return [];
  if ((ctx as any).isReplaying) return [];

  const triggers = orderTriggersByAPNAP(ctx, getTokenCreatedTriggers(ctx, controllerId));
  if (triggers.length === 0) return [];

  const stateAny = ctx.state as any;
  stateAny.stack = Array.isArray(stateAny.stack) ? stateAny.stack : [];
  const gameId = String((ctx as any).gameId || (ctx as any).id || '').trim();
  const queued: any[] = [];

  for (const trigger of triggers) {
    const effect = String(trigger.effect || '').trim();
    const targetMetadata = inferGenericTriggeredAbilityTargetMetadata(effect);
    if (!effect || hasUnsupportedTargetRequirement(targetMetadata)) {
      continue;
    }

    const triggerCount = trigger.perToken ? tokenIds.length : 1;
    for (let index = 0; index < triggerCount; index++) {
      const triggerId = uid('trigger');
      const createdTokenId = trigger.perToken ? tokenIds[index] : undefined;
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
        triggeringPlayer: controllerId,
        effectData: {
          tokenControllerId: controllerId,
          createdTokenIds: [...tokenIds],
          createdTokenId,
          tokensCreated: tokenIds.length,
          tokenName: String(tokenSnapshot.name || '').trim(),
          tokenTypeLine: String(tokenSnapshot.typeLine || '').trim(),
        },
        card: Array.isArray(stateAny.battlefield)
          ? stateAny.battlefield.find((permanent: any) => String(permanent?.id || '') === trigger.permanentId)?.card
          : undefined,
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
            triggeringPlayer: controllerId,
            effectData: stackItem.effectData,
          });
        } catch (err) {
          debugWarn(1, '[tokenCreatedTrigger] Failed to persist generic token-created trigger:', err);
        }
      }
    }
  }

  return queued;
}