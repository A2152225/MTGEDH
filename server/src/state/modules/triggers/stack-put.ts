/**
 * Origin: Grip of Chaos family — "Whenever a spell or ability is put onto the
 * stack, if it has a single target, reselect its target at random."
 * Generic stack-put detection + queue. No card-name routing.
 * Public: detectStackPutTriggers, queueStackPutTriggers.
 */
import type { GameContext } from '../../context.js';
import { extractTriggeredEffectFromTimingMatch } from '../../../../../rules-engine/src/triggerEffectTextExtraction.js';
import { appendEvent } from '../../../db/index.js';
import { debugWarn } from '../../../utils/debug.js';
import { uid } from '../../utils.js';
import { uniqueStackTargetIds } from '../../../rules-engine/targeting-handlers/targetingStackObjectSingleTarget.js';
import { isInterveningIfSatisfied } from './intervening-if.js';
import { orderTriggersByAPNAP } from './ordering.js';
import { collectMatchingParsedEventLines, parsedEffectDuplicates } from './triggerConditionFamilyMatch.js';
import { hasUnsupportedTargetRequirement, inferGenericTriggeredAbilityTargetMetadata } from './target-metadata.js';

export interface StackPutTrigger {
  permanentId: string;
  cardName: string;
  controllerId: string;
  triggerType: 'stack_put';
  oracleClause: string;
  effect: string;
  mandatory: boolean;
}

function normalizeOracleText(text: string): string {
  return String(text || '').replace(/[’]/g, "'").replace(/\s+/g, ' ').trim();
}

const STACK_PUT_PATTERN =
  /whenever a spell or ability is put onto the stack(?:,\s*if it has a single target)?,?\s*([^.]+)/gi;

export function detectStackPutTriggers(card: any, permanent: any): StackPutTrigger[] {
  const triggers: StackPutTrigger[] = [];
  const oracleText = normalizeOracleText(card?.oracle_text || '');
  const permanentId = String(permanent?.id || '');
  const controllerId = String(permanent?.controller || '');
  const cardName = String(card?.name || 'Unknown');
  if (!oracleText || !permanentId || !controllerId) return triggers;

  STACK_PUT_PATTERN.lastIndex = 0;
  for (const match of oracleText.matchAll(STACK_PUT_PATTERN)) {
    const effect = extractTriggeredEffectFromTimingMatch(oracleText, match, 1)
      || String(match[1] || '').trim();
    if (!effect) continue;
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerType: 'stack_put',
      oracleClause: String(match[0] || '').trim(),
      effect,
      mandatory: !/^you may\b/i.test(effect),
    });
  }
  return triggers;
}

function findStackItem(state: any, stackItemId: string): any | undefined {
  const wanted = String(stackItemId || '').trim();
  if (!wanted) return undefined;
  const stack = Array.isArray(state?.stack) ? state.stack : [];
  return stack.find((item: any) => String(item?.id || '').trim() === wanted);
}

function snapshotPermanent(permanent: any): any | undefined {
  if (!permanent || typeof permanent !== 'object') return undefined;
  return {
    id: String(permanent?.id || ''),
    controller: String(permanent?.controller || ''),
    owner: String(permanent?.owner || permanent?.controller || ''),
    tapped: permanent?.tapped === true,
    counters: permanent?.counters && typeof permanent.counters === 'object' ? { ...permanent.counters } : undefined,
    card: permanent?.card && typeof permanent.card === 'object' ? { ...(permanent.card as any) } : undefined,
  };
}

let stackPutDepth = 0;

