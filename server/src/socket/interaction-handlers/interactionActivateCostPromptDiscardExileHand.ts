/**
 * Origin parent: server/src/socket/interaction.ts
 * Cluster moved: discard / exile-from-hand activation cost prompts.
 * Public entry symbols: tryHandleActivateCostPromptDiscardExileHand.
 */

import type { PlayerID } from "../../../../shared/src/index.js";
import { isActivatedManaAbilityText, adjustActivationManaCostForPayment } from "../../state/modules/ability-cost-adjustments.js";
import { parseWordNumber } from "../../state/utils";
import { ResolutionQueueManager, ResolutionStepType } from "../../state/resolution/index.js";
import { debug } from "../../utils/debug.js";
import { creatureHasHaste } from "../game-actions.js";
import {
  broadcastGame,
  calculateManaProduction,
  calculateTotalAvailableMana,
  consumeManaFromPool,
  getOrInitManaPool,
  getPlayerName,
  parseManaCost,
  validateManaPayment,
} from "../util";
import type { ActivateBattlefieldAbilityContext } from "./interactionActivateBattlefieldAbilityContext.js";

export async function tryHandleActivateCostPromptDiscardExileHand(
  ctx: ActivateBattlefieldAbilityContext,
  manaCost: string | undefined,
  abilityText: string,
  requiresTap: boolean,
  abilityConditionText: string,
  pendingSpellCardIdForCostSelection: string,
  applyXValueToText: (text: string, xValue?: number) => string,
  buildActivatedAbilityOracleTextForStack: (params: any) => string,
  selectedAbilityFullText: string,
  selectedAbilityOracleLine: string,
  tappedPermanentsForCost: string[],
  sacrificeType: any,
  sacrificeSubtype: any,
  sacrificeCount: any,
  mustBeOther: any,
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
    cardName,
    selectedXValue,
    card,
  } = ctx;

  // ========================================================================
  // DISCARD AS AN ACTIVATION COST
  // Example: "Discard a card: Draw a card." (no other non-mana cost components supported yet)
  // ========================================================================
  // ========================================================================
  // EXILE FROM YOUR HAND AS AN ACTIVATION COST
  // Examples:
  // - "Exile a card from your hand: Draw a card."
  // - "Exile an instant card from your hand: ..."
  // - "{1}, Exile two cards from your hand: ..."
  // Conservative: only support costs that are (mana symbols and/or {T}/{Q}) plus exactly one
  // "Exile N (optional <type>) card(s) from your hand" clause. No mixing with discard/sacrifice/remove-counters/tap-other/etc.
  // ========================================================================
  {
    const costStr = String(manaCost || '');
    const costLower = costStr.toLowerCase();

    if (costLower.includes('exile') && costLower.includes('from your hand')) {
      const exileMatch = costStr.match(
        /\bexile\s+(a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+cards?\s+from\s+your\s+hand\b/i
      );
      const exileTypedMatch = costStr.match(
        /\bexile\s+(a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+(creature|artifact|enchantment|land|instant|sorcery|planeswalker|nonland|noncreature)\s+cards?\s+from\s+your\s+hand\b/i
      );

      if (exileMatch || exileTypedMatch) {
        const typedRestriction = exileTypedMatch ? String(exileTypedMatch[2] || '').trim().toLowerCase() : '';

        // Optional supported additional clause: "Pay N life" (non-interactive).
        // IMPORTANT: do not actually pay life until the discard/exile step resolves;
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

        // Reject choice-based or mixed costs for now.
        if (/\bor\b/i.test(costStr)) {
          socket.emit('error', {
            code: 'UNSUPPORTED_COST',
            message: `Cannot activate ${cardName}: exile-from-hand costs with choices ("or") are not supported yet.`,
          });
          return true;
        }

        const remainingNonManaCostText = costStr
          .replace(/\{[^}]+\}/g, ' ')
          .replace(/\bpay\s+(?:a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+life\b/gi, ' ')
          .replace(
            /\bexile\s+(?:a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+(?:(?:creature|artifact|enchantment|land|instant|sorcery|planeswalker|nonland|noncreature)\s+)?cards?\s+from\s+your\s+hand\b/gi,
            ' '
          )
          .replace(/[\s,]+/g, ' ')
          .trim();

        if (remainingNonManaCostText.length > 0) {
          socket.emit('error', {
            code: 'UNSUPPORTED_COST',
            message: `Cannot activate ${cardName}: exile-from-hand cost with additional non-mana components is not supported yet (${remainingNonManaCostText}).`,
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
        const hand = zones?.hand;
        if (!zones || !Array.isArray(hand)) {
          socket.emit('error', { code: 'NO_HAND', message: 'No hand found for exile cost' });
          return true;
        }

        const eligibleHand = (() => {
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

        if (eligibleHand.length < exileCount) {
          socket.emit('error', {
            code: 'INSUFFICIENT_CARDS',
            message: typedRestriction
              ? `Need to exile ${exileCount} ${typedRestriction} card(s) from your hand, but you only have ${eligibleHand.length}.`
              : `Need to exile ${exileCount} card(s) from your hand, but you only have ${eligibleHand.length}.`,
          });
          return true;
        }

        const existing = ResolutionQueueManager
          .getStepsForPlayer(gameId, pid as any)
          .find((s: any) => s?.type === ResolutionStepType.DISCARD_SELECTION && (s as any)?.exileFromHandAbilityAsCost === true && String((s as any)?.permanentId || s?.sourceId) === String(permanentId));

        if (!existing) {
          const activatedAbilityText = String(abilityConditionText || '').trim() || `${costStr}: ${abilityText}`;

          const typePhrase = typedRestriction ? `${typedRestriction} ` : '';
          ResolutionQueueManager.addStep(gameId, {
            type: ResolutionStepType.DISCARD_SELECTION,
            playerId: pid as PlayerID,
            sourceId: permanentId,
            sourceName: cardName,
            sourceImage: card?.image_uris?.small || card?.image_uris?.normal,
            description: `${cardName}: Exile ${exileCount} ${typePhrase}card${exileCount === 1 ? '' : 's'} from your hand to activate: ${abilityText}`,
            mandatory: false,
            hand: eligibleHand,
            discardCount: exileCount,
            currentHandSize: eligibleHand.length,
            maxHandSize: Math.max(7, eligibleHand.length),
            reason: 'activation_cost',

            // Custom extensions consumed by resolution.ts
            destination: 'exile',
            exileFromHandAbilityAsCost: true,
            permanentId,
            abilityId,
            cardName,
            abilityText,
            manaCost: costStr,
            requiresTap,
            activatedAbilityText,
            exileCount,
            lifeToPayForCost,
          } as any);
        }

        debug(2, `[activateBattlefieldAbility] ${cardName} requires exiling ${exileCount} card(s) from hand as a cost. Queued DISCARD_SELECTION (destination=exile).`);
        broadcastGame(io, game, gameId);
        return true;
      }
    }
  }

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
      const discardMatch = costLower.match(/\bdiscard\s+(a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+cards?\b/i);
      const discardTypedMatch = costLower.match(
        /\bdiscard\s+(a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+(creature|artifact|enchantment|land|instant|sorcery|planeswalker|nonland|noncreature)\s+cards?\b/i
      );
      if (discardMatch || discardTypedMatch) {
        const typedRestriction = discardTypedMatch ? String(discardTypedMatch[2] || '').trim().toLowerCase() : '';

        // If this cost also includes a sacrifice clause, we don't yet support multi-step costs.
        if (costLower.includes('sacrifice')) {
          socket.emit('error', {
            code: 'UNSUPPORTED_COST',
            message: `Cannot activate ${cardName}: discard + sacrifice as an activation cost is not supported yet.`,
          });
          return true;
        }

        const raw = String((discardTypedMatch?.[1] || discardMatch?.[1]) || '').trim();
        const discardCount = parseWordNumber(raw, 1);

        // Ensure the cost contains no other non-mana cost components besides the discard clause.
        const remainingNonManaCostText = costStr
          .replace(/\{[^}]+\}/g, ' ')
          .replace(/\bpay\s+(?:a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+life\b/gi, ' ')
          .replace(
            /\bdiscard\s+(?:a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+(?:(?:creature|artifact|enchantment|land|instant|sorcery|planeswalker|nonland|noncreature)\s+)?cards?\b/gi,
            ' '
          )
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

        const eligibleHand = (() => {
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

        if (eligibleHand.length < discardCount) {
          socket.emit('error', {
            code: 'INSUFFICIENT_CARDS',
            message: typedRestriction
              ? `Need to discard ${discardCount} ${typedRestriction} card(s), but you only have ${eligibleHand.length}.`
              : `Need to discard ${discardCount} card(s), but you only have ${eligibleHand.length}.`,
          });
          return true;
        }

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
            hand: eligibleHand,
            discardCount,
            currentHandSize: eligibleHand.length,
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
          } as any);
        }

        debug(2, `[activateBattlefieldAbility] ${cardName} requires discarding ${discardCount} card(s) as a cost. Queued DISCARD_SELECTION.`);
        broadcastGame(io, game, gameId);
        return true;
      }
    }
  }

  const resolvedAbilityText = applyXValueToText(abilityText, selectedXValue);
  const resolvedActivatedAbilityText = applyXValueToText(
    buildActivatedAbilityOracleTextForStack({
      selectedAbilityFullText,
      selectedAbilityOracleLine,
      abilityConditionText,
      manaCost,
      abilityText,
    }),
    selectedXValue,
  );

  const shouldPromptForActivationPaymentChoice = (resolvedManaCost: string): boolean => {
    const parsed = parseManaCost(String(resolvedManaCost || ''));
    const hasColoredRequirement = Object.values(parsed.colors || {}).some((amount) => Number(amount || 0) > 0);
    const genericRequirement = Number(parsed.generic || 0);

    if (!hasColoredRequirement && genericRequirement <= 0) {
      return false;
    }

    const manaPool = getOrInitManaPool(game.state, pid);
    const totalAvailable = calculateTotalAvailableMana(manaPool, undefined);
    const validationError = validateManaPayment(totalAvailable, parsed.colors, genericRequirement);
    if (validationError) {
      return true;
    }

    const nonZeroPoolKeys = ['white', 'blue', 'black', 'red', 'green', 'colorless'].filter(
      (poolKey) => Number((manaPool as any)?.[poolKey] || 0) > 0,
    );

    return nonZeroPoolKeys.length > 1;
  };

  const maybeAutoTapForSimpleNonHybridCost = (required: { colors: Record<string, number>; generic: number }): void => {
    const manaPool = getOrInitManaPool(game.state, pid);
    const requiredColors: Record<string, number> = required?.colors || {};
    const requiredGeneric = Math.max(0, Number(required?.generic || 0));

    const colorKeyBySymbol: Record<string, keyof typeof manaPool> = {
      W: 'white',
      U: 'blue',
      B: 'black',
      R: 'red',
      G: 'green',
      C: 'colorless',
    } as any;

    const poolColor = (sym: string) => {
      const k = colorKeyBySymbol[String(sym || '').toUpperCase()];
      return k ? Number((manaPool as any)[k] || 0) : 0;
    };

    // Remaining colored requirements after considering currently-floated mana.
    const remainingColors: Record<string, number> = {};
    for (const [sym, needRaw] of Object.entries(requiredColors)) {
      const need = Math.max(0, Number(needRaw || 0));
      if (need <= 0) continue;
      const have = poolColor(sym);
      const rem = Math.max(0, need - have);
      if (rem > 0) remainingColors[String(sym).toUpperCase()] = rem;
    }

    const totalPool = () =>
      (manaPool.white || 0) + (manaPool.blue || 0) + (manaPool.black || 0) +
      (manaPool.red || 0) + (manaPool.green || 0) + (manaPool.colorless || 0);

    let remainingGeneric = Math.max(0, requiredGeneric - totalPool());

    const battlefield = (game.state.battlefield || []) as any[];
    const candidates: Array<{ perm: any; prod: any; amount: number }>
      = [];

    for (const perm of battlefield) {
      if (!perm || String(perm.controller) !== String(pid)) continue;
      if ((perm as any).tapped) continue;
      const c = perm.card;
      if (!c) continue;

      const typeLine = String(c.type_line || '').toLowerCase();
      const isCreature = typeLine.includes('creature');
      const isLand = typeLine.includes('land');
      if (isCreature && !isLand && (perm as any).summoningSickness) {
        const hasHaste = creatureHasHaste(perm, battlefield, pid);
        if (!hasHaste) continue;
      }

      const oracleText = String(c.oracle_text || '').toLowerCase();
      // Only auto-tap VERY simple mana sources: "{T}: Add ..." (no extra costs like "{1}, {T}" or "{T}, Sacrifice")
      if (!/\{t\}\s*:\s*add\b/i.test(oracleText)) continue;
      if (/\{t\}\s*,/i.test(oracleText)) continue;
      if (oracleText.includes('sacrifice')) continue;
      if (oracleText.includes('pay ')) continue;

      const prod = calculateManaProduction(game.state, perm, pid);
      const amt = Number(prod?.totalAmount || prod?.baseAmount || 0);
      if (!Number.isFinite(amt) || amt <= 0) continue;

      candidates.push({ perm, prod, amount: amt });
    }

    const normalizeProducedColors = (prodColors: string[]): string[] => {
      if (!Array.isArray(prodColors)) return [];
      const normalized: string[] = [];
      for (const color of prodColors) {
        const sym = String(color || '').toUpperCase();
        if (!sym) continue;
        if (!normalized.includes(sym)) normalized.push(sym);
      }
      return normalized;
    };

    const chooseColorForProd = (prodColors: string[]): string => {
      const colors = normalizeProducedColors(prodColors);
      // Prioritize a missing required color.
      for (const sym of Object.keys(remainingColors)) {
        if ((remainingColors[sym] || 0) > 0 && (colors.includes(sym) || colors.includes('ANY'))) return sym;
      }
      // Otherwise prefer colorless, then the first fixed color.
      if (colors.includes('C')) return 'C';
      const firstFixedColor = colors.find((sym) => sym !== 'ANY');
      if (firstFixedColor) return firstFixedColor;
      return 'W';
    };

    const tapAndAdd = (perm: any, prod: any, chosenSym: string, amount: number): Record<string, number> => {
      (perm as any).tapped = true;
      tappedPermanentsForCost.push(String((perm as any).id));

      const totalAmount = Math.max(1, Number(amount || 0));
      const producedColors = normalizeProducedColors(prod?.colors || []);
      const addsAllColorsAtOnce = prod?.requiresColorChoice !== true && producedColors.length > 1 && !producedColors.includes('ANY');
      const addedManaBySymbol: Record<string, number> = {};

      if (addsAllColorsAtOnce) {
        const amountPerColor = Math.max(1, Math.floor(totalAmount / producedColors.length));
        for (const sym of producedColors) {
          const key = colorKeyBySymbol[sym] || 'colorless';
          (manaPool as any)[key] = Number((manaPool as any)[key] || 0) + amountPerColor;
          addedManaBySymbol[sym] = Number(addedManaBySymbol[sym] || 0) + amountPerColor;
        }
        return addedManaBySymbol;
      }

      const sym = String(chosenSym || '').toUpperCase();
      const resolvedSym = sym === 'ANY' ? chooseColorForProd(producedColors) : sym;
      const key = colorKeyBySymbol[resolvedSym] || 'colorless';
      (manaPool as any)[key] = Number((manaPool as any)[key] || 0) + totalAmount;
      addedManaBySymbol[resolvedSym] = Number(addedManaBySymbol[resolvedSym] || 0) + totalAmount;
      return addedManaBySymbol;
    };

    // 1) Cover colored requirements first.
    while (Object.values(remainingColors).some((n: any) => Number(n || 0) > 0)) {
      let bestIdx = -1;
      let bestScore = -1;
      let bestColor = 'C';

      for (let i = 0; i < candidates.length; i++) {
        const cand = candidates[i];
        const colors = Array.isArray(cand.prod?.colors) ? cand.prod.colors.map((x: any) => String(x).toUpperCase()) : [];
        const color = chooseColorForProd(colors);
        if (!remainingColors[color]) continue;

        // Prefer sources that produce exactly 1 (avoid leftover) and match required color.
        const amount = Number(cand.amount || 0);
        const score = (amount === 1 ? 1000 : 0) + Math.min(10, amount);
        if (score > bestScore) {
          bestScore = score;
          bestIdx = i;
          bestColor = color;
        }
      }

      if (bestIdx === -1) break;
      const chosen = candidates.splice(bestIdx, 1)[0];
      try {
        const amount = Number(chosen.amount || 1);
        const addedManaBySymbol = tapAndAdd(chosen.perm, chosen.prod, bestColor, amount);
        for (const [sym, addedAmountRaw] of Object.entries(addedManaBySymbol)) {
          const addedAmount = Math.max(0, Number(addedAmountRaw || 0));
          if (!remainingColors[sym]) continue;
          remainingColors[sym] = Math.max(0, (remainingColors[sym] || 0) - addedAmount);
        }
      } catch {
        // best-effort only
      }
    }

    // 2) Cover generic requirement with remaining sources (prefer 1-mana producers to avoid leftover).
    remainingGeneric = Math.max(0, requiredGeneric - totalPool());
    candidates.sort((a, b) => {
      const aAmt = Number(a.amount || 0);
      const bAmt = Number(b.amount || 0);
      const aPref = aAmt === 1 ? 0 : 1;
      const bPref = bAmt === 1 ? 0 : 1;
      if (aPref !== bPref) return aPref - bPref;
      return aAmt - bAmt;
    });

    for (const cand of candidates) {
      if (remainingGeneric <= 0) break;
      try {
        const colors = Array.isArray(cand.prod?.colors) ? cand.prod.colors.map((x: any) => String(x).toUpperCase()) : [];
        const chosenColor = chooseColorForProd(colors);
        const addedManaBySymbol = tapAndAdd(cand.perm, cand.prod, chosenColor, Number(cand.amount || 1));
        const totalAdded = Object.values(addedManaBySymbol)
          .reduce((sum, value) => sum + Math.max(0, Number(value || 0)), 0);
        remainingGeneric -= Math.max(1, totalAdded);
      } catch {
        // best-effort only
      }
    }
  };

  const activationCostForX = String(
    manaCost
    || selectedAbilityFullText.split(':')[0]
    || selectedAbilityOracleLine.split(':')[0]
    || '',
  ).trim();
  const xSymbolsRequired = (activationCostForX.match(/\{X\}/gi) || []).length;
  if (xSymbolsRequired > 0 && selectedXValue === undefined) {
    socket.emit('error', {
      code: 'X_VALUE_REQUIRED',
      message: `Choose a value for X before activating ${cardName}.`,
    });
    return true;
  }

  // Parse and validate mana cost if present
  // Extract just the mana symbols from the cost string (excluding {T}, sacrifice, etc.)
  if (manaCost) {
    // Match all mana symbols including Phyrexian {W/P}, hybrid {W/U}, etc.
    const manaSymbols = manaCost.match(/\{[WUBRGC0-9X\/P]+\}/gi);
    if (manaSymbols) {
      // Filter out {T} and {Q} to get just the mana cost
      const manaOnly = manaSymbols.filter(s => 
        s.toUpperCase() !== '{T}' && s.toUpperCase() !== '{Q}'
      ).join('');
      
      if (manaOnly) {
        const xSymbolCount = (manaOnly.match(/\{X\}/gi) || []).length;
        if (xSymbolCount > 0 && selectedXValue === undefined) {
          socket.emit('error', {
            code: 'X_VALUE_REQUIRED',
            message: `Choose a value for X before activating ${cardName}.`,
          });
          return true;
        }

        const resolvedManaOnly = xSymbolCount > 0
          ? applyXValueToText(manaOnly, selectedXValue)
          : manaOnly;

        const wouldBeManaAbility = isActivatedManaAbilityText(abilityText);
        const costAdjustment = adjustActivationManaCostForPayment({
          state: game.state,
          activatorId: String(pid),
          sourceCard: permanent.card,
          sourceZone: 'battlefield',
          sourceController: String(permanent.controller || pid),
          sourcePermanent: permanent,
          sourceId: String(permanentId),
          isManaAbility: wouldBeManaAbility,
          manaCostString: resolvedManaOnly,
          sourceName: cardName,
        });
        const effectiveManaOnly = costAdjustment.adjustedManaCost || resolvedManaOnly;

        const parsedCost = parseManaCost(effectiveManaOnly);
        const manaPool = getOrInitManaPool(game.state, pid);
        
        // For Phyrexian mana costs, we need to check if player can pay with mana OR life
        const playerLife = game.state.life?.[pid] || 40;
        
        // Adapt parsedCost for canPayManaCost (uses 'hybrid' instead of 'hybrids')
        const costForCheck = {
          colors: parsedCost.colors,
          generic: parsedCost.generic,
          hasX: parsedCost.hasX,
          hybrid: parsedCost.hybrids, // Map hybrids to hybrid for compatibility
        };
        
        // Check if we can pay the cost, including mana that could be produced by untapped sources.
        // (Activated abilities allow activating mana abilities during cost payment.)
        // Check if there are Phyrexian mana costs that require a player choice
        // Phyrexian mana can ALWAYS be paid with life (2 life per {X/P}), even if the player has the color
        const phyrexianCosts = (parsedCost.hybrids || []).filter((options: string[]) => 
          options.some(o => o.startsWith('LIFE:'))
        );
        
        if (phyrexianCosts.length > 0) {
          const pendingPhyrexianId = `phyrexian_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
          const activatedAbilityText = (() => {
            const scopedAbilityText = String(abilityConditionText || '').trim();
            if (scopedAbilityText.includes(':')) return scopedAbilityText;
            return manaOnly ? `${manaOnly}: ${abilityText}` : (scopedAbilityText || abilityText);
          })();
          
          // Build the choice options for each Phyrexian mana symbol
          const phyrexianChoices = phyrexianCosts.map((options: string[], index: number) => {
            const colorOption = options.find((o: string) => !o.startsWith('LIFE:') && !o.startsWith('GENERIC:'));
            const lifeOption = options.find((o: string) => o.startsWith('LIFE:'));
            const lifeAmount = lifeOption ? parseInt(lifeOption.split(':')[1], 10) : 2;
            
            const colorMap: Record<string, string> = {
              'W': 'white', 'U': 'blue', 'B': 'black', 'R': 'red', 'G': 'green'
            };
            const colorName = colorOption ? colorMap[colorOption] || colorOption : 'colored';
            const hasColorMana = colorOption ? (manaPool[colorName] || 0) >= 1 : false;
            
            return {
              index,
              colorOption,
              colorName,
              lifeAmount,
              hasColorMana,
              symbol: colorOption ? `{${colorOption}/P}` : '{P}',
            };
          });
          
          // Resolution Queue: prompt player to choose how to pay the Phyrexian symbols
          ResolutionQueueManager.addStep(gameId, {
            type: ResolutionStepType.MANA_PAYMENT_CHOICE,
            playerId: pid as PlayerID,
            sourceId: permanentId,
            sourceName: cardName,
            sourceImage: (permanent.card as any)?.image_uris?.small || (permanent.card as any)?.image_uris?.normal,
            description: `Choose how to pay Phyrexian mana for ${cardName}.`,
            mandatory: true,
            phyrexianManaChoice: true,
            pendingId: pendingPhyrexianId,
            permanentId,
            abilityId,
            cardName,
            abilityText,
            activatedAbilityText,
            manaCost: manaOnly,
            totalManaCost: manaOnly,
            genericCost: parsedCost.generic,
            phyrexianChoices,
            playerLife,
            parsedCost,
            phyrexianCosts,
            requiresTap,
            sacrificeType,
            sacrificeSubtype,
            sacrificeCount,
            mustBeOther,
          } as any);
          
          debug(2, `[activateBattlefieldAbility] ${cardName} has Phyrexian mana costs. Prompting ${pid} for payment choice.`);
          return true; // Wait for player's choice
        }

        if (
          wouldBeManaAbility &&
          (!parsedCost.hybrids || parsedCost.hybrids.length === 0) &&
          !sacrificeType &&
          shouldPromptForActivationPaymentChoice(effectiveManaOnly)
        ) {
          const activatedAbilityText = (() => {
            const scopedAbilityText = String(abilityConditionText || '').trim();
            if (scopedAbilityText.includes(':')) return scopedAbilityText;
            return manaOnly ? `${manaOnly}: ${abilityText}` : (scopedAbilityText || abilityText);
          })();

          ResolutionQueueManager.addStep(gameId, {
            type: ResolutionStepType.MANA_PAYMENT_CHOICE,
            playerId: pid as PlayerID,
            sourceId: permanentId,
            sourceName: cardName,
            sourceImage: (permanent.card as any)?.image_uris?.small || (permanent.card as any)?.image_uris?.normal,
            description: `Choose how to pay ${effectiveManaOnly} for ${cardName}.`,
            mandatory: true,
            activationPaymentChoice: true,
            activationPaymentContext: 'mana_ability',
            confirmLabel: 'Pay and Activate',
            permanentId,
            abilityId,
            cardName,
            abilityText,
            activatedAbilityText,
            manaCost: effectiveManaOnly,
            requiresTap,
          } as any);

          if (typeof game.bumpSeq === 'function') {
            game.bumpSeq();
          }
          broadcastGame(io, game, gameId);
          return true;
        }

        if (
          !wouldBeManaAbility &&
          (!parsedCost.hybrids || parsedCost.hybrids.length === 0) &&
          !sacrificeType &&
          /each player draws?/i.test(String(abilityText || '')) &&
          shouldPromptForActivationPaymentChoice(effectiveManaOnly)
        ) {
          const activatedAbilityText = (() => {
            const scopedAbilityText = String(abilityConditionText || '').trim();
            if (scopedAbilityText.includes(':')) return scopedAbilityText;
            return manaOnly ? `${manaOnly}: ${abilityText}` : (scopedAbilityText || abilityText);
          })();

          ResolutionQueueManager.addStep(gameId, {
            type: ResolutionStepType.MANA_PAYMENT_CHOICE,
            playerId: pid as PlayerID,
            sourceId: permanentId,
            sourceName: cardName,
            sourceImage: (permanent.card as any)?.image_uris?.small || (permanent.card as any)?.image_uris?.normal,
            description: `Choose how to pay ${effectiveManaOnly} for ${cardName}.`,
            mandatory: true,
            activationPaymentChoice: true,
            activationPaymentContext: 'battlefield_group_draw',
            confirmLabel: 'Pay and Activate',
            permanentId,
            abilityId,
            cardName,
            abilityText,
            activatedAbilityText,
            manaCost: effectiveManaOnly,
            requiresTap,
            xValue: selectedXValue,
          } as any);

          if (typeof game.bumpSeq === 'function') {
            game.bumpSeq();
          }
          broadcastGame(io, game, gameId);
          return true;
        }
        
        // No Phyrexian costs - handle regular hybrid costs (like {W/U} or {2/W})
        if (parsedCost.hybrids && parsedCost.hybrids.length > 0) {
          let manaToConsume = { colors: { ...parsedCost.colors }, generic: parsedCost.generic };
          
          for (const hybridOptions of parsedCost.hybrids) {
            let paid = false;
            
            for (const option of hybridOptions) {
              if (option.startsWith('GENERIC:')) {
                // Hybrid generic/color option (like {2/W}) - check if we have enough generic
                const genericAmount = parseInt(option.split(':')[1], 10);
                const totalAvailable = calculateTotalAvailableMana(manaPool, undefined);
                const totalMana = Object.values(totalAvailable).reduce((a, b) => a + b, 0);
                if (totalMana >= genericAmount + manaToConsume.generic) {
                  // Can pay with generic - add to generic cost
                  manaToConsume.generic += genericAmount;
                  paid = true;
                  break;
                }
              } else {
                // Regular hybrid color option (like W or U from {W/U})
                const colorMap: Record<string, string> = {
                  'W': 'white', 'U': 'blue', 'B': 'black', 'R': 'red', 'G': 'green'
                };
                const colorKey = colorMap[option];
                if (colorKey && (manaPool[colorKey] || 0) >= 1) {
                  manaToConsume.colors[option] = (manaToConsume.colors[option] || 0) + 1;
                  paid = true;
                  break;
                }
              }
            }
            
            if (!paid) {
              socket.emit("error", {
                code: "INSUFFICIENT_MANA",
                message: `Cannot pay ${effectiveManaOnly} - insufficient mana`,
              });
              return true;
            }
          }
          
          // Consume the mana
          consumeManaFromPool(manaPool, manaToConsume.colors, manaToConsume.generic);
        } else {
          // Non-hybrid mana costs (including mixed colored+generic like {W}{1}).
          // Attempt to auto-tap simple mana sources when the player has mana available on the field.
          const totalAvailableBefore = calculateTotalAvailableMana(manaPool, undefined);
          let validationError = validateManaPayment(totalAvailableBefore, parsedCost.colors, parsedCost.generic);
          if (validationError) {
            maybeAutoTapForSimpleNonHybridCost({ colors: parsedCost.colors, generic: parsedCost.generic });
            const totalAvailableAfter = calculateTotalAvailableMana(manaPool, undefined);
            validationError = validateManaPayment(totalAvailableAfter, parsedCost.colors, parsedCost.generic);
          }

          if (validationError) {
            socket.emit('error', {
              code: 'INSUFFICIENT_MANA',
              message: `Cannot pay ${effectiveManaOnly}: ${validationError}`,
            });
            return true;
          }

          consumeManaFromPool(manaPool, parsedCost.colors, parsedCost.generic);
        }
        
        io.to(gameId).emit("chat", {
          id: `m_${Date.now()}`,
          gameId,
          from: "system",
          message: `${getPlayerName(game, pid)} paid ${effectiveManaOnly} to activate ${cardName}.`,
          ts: Date.now(),
        });
      }
    }
  }

  return false;
}
