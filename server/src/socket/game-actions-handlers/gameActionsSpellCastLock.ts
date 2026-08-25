/**
 * Origin parent: server/src/socket/game-actions.ts
 *
 * Cluster moved: the in-flight cast guard - the "this player is completing a
 * cast" marker, the payment-resume lock, timing/duplicate-stack checks before a
 * cast may complete, finding or restoring the pending cast step, and the Oracle
 * IR interaction pass that runs while a cast is being completed.
 *
 * Public entry symbols: isPlayerCompletingSpellCast, canCompleteSpellCastAtCurrentTiming,
 * findPendingSpellCastStep, restoreSuspendedLibrarySearchStep, processOracleIRInteractions.
 */
import type { Server, Socket } from "socket.io";
import { applyOracleIRStepsToGameState } from "../../../../rules-engine/src/oracleIRExecutor.js";
import { parseOracleTextToIR } from "../../../../rules-engine/src/oracleIRParser.js";
import type { PlayerID } from "../../../../shared/src/index.js";
import { isSpellEffectOwnedByOracleIrPrimary } from "../../state/modules/oracleIrSpellLegacyRouting.js";
import { ResolutionQueueManager, ResolutionStepType } from "../../state/resolution/index.js";
import { debug } from "../../utils/debug.js";
import { extractModalModesFromOracleText } from "../../utils/oraclePromptContext.js";
import {
  BOUNCE_LANDS,
  SHOCK_LANDS,
  detectETBTappedPattern,
  detectSacrificeUnlessPayETB,
  detectScryOnETB,
  evaluateConditionalLandETB,
  getLandSubtypes,
  isBounceLand,
  isShockLand,
} from "../land-helpers";
import { queueMayAbilityStep } from "../may-ability-prompts.js";

type CompletingSpellCastMarker = {
  cardId: string;
  effectId?: string;
  startedAt: number;
};

export function isPlayerCompletingSpellCast(game: any, playerId: string): boolean {
  const marker = (game?.state as any)?._completingSpellCastByPlayer?.[playerId] as CompletingSpellCastMarker | undefined;
  return Boolean(marker?.cardId);
}

export function markPlayerCompletingSpellCast(game: any, playerId: string, cardId: string, effectId?: string): void {
  const stateAny = (game?.state as any) || {};
  stateAny._completingSpellCastByPlayer = stateAny._completingSpellCastByPlayer || {};
  stateAny._completingSpellCastByPlayer[playerId] = {
    cardId: String(cardId),
    effectId: effectId ? String(effectId) : undefined,
    startedAt: Date.now(),
  };
}

export function clearPlayerCompletingSpellCast(game: any, playerId: string, cardId?: string): void {
  const stateAny = (game?.state as any) || {};
  const marker = stateAny._completingSpellCastByPlayer?.[playerId] as CompletingSpellCastMarker | undefined;
  if (!marker) return;
  if (cardId && String(marker.cardId) !== String(cardId)) return;
  delete stateAny._completingSpellCastByPlayer[playerId];
}

function getPaymentResumeCastLock(game: any): { playerId: string; cardId: string } | null {
  const lock = (game?.state as any)?._paymentResumeCastLock;
  if (!lock || typeof lock !== 'object') return null;
  const playerId = String((lock as any).playerId || '').trim();
  const cardId = String((lock as any).cardId || '').trim();
  if (!playerId || !cardId) return null;
  return { playerId, cardId };
}

export function canCompleteSpellCastAtCurrentTiming(
  game: any,
  playerId: string,
  allowResolutionMode: boolean,
): boolean {
  // Payment-resume path pins this lock so async yields (imports / broadcasts) cannot
  // abort an already-authorized cast when priority races to another player.
  const paymentResumeLock = getPaymentResumeCastLock(game);
  if (paymentResumeLock && paymentResumeLock.playerId === String(playerId)) {
    return true;
  }
  const priority = game?.state?.priority;
  if (priority === playerId) return true;
  if (allowResolutionMode && (priority === null || priority === undefined)) return true;
  return false;
}

export function isSpellAlreadyOnStackForPlayer(game: any, playerId: string, cardId: string): boolean {
  const stack = Array.isArray(game?.state?.stack) ? game.state.stack : [];
  return stack.some((item: any) =>
    String(item?.controller || '') === String(playerId) &&
    String(item?.card?.id || item?.cardId || '') === String(cardId),
  );
}

export function findPendingSpellCastStep(gameId: string, playerId: string, cardId: string): any | undefined {
  const normalizedCardId = String(cardId || '').trim();
  if (!normalizedCardId) {
    return undefined;
  }

  return ResolutionQueueManager
    .getStepsForPlayer(gameId, playerId as any)
    .find((step: any) => {
      if (!step) {
        return false;
      }

      const stepCardId = String(
        step.cardId ??
        step.mutateCardId ??
        step.spellCastContext?.cardId ??
        ''
      ).trim();

      if (stepCardId !== normalizedCardId) {
        return false;
      }

      return (
        (step.type === ResolutionStepType.MANA_PAYMENT_CHOICE && step.spellPaymentRequired === true) ||
        (step.type === ResolutionStepType.TARGET_SELECTION && step.spellCastContext) ||
        step.type === ResolutionStepType.MUTATE_TARGET_SELECTION ||
        (step.type === ResolutionStepType.OPTION_CHOICE && (step.mutateCastModeChoice === true || step.giftCastChoice === true))
      );
    });
}

