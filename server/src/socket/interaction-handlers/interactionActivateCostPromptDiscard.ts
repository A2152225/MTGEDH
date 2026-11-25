/**
 * socket/interaction-handlers/interactionActivateCostPromptDiscard.ts
 *
 * Origin parent: interactionActivateCostPromptDiscardExileHand.ts (split to stay under 40KB).
 * Cluster moved: "Discard ..." as a battlefield activation cost. Validates the cost text and queues
 * the DISCARD_SELECTION that resolutionDiscardResponseCoreHandlers / the discard activation resume
 * consume. Supports "Discard N [type] card(s) [at random]", "Discard N card(s) with mana value X|N",
 * "Discard your hand", an optional "Pay N life", and a trailing "Sacrifice this".
 *
 * Public entry symbols: tryHandleActivateCostPromptDiscard.
 * Returns true when it handled the activation (queued a prompt or emitted an error).
 */

import type { PlayerID } from "../../../../shared/src/index.js";
import { cardManaValue, parseWordNumber } from "../../state/utils";
import { ResolutionQueueManager, ResolutionStepType } from "../../state/resolution/index.js";
import { debug } from "../../utils/debug.js";
import { broadcastGame } from "../util";
import { isRandomDiscardCost, pickRandomCostDiscards } from "./activationCostExtras.js";
import { parseExtendedDiscardCost, stripExtendedDiscardCostClauses } from "./activationCostXAndDiscardClauses.js";
import type { ActivateBattlefieldAbilityContext } from "./interactionActivateBattlefieldAbilityContext.js";

