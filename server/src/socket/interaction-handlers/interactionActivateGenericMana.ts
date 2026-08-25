/**
 * Origin parent: server/src/socket/interaction.ts
 *
 * Cluster moved: activateBattlefieldAbility generic mana else-body
 * (immediate mana production, multipliers, color choice).
 *
 * Public entry symbols: tryHandleActivateGenericMana.
 */

import type { PlayerID } from "../../../../shared/src/index.js";
import { appendEvent } from "../../db";
import { movePermanentToGraveyard } from "../../state/modules/counters_tokens.js";
import {
  detectManaModifiers,
  getCreatureCountManaAmount,
  getDevotionManaAmount,
  getExtraManaProduction,
  getManaMultiplier,
} from "../../state/modules/mana-abilities";
import {
  buildAnyCombinationManaSelectionFields,
  buildManaProductionColorSelectionFields,
  isCombinationOrAnyColorManaField,
  resolveAllowedColorsForCombinationMana,
} from "../../state/modules/manaColorSelectionStepUtils.js";
import { triggerAbilityActivatedTriggers } from "../../state/modules/triggers/ability-activated.js";
import { ResolutionQueueManager, ResolutionStepType } from "../../state/resolution/index.js";
import { parseWordNumber } from "../../state/utils";
import { debugWarn } from "../../utils/debug.js";
import {
  broadcastGame,
  broadcastManaPoolUpdate,
  calculateManaProduction,
  getPlayerName,
  recordCreatureSpellHasteManaProduced,
  recordManaProducedByPermanentSource,
} from "../util";
import type { ActivateBattlefieldAbilityContext } from "./interactionActivateBattlefieldAbilityContext.js";
import {
  getManaAbilityLifeEffect,
  persistAbilityActivatedTriggerPushes,
} from "./interactionActivateBattlefieldAbilityHelpers.js";
import type {
  ActivateGenericAbilityExtras,
  ActivateGenericAbilityMutationState,
} from "./interactionActivateGenericAbilityState.js";
import {
  getAnyColorBonusManaAmount,
  getChosenTypeManaSelectionFields,
  queueAnyColorBonusManaSelection,
  resolveManaAbilityActivationShape,
} from "./interactionManaAbilityActivationShape.js";