export async function restoreSuspendedLibrarySearchStep(
  io: Server,
  socket: Socket,
  gameId: string,
  suspendedStep: any,
): Promise<void> {
  if (!suspendedStep) {
    return;
  }

  const queue = ResolutionQueueManager.getQueue(gameId);
  const alreadyQueued = queue.steps.some((entry: any) => String(entry?.id || '') === String(suspendedStep?.id || ''));
  if (!alreadyQueued) {
    queue.steps.unshift(suspendedStep);
    if ((queue as any).activeStep && String((queue as any).activeStep.id || '') === String(suspendedStep?.id || '')) {
      (queue as any).activeStep = undefined;
    }
  }

  const { sanitizeStepForClient } = await import('../resolution.js');
  socket.emit('resolutionStepPrompt', {
    gameId,
    step: sanitizeStepForClient(gameId, suspendedStep),
  });
}

/**
 * After resolveTopOfStack(), scan the resolved spell's oracle IR for optional
 * ("you may") effects and queue an optional may-ability prompt for each one so the player
 * is prompted. AI players are auto-resolved by queueMayAbilityStep using the
 * library-size heuristic from resolution.ts.
 *
 * Only runs for `type === 'spell'` or `type === 'ability'` stack items.
 * `choose_mode` steps are skipped here because modal selection is handled
 * at cast time via extractModalModesFromOracleText.
 */
export async function processOracleIRInteractions(
  io: Server,
  game: any,
  gameId: string,
  topItem: any
): Promise<void> {
  if (!topItem) return;
  // Only process spells and activated abilities; triggered ability effects are
  // handled by their own trigger resolution path.
  if (topItem.type !== 'spell' && topItem.type !== 'ability') return;

  const resolvedCard = topItem.card;
  const resolvedController = String(topItem.controller || '');
  const oracleText: string = resolvedCard?.oracle_text || '';
  if (!oracleText || !resolvedController) return;

  const cardName: string = resolvedCard?.name || 'Spell';
  // When Oracle IR primary owns the spell/ability text, resolve already applied
  // (or queued EP mays for) optional steps. Re-scanning here doubles "you may".
  if (isSpellEffectOwnedByOracleIrPrimary(oracleText, cardName)) {
    debug(2, `[OracleIR] Skipping post-resolve optional may scan for ${cardName} (IR primary owns effect)`);
    return;
  }

  const sourceImage: string | undefined = resolvedCard?.image_uris?.small || resolvedCard?.image_uris?.normal;
  const stackItemId: string = String(topItem.id || '');
  const ctx = {
    controllerId: resolvedController as PlayerID,
    sourceId: stackItemId,
    sourceName: cardName,
    giftPromised: Boolean((topItem as any)?.giftPromised ?? (topItem as any)?.card?.giftPromised),
  };

  let ir: any;
  try {
    ir = parseOracleTextToIR(oracleText, cardName);
  } catch (err) {
    debug(2, `[OracleIR] Failed to parse oracle text for ${cardName}:`, err);
    return;
  }

  for (const ability of (ir?.abilities ?? [])) {
    for (const step of (ability?.steps ?? [])) {
      // choose_mode is handled at cast time via extractModalModesFromOracleText
      if (step.kind === 'choose_mode') continue;
      // Only queue prompts for optional ("you may") steps
      if (!(step as any).optional) continue;

      const effectText: string = String((step as any).raw || step.kind || '').toLowerCase();
      const fullAbilityText: string | undefined = ability.text || ability.effectText || undefined;

      queueMayAbilityStep(
        io, gameId, game,
        resolvedController, cardName,
        effectText, fullAbilityText,
        async () => {
          try {
            const result = applyOracleIRStepsToGameState(
              game.state as any,
              [step],
              ctx,
              { allowOptional: true }
            );
            // Merge executor output back into the live game state.
            // Object.assign replaces top-level fields (zones, life, battlefield,
            // etc.) while preserving any server-side extra properties.
            Object.assign(game.state as any, result.state);
          } catch (err) {
            debug(1, `[OracleIR] Error applying optional step for ${cardName}:`, err);
          }
        }
      );
    }
  }
}

// Note: SHOCK_LANDS, BOUNCE_LANDS, isShockLand, isBounceLand, detectScryOnETB, 
// detectSacrificeUnlessPayETB, detectETBTappedPattern, evaluateConditionalLandETB,
// getLandSubtypes are now imported from ./land-helpers.ts
