/**
 * Origin parent: server/src/socket/interaction.ts
 *
 * Cluster moved: activateBattlefieldAbility sacrifice-as-cost TARGET_SELECTION
 * prompt (non-self sacrifice types).
 *
 * Public entry symbols: tryHandleActivateSacrificeCostPrompt.
 */

import type { PlayerID } from "../../../../shared/src/index.js";
import { parseSacrificeCost } from "../../../../shared/src/textUtils";
import { permanentHasCreatureTypeNow } from "../../state/creatureTypeNow.js";
import { syncDerivedContinuousEffects } from "../../state/modules/staticEffectSpec.js";
import { parseWordNumber } from "../../state/utils";
import { ResolutionQueueManager, ResolutionStepType } from "../../state/resolution/index.js";
import { debug } from "../../utils/debug.js";
import {
  broadcastGame,
  getEffectivePower,
  getEffectiveToughness,
  getOrInitManaPool,
  parseManaCost,
} from "../util";
import type { ActivateBattlefieldAbilityContext } from "./interactionActivateBattlefieldAbilityContext.js";

export async function tryHandleActivateSacrificeCostPrompt(
  ctx: ActivateBattlefieldAbilityContext,
  manaCost: string | undefined,
  abilityText: string,
  requiresTap: boolean,
  abilityConditionText: string,
  selectedAbilityFullText: string,
  selectedAbilityOracleLine: string,
  sacrificeType: any,
  sacrificeSubtype: any,
  buildActivatedAbilityOracleTextForStack: (params: any) => string,
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
    oracleText,
  } = ctx;

  // Check if sacrifice is required and we need to prompt for selection
  if (sacrificeType && sacrificeType !== 'self') {
    // Get the sacrifice count (default 1)
    const sacrificeInfo = parseSacrificeCost(manaCost || '');
    const sacrificeCount = sacrificeInfo.sacrificeCount || 1;
    const mustBeOther = sacrificeInfo.mustBeOther || false;

    // Optional supported additional clause: "Pay N life" (non-interactive).
    // IMPORTANT: do not actually pay life until the sacrifice selection step resolves;
    // otherwise canceling the step would incorrectly charge life.
    const costStr = String(manaCost || '');
    const costLower = costStr.toLowerCase();
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

    // Conservative: only support costs that are (mana symbols and/or {T}/{Q}) plus the sacrifice clause
    // and optionally exactly one pay-life clause.
    // (Discard+sacrifice is handled by the dedicated flow below.)
    const remainingNonManaCostTextForSacOnly = costStr
      .replace(/\{[^}]+\}/g, ' ')
      .replace(/\bpay\s+(?:a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+life\b/gi, ' ')
      .replace(/\bsacrifice\b[^,]*/gi, ' ')
      .replace(/\bdiscard\b[^,]*/gi, ' discard ')
      .replace(/[\s,]+/g, ' ')
      .trim();
    if (remainingNonManaCostTextForSacOnly.length > 0 && !/\bdiscard\b/i.test(remainingNonManaCostTextForSacOnly)) {
      socket.emit('error', {
        code: 'UNSUPPORTED_COST',
        message: `Cannot activate ${cardName}: sacrifice cost with additional non-mana components is not supported yet (${remainingNonManaCostTextForSacOnly}).`,
      });
      return true;
    }

    // If the cost also requires a discard, prompt for discard first, then enqueue sacrifice.
    // Conservative: only support costs that are (mana symbols and/or {T}/{Q}) plus exactly one
    // discard clause and exactly one sacrifice clause.
    // (costStr/costLower already computed above)

    if (costLower.includes('discard')) {
      const discardMatch = costLower.match(
        /\bdiscard\s+(a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+cards?\b/i
      );
      const discardTypedMatch = costLower.match(
        /\bdiscard\s+(a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+(creature|artifact|enchantment|land|instant|sorcery|planeswalker|nonland|noncreature)\s+cards?\b/i
      );

      if (discardMatch || discardTypedMatch) {
        // Reject choice-based or mixed costs for now.
        if (/\bor\b/i.test(costStr)) {
          socket.emit('error', {
            code: 'UNSUPPORTED_COST',
            message: `Cannot activate ${cardName}: discard + sacrifice costs with choices ("or") are not supported yet.`,
          });
          return true;
        }

        // Ensure the cost contains no other non-mana cost components besides discard + sacrifice.
        const remainingNonManaCostText = costStr
          .replace(/\{[^}]+\}/g, ' ')
          .replace(/\bpay\s+(?:a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+life\b/gi, ' ')
          .replace(
            /\bdiscard\s+(?:a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+(?:(?:creature|artifact|enchantment|land|instant|sorcery|planeswalker|nonland|noncreature)\s+)?cards?\b/gi,
            ' '
          )
          .replace(/\bsacrifice\b[^,]*/gi, ' ')
          .replace(/[\s,]+/g, ' ')
          .trim();
        if (remainingNonManaCostText.length > 0) {
          socket.emit('error', {
            code: 'UNSUPPORTED_COST',
            message: `Cannot activate ${cardName}: discard + sacrifice cost with additional non-mana components is not supported yet (${remainingNonManaCostText}).`,
          });
          return true;
        }

        const typedRestriction = discardTypedMatch ? String(discardTypedMatch[2] || '').trim().toLowerCase() : '';
        const rawDiscard = String((discardTypedMatch?.[1] || discardMatch?.[1]) || '').trim();
        const discardCount = parseWordNumber(rawDiscard, 1);
        if (!Number.isFinite(discardCount) || discardCount <= 0) {
          socket.emit('error', {
            code: 'UNSUPPORTED_COST',
            message: `Cannot activate ${cardName}: invalid discard count.`,
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
          if (!typedRestriction) return hand;
          return (hand as any[]).filter((c: any) => {
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
              : `Need to discard ${discardCount} card(s), but you only have ${hand.length}.`,
          });
          return true;
        }

        // Compute eligible permanents for sacrifice (same rules as sacrifice-only flow).
        const eligiblePermanents = battlefield.filter((p: any) => {
          if (p.controller !== pid) return false;
          if (mustBeOther && p.id === permanentId) return false;
          const permTypeLine = (p.card?.type_line || '').toLowerCase();
          let matchesType = false;
          switch (sacrificeType) {
            case 'creature':
              matchesType = permTypeLine.includes('creature');
              break;
            case 'artifact':
              matchesType = permTypeLine.includes('artifact');
              break;
            case 'enchantment':
              matchesType = permTypeLine.includes('enchantment');
              break;
            case 'land':
              matchesType = permTypeLine.includes('land');
              break;
            case 'nonland_permanent':
              matchesType = !permTypeLine.includes('land');
              break;
            case 'permanent':
              matchesType = true;
              break;
            case 'artifact_or_creature':
              matchesType = permTypeLine.includes('artifact') || permTypeLine.includes('creature');
              break;
            default:
              matchesType = false;
          }
          if (!matchesType) return false;
          if (sacrificeSubtype) {
            if (sacrificeType === 'creature') {
              return permanentHasCreatureTypeNow(p, sacrificeSubtype);
            }
            const subtypeLower = sacrificeSubtype.toLowerCase();
            return permTypeLine.includes(subtypeLower);
          }
          return true;
        });

        let sacrificeLabel = sacrificeSubtype ? sacrificeSubtype : sacrificeType;
        let sacrificeLabelPlural = sacrificeLabel + 's';
        if (sacrificeType === 'artifact_or_creature') {
          sacrificeLabel = 'artifact or creature';
          sacrificeLabelPlural = 'artifacts and/or creatures';
        } else if (sacrificeType === 'nonland_permanent') {
          sacrificeLabel = 'nonland permanent';
          sacrificeLabelPlural = 'nonland permanents';
        }

        if (eligiblePermanents.length < sacrificeCount) {
          socket.emit('error', {
            code: 'INSUFFICIENT_SACRIFICE_TARGETS',
            message: `You don't control enough ${sacrificeLabelPlural} to sacrifice. (Need ${sacrificeCount}, have ${eligiblePermanents.length})`,
          });
          return true;
        }

        const existing = ResolutionQueueManager
          .getStepsForPlayer(gameId, pid as any)
          .find(
            (s: any) =>
              s?.type === ResolutionStepType.DISCARD_SELECTION &&
              (s as any)?.discardAbilityAsCost === true &&
              (s as any)?.discardAndSacrificeAbilityAsCost === true &&
              String((s as any)?.permanentId || s?.sourceId) === String(permanentId)
          );

        if (!existing) {
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
            discardAndSacrificeAbilityAsCost: true,
            permanentId,
            abilityId,
            cardName,
            abilityText,
            manaCost,
            requiresTap,
            discardTypeRestriction: typedRestriction || undefined,

            // Sacrifice continuation context
            sacrificeType,
            sacrificeSubtype,
            sacrificeCount,
            mustBeOther,

            // Optional deferred life payment (validated at activation time; paid after final step)
            lifeToPayForCost,
          } as any);
        }

        debug(2, `[activateBattlefieldAbility] ${cardName} requires discard + sacrifice as a cost. Queued DISCARD_SELECTION (will continue to sacrifice).`);
        broadcastGame(io, game, gameId);
        return true;
      }
    }
    
    // Get eligible permanents for sacrifice
    const eligiblePermanents = battlefield.filter((p: any) => {
      if (p.controller !== pid) return false;
      // If mustBeOther is true, exclude the source permanent
      if (mustBeOther && p.id === permanentId) return false;
      
      const permTypeLine = (p.card?.type_line || '').toLowerCase();
      
      // First check if it matches the basic type requirement
      let matchesType = false;
      switch (sacrificeType) {
        case 'creature':
          matchesType = permTypeLine.includes('creature');
          break;
        case 'artifact':
          matchesType = permTypeLine.includes('artifact');
          break;
        case 'enchantment':
          matchesType = permTypeLine.includes('enchantment');
          break;
        case 'land':
          matchesType = permTypeLine.includes('land');
          break;
        case 'nonland_permanent':
          matchesType = !permTypeLine.includes('land');
          break;
        case 'permanent':
          matchesType = true; // Any permanent
          break;
        case 'artifact_or_creature':
          // Match either artifact or creature (e.g., Mondrak's ability)
          matchesType = permTypeLine.includes('artifact') || permTypeLine.includes('creature');
          break;
        default:
          matchesType = false;
      }
      
      if (!matchesType) return false;
      
      // If there's a creature subtype requirement, also check that
      if (sacrificeSubtype) {
        if (sacrificeType === 'creature') {
          return permanentHasCreatureTypeNow(p, sacrificeSubtype);
        }
        const subtypeLower = sacrificeSubtype.toLowerCase();
        return permTypeLine.includes(subtypeLower);
      }
      
      return true;
    });
    
    // Determine what type label to show in error message
    let sacrificeLabel = sacrificeSubtype ? sacrificeSubtype : sacrificeType;
    let sacrificeLabelPlural = sacrificeLabel + 's';
    if (sacrificeType === 'artifact_or_creature') {
      sacrificeLabel = 'artifact or creature';
      sacrificeLabelPlural = 'artifacts and/or creatures';
    } else if (sacrificeType === 'nonland_permanent') {
      sacrificeLabel = 'nonland permanent';
      sacrificeLabelPlural = 'nonland permanents';
    }
    
    if (eligiblePermanents.length < sacrificeCount) {
      socket.emit("error", {
        code: "INSUFFICIENT_SACRIFICE_TARGETS",
        message: `You don't control enough ${sacrificeLabelPlural} to sacrifice. (Need ${sacrificeCount}, have ${eligiblePermanents.length})`,
      });
      return true;
    }

    if (manaCost) {
      const manaSymbols = manaCost.match(/\{[WUBRGC0-9X\/P]+\}/gi);
      if (manaSymbols) {
        const manaOnly = manaSymbols
          .filter(symbol => symbol.toUpperCase() !== '{T}' && symbol.toUpperCase() !== '{Q}')
          .join('');

        if (manaOnly) {
          const parsedCost = parseManaCost(manaOnly);
          const manaPool = getOrInitManaPool(game.state, pid);
          const playerLife = game.state.life?.[pid] || 40;
          const phyrexianCosts = (parsedCost.hybrids || []).filter((options: string[]) =>
            options.some(option => option.startsWith('LIFE:'))
          );

          if (phyrexianCosts.length > 0) {
            const existingPhyrexianPrompt = ResolutionQueueManager
              .getStepsForPlayer(gameId, pid as any)
              .find((step: any) => step?.type === ResolutionStepType.MANA_PAYMENT_CHOICE && step?.phyrexianManaChoice === true && String(step?.permanentId || step?.sourceId) === String(permanentId));

            if (!existingPhyrexianPrompt) {
              const activatedAbilityText = buildActivatedAbilityOracleTextForStack({
                selectedAbilityFullText,
                selectedAbilityOracleLine,
                abilityConditionText,
                manaCost: manaOnly || manaCost,
                abilityText,
              });
              const phyrexianChoices = phyrexianCosts.map((options: string[], index: number) => {
                const colorOption = options.find((option: string) => !option.startsWith('LIFE:') && !option.startsWith('GENERIC:'));
                const lifeOption = options.find((option: string) => option.startsWith('LIFE:'));
                const lifeAmount = lifeOption ? parseInt(lifeOption.split(':')[1], 10) : 2;
                const colorMap: Record<string, string> = {
                  W: 'white',
                  U: 'blue',
                  B: 'black',
                  R: 'red',
                  G: 'green',
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

              ResolutionQueueManager.addStep(gameId, {
                type: ResolutionStepType.MANA_PAYMENT_CHOICE,
                playerId: pid as PlayerID,
                sourceId: permanentId,
                sourceName: cardName,
                sourceImage: card?.image_uris?.small || card?.image_uris?.normal,
                description: `Choose how to pay Phyrexian mana for ${cardName}.`,
                mandatory: true,
                phyrexianManaChoice: true,
                pendingId: `phyrexian_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
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
            }

            debug(2, `[activateBattlefieldAbility] ${cardName} has Phyrexian mana in a sacrifice cost. Prompting ${pid} for payment choice before sacrifice selection.`);
            broadcastGame(io, game, gameId);
            return true;
          }
        }
      }
    }

    const playerNameById = new Map<string, string>(
      (Array.isArray((game.state as any)?.players) ? (game.state as any).players : [])
        .map((player: any) => [
          String(player?.id || '').trim(),
          String(player?.name || player?.id || '').trim(),
        ] as [string, string])
        .filter(([id]) => Boolean(id)),
    );
    // Refresh continuous effects so sacrifice labels include lords (Morophon, etc.)
    try {
      delete (game.state as any)._derivedContinuousEffects;
      syncDerivedContinuousEffects(game.state);
    } catch {
      // best-effort
    }
    const sacrificeTargets = eligiblePermanents.map((p: any) => {
      const controllerId = String(p?.controller || '').trim();
      const ownerId = String(p?.owner || p?.ownerId || controllerId).trim();
      const power = getEffectivePower(p, game.state);
      const toughness = getEffectiveToughness(p, game.state);
      const name = p.card?.name || 'Unknown';
      const ptLabel = Number.isFinite(power) && Number.isFinite(toughness) ? ` (${power}/${toughness})` : '';
      return {
        id: p.id,
        label: `${name}${ptLabel}`,
        name,
        description: p.card?.type_line || 'Permanent',
        imageUrl: p.card?.image_uris?.small || p.card?.image_uris?.normal,
        type: 'permanent',
        typeLine: p.card?.type_line || '',
        power: Number.isFinite(power) ? power : undefined,
        toughness: Number.isFinite(toughness) ? toughness : undefined,
        effectivePower: Number.isFinite(power) ? power : undefined,
        effectiveToughness: Number.isFinite(toughness) ? toughness : undefined,
        controller: controllerId || undefined,
        controllerName: controllerId
          ? (playerNameById.get(controllerId) || controllerId)
          : undefined,
        owner: ownerId || undefined,
        ownerName: ownerId ? (playerNameById.get(ownerId) || ownerId) : undefined,
        tapped: p?.tapped === true,
        isToken: p?.isToken === true || p?.card?.isToken === true,
        isCommander: p?.isCommander === true || p?.card?.isCommander === true,
      };
    });

    // Unified Resolution Queue prompt
    const existing = ResolutionQueueManager
      .getStepsForPlayer(gameId, pid as any)
      .find((s: any) => s?.type === ResolutionStepType.TARGET_SELECTION && (s as any)?.sacrificeAbilityAsCost === true && String((s as any)?.permanentId || s?.sourceId) === String(permanentId));

    if (!existing) {
      const activatedAbilityText = buildActivatedAbilityOracleTextForStack({
        selectedAbilityFullText,
        selectedAbilityOracleLine,
        abilityConditionText,
        manaCost,
        abilityText,
      });
      ResolutionQueueManager.addStep(gameId, {
        type: ResolutionStepType.TARGET_SELECTION,
        playerId: pid as PlayerID,
        sourceId: permanentId,
        sourceName: cardName,
        sourceImage: card?.image_uris?.small || card?.image_uris?.normal,
        description: `${cardName}: Sacrifice ${sacrificeCount} ${sacrificeLabelPlural} to activate: ${abilityText}`,
        mandatory: false,
        validTargets: sacrificeTargets,
        targetTypes: ['sacrifice_cost'],
        minTargets: sacrificeCount,
        maxTargets: sacrificeCount,
        targetDescription: `${sacrificeLabelPlural} you control`,

        // Custom payload consumed by socket/resolution.ts
        sacrificeAbilityAsCost: true,
        permanentId,
        abilityId,
        cardName,
        abilityText,
        manaCost,
        oracleText: (card?.oracle_text || oracleText || ''),
        requiresTap,
        activatedAbilityText,
        sacrificeType,
        sacrificeSubtype,
        sacrificeCount,
        mustBeOther,
        lifeToPayForCost,
      } as any);
    }

    debug(2, `[activateBattlefieldAbility] ${cardName} requires sacrifice of ${sacrificeCount} ${sacrificeLabel}(s). Queued TARGET_SELECTION.`);
    broadcastGame(io, game, gameId);
    return true;
  }
  

  return false;
}