export async function tryHandleActivateCostPromptDiscard(
  ctx: ActivateBattlefieldAbilityContext,
  manaCost: string | undefined,
  abilityText: string,
  requiresTap: boolean,
  abilityConditionText: string,
  pendingSpellCardIdForCostSelection: string,
  buildActivatedAbilityOracleTextForStack: (params: any) => string,
  selectedAbilityFullText: string,
  selectedAbilityOracleLine: string,
): Promise<boolean> {
  const { io, socket, game, gameId, pid, permanentId, abilityId, cardName, selectedXValue } = ctx;

  {
    const costStr = String(manaCost || '');
    const costLower = costStr.toLowerCase();
    if (costLower.includes('discard')) {
      // Optional supported additional clause: "Pay N life" (non-interactive).
      // IMPORTANT: do not actually pay life until the discard step resolves;
      // otherwise canceling the step would incorrectly charge life.
      let lifeToPayForCost: number | undefined;
      {
        const payLifeMatch = costStr.match(/\bpay\s+(a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+life\b/i);
        if (payLifeMatch) {
          const multiple = (costLower.match(/\bpay\s+(?:a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+life\b/gi) || []).length;
          if (multiple > 1 || /\bor\b/i.test(costStr)) {
            socket.emit('error', {
              code: 'UNSUPPORTED_COST',
              message: `Cannot activate ${cardName}: pay-life costs with choices ("or") are not supported yet.`,
            });
            return true;
          }

          const raw = String(payLifeMatch[1] || '').trim();
          const n = parseWordNumber(raw, 1);
          if (!Number.isFinite(n) || n <= 0) {
            socket.emit('error', {
              code: 'UNSUPPORTED_COST',
              message: `Cannot activate ${cardName}: invalid life payment amount.`,
            });
            return true;
          }

          const currentLife = Number((game.state as any)?.life?.[pid] ?? 40);
          if (!Number.isFinite(currentLife) || currentLife < n) {
            socket.emit('error', {
              code: 'INSUFFICIENT_LIFE',
              message: `Cannot activate ${cardName}: need to pay ${n} life, but you only have ${Number.isFinite(currentLife) ? currentLife : 0}.`,
            });
            return true;
          }

          lifeToPayForCost = n;
        }
      }

      // Conservative: support "discard N card(s)" and "discard N <type> card(s)" where <type> is a single keyword.
      // Examples:
      // - "Discard a card"
      // - "Discard a creature card"
      // - "Discard two land cards"
      // "Discard your hand" (Bomat Courier) and "Discard a card with mana value X" (Knollspine Invocation).
      const extendedDiscard = parseExtendedDiscardCost(costStr);
      const wholeHand = extendedDiscard?.kind === 'hand';
      const announcedX = typeof selectedXValue === 'number' && Number.isFinite(selectedXValue)
        ? Math.max(0, Math.floor(selectedXValue))
        : undefined;
      const discardMatch = costLower.match(/\bdiscard\s+(a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+cards?\b/i);
      const discardTypedMatch = costLower.match(
        /\bdiscard\s+(a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+(creature|artifact|enchantment|land|instant|sorcery|planeswalker|nonland|noncreature)\s+cards?\b/i
      );
      if (discardMatch || discardTypedMatch || wholeHand) {
        // CR 601.2b / 602.2b: X is announced with the activation, before any cost is paid.
        if (/\{x\}/i.test(costStr) && announcedX === undefined) {
          socket.emit('error', { code: 'X_VALUE_REQUIRED', message: `Choose a value for X before activating ${cardName}.` });
          return true;
        }
        const typedRestriction = discardTypedMatch ? String(discardTypedMatch[2] || '').trim().toLowerCase() : '';

        // If this cost also includes a sacrifice clause, we don't yet support multi-step costs.
        // "Discard a card, Sacrifice this creature": the self-sacrifice rides the discard step (CR 602.2b).
        const discardSacrificesSelf = /\bsacrifice\s+(?:~|this\b)/i.test(costStr) && (costLower.match(/\bsacrifice\b/g) || []).length === 1;
        if (costLower.includes('sacrifice') && !discardSacrificesSelf) {
          socket.emit('error', {
            code: 'UNSUPPORTED_COST',
            message: `Cannot activate ${cardName}: discard + sacrifice as an activation cost is not supported yet.`,
          });
          return true;
        }

        const raw = String((discardTypedMatch?.[1] || discardMatch?.[1]) || '').trim();
        let discardCount = wholeHand ? 0 : parseWordNumber(raw, 1);

        // Ensure the cost contains no other non-mana cost components besides the discard clause.
        const remainingNonManaCostText = stripExtendedDiscardCostClauses(costStr)
          .replace(/\{[^}]+\}/g, ' ')
          .replace(/\bpay\s+(?:a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+life\b/gi, ' ')
          .replace(
            /\bdiscard\s+(?:a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+(?:(?:creature|artifact|enchantment|land|instant|sorcery|planeswalker|nonland|noncreature)\s+)?cards?\b(?:\s+at\s+random\b)?/gi,
            ' '
          )
          .replace(/\bsacrifice\s+(?:~|this\b)[^,]*/gi, ' ')
          .replace(/[\s,]+/g, ' ')
          .trim();
        if (remainingNonManaCostText.length > 0) {
          socket.emit('error', {
            code: 'UNSUPPORTED_COST',
            message: `Cannot activate ${cardName}: discard cost with additional non-mana components is not supported yet (${remainingNonManaCostText}).`,
          });
          return true;
        }

        const zones = (game.state as any)?.zones?.[pid];
        const hand = zones?.hand;
        if (!zones || !Array.isArray(hand)) {
          socket.emit('error', { code: 'NO_HAND', message: 'No hand found for discard cost' });
          return true;
        }

        const baseEligibleHand = (() => {
          const filteredHand = pendingSpellCardIdForCostSelection
            ? (hand as any[]).filter((c: any) => String(c?.id || '') !== pendingSpellCardIdForCostSelection)
            : hand;
          if (!typedRestriction) return filteredHand;
          return (filteredHand as any[]).filter((c: any) => {
            const tl = String(c?.type_line || '').toLowerCase();
            switch (typedRestriction) {
              case 'creature':
              case 'artifact':
              case 'enchantment':
              case 'land':
              case 'instant':
              case 'sorcery':
              case 'planeswalker':
                return tl.includes(typedRestriction);
              case 'nonland':
                return !tl.includes('land');
              case 'noncreature':
                return !tl.includes('creature');
              default:
                return false;
            }
          });
        })();
        const manaValueFilter = extendedDiscard?.kind === 'manaValue'
          ? (extendedDiscard.manaValue === 'x' ? announcedX : extendedDiscard.manaValue)
          : undefined;
        const eligibleHand = typeof manaValueFilter === 'number'
          ? (baseEligibleHand as any[]).filter((c: any) => cardManaValue(c) === manaValueFilter)
          : baseEligibleHand;
        if (wholeHand) {
          // An empty hand is discarded for free; the generic self-sacrifice path pays the rest.
          if ((eligibleHand as any[]).length === 0) return false;
          discardCount = (eligibleHand as any[]).length;
        }

        if (eligibleHand.length < discardCount) {
          socket.emit('error', {
            code: 'INSUFFICIENT_CARDS',
            message: typedRestriction
              ? `Need to discard ${discardCount} ${typedRestriction} card(s), but you only have ${eligibleHand.length}.`
              : typeof manaValueFilter === 'number'
              ? `Need to discard ${discardCount} card(s) with mana value ${manaValueFilter}, but you only have ${eligibleHand.length}.`
              : `Need to discard ${discardCount} card(s), but you only have ${eligibleHand.length}.`,
          });
          return true;
        }

        // "Discard a card at random" (Pyromania): the random cards are the only choice offered.
        const offeredHand = isRandomDiscardCost(costStr) ? pickRandomCostDiscards(game, eligibleHand as any[], discardCount) : eligibleHand;
        const existing = ResolutionQueueManager
          .getStepsForPlayer(gameId, pid as any)
          .find((s: any) => s?.type === ResolutionStepType.DISCARD_SELECTION && (s as any)?.discardAbilityAsCost === true && String((s as any)?.permanentId || s?.sourceId) === String(permanentId));

        if (!existing) {
          const activatedAbilityText = buildActivatedAbilityOracleTextForStack({
            selectedAbilityFullText,
            selectedAbilityOracleLine,
            abilityConditionText,
            manaCost,
            abilityText,
          });
          ResolutionQueueManager.addStep(gameId, {
            type: ResolutionStepType.DISCARD_SELECTION,
            playerId: pid as PlayerID,
            sourceId: permanentId,
            sourceName: cardName,
            description: `${cardName}: Discard ${discardCount} card${discardCount === 1 ? '' : 's'} to activate: ${abilityText}`,
            mandatory: false,
            hand: offeredHand,
            discardCount,
            currentHandSize: offeredHand.length,
            maxHandSize: Math.max(7, eligibleHand.length),
            reason: 'activation_cost',

            // Custom payload consumed by resolution.ts
            discardAbilityAsCost: true,
            permanentId,
            abilityId,
            cardName,
            abilityText,
            manaCost,
            requiresTap,
            activatedAbilityText,
            discardTypeRestriction: typedRestriction || undefined,
            lifeToPayForCost,
            deferredSelfSourceCost: discardSacrificesSelf ? 'sacrifice' : undefined,
            ...(announcedX !== undefined ? { xValue: announcedX } : null),
          } as any);
        }

        debug(2, `[activateBattlefieldAbility] ${cardName} requires discarding ${discardCount} card(s) as a cost. Queued DISCARD_SELECTION.`);
        broadcastGame(io, game, gameId);
        return true;
      }
    }
  }

  return false;
}
