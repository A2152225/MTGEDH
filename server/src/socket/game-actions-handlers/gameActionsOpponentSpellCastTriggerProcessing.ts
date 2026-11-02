import type { Server } from "socket.io";
import type { PlayerID } from "../../../../shared/src/index.js";
import { appendEvent } from "../../db";
import { updateCounters } from "../../state/modules/counters_tokens.js";
import { inferTriggeredAbilityTargetMetadata, isModalChooseModesEffectText } from "../../state/modules/inferTriggeredAbilityTargetMetadata.js";
import { isOracleIrTriggerPrimaryEnabled } from "../../state/modules/oracleIrFeatureFlags.js";
import { tryResolveTriggerViaOracleIR } from "../../state/modules/oracleIrTriggerExecution.js";
import { isTriggerEffectOwnedByOracleIrPrimary } from "../../state/modules/oracleIrTriggerLegacyRouting.js";
import { getOpponentSpellCastTriggers, spellOrdinalForCaster } from "../../state/modules/triggers/index.js";
import { getTurnScopedSpellTriggerSources } from "../../state/modules/triggers/turnScopedSpellTriggers.js";
import { isInterveningIfSatisfied } from "../../state/modules/triggers/intervening-if";
import { orderTriggersByAPNAP } from "../../state/modules/triggers/ordering.js";
import { ResolutionQueueManager, ResolutionStepType, createResolutionStep } from "../../state/resolution/index.js";
import { uid } from "../../state/utils";
import { debug, debugWarn } from "../../utils/debug.js";
import { cloneTriggeringStackItemSnapshot, findTriggeringSpellOnStack } from "../../state/modules/triggerCastSpellStackBinding.js";
import { queueStackPutTriggers } from "../../state/modules/triggers/stack-put.js";
import { queueOptionalPaymentStep } from "../optional-payment-prompts.js";
import { deriveCastUsedManaFromPermanentSource, getPlayerName, millUntilLand } from "../util";
import type { SpellCastSourceZone } from "./gameActionsCastCostReduction.js";
import {
  applySpellCastUntapTrigger,
  cloneTriggeredSpellCopy,
  persistQueuedSpellCastStepContinuation,
} from "./gameActionsSpellCopyHeroicTriggers.js";
import {
  createSpellCastTriggerToken,
  getSpellCastTriggersForCard,
  hasSpellCastTriggerTriggeredThisTurn,
  markSpellCastTriggerTriggeredThisTurn,
  normalizeSpellCastSourceZone,
  resolveSpellCastOptionalPaymentChoice,
} from "./gameActionsSpellCastTriggerDetection.js";
import { faceDownSpellCastView } from '../../state/modules/faceDownCastTriggerView.js';

/**
 * Origin parent: server/src/socket/game-actions-handlers/gameActionsSpellCastTriggerProcessing.ts
 *
 * Cluster moved: the opponent / any-player spell-cast trigger pass (Esper Sentinel,
 * Bonus Round turn-scoped watchers): APNAP ordering, cast-zone and intervening-if
 * gating, Oracle IR routing and queueing.
 *
 * Public entry symbol: processOpponentSpellCastTriggersForCast.
 */