export async function tryHandleActivateGenericMana(
  ctx: ActivateBattlefieldAbilityContext,
  mut: ActivateGenericAbilityMutationState,
  extras: ActivateGenericAbilityExtras,
  recordAddedMana: (poolKey: string, amount: number) => void,
): Promise<boolean> {
  const {
    abilityText,
    requiresTap,
    manaCost,
    requiresSelfExert,
    sacrificeType,
    selectedAbilityFullText,
    selectedAbilityOracleLine,
    resolvedAbilityText,
    resolvedActivatedAbilityText,
  } = extras;
  let pendingLifePaymentForCost = mut.pendingLifePaymentForCost;
  let pendingManaLifeLossAmount = mut.pendingManaLifeLossAmount;
  let pendingManaLifeLossIsDamage = mut.pendingManaLifeLossIsDamage;
  let manaGrantsCreatureSpellHasteUntilEndOfTurn = mut.manaGrantsCreatureSpellHasteUntilEndOfTurn;
  const tappedPermanentsForCost = mut.tappedPermanentsForCost;
  const sacrificedPermanentsForCost = mut.sacrificedPermanentsForCost;
  const pendingCounterRemovals = mut.pendingCounterRemovals;
  const {
    io,
    socket,
    game,
    gameId,
    pid,
    permanentId,
    abilityId,
    permanent,
    card,
    cardName,
    typeLine,
  } = ctx;

    // ========================================================================
    // MANA ABILITY - Handle immediately without using the stack
    // Must actually add mana to the pool, accounting for:
    // - Mana multipliers (Mana Reflection, Nyxbloom Ancient)
    // - Extra mana effects (Nissa, Crypt Ghast)
    // - Devotion-based abilities (Karametra's Acolyte)
    // - Creature-count abilities (Priest of Titania, Elvish Archdruid)
    // ========================================================================

    // Tap as part of the cost for mana abilities.
    if (requiresTap && !(permanent as any).tapped) {
      (permanent as any).tapped = true;
      tappedPermanentsForCost.push(String(permanentId));
    }

    // Sacrifice the source as part of the activation cost for mana abilities
    // (e.g., "{T}, Sacrifice this artifact: Add one mana of any color").
    if (sacrificeType === 'self') {
      const costStr = String(manaCost || '');

      // Optional supported additional clause: "Pay N life" (non-interactive).
      // Use the deferred payment slot so we only pay life after the activation successfully completes.
      {
        const costLower = costStr.toLowerCase();
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

          pendingLifePaymentForCost = n;
        }
      }

      const remainingNonManaCostText = costStr
        .replace(/\{[^}]+\}/g, ' ')
        .replace(/\bpay\s+(?:a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+life\b/gi, ' ')
        .replace(/\bsacrifice\s+(?:~|this)\b[^,]*/gi, ' ')
        .replace(/[\s,]+/g, ' ')
        .trim();

      if (remainingNonManaCostText.length > 0) {
        socket.emit('error', {
          code: 'UNSUPPORTED_COST',
          message: `Cannot activate ${cardName}: sacrifice-self cost with additional non-mana components is not supported yet (${remainingNonManaCostText}).`,
        });
        return true;
      }

      try {
        const ctx = {
          state: game.state,
          libraries: (game as any).libraries,
          bumpSeq: typeof (game as any).bumpSeq === 'function' ? (game as any).bumpSeq.bind(game) : (() => {}),
          rng: (game as any).rng,
          gameId,
        } as any;
        const { movePermanentToGraveyard } = await import('../../state/modules/counters_tokens.js');
        const moved = movePermanentToGraveyard(ctx, String(permanentId), true);
        if (!moved) {
          socket.emit('error', {
            code: 'PERMANENT_NOT_FOUND',
            message: 'Permanent no longer on battlefield',
          });
          return true;
        }
        sacrificedPermanentsForCost.push(String(permanentId));
      } catch {
        socket.emit('error', {
          code: 'SACRIFICE_FAILED',
          message: `Failed to sacrifice ${cardName} as part of the activation cost.`,
        });
        return true;
      }
    }
    
    // Initialize mana pool if needed
    game.state.manaPool = game.state.manaPool || {};
    game.state.manaPool[pid] = game.state.manaPool[pid] || {
      white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0
    };

    // Fire triggers that care about ability activation.
    // Many will be filtered out by intervening-if ("if it isn't a mana ability").
    try {
      const triggeredAbilities = triggerAbilityActivatedTriggers(game as any, {
        activatedBy: pid as any,
        sourcePermanentId: permanentId as any,
        isManaAbility: true,
        abilityText,
      });
      persistAbilityActivatedTriggerPushes(gameId, game, triggeredAbilities);
    } catch {}
    
    const colorToPoolKey: Record<string, string> = {
      'W': 'white',
      'U': 'blue',
      'B': 'black',
      'R': 'red',
      'G': 'green',
      'C': 'colorless',
    };
    
    const isLand = typeLine.includes("land");
    const isBasic = typeLine.includes("basic");
    manaGrantsCreatureSpellHasteUntilEndOfTurn = /if that mana is spent on a creature spell, it gains haste until end of turn/i.test(
      String(selectedAbilityOracleLine || selectedAbilityFullText || resolvedActivatedAbilityText || resolvedAbilityText || abilityText || ''),
    );
    
    // Check for devotion-based mana abilities (Karametra's Acolyte, etc.)
    const devotionMana = getDevotionManaAmount(game.state, permanent, pid);
    
    // Check for creature-count-based mana abilities (Priest of Titania, etc.)
    const creatureCountMana = getCreatureCountManaAmount(game.state, permanent, pid);
    
    // Get mana multiplier
    const manaMultiplier = getManaMultiplier(game.state, permanent, pid);
    
    // Check for Virtue of Strength (only affects basic lands)
    let effectiveMultiplier = manaMultiplier;
    if (manaMultiplier > 1 && !isBasic && isLand) {
      const modifiers = detectManaModifiers(game.state, pid);
      const virtueModifier = modifiers.find(m => 
        m.cardName.toLowerCase().includes('virtue of strength') && 
        m.type === 'mana_multiplier'
      );
      if (virtueModifier) {
        const otherMultiplier = modifiers
          .filter(m => m.type === 'mana_multiplier' && m.cardName !== virtueModifier.cardName)
          .reduce((acc, m) => acc * (m.multiplier || 1), 1);
        effectiveMultiplier = otherMultiplier;
      }
    }
    
    // Handle devotion-based mana
    if (devotionMana && devotionMana.amount > 0) {
      const totalAmount = devotionMana.amount * effectiveMultiplier;
      const poolKey = colorToPoolKey[devotionMana.color] || 'green';
      (game.state.manaPool[pid] as any)[poolKey] += totalAmount;
      recordAddedMana(poolKey, totalAmount);
      if (manaGrantsCreatureSpellHasteUntilEndOfTurn) {
        recordCreatureSpellHasteManaProduced(game.state, String(pid), String(poolKey) as any, totalAmount);
      }
      recordManaProducedByPermanentSource(game.state, String(pid), String(permanentId || ''), String(poolKey) as any, totalAmount);
      
      io.to(gameId).emit("chat", {
        id: `m_${Date.now()}`,
        gameId,
        from: "system",
        message: effectiveMultiplier > 1 
          ? `${getPlayerName(game, pid)} tapped ${cardName} for ${totalAmount} {${devotionMana.color}} mana (devotion ${devotionMana.amount} × ${effectiveMultiplier}).`
          : `${getPlayerName(game, pid)} tapped ${cardName} for ${totalAmount} {${devotionMana.color}} mana (devotion: ${devotionMana.amount}).`,
        ts: Date.now(),
      });
      
      broadcastManaPoolUpdate(io, gameId, pid, game.state.manaPool[pid] as any, `Tapped ${cardName}`, game);
    }
    // Handle creature-count-based mana
    else if (creatureCountMana && (
      creatureCountMana.amount > 0
      || (creatureCountMana as any).requiresColorChoice === true
      || Boolean((creatureCountMana as any).activationCost)
    )) {
      const totalAmount = creatureCountMana.amount * effectiveMultiplier;
      
          if (isCombinationOrAnyColorManaField(creatureCountMana.color)) {
        const isDevotion = (creatureCountMana as any).dynamicAmountSource === 'devotion';
        const combinationFields = isDevotion
          ? buildAnyCombinationManaSelectionFields({
              totalAmount: Math.max(1, totalAmount),
              cardName,
              allowedColors: resolveAllowedColorsForCombinationMana(creatureCountMana.color),
            })
          : buildManaProductionColorSelectionFields({
              totalAmount,
              cardName,
              colorMode: creatureCountMana.color,
            });

        if (!combinationFields) {
          io.to(gameId).emit("chat", {
            id: `m_${Date.now()}`,
            gameId,
            from: "system",
            message: `${getPlayerName(game, pid)} activated ${cardName} but added no mana (0 creatures of the chosen type).`,
            ts: Date.now(),
          });
          broadcastGame(io, game, gameId);
          return true;
        }

        // Resolution Queue: request a color choice from player
        const queuedManaChoiceStep = ResolutionQueueManager.addStep(gameId, {
          type: ResolutionStepType.MANA_COLOR_SELECTION,
          playerId: pid as PlayerID,
          sourceId: permanentId,
          sourceName: cardName,
          sourceImage: (permanent.card as any)?.image_uris?.small || (permanent.card as any)?.image_uris?.normal,
          description: combinationFields.description,
          mandatory: true,
          selectionKind: combinationFields.selectionKind,
          permanentId,
          abilityId,
          cardName,
          abilityText: String(resolvedAbilityText || '').trim() || String(abilityText || '').trim(),
          activatedAbilityText: String(resolvedActivatedAbilityText || '').trim(),
          ...(combinationFields.amount != null ? { amount: combinationFields.amount } : null),
          ...(combinationFields.totalAmount != null ? { totalAmount: combinationFields.totalAmount } : null),
          ...(combinationFields.availableColors ? { availableColors: combinationFields.availableColors } : null),
          allowedColors: combinationFields.allowedColors,
          singleColor: combinationFields.selectionKind === 'any_color',
          dynamicAmountSource: (creatureCountMana as any).dynamicAmountSource,
          manaMultiplier: effectiveMultiplier,
          // Activation-cost evidence (for deterministic replay) and deferred costs
          lifeToPayForCost: pendingLifePaymentForCost || undefined,
          tappedPermanentsForCost: tappedPermanentsForCost,
          sacrificedPermanentsForCost: sacrificedPermanentsForCost,
          ...(pendingCounterRemovals.length > 0
            ? { pendingCounterRemovals: pendingCounterRemovals.map((entry) => ({ ...entry })) }
            : null),
          ...(requiresSelfExert ? { requiresSelfExertForCost: true } : null),
        } as any);

        try {
          appendEvent(gameId, (game as any).seq ?? 0, 'activateBattlefieldAbility', {
            playerId: pid,
            permanentId,
            abilityId,
            cardName,
            abilityText: String(resolvedAbilityText || '').trim() || String(abilityText || '').trim(),
            activatedAbilityText: String(resolvedActivatedAbilityText || '').trim() || undefined,
            tappedPermanents: tappedPermanentsForCost,
            queuedResolutionStep: queuedManaChoiceStep,
          });
        } catch (err) {
          debugWarn(1, '[activateBattlefieldAbility] appendEvent(exert mana color queued step) failed:', err);
        }
        
        io.to(gameId).emit("chat", {
          id: `m_${Date.now()}`,
          gameId,
          from: "system",
          message: (creatureCountMana as any).dynamicAmountSource === 'devotion'
            ? `${getPlayerName(game, pid)} activated ${cardName} and must choose a color for devotion mana.`
            : `${getPlayerName(game, pid)} tapped ${cardName} for ${totalAmount} mana (choose a color).`,
          ts: Date.now(),
        });
        
        broadcastGame(io, game, gameId);
        return true; // Exit early - wait for color choice
      } else {
        const poolKey = colorToPoolKey[creatureCountMana.color] || 'green';
        (game.state.manaPool[pid] as any)[poolKey] += totalAmount;
        recordAddedMana(poolKey, totalAmount);
        if (manaGrantsCreatureSpellHasteUntilEndOfTurn) {
          recordCreatureSpellHasteManaProduced(game.state, String(pid), String(poolKey) as any, totalAmount);
        }
        
        io.to(gameId).emit("chat", {
          id: `m_${Date.now()}`,
          gameId,
          from: "system",
          message: effectiveMultiplier > 1 
            ? `${getPlayerName(game, pid)} tapped ${cardName} for ${totalAmount} {${creatureCountMana.color}} mana (count ${creatureCountMana.amount} × ${effectiveMultiplier}).`
            : `${getPlayerName(game, pid)} tapped ${cardName} for ${totalAmount} {${creatureCountMana.color}} mana.`,
          ts: Date.now(),
        });
        
        broadcastManaPoolUpdate(io, gameId, pid, game.state.manaPool[pid] as any, `Tapped ${cardName}`, game);
      }
    }
    // Handle standard mana abilities
    else {
      const scopedManaProduction = calculateManaProduction(
        game.state,
        permanent,
        pid,
        undefined,
        String(abilityId || ''),
      );

      if (
        scopedManaProduction.requiresColorChoice === true
        && scopedManaProduction.dynamicAmountSource === 'devotion'
      ) {
        const combinationFields = buildAnyCombinationManaSelectionFields({
          totalAmount: 0,
          cardName,
          allowedColors: ['W', 'U', 'B', 'R', 'G'],
        });
        const queuedManaChoiceStep = ResolutionQueueManager.addStep(gameId, {
          type: ResolutionStepType.MANA_COLOR_SELECTION,
          playerId: pid as PlayerID,
          sourceId: permanentId,
          sourceName: cardName,
          sourceImage: (permanent.card as any)?.image_uris?.small || (permanent.card as any)?.image_uris?.normal,
          description: combinationFields.description,
          mandatory: true,
          selectionKind: combinationFields.selectionKind,
          permanentId,
          abilityId,
          cardName,
          abilityText: String(resolvedAbilityText || '').trim() || String(abilityText || '').trim(),
          activatedAbilityText: String(resolvedActivatedAbilityText || '').trim(),
          allowedColors: combinationFields.allowedColors,
          singleColor: true,
          dynamicAmountSource: 'devotion',
          manaMultiplier: effectiveMultiplier,
          lifeToPayForCost: pendingLifePaymentForCost || undefined,
          tappedPermanentsForCost: tappedPermanentsForCost,
          sacrificedPermanentsForCost: sacrificedPermanentsForCost,
          ...(pendingCounterRemovals.length > 0
            ? { pendingCounterRemovals: pendingCounterRemovals.map((entry) => ({ ...entry })) }
            : null),
          ...(requiresSelfExert ? { requiresSelfExertForCost: true } : null),
        } as any);

        try {
          appendEvent(gameId, (game as any).seq ?? 0, 'activateBattlefieldAbility', {
            playerId: pid,
            permanentId,
            abilityId,
            cardName,
            abilityText: String(resolvedAbilityText || '').trim() || String(abilityText || '').trim(),
            activatedAbilityText: String(resolvedActivatedAbilityText || '').trim() || undefined,
            tappedPermanents: tappedPermanentsForCost,
            queuedResolutionStep: queuedManaChoiceStep,
          });
        } catch (err) {
          debugWarn(1, '[activateBattlefieldAbility] appendEvent(devotion mana color queued step) failed:', err);
        }

        io.to(gameId).emit("chat", {
          id: `m_${Date.now()}`,
          gameId,
          from: "system",
          message: `${getPlayerName(game, pid)} activated ${cardName} and must choose a color for devotion mana.`,
          ts: Date.now(),
        });

        broadcastGame(io, game, gameId);
        return true;
      }

      const {
        ability,
        produces,
        baseAmount,
        producesAllAtOnce,
      } = resolveManaAbilityActivationShape(
        game.state,
        permanent,
        pid,
        String(abilityId || ''),
        selectedAbilityFullText,
        abilityText,
        manaCost,
      );

      if (produces.length > 0) {
        const producesColoredMana = produces.some((color: any) => String(color || '').toUpperCase() !== 'C');
        const rawFallbackManaLifeEffect = getManaAbilityLifeEffect(permanent.card, producesColoredMana);
        const fallbackManaLifeEffect = rawFallbackManaLifeEffect.isDamage || pendingLifePaymentForCost <= 0
          ? rawFallbackManaLifeEffect
          : { amount: 0, isDamage: false };
        const manaLifeEffect = ability?.damageEffect?.type === 'damage_self'
          ? {
              amount: Math.max(0, Number(ability?.damageEffect?.amount || 0)),
              isDamage: true,
            }
          : fallbackManaLifeEffect;
        pendingManaLifeLossAmount = Math.max(0, Number(manaLifeEffect.amount || 0));
        pendingManaLifeLossIsDamage = pendingManaLifeLossAmount > 0 && manaLifeEffect.isDamage === true;

        if (producesAllAtOnce && produces.length > 1) {
          const manaAdded: string[] = [];
          const amountPerColor = produces.length > 0
            ? Math.max(1, Math.floor(baseAmount / produces.length))
            : 1;

          for (const manaColor of produces) {
            const poolKey = colorToPoolKey[manaColor] || 'colorless';
            (game.state.manaPool[pid] as any)[poolKey] += amountPerColor * effectiveMultiplier;
            recordAddedMana(poolKey, amountPerColor * effectiveMultiplier);
            if (manaGrantsCreatureSpellHasteUntilEndOfTurn) {
              recordCreatureSpellHasteManaProduced(game.state, String(pid), String(poolKey) as any, amountPerColor * effectiveMultiplier);
            }
            manaAdded.push(`{${manaColor}}`);
          }

          const manaStr = manaAdded.join('');
          let message = `${getPlayerName(game, pid)} tapped ${cardName} for ${manaStr}`;
          if (effectiveMultiplier > 1) {
            message += ` (×${effectiveMultiplier})`;
          }
          message += '.';

          io.to(gameId).emit("chat", {
            id: `m_${Date.now()}`,
            gameId,
            from: "system",
            message,
            ts: Date.now(),
          });

          broadcastManaPoolUpdate(io, gameId, pid, game.state.manaPool[pid] as any, `Tapped ${cardName}`, game);
        } else if (produces.length > 1) {
          const totalAmount = baseAmount * effectiveMultiplier;
          const extraMana = getExtraManaProduction(game.state, permanent, pid, produces[0]);
          const totalExtra = extraMana.reduce((acc, e) => acc + e.amount, 0);
          const finalTotal = totalAmount + totalExtra;

          const queuedManaChoiceStep = ResolutionQueueManager.addStep(gameId, {
            type: ResolutionStepType.MANA_COLOR_SELECTION,
            playerId: pid as PlayerID,
            sourceId: permanentId,
            sourceName: cardName,
            sourceImage: (permanent.card as any)?.image_uris?.small || (permanent.card as any)?.image_uris?.normal,
            description: `Choose a color for ${cardName}'s mana.`,
            mandatory: true,
            selectionKind: 'any_color',
            permanentId,
            abilityId,
            cardName,
            abilityText: String(resolvedAbilityText || '').trim() || String(abilityText || '').trim(),
            activatedAbilityText: String(resolvedActivatedAbilityText || '').trim(),
            amount: finalTotal,
            allowedColors: produces.filter((color) => ['W', 'U', 'B', 'R', 'G'].includes(String(color || '').toUpperCase())),
            lifeToPayForCost: pendingLifePaymentForCost || undefined,
            tappedPermanentsForCost: tappedPermanentsForCost,
            sacrificedPermanentsForCost: sacrificedPermanentsForCost,
            ...(pendingCounterRemovals.length > 0
              ? { pendingCounterRemovals: pendingCounterRemovals.map((entry) => ({ ...entry })) }
              : null),
            manaLifeLossAmount: pendingManaLifeLossAmount > 0 ? pendingManaLifeLossAmount : undefined,
            manaLifeLossIsDamage: pendingManaLifeLossAmount > 0 ? pendingManaLifeLossIsDamage : undefined,
            ...(requiresSelfExert ? { requiresSelfExertForCost: true } : null),
            ...getChosenTypeManaSelectionFields(ability),
          } as any);

          try {
            appendEvent(gameId, (game as any).seq ?? 0, 'activateBattlefieldAbility', {
              playerId: pid,
              permanentId,
              abilityId,
              cardName,
              abilityText: String(resolvedAbilityText || '').trim() || String(abilityText || '').trim(),
              activatedAbilityText: String(resolvedActivatedAbilityText || '').trim() || undefined,
              tappedPermanents: tappedPermanentsForCost,
              queuedResolutionStep: queuedManaChoiceStep,
            });
          } catch (err) {
            debugWarn(1, '[activateBattlefieldAbility] appendEvent(exert mana shape queued step) failed:', err);
          }

          const bonusAnyAmount = getAnyColorBonusManaAmount(scopedManaProduction);
          if (bonusAnyAmount > 0) {
            queueAnyColorBonusManaSelection({
              gameId,
              playerId: pid as PlayerID,
              permanentId,
              cardName,
              permanent,
              amount: bonusAnyAmount,
              abilityId: String(abilityId || ''),
            });
          }

          io.to(gameId).emit("chat", {
            id: `m_${Date.now()}`,
            gameId,
            from: "system",
            message: `${getPlayerName(game, pid)} tapped ${cardName} for mana (choose color).`,
            ts: Date.now(),
          });

          broadcastGame(io, game, gameId);
          return true;
        } else {
          const manaColor = produces[0];
          const poolKey = colorToPoolKey[manaColor] || 'colorless';
          let totalAmount = baseAmount * effectiveMultiplier;

          const extraMana = getExtraManaProduction(game.state, permanent, pid, manaColor);
          for (const extra of extraMana) {
            const extraPoolKey = colorToPoolKey[extra.color] || poolKey;
            (game.state.manaPool[pid] as any)[extraPoolKey] += extra.amount;
            recordAddedMana(extraPoolKey, extra.amount);
            if (manaGrantsCreatureSpellHasteUntilEndOfTurn) {
              recordCreatureSpellHasteManaProduced(game.state, String(pid), String(extraPoolKey) as any, extra.amount);
            }
            recordManaProducedByPermanentSource(game.state, String(pid), String(permanentId || ''), String(extraPoolKey) as any, extra.amount);
            totalAmount += extra.amount;
          }

          (game.state.manaPool[pid] as any)[poolKey] += baseAmount * effectiveMultiplier;
          recordAddedMana(poolKey, baseAmount * effectiveMultiplier);
          if (manaGrantsCreatureSpellHasteUntilEndOfTurn) {
            recordCreatureSpellHasteManaProduced(game.state, String(pid), String(poolKey) as any, baseAmount * effectiveMultiplier);
          }
          recordManaProducedByPermanentSource(game.state, String(pid), String(permanentId || ''), String(poolKey) as any, baseAmount * effectiveMultiplier);

          let message = `${getPlayerName(game, pid)} tapped ${cardName}`;
          if (effectiveMultiplier > 1 && extraMana.length > 0) {
            message += ` for ${totalAmount} {${manaColor}} mana (×${effectiveMultiplier} + ${extraMana.length} extra).`;
          } else if (effectiveMultiplier > 1) {
            message += ` for ${totalAmount} {${manaColor}} mana (×${effectiveMultiplier}).`;
          } else if (extraMana.length > 0) {
            message += ` for ${totalAmount} {${manaColor}} mana (+${extraMana.reduce((a, e) => a + e.amount, 0)} extra).`;
          } else {
            message += ` for {${manaColor}} mana.`;
          }

          io.to(gameId).emit("chat", {
            id: `m_${Date.now()}`,
            gameId,
            from: "system",
            message,
            ts: Date.now(),
          });

          broadcastManaPoolUpdate(io, gameId, pid, game.state.manaPool[pid] as any, `Tapped ${cardName}`, game);

          const bonusAnyAmount = getAnyColorBonusManaAmount(scopedManaProduction);
          if (bonusAnyAmount > 0) {
            queueAnyColorBonusManaSelection({
              gameId,
              playerId: pid as PlayerID,
              permanentId,
              cardName,
              permanent,
              amount: bonusAnyAmount,
              abilityId: String(abilityId || ''),
            });
          }
        }
      } else {
        io.to(gameId).emit("chat", {
          id: `m_${Date.now()}`,
          gameId,
          from: "system",
          message: `${getPlayerName(game, pid)} activated ${cardName}'s mana ability.`,
          ts: Date.now(),
        });
      }
    }
  mut.pendingLifePaymentForCost = pendingLifePaymentForCost;
  mut.pendingManaLifeLossAmount = pendingManaLifeLossAmount;
  mut.pendingManaLifeLossIsDamage = pendingManaLifeLossIsDamage;
  mut.manaGrantsCreatureSpellHasteUntilEndOfTurn = manaGrantsCreatureSpellHasteUntilEndOfTurn;
  return false;
}
