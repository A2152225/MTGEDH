/**
 * Origin parent: server/src/socket/interaction.ts
 *
 * Cluster moved: activateBattlefieldAbility pay-life, exile-from-graveyard,
 * and remove-counters activation-cost families.
 *
 * Public entry symbols: tryHandleActivatePayLifeExileCounters.
 */

import type { PlayerID } from "../../../../shared/src/index.js";
import type { GameContext } from "../../state/context.js";
import { canPlayerPayLife } from "../../state/modules/game-state-effects-handlers/gameStateEffectsLifeModifierOraclePatterns.js";
import { parseWordNumber } from "../../state/utils";
import { ResolutionQueueManager, ResolutionStepType } from "../../state/resolution/index.js";
import { debug } from "../../utils/debug.js";
import { broadcastGame } from "../util";
import type { ActivateBattlefieldAbilityContext } from "./interactionActivateBattlefieldAbilityContext.js";

export type ActivateCostMutationState = {
  manaCost: string | undefined;
  pendingLifePaymentForCost: number;
  pendingCounterRemovals: Array<{ counterType: string; count: number }>;
};

export async function tryHandleActivatePayLifeExileCounters(
  ctx: ActivateBattlefieldAbilityContext,
  costState: ActivateCostMutationState,
  abilityText: string,
  requiresTap: boolean,
  abilityConditionText: string,
): Promise<boolean> {
  const {
    io,
    socket,
    game,
    gameId,
    pid,
    permanentId,
    abilityId,
    battlefield,
    permanent,
    card,
    cardName,
  } = ctx;

  let manaCost = costState.manaCost;
  let pendingLifePaymentForCost = costState.pendingLifePaymentForCost;
  const pendingCounterRemovals = costState.pendingCounterRemovals;

  // ========================================================================
  // PAY LIFE AS AN ACTIVATION COST (generic)
  // Examples:
  // - "Pay 2 life: Draw a card."
  // - "{T}, Pay 1 life: Add {C}."
  // Conservative: only support costs that are (mana symbols and/or {T}/{Q}) plus exactly one
  // "Pay N life" clause. No mixing with discard/sacrifice/remove-counters/tap-other/etc.
  // ========================================================================
  {
    const costStr = String(manaCost || '');
    const costLower = costStr.toLowerCase();

    if (costLower.includes('pay') && costLower.includes('life')) {
      const payLifeMatch = costStr.match(
        /\bpay\s+(a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+life\b/i
      );

      if (payLifeMatch) {
        // Reject choice-based or mixed costs for now.
        if (/\bor\b/i.test(costStr)) {
          socket.emit('error', {
            code: 'UNSUPPORTED_COST',
            message: `Cannot activate ${cardName}: "pay life" costs with choices ("or") are not supported yet.`,
          });
          return true;
        }

        // Ensure there are no other non-mana cost components besides the pay-life clause.
        // (We allow mana symbols inside braces and {T}/{Q}.)
        const remainingNonManaCostText = costStr
          .replace(/\{[^}]+\}/g, ' ')
          .replace(/\bexert\s+(?:this creature|~)\b/gi, ' ')
          .replace(
            /\bpay\s+(?:a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+life\b/gi,
            ' '
          )
          .replace(/[\s,]+/g, ' ')
          .trim();

        let deferToSpecializedHandler = false;

        if (remainingNonManaCostText.length > 0) {
          // Mixed costs: allow other dedicated handlers to process supported combinations
          // like discard/exile-from-hand/tap-other + pay life, deferring life payment
          // until the relevant Resolution Queue step resolves.
          const remainingLower = remainingNonManaCostText.toLowerCase();
          const looksLikeSupportedTapOther = /\btap\s+(?:another\s+|other\s+)?(?:a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+untapped\b/i.test(remainingLower) && /\byou\s+control\b/i.test(remainingLower);
          const looksLikeSupportedDiscard = /\bdiscard\b/i.test(remainingLower);
          const looksLikeSupportedExileFromHand = /\bexile\b/i.test(remainingLower) && /\bfrom\s+your\s+hand\b/i.test(remainingLower);
          const looksLikeSupportedExileFromGraveyard = /\bexile\b/i.test(remainingLower) && /\bfrom\s+your\s+graveyard\b/i.test(remainingLower);
          const looksLikeSupportedReturnToHand = /\breturn\b/i.test(remainingLower) && /\byou\s+control\b/i.test(remainingLower) && /\bowner(?:'|’)s\s+hand\b/i.test(remainingLower);
          const looksLikeSupportedSacrificeSelf = /\bsacrifice\s+(?:~|this)\b/i.test(remainingLower);

          if (looksLikeSupportedTapOther || looksLikeSupportedDiscard || looksLikeSupportedExileFromHand || looksLikeSupportedExileFromGraveyard || looksLikeSupportedReturnToHand || looksLikeSupportedSacrificeSelf) {
            // Defer entirely to the specialized cost handler.
            // IMPORTANT: do not pre-strip the pay-life clause from manaCost here;
            // the specialized handler needs to parse and carry it into the Resolution step.
            deferToSpecializedHandler = true;
          } else {
            socket.emit('error', {
              code: 'UNSUPPORTED_COST',
              message: `Cannot activate ${cardName}: pay-life cost with additional non-mana components is not supported yet (${remainingNonManaCostText}).`,
            });
            return true;
          }
        }

        if (!deferToSpecializedHandler) {
          const raw = String(payLifeMatch[1] || '').trim();
          const lifeToPay = parseWordNumber(raw, 1);
          if (!Number.isFinite(lifeToPay) || lifeToPay <= 0) {
            socket.emit('error', {
              code: 'UNSUPPORTED_COST',
              message: `Cannot activate ${cardName}: invalid life payment amount.`,
            });
            return true;
          }

          const currentLife = Number((game.state as any)?.life?.[pid] ?? 40);
          if (!canPlayerPayLife(game as GameContext, String(pid))) {
            socket.emit('error', {
              code: 'CANNOT_PAY_COST',
              message: `Cannot activate ${cardName}: players can't pay life.`,
            });
            return true;
          }
          if (!Number.isFinite(currentLife) || currentLife < lifeToPay) {
            socket.emit('error', {
              code: 'INSUFFICIENT_LIFE',
              message: `Cannot activate ${cardName}: need to pay ${lifeToPay} life, but you only have ${Number.isFinite(currentLife) ? currentLife : 0}.`,
            });
            return true;
          }

          pendingLifePaymentForCost = lifeToPay;

          // Strip this clause from manaCost so later mana-payment logic doesn't see non-mana text.
          try {
            manaCost = String(manaCost || '')
              .replace(
                /\bpay\s+(?:a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+life\b/gi,
                ' '
              )
              .replace(/^[\s,]+|[\s,]+$/g, '')
              .replace(/[\s,]+/g, ' ')
              .trim();
          } catch {
            // best-effort only
          }
        }
      }
    }
  }

  // ========================================================================
  // EXILE FROM YOUR GRAVEYARD AS AN ACTIVATION COST
  // Examples:
  // - "Exile a card from your graveyard: Draw a card."
  // - "Exile a creature card from your graveyard: ..."
  // - "{1}, Exile two cards from your graveyard: ..."
  // Conservative: only support costs that are (mana symbols and/or {T}/{Q}) plus exactly one
  // "Exile N (optional <type>) card(s) from your graveyard" clause.
  // ========================================================================
  {
    const costStr = String(manaCost || '');
    const costLower = costStr.toLowerCase();

    if (costLower.includes('exile') && costLower.includes('from your graveyard')) {
      const exileMatch = costStr.match(
        /\bexile\s+(a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+cards?\s+from\s+your\s+graveyard\b/i
      );
      const exileTypedMatch = costStr.match(
        /\bexile\s+(a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+(creature|artifact|enchantment|land|instant|sorcery|planeswalker|legendary|nonland|noncreature)\s+cards?\s+from\s+your\s+graveyard\b/i
      );

      if (exileMatch || exileTypedMatch) {
        const typedRestriction = exileTypedMatch ? String(exileTypedMatch[2] || '').trim().toLowerCase() : '';

        // Optional supported additional clause: "Pay N life" (non-interactive).
        // IMPORTANT: do not actually pay life until the graveyard selection step resolves;
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
            if (!canPlayerPayLife(game as GameContext, String(pid))) {
              socket.emit('error', {
                code: 'CANNOT_PAY_COST',
                message: `Cannot activate ${cardName}: players can't pay life.`,
              });
              return true;
            }
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
        // Reject choice-based or mixed costs for now.
        if (/\bor\b/i.test(costStr)) {
          socket.emit('error', {
            code: 'UNSUPPORTED_COST',
            message: `Cannot activate ${cardName}: exile-from-graveyard costs with choices ("or") are not supported yet.`,
          });
          return true;
        }

        // Ensure there are no other non-mana cost components besides the exile clause.
        const remainingNonManaCostText = costStr
          .replace(/\{[^}]+\}/g, ' ')
          .replace(/\bpay\s+(?:a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+life\b/gi, ' ')
          .replace(
            /\bexile\s+(?:a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+(?:(?:creature|artifact|enchantment|land|instant|sorcery|planeswalker|legendary|nonland|noncreature)\s+)?cards?\s+from\s+your\s+graveyard\b/gi,
            ' '
          )
          .replace(/[\s,]+/g, ' ')
          .trim();

        if (remainingNonManaCostText.length > 0) {
          socket.emit('error', {
            code: 'UNSUPPORTED_COST',
            message: `Cannot activate ${cardName}: exile-from-graveyard cost with additional non-mana components is not supported yet (${remainingNonManaCostText}).`,
          });
          return true;
        }

        const raw = String((exileTypedMatch?.[1] || exileMatch?.[1]) || '').trim();
        const exileCount = parseWordNumber(raw, 1);
        if (!Number.isFinite(exileCount) || exileCount <= 0) {
          socket.emit('error', {
            code: 'UNSUPPORTED_COST',
            message: `Cannot activate ${cardName}: invalid exile count.`,
          });
          return true;
        }

        const zones = (game.state as any)?.zones?.[pid];
        const graveyard = zones?.graveyard;
        if (!zones || !Array.isArray(graveyard)) {
          socket.emit('error', { code: 'NO_GRAVEYARD', message: 'No graveyard found for exile cost' });
          return true;
        }

        const eligibleGraveyard = (() => {
          if (!typedRestriction) return graveyard;
          return (graveyard as any[]).filter((c: any) => {
            const tl = String(c?.type_line || '').toLowerCase();
            switch (typedRestriction) {
              case 'creature':
              case 'artifact':
              case 'enchantment':
              case 'land':
              case 'instant':
              case 'sorcery':
              case 'planeswalker':
              case 'legendary':
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

        if (eligibleGraveyard.length < exileCount) {
          socket.emit('error', {
            code: 'INSUFFICIENT_CARDS',
            message: typedRestriction
              ? `Need to exile ${exileCount} ${typedRestriction} card(s) from your graveyard, but you only have ${eligibleGraveyard.length}.`
              : `Need to exile ${exileCount} card(s) from your graveyard, but you only have ${graveyard.length}.`,
          });
          return true;
        }

        const validTargets = (eligibleGraveyard as any[]).map((c: any) => ({
          id: String(c?.id || ''),
          name: String(c?.name || 'Unknown'),
          typeLine: String(c?.type_line || ''),
          manaCost: String(c?.mana_cost || ''),
          imageUrl: (c as any)?.image_uris?.small || (c as any)?.image_uris?.normal,
        })).filter((t: any) => Boolean(t.id));

        if (validTargets.length < exileCount) {
          socket.emit('error', {
            code: 'INSUFFICIENT_CARDS',
            message: `Need to exile ${exileCount} card(s) from your graveyard, but there are only ${validTargets.length} selectable card(s).`,
          });
          return true;
        }

        const existing = ResolutionQueueManager
          .getStepsForPlayer(gameId, pid as any)
          .find(
            (s: any) =>
              s?.type === ResolutionStepType.GRAVEYARD_SELECTION &&
              (s as any)?.graveyardExileAbilityAsCost === true &&
              String((s as any)?.permanentId || s?.sourceId) === String(permanentId)
          );

        if (!existing) {
          const effectId = `gy_exile_cost_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
          const activatedAbilityText = String(abilityConditionText || '').trim() || `${costStr}: ${abilityText}`;

          const typePhrase = typedRestriction ? `${typedRestriction} ` : '';
          ResolutionQueueManager.addStep(gameId, {
            type: ResolutionStepType.GRAVEYARD_SELECTION,
            playerId: pid as PlayerID,
            sourceId: permanentId,
            sourceName: cardName,
            sourceImage: card?.image_uris?.small || card?.image_uris?.normal,
            description: `${cardName}: Exile ${exileCount} ${typePhrase}card${exileCount === 1 ? '' : 's'} from your graveyard to activate: ${abilityText}`,
            mandatory: false,

            // Required GraveyardSelectionStep fields
            effectId,
            cardName,
            title: `${cardName} — Exile from graveyard` ,
            targetPlayerId: String(pid),
            minTargets: exileCount,
            maxTargets: exileCount,
            destination: 'exile',
            validTargets,
            imageUrl: card?.image_uris?.small || card?.image_uris?.normal,

            // Custom payload consumed by socket/resolution.ts
            graveyardExileAbilityAsCost: true,
            permanentId,
            abilityId,
            abilityText,
            manaCost: costStr,
            requiresTap,
            activatedAbilityText,
            exileCount,
            lifeToPayForCost,
          } as any);
        }

        debug(2, `[activateBattlefieldAbility] ${cardName} requires exiling ${exileCount} card(s) from graveyard as a cost. Queued GRAVEYARD_SELECTION.`);
        broadcastGame(io, game, gameId);
        return true;
      }
    }
  }

  // ========================================================================
  // REMOVE COUNTERS AS AN ACTIVATION COST (source permanent only)
  // Examples:
  // - "Remove a +1/+1 counter from ~: ..."
  // - "Remove two charge counters from ~: ..."
  // Conservative: only support costs that are (mana symbols and/or {T}/{Q}) plus exactly one
  // "Remove N <counterType> counter(s) from <this>" clause.
  // ========================================================================
  {
    const costStr = String(manaCost || '');
    const costLower = costStr.toLowerCase();

    // Avoid interfering with special-case storage-counter lands handled earlier.
    if (costLower.includes('storage counter')) {
      // no-op
    } else if (costLower.includes('remove') && costLower.includes('counter')) {
      const removeMatch = costStr.match(
        /\bremove\s+(a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+([^,]+?)\s+counters?(?:\s+from\s+([^,]+))?\b/i
      );

      if (removeMatch) {
        const rawCount = String(removeMatch[1] || '').trim();
        const rawTypePhrase = String(removeMatch[2] || '').trim();
        const rawSourceRef = String(removeMatch[3] || '').trim();

        const removeCount = parseWordNumber(rawCount, 1);
        if (removeCount <= 0) {
          socket.emit('error', {
            code: 'UNSUPPORTED_COST',
            message: `Cannot activate ${cardName}: invalid counter removal count.`,
          });
          return true;
        }

        // Missing "from ..." means remove from the source permanent (Pentad Prism, Sphere of the Suns, etc.).
        const srcRefLower = rawSourceRef.toLowerCase();
        const nameLower = String(cardName || '').toLowerCase();
        const refersToSource =
          !srcRefLower ||
          (nameLower && srcRefLower.includes(nameLower)) ||
          /\b(this|this permanent|this artifact|this creature|this land|this enchantment|it|source)\b/i.test(srcRefLower);
        if (!refersToSource) {
          // Support "Remove N <counter> counters from (another/other)? (permanent type) you control".
          if (!/\byou control\b/i.test(srcRefLower)) {
            socket.emit('error', {
              code: 'UNSUPPORTED_COST',
              message: `Cannot activate ${cardName}: removing counters from another permanent as an activation cost is not supported yet.`,
            });
            return true;
          }

          const mustBeOther = /\b(another|other)\b/i.test(srcRefLower);
          const typeMatch = srcRefLower.match(/\b(creature|artifact|enchantment|land|permanent)\b/i);
          const removeFromType = String(typeMatch?.[1] || 'permanent').toLowerCase();

          // Normalize counter type.
          let counterType = rawTypePhrase;
          counterType = counterType.replace(/^\s*(?:a|an)\s+/i, '').trim();
          if (/\+\s*1\s*\/\s*\+\s*1/i.test(counterType)) counterType = '+1/+1';
          else if (/-\s*1\s*\/\s*-\s*1/i.test(counterType)) counterType = '-1/-1';
          else if (/^\d+\s*\/\s*\d+$/i.test(counterType)) {
            socket.emit('error', {
              code: 'UNSUPPORTED_COST',
              message: `Cannot activate ${cardName}: unsupported counter type (${counterType}).`,
            });
            return true;
          } else {
            const first = counterType.split(/\s+/)[0];
            counterType = String(first || '').toLowerCase();
          }
          if (!counterType) {
            socket.emit('error', {
              code: 'UNSUPPORTED_COST',
              message: `Cannot activate ${cardName}: could not parse counter type.`,
            });
            return true;
          }

          // Ensure no other non-mana cost components besides this remove-counters clause.
          const remainingNonManaCostText = costStr
            .replace(/\{[^}]+\}/g, ' ')
            .replace(/\bremove\s+(?:a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+[^,]+?\s+counters?(?:\s+from\s+[^,]+)?\b/gi, ' ')
            .replace(/[\s,]+/g, ' ')
            .trim();
          if (remainingNonManaCostText.length > 0) {
            socket.emit('error', {
              code: 'UNSUPPORTED_COST',
              message: `Cannot activate ${cardName}: remove-counter cost with additional non-mana components is not supported yet (${remainingNonManaCostText}).`,
            });
            return true;
          }

          const battlefield = (game.state?.battlefield || []) as any[];
          const matchesType = (perm: any): boolean => {
            if (!perm) return false;
            if (String(perm.controller || '') !== String(pid)) return false;
            if (mustBeOther && String(perm.id) === String(permanentId)) return false;
            const tl = String(perm.card?.type_line || '').toLowerCase();
            if (removeFromType === 'permanent') return true;
            return tl.includes(removeFromType);
          };

          const counterKeyCandidates = (() => {
            const ct = String(counterType);
            if (ct === '+1/+1') return ['+1/+1', 'p1p1', 'plus_one', 'plusone', 'plus1plus1', '+1+1'];
            if (ct === '-1/-1') return ['-1/-1', 'm1m1', 'minus_one', 'minusone', 'minus1minus1', '-1-1'];
            return [ct];
          })();

          const eligiblePermanents = battlefield.filter((p: any) => {
            if (!matchesType(p)) return false;
            const counters = (p as any).counters || {};
            const has = counterKeyCandidates.some((k) => Number(counters?.[k] || 0) >= removeCount);
            return has;
          });

          if (eligiblePermanents.length < 1) {
            socket.emit('error', {
              code: 'INSUFFICIENT_COUNTERS',
              message: `You don't control an eligible ${removeFromType} with at least ${removeCount} ${counterType} counter(s).`,
            });
            return true;
          }

          const validTargets = eligiblePermanents.map((p: any) => ({
            id: p.id,
            label: p.card?.name || 'Unknown',
            description: p.card?.type_line || 'Permanent',
            imageUrl: p.card?.image_uris?.small || p.card?.image_uris?.normal,
          }));

          const existing = ResolutionQueueManager
            .getStepsForPlayer(gameId, pid as any)
            .find(
              (s: any) =>
                s?.type === ResolutionStepType.TARGET_SELECTION &&
                (s as any)?.removeCountersAbilityAsCost === true &&
                String((s as any)?.permanentId || s?.sourceId) === String(permanentId)
            );

          if (!existing) {
            const activatedAbilityText = String(abilityConditionText || '').trim() || `${costStr}: ${abilityText}`;
            ResolutionQueueManager.addStep(gameId, {
              type: ResolutionStepType.TARGET_SELECTION,
              playerId: pid as PlayerID,
              sourceId: permanentId,
              sourceName: cardName,
              sourceImage: card?.image_uris?.small || card?.image_uris?.normal,
              description: `${cardName}: Remove ${removeCount} ${counterType} counter${removeCount === 1 ? '' : 's'} from a ${mustBeOther ? 'different ' : ''}${removeFromType} you control to activate: ${abilityText}`,
              mandatory: false,
              validTargets,
              targetTypes: ['remove_counter_cost'],
              minTargets: 1,
              maxTargets: 1,
              targetDescription: `${removeFromType} you control`,

              // Custom payload consumed by socket/resolution.ts
              removeCountersAbilityAsCost: true,
              permanentId,
              abilityId,
              cardName,
              abilityText,
              manaCost: costStr,
              requiresTap,
              activatedAbilityText,
              removeCount,
              counterType,
              counterKeyCandidates,
              removeFromType,
              mustBeOther,
            } as any);
          }

          debug(2, `[activateBattlefieldAbility] ${cardName} requires removing ${removeCount} ${counterType} counter(s) from a ${removeFromType} you control as a cost. Queued TARGET_SELECTION.`);
          broadcastGame(io, game, gameId);
          return true;
        }

        // Normalize counter type.
        let counterType = rawTypePhrase;
        // Strip leading articles/words like "a" (if they made it into the type phrase).
        counterType = counterType.replace(/^\s*(?:a|an)\s+/i, '').trim();
        // Common explicit counter keys
        if (/\+\s*1\s*\/\s*\+\s*1/i.test(counterType)) counterType = '+1/+1';
        else if (/-\s*1\s*\/\s*-\s*1/i.test(counterType)) counterType = '-1/-1';
        else if (/^\d+\s*\/\s*\d+$/i.test(counterType)) {
          // "1/1" style should be treated as "+1/+1" or "-1/-1" only; reject.
          socket.emit('error', {
            code: 'UNSUPPORTED_COST',
            message: `Cannot activate ${cardName}: unsupported counter type (${counterType}).`,
          });
          return true;
        }
        else {
          // Use first word for named counters (charge, loyalty, time, etc.).
          const first = counterType.split(/\s+/)[0];
          counterType = String(first || '').toLowerCase();
        }

        if (!counterType) {
          socket.emit('error', {
            code: 'UNSUPPORTED_COST',
            message: `Cannot activate ${cardName}: could not parse counter type.`,
          });
          return true;
        }

        // Ensure no other non-mana cost components besides this remove-counters clause.
        const remainingNonManaCostText = costStr
          .replace(/\{[^}]+\}/g, ' ')
          .replace(/\bremove\s+(?:a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+[^,]+?\s+counters?(?:\s+from\s+[^,]+)?\b/gi, ' ')
          .replace(/[\s,]+/g, ' ')
          .trim();
        if (remainingNonManaCostText.length > 0) {
          socket.emit('error', {
            code: 'UNSUPPORTED_COST',
            message: `Cannot activate ${cardName}: remove-counter cost with additional non-mana components is not supported yet (${remainingNonManaCostText}).`,
          });
          return true;
        }

        // Verify the source permanent still has enough counters.
        const currentCounters = (permanent as any).counters || {};
        const counterKeyCandidates = (() => {
          const ct = String(counterType);
          if (ct === '+1/+1') return ['+1/+1', 'p1p1', 'plus_one', 'plusone', 'plus1plus1', '+1+1'];
          if (ct === '-1/-1') return ['-1/-1', 'm1m1', 'minus_one', 'minusone', 'minus1minus1', '-1-1'];
          return [ct];
        })();
        const actualKey = counterKeyCandidates.find((k) => Number(currentCounters?.[k] || 0) >= removeCount);
        const currentN = actualKey ? Number(currentCounters?.[actualKey] || 0) : 0;
        if (!actualKey || currentN < removeCount) {
          socket.emit('error', {
            code: 'INSUFFICIENT_COUNTERS',
            message: `${cardName} doesn't have enough ${counterType} counter(s). (Need ${removeCount}, have ${currentN})`,
          });
          return true;
        }

        pendingCounterRemovals.push({ counterType: actualKey, count: removeCount });

        // Strip this clause from manaCost so later mana-payment logic doesn't see non-mana text.
        // Keep any remaining mana symbols / tap symbols intact.
        try {
          manaCost = String(manaCost || '')
            .replace(
              /\bremove\s+(?:a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+[^,]+?\s+counters?(?:\s+from\s+[^,]+)?\b/gi,
              ' '
            )
            .replace(/^[\s,]+|[\s,]+$/g, '')
            .replace(/[\s,]+/g, ' ')
            .trim();
        } catch {
          // best-effort only
        }
      }
    }
  }


  costState.manaCost = manaCost;
  costState.pendingLifePaymentForCost = pendingLifePaymentForCost;
  return false;
}