export function processOpponentSpellCastTriggersForCast(
  gameId: string,
  game: any,
  io: Server,
  casterId: string,
  spellCard: any,
  castSourceZone?: SpellCastSourceZone,
  triggeringStackItemId?: string,
): void {
  spellCard = faceDownSpellCastView(game?.state, casterId, spellCard);
  try {
    const allPlayerIds = (game.state?.players || []).map((player: any) => player.id);
    const battlefield = game.state?.battlefield || [];
    const ctxForInterveningIf = { state: game.state } as any;
    const normalizedCastSourceZone = normalizeSpellCastSourceZone(castSourceZone);
    const triggeringSpellImageUrl = String(
      spellCard?.image_uris?.small
      || spellCard?.image_uris?.normal
      || spellCard?.imageUrl
      || '',
    ).trim();
    const triggeringSpellSnapshot = {
      id: spellCard?.id,
      name: spellCard?.name,
      type_line: spellCard?.type_line,
      ...(triggeringSpellImageUrl ? { imageUrl: triggeringSpellImageUrl } : null),
      ...(normalizedCastSourceZone ? { castSourceZone: normalizedCastSourceZone } : null),
    };
    const stackArr: any[] = Array.isArray((game.state as any)?.stack) ? (game.state as any).stack : [];
    let triggeringStackItem: any = null;
    const normalizedTriggeringStackItemId = String(triggeringStackItemId || '').trim();
    if (normalizedTriggeringStackItemId) {
      triggeringStackItem = stackArr.find((item: any) => item && String(item.id || '') === normalizedTriggeringStackItemId) || null;
    }
    if (!triggeringStackItem) {
      for (let i = stackArr.length - 1; i >= 0; i--) {
        const item = stackArr[i];
        if (!item || String(item.controller || '') !== String(casterId)) continue;
        if (String(item.type || '').trim().toLowerCase() === 'triggered_ability') continue;
        const itemCardId = String(item?.card?.id || '');
        if (itemCardId && itemCardId === String(spellCard?.id || '')) {
          triggeringStackItem = item;
          break;
        }
      }
    }
    const resolvedTriggeringStackItemId = triggeringStackItem
      ? String(triggeringStackItem.id || '')
      : String(findTriggeringSpellOnStack(game.state, {
          triggeringPlayer: casterId,
          effectData: {
            casterId,
            triggeringSpell: triggeringSpellSnapshot,
          },
        }, { casterId, cardId: String(spellCard?.id || '') })?.id || '') || undefined;
    if (!triggeringStackItem && resolvedTriggeringStackItemId) {
      triggeringStackItem = stackArr.find((item: any) => item && String(item.id || '') === resolvedTriggeringStackItemId) || null;
    }
    const triggeringSpellStackItemSnapshot = cloneTriggeringStackItemSnapshot(triggeringStackItem);
    const spellTypeLine = String(spellCard?.type_line || '').toLowerCase();
    const isNoncreatureSpell = !spellTypeLine.includes('creature');
    const noncreatureSpellsThisTurn = (game.state?.noncreatureSpellsCastThisTurn || {})[casterId] || 0;
    const isFirstNoncreatureThisTurn = isNoncreatureSpell && noncreatureSpellsThisTurn === 0;

    if (isNoncreatureSpell) {
      game.state.noncreatureSpellsCastThisTurn = game.state.noncreatureSpellsCastThisTurn || {};
      game.state.noncreatureSpellsCastThisTurn[casterId] = noncreatureSpellsThisTurn + 1;
    }

    const opponentTriggers = orderTriggersByAPNAP(
      { state: game.state } as any,
      getOpponentSpellCastTriggers(
        // Spell-created "until end of turn, whenever a player casts" sources (Bonus Round) watch too.
        [...battlefield, ...getTurnScopedSpellTriggerSources(game.state)],
        casterId,
        spellCard,
        allPlayerIds,
        isFirstNoncreatureThisTurn,
        normalizedCastSourceZone,
        spellOrdinalForCaster(game.state, casterId, spellCard),
      ),
    );

    for (const trigger of opponentTriggers) {
      const raw = String(trigger.description || (trigger as any).effect || '').trim();
      let triggerText = raw;
      if (triggerText && !/^(?:when|whenever|at)\b/i.test(triggerText)) {
        triggerText = `Whenever an opponent casts a spell, ${triggerText}`;
      }
      const resolvedCasterId = String((trigger as any).casterId || casterId || '').trim();
      const wantsHandCast = /\bfrom (?:their|your|his or her) hand\b/i.test(triggerText);
      if (wantsHandCast && normalizedCastSourceZone && normalizedCastSourceZone !== 'hand') {
        debug(2, `[processOpponentSpellCastTriggersForCast] Skipping ${trigger.cardName}: spell was not cast from hand`);
        continue;
      }
      const sourcePerm = (game.state?.battlefield || []).find((perm: any) => perm && perm.id === (trigger as any).permanentId);
      const needsThatPlayerRef = /\bthat player\b/i.test(triggerText);
      const baseRefs: any = {
        triggeringStackItemId: resolvedTriggeringStackItemId,
        stackItem: triggeringStackItem || undefined,
      };
      const ok = isInterveningIfSatisfied(
        ctxForInterveningIf,
        String(trigger.controllerId),
        triggerText,
        sourcePerm,
        needsThatPlayerRef && resolvedCasterId
          ? {
              ...baseRefs,
              thatPlayerId: resolvedCasterId,
              referencedPlayerId: resolvedCasterId,
              theirPlayerId: resolvedCasterId,
            }
          : baseRefs,
      );
      if (ok === false) {
        debug(2, `[processOpponentSpellCastTriggersForCast] Skipping opponent spell trigger due to unmet intervening-if: ${trigger.cardName} - ${triggerText}`);
        continue;
      }

      game.state.stack = game.state.stack || [];
      const triggerId = `trigger_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const stackItem: any = {
        id: triggerId,
        type: 'triggered_ability',
        controller: trigger.controllerId,
        source: trigger.permanentId,
        permanentId: trigger.permanentId,
        sourceName: trigger.cardName,
        description: trigger.description,
        effect: trigger.effect || trigger.benefitIfNotPaid,
        triggerType: trigger.triggerType,
        mandatory: trigger.mandatory,
        targetPlayer: String((trigger as any).casterId || casterId || ''),
        triggeringPlayer: String((trigger as any).casterId || casterId || ''),
        ...(resolvedTriggeringStackItemId ? { triggeringStackItemId: resolvedTriggeringStackItemId } : null),
        ...(normalizedCastSourceZone ? { triggeringSpellCastSourceZone: normalizedCastSourceZone } : null),
        effectData: {
          casterId: trigger.casterId,
          ...(normalizedCastSourceZone ? { castSourceZone: normalizedCastSourceZone, sourceCastZone: normalizedCastSourceZone } : null),
          ...(resolvedTriggeringStackItemId ? { triggeringStackItemId: resolvedTriggeringStackItemId } : null),
          triggeringSpell: triggeringSpellSnapshot,
          ...(triggeringSpellStackItemSnapshot ? { triggeringSpellStackItem: triggeringSpellStackItemSnapshot } : null),
          paymentCost: trigger.paymentCost,
          paymentAmount: trigger.paymentAmount,
          benefitIfNotPaid: trigger.benefitIfNotPaid,
        },
      };
      game.state.stack.push(stackItem);

      try {
        appendEvent(gameId, (game as any).seq ?? 0, 'pushTriggeredAbility', {
          triggerId,
          sourceId: trigger.permanentId,
          permanentId: trigger.permanentId,
          sourceName: trigger.cardName,
          controllerId: trigger.controllerId,
          description: trigger.description,
          triggerType: trigger.triggerType,
          effect: (trigger as any).effect || trigger.description,
          mandatory: trigger.mandatory,
          targetPlayer: stackItem.targetPlayer,
          triggeringPlayer: stackItem.triggeringPlayer,
          ...(resolvedTriggeringStackItemId ? { triggeringStackItemId: resolvedTriggeringStackItemId } : null),
          ...(normalizedCastSourceZone ? { triggeringSpellCastSourceZone: normalizedCastSourceZone } : null),
          effectData: stackItem.effectData,
        });
      } catch (err) {
        debugWarn(1, '[processOpponentSpellCastTriggersForCast] appendEvent(pushTriggeredAbility opponent spell-cast) failed:', err);
      }

      io.to(gameId).emit('chat', {
        id: `m_${Date.now()}`,
        gameId,
        from: 'system',
        message: `${trigger.cardName} triggers (${trigger.description}).`,
        ts: Date.now(),
      });
    }
  } catch (err) {
    debugWarn(1, '[processOpponentSpellCastTriggersForCast] Failed to process opponent spell triggers:', err);
  }
}