export function queueStackPutTriggers(ctx: GameContext, stackItemId: string): any[] {
  if ((ctx as any)?.isReplaying) return [];
  const causingId = String(stackItemId || '').trim();
  if (!causingId) return [];
  if (stackPutDepth > 24) return [];

  const stateAny = ctx.state as any;
  const causingItem = findStackItem(stateAny, causingId);
  if (!causingItem) return [];

  const battlefield = Array.isArray(stateAny?.battlefield) ? stateAny.battlefield : [];
  const detected: StackPutTrigger[] = [];
  for (const permanent of battlefield) {
    if (!permanent?.card) continue;
    detected.push(...detectStackPutTriggers(permanent.card, permanent));
    for (const line of collectMatchingParsedEventLines({
      ctx,
      oracleText: String(permanent.card.oracle_text || ''),
      event: 'put_on_stack',
      subjectPermanent: causingItem,
      subjectControllerId: String(causingItem.controller || ''),
      sourcePermanent: permanent,
    })) {
      const normalized = line.effect.toLowerCase();
      if (detected.some((existing) => (
        existing.permanentId === String(permanent.id || '')
        && parsedEffectDuplicates(existing.effect || '', line)
      ))) continue;
      detected.push({
        permanentId: String(permanent.id || ''),
        cardName: String(permanent.card?.name || 'Unknown'),
        controllerId: String(permanent.controller || ''),
        triggerType: 'stack_put',
        oracleClause: line.effect,
        effect: line.effect,
        mandatory: !/^you may\b/i.test(line.effect),
      });
    }
  }
  if (detected.length === 0) return [];

  const causingUniqueTargetCount = uniqueStackTargetIds(causingItem).length;
  const ordered = orderTriggersByAPNAP(ctx, detected);
  stateAny.stack = Array.isArray(stateAny.stack) ? stateAny.stack : [];
  const gameId = String((ctx as any).gameId || (ctx as any).id || '').trim();
  const queued: any[] = [];

  stackPutDepth += 1;
  try {
    for (const trigger of ordered) {
      if (/if it has a single target/i.test(trigger.oracleClause) && causingUniqueTargetCount !== 1) {
        continue;
      }
      const sourcePermanent = battlefield.find(
        (perm: any) => String(perm?.id || '') === String(trigger.permanentId),
      );
      const clause = String(trigger.oracleClause || '').trim()
        || `Whenever a spell or ability is put onto the stack, ${trigger.effect}`;
      const ok = isInterveningIfSatisfied(
        ctx as any,
        String(trigger.controllerId),
        clause,
        sourcePermanent,
        {
          triggeringStackItemId: causingId,
          stackItem: causingItem,
        } as any,
      );
      if (ok === false) continue;

      const effect = String(trigger.effect || '').trim();
      const targetMetadata = inferGenericTriggeredAbilityTargetMetadata(effect);
      if (!effect || hasUnsupportedTargetRequirement(targetMetadata)) continue;

      const triggerId = uid('trigger');
      const sourcePermanentSnapshot = snapshotPermanent(sourcePermanent);
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
        triggeringStackItemId: causingId,
        effectData: {
          triggeringStackItemId: causingId,
        },
      } as any;

      stateAny.stack.push(stackItem);
      queued.push(stackItem);

      if (gameId && gameId !== 'unknown') {
        try {
          appendEvent(gameId, Number((ctx as any).seq?.value ?? (ctx as any).seq ?? 0), 'pushTriggeredAbility', {
            triggerId,
            sourceId: trigger.permanentId,
            permanentId: trigger.permanentId,
            sourceName: trigger.cardName,
            controllerId: trigger.controllerId,
            description: effect,
            triggerType: trigger.triggerType,
            effect,
            ...targetMetadata,
            mandatory: trigger.mandatory !== false,
            triggeringStackItemId: causingId,
            ...(sourcePermanentSnapshot?.card ? { card: sourcePermanentSnapshot.card } : null),
            ...(sourcePermanentSnapshot ? { sourcePermanentSnapshot } : null),
            effectData: stackItem.effectData,
          });
        } catch (err) {
          debugWarn(1, '[stack-put] appendEvent(pushTriggeredAbility) failed:', err);
        }
      }
    }

    for (const item of [...queued]) {
      const nestedId = String(item?.id || '').trim();
      if (nestedId) queued.push(...queueStackPutTriggers(ctx, nestedId));
    }
  } finally {
    stackPutDepth -= 1;
  }

  return queued;
}
