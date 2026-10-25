/**
 * Origin parent: server/src/socket/interaction.ts
 *
 * Cluster moved: registerInteractionHandlers socket handler for tapPermanent.
 *
 * Public entry symbols: handleTapPermanentRequest.
 */
import { notifyNoncombatPlayerDamage } from '../../state/modules/triggers/player-dealt-damage-ir.js';
import type { Server, Socket } from "socket.io";
import type { PlayerID } from "../../../../shared/src/index.js";
import { appendEvent } from "../../db";
import { queueTapTriggersForTappedPermanents } from "../../state/modules/tap-trigger-queue.js";
import {
  detectManaModifiers,
  getCreatureCountManaAmount,
  getDevotionManaAmount,
  getExtraManaProduction,
  getManaAbilitiesForPermanent,
  getManaMultiplier,
  parseManaSpendRestrictionFromOracle,
} from "../../state/modules/mana-abilities";
import {
  buildAnyCombinationManaSelectionFields,
  buildManaProductionColorSelectionFields,
  isCombinationOrAnyColorManaField,
  resolveAllowedColorsForCombinationMana,
} from "../../state/modules/manaColorSelectionStepUtils.js";
import { ResolutionQueueManager, ResolutionStepType } from "../../state/resolution/index.js";
import { debug } from "../../utils/debug.js";
import { creatureHasHaste } from "../game-actions.js";
import { permanentCannotActivateTapAbilities } from "../../state/modules/staticEffectSpecActivationLocks.js";
import { resolveGroupedPermanentRef } from "../tokenGroupResolve.js";
import {
  addRestrictedManaToPool,
  broadcastGame,
  broadcastManaPoolUpdate,
  calculateManaProduction,
  shouldSkipScalingManaForColorlessTap,
  calculateTotalAvailableMana,
  consumeManaFromPool,
  getOrInitManaPool,
  getPlayerName,
  parseManaCost,
  recordTreasureManaProduced,
  validateManaPayment,
} from "../util";
import {
  getAnyColorBonusManaAmount,
  getChosenTypeManaSelectionFields,
  queueAnyColorBonusManaSelection,
  resolveManaAbilityActivationShape,
} from "./interactionManaAbilityActivationShape.js";
import { getBattlefield, type EnsureInRoomAndSeated } from "./interactionRoomAndBattlefield.js";

// Tap a permanent on the battlefield
export async function handleTapPermanentRequest(
  io: Server,
  socket: Socket,
  ensureInRoomAndSeated: EnsureInRoomAndSeated,
  payload?: { gameId?: unknown; permanentId?: unknown },
): Promise<void> {
    const gameIdRaw = payload?.gameId;
    const payloadPermanentId = payload?.permanentId;

    if (!payloadPermanentId || typeof payloadPermanentId !== 'string') return;

    const ctx = ensureInRoomAndSeated(gameIdRaw);
    if (!ctx) return;

    const { gameId, game, pid } = ctx;
    const battlefield = getBattlefield(game);

  const resolvedPermanentId = resolveGroupedPermanentRef(game, pid as any, payloadPermanentId) || payloadPermanentId;
  const permanent = battlefield.find((p: any) => p?.id === resolvedPermanentId && p?.controller === pid);
  if (!permanent) {
    socket.emit("error", {
      code: "PERMANENT_NOT_FOUND",
      message: "Permanent not found or not controlled by you",
    });
    return;
  }
  const permanentId = String(permanent.id);
  
  if ((permanent as any).tapped) {
    socket.emit("error", {
      code: "ALREADY_TAPPED",
      message: "Permanent is already tapped",
    });
    return;
  }
  
  // Get card info early for summoning sickness check
  const card = (permanent as any).card;
  const cardName = card?.name || "Unknown";
  const typeLine = (card?.type_line || "").toLowerCase();
  const isCreature = /\bcreature\b/.test(typeLine);
  const isLand = typeLine.includes("land");
  
  // ========================================================================
  // Rule 302.6 / 702.10: Check summoning sickness for creatures with tap abilities
  // A creature can't use tap/untap abilities unless it has been continuously controlled
  // since the turn began OR it has haste (from any source).
  // Lands and non-creature permanents are NOT affected by summoning sickness.
  // ========================================================================
  if (isCreature && !isLand) {
    const hasHaste = creatureHasHaste(permanent, battlefield, pid);
    
    // summoningSickness is set when creatures enter the battlefield
    // If a creature has summoning sickness and doesn't have haste, it can't use tap abilities
    if ((permanent as any).summoningSickness && !hasHaste) {
      socket.emit("error", {
        code: "SUMMONING_SICKNESS",
        message: `${cardName} has summoning sickness and cannot use tap abilities this turn`,
      });
      return;
    }
  }

  if (permanentCannotActivateTapAbilities(permanent, game.state)) {
    socket.emit("error", {
      code: "CANNOT_ACTIVATE_TAP_ABILITY",
      message: `${cardName}'s activated abilities with {T} in their costs can't be activated.`,
    });
    return;
  }
  
  // Set tapped on the permanent
  (permanent as any).tapped = true;

  // Intervening-if support: record that this player tapped a nonland permanent this turn.
  // Conservative: only mark true on positive evidence.
  try {
    if (!isLand) {
      (game.state as any).tappedNonlandPermanentThisTurnByPlayer = (game.state as any).tappedNonlandPermanentThisTurnByPlayer || {};
      (game.state as any).tappedNonlandPermanentThisTurnByPlayer[String(pid)] = true;
    }
  } catch {}
  
  // Also ensure it's set in the main battlefield array (defensive programming)
  const battlefieldIndex = battlefield.findIndex((p: any) => p?.id === permanentId);
  if (battlefieldIndex >= 0) {
    battlefield[battlefieldIndex].tapped = true;
  }
  
  debug(2, `[tapPermanent] Tapped ${cardName} (${permanentId}). Tapped state: ${!!permanent.tapped}`);
  
  // Check if this permanent has mana abilities (intrinsic or granted by effects like Cryptolith Rite)
  // If so, add the produced mana to the player's mana pool
  const isBasic = typeLine.includes("basic");
  const isTreasureSource = /\btreasure\b/.test(typeLine);
  const recordedAddedMana: Record<string, number> = {};
  let recordedManaCost: string | undefined;
  let recordedLifeLost = 0;
  let recordedLifeLossIsDamage: boolean | undefined;

  const recordAddedMana = (poolKey: string, amount: number) => {
    if (!poolKey) return;
    if (!Number.isFinite(amount) || amount === 0) return;
    recordedAddedMana[poolKey] = (recordedAddedMana[poolKey] || 0) + amount;
  };
  
  // ========================================================================
  // Check for devotion-based or creature-count-based mana abilities FIRST
  // These are special scaling mana abilities (Karametra's Acolyte, Priest of Titania, etc.)
  // ========================================================================
  let devotionMana = getDevotionManaAmount(game.state, permanent, pid);
  let creatureCountMana = shouldSkipScalingManaForColorlessTap({
    cardName,
    selectedAbilityText: '',
    oracleText: String(card?.oracle_text || ''),
  })
    ? null
    : getCreatureCountManaAmount(game.state, permanent, pid);
  
  // Debug logging for devotion mana
  if (cardName.toLowerCase().includes('karametra') || cardName.toLowerCase().includes('acolyte')) {
    debug(2, `[tapPermanent] ${cardName} devotion check:`, {
      devotionMana,
      creatureCountMana,
      hasDevotionMana: !!devotionMana,
      devotionAmount: devotionMana?.amount,
      permanentController: pid,
      cardName: cardName,
    });
  }
  
  // Get mana abilities for this permanent (includes granted abilities from Cryptolith Rite, etc.)
  const manaAbilities = getManaAbilitiesForPermanent(game.state, permanent, pid);
  
  // ========================================================================
  // Calculate mana multiplier from effects like Mana Reflection, Nyxbloom Ancient
  // ========================================================================
  const manaMultiplier = getManaMultiplier(game.state, permanent, pid);
  
  // Check for Virtue of Strength (only affects basic lands)
  let effectiveMultiplier = manaMultiplier;
  if (manaMultiplier > 1 && !isBasic) {
    // Check if Virtue of Strength is the source of the multiplier
    const modifiers = detectManaModifiers(game.state, pid);
    const virtueModifier = modifiers.find(m => 
      m.cardName.toLowerCase().includes('virtue of strength') && 
      m.type === 'mana_multiplier'
    );
    if (virtueModifier) {
      // Virtue only affects basic lands - recalculate without it
      const otherMultiplier = modifiers
        .filter(m => m.type === 'mana_multiplier' && m.cardName !== virtueModifier.cardName)
        .reduce((acc, m) => acc * (m.multiplier || 1), 1);
      effectiveMultiplier = isBasic ? manaMultiplier : otherMultiplier;
    }
  }
  
  if (manaAbilities.length > 0 || devotionMana || creatureCountMana) {
    // Permanent has mana abilities - add mana to the pool
    // Initialize mana pool if needed
    game.state.manaPool = game.state.manaPool || {};
    game.state.manaPool[pid] = game.state.manaPool[pid] || {
      white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0
    };
    
    // Map mana color codes to pool keys
    const colorToPoolKey: Record<string, string> = {
      'W': 'white',
      'U': 'blue',
      'B': 'black',
      'R': 'red',
      'G': 'green',
      'C': 'colorless',
    };
    
    // ========================================================================
    // Handle devotion-based mana abilities (Karametra's Acolyte, etc.)
    // ========================================================================
    if (devotionMana && devotionMana.amount > 0) {
      const baseAmount = devotionMana.amount;
      const totalAmount = baseAmount * effectiveMultiplier;
      const poolKey = colorToPoolKey[devotionMana.color] || 'green';
      (game.state.manaPool[pid] as any)[poolKey] += totalAmount;
      recordAddedMana(poolKey, totalAmount);
      if (isTreasureSource) {
        try {
          recordTreasureManaProduced(game.state, String(pid), String(poolKey) as any, totalAmount);
        } catch {}
      }
      
      io.to(gameId).emit("chat", {
        id: `m_${Date.now()}`,
        gameId,
        from: "system",
        message: effectiveMultiplier > 1 
          ? `${getPlayerName(game, pid)} tapped ${cardName} for ${totalAmount} {${devotionMana.color}} mana (devotion ${baseAmount} × ${effectiveMultiplier}).`
          : `${getPlayerName(game, pid)} tapped ${cardName} for ${totalAmount} {${devotionMana.color}} mana (devotion: ${baseAmount}).`,
        ts: Date.now(),
      });
      
      broadcastManaPoolUpdate(io, gameId, pid, game.state.manaPool[pid] as any, `Tapped ${cardName}`, game);
    }
    // ========================================================================
    // Handle creature-count-based mana abilities (Priest of Titania, Elvish Archdruid, etc.)
    // ========================================================================
    else if (creatureCountMana && (
      creatureCountMana.amount > 0
      || (creatureCountMana as any).requiresColorChoice === true
      || Boolean((creatureCountMana as any).activationCost)
    )) {
      const baseAmount = creatureCountMana.amount;
      const totalAmount = baseAmount * effectiveMultiplier;
      
      // Handle activation cost (like Three Tree City's {2})
      if ((creatureCountMana as any).activationCost) {
        const activationCost = (creatureCountMana as any).activationCost;
        recordedManaCost = activationCost;
        const parsedCost = parseManaCost(activationCost);
        const pool = getOrInitManaPool(game.state, pid);
        const totalAvailable = calculateTotalAvailableMana(pool, []);
        
        // Validate mana payment
        const validationError = validateManaPayment(totalAvailable, parsedCost.colors, parsedCost.generic);
        if (validationError) {
          (permanent as any).tapped = false;
          if (battlefieldIndex >= 0) {
            battlefield[battlefieldIndex].tapped = false;
          }
          socket.emit("error", {
            code: "INSUFFICIENT_MANA",
            message: `Cannot pay activation cost ${activationCost}: ${validationError}`,
          });
          return;
        }
        
        // Consume mana for activation cost
        consumeManaFromPool(pool, parsedCost.colors, parsedCost.generic, `[tapPermanent:${cardName}]`);
        
        io.to(gameId).emit("chat", {
          id: `m_${Date.now()}`,
          gameId,
          from: "system",
          message: `${getPlayerName(game, pid)} paid ${activationCost} for ${cardName}'s ability.`,
          ts: Date.now(),
        });
      }
      
      // Handle special 'any_combination' color (like Selvala)
      // 'any_one_color' (Three Tree City, White Lotus Tile)
      // and restricted combinations (Vivi Ornitier)
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
          return;
        }

        // Resolution Queue: request a color choice from player
        const oracleSpendRestriction = parseManaSpendRestrictionFromOracle(
          String(permanent?.card?.oracle_text || ''),
        );
        ResolutionQueueManager.addStep(gameId, {
          type: ResolutionStepType.MANA_COLOR_SELECTION,
          playerId: pid as PlayerID,
          sourceId: permanentId,
          sourceName: cardName,
          sourceImage: (permanent.card as any)?.image_uris?.small || (permanent.card as any)?.image_uris?.normal,
          description: combinationFields.description,
          mandatory: true,
          selectionKind: combinationFields.selectionKind,
          permanentId,
          cardName,
          ...(combinationFields.amount != null ? { amount: combinationFields.amount } : null),
          ...(combinationFields.totalAmount != null ? { totalAmount: combinationFields.totalAmount } : null),
          ...(combinationFields.availableColors ? { availableColors: combinationFields.availableColors } : null),
          allowedColors: combinationFields.allowedColors,
          singleColor: combinationFields.selectionKind === 'any_color',
          dynamicAmountSource: (creatureCountMana as any).dynamicAmountSource,
          manaMultiplier: effectiveMultiplier,
          ...(oracleSpendRestriction
            ? {
                manaRestriction: oracleSpendRestriction.restriction,
                manaRestrictedTo: oracleSpendRestriction.restrictedTo,
              }
            : null),
        } as any);
        
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
        return; // Exit early - wait for color choice
      } else {
        const poolKey = colorToPoolKey[creatureCountMana.color] || 'green';
        const fixedSpendRestriction = parseManaSpendRestrictionFromOracle(
          String(permanent?.card?.oracle_text || ''),
        );
        if (fixedSpendRestriction) {
          addRestrictedManaToPool(
            game.state,
            pid,
            poolKey as any,
            totalAmount,
            fixedSpendRestriction.restriction,
            fixedSpendRestriction.restrictedTo,
            String(permanentId),
            cardName,
          );
        } else {
          (game.state.manaPool[pid] as any)[poolKey] += totalAmount;
        }
        recordAddedMana(poolKey, totalAmount);
        if (isTreasureSource) {
          try {
            recordTreasureManaProduced(game.state, String(pid), String(poolKey) as any, totalAmount);
          } catch {}
        }
        
        io.to(gameId).emit("chat", {
          id: `m_${Date.now()}`,
          gameId,
          from: "system",
          message: effectiveMultiplier > 1 
            ? `${getPlayerName(game, pid)} tapped ${cardName} for ${totalAmount} {${creatureCountMana.color}} mana (count ${baseAmount} × ${effectiveMultiplier}).`
            : `${getPlayerName(game, pid)} tapped ${cardName} for ${totalAmount} {${creatureCountMana.color}} mana.`,
          ts: Date.now(),
        });
        
        broadcastManaPoolUpdate(io, gameId, pid, game.state.manaPool[pid] as any, `Tapped ${cardName}`, game);
      }
    }
    // ========================================================================
    // Handle standard mana abilities (lands, mana dorks, rocks)
    // ========================================================================
    else if (manaAbilities.length > 0) {
      const {
        ability,
        produces,
        baseAmount,
        producesAllAtOnce,
      } = resolveManaAbilityActivationShape(
        game.state,
        permanent,
        pid,
        '',
        '',
        '',
        '',
      );
      
      if (produces.length > 0) {
        // ========================================================================
        // Handle additional costs (pay life, etc.) for this ability
        // ========================================================================
        if (ability.additionalCosts && ability.additionalCosts.length > 0) {
          for (const cost of ability.additionalCosts) {
            if (cost.type === 'pay_life' && cost.amount) {
              // Check if player has enough life
              const currentLife = game.state.life?.[pid] || 40;
              if (currentLife <= cost.amount) {
                socket.emit("error", {
                  code: "INSUFFICIENT_LIFE",
                  message: `Cannot pay ${cost.amount} life (you have ${currentLife} life)`,
                });
                return;
              }
              
              // Pay the life cost
              if (!game.state.life) game.state.life = {};
              game.state.life[pid] = currentLife - cost.amount;
              recordedLifeLost += Number(cost.amount) || 0;
              if (recordedLifeLossIsDamage !== true) {
                recordedLifeLossIsDamage = false;
              }

              // Track life lost this turn.
              try {
                (game.state as any).lifeLostThisTurn = (game.state as any).lifeLostThisTurn || {};
                (game.state as any).lifeLostThisTurn[String(pid)] = ((game.state as any).lifeLostThisTurn[String(pid)] || 0) + Number(cost.amount);
              } catch {}
              
              io.to(gameId).emit("chat", {
                id: `m_${Date.now()}`,
                gameId,
                from: "system",
                message: `${getPlayerName(game, pid)} paid ${cost.amount} life (${currentLife} → ${game.state.life[pid]}).`,
                ts: Date.now(),
              });
            }
          }
        }
        
        // ========================================================================
        // Handle damage effects (pain lands like Adarkar Wastes)
        // ========================================================================
        if (ability.damageEffect && ability.damageEffect.type === 'damage_self') {
          const damageAmount = ability.damageEffect.amount;
          const currentLife = game.state.life?.[pid] || 40;
          
          if (!game.state.life) game.state.life = {};
          game.state.life[pid] = currentLife - damageAmount;
          recordedLifeLost += Number(damageAmount) || 0;
          recordedLifeLossIsDamage = true;

          // Track per-turn damage and life lost.
          try {
            (game.state as any).damageTakenThisTurnByPlayer = (game.state as any).damageTakenThisTurnByPlayer || {};
            (game.state as any).damageTakenThisTurnByPlayer[String(pid)] =
              ((game.state as any).damageTakenThisTurnByPlayer[String(pid)] || 0) + Number(damageAmount || 0);
            notifyNoncombatPlayerDamage(game as any, String(pid), Number(damageAmount || 0));

            (game.state as any).lifeLostThisTurn = (game.state as any).lifeLostThisTurn || {};
            (game.state as any).lifeLostThisTurn[String(pid)] =
              ((game.state as any).lifeLostThisTurn[String(pid)] || 0) + Number(damageAmount || 0);
          } catch {}
          
          io.to(gameId).emit("chat", {
            id: `m_${Date.now()}`,
            gameId,
            from: "system",
            message: `${cardName} deals ${damageAmount} damage to ${getPlayerName(game, pid)} (${currentLife} → ${game.state.life[pid]}).`,
            ts: Date.now(),
          });
        }
        
        // ========================================================================
        // Check if this ability produces ALL colors at once (like bounce lands)
        // If producesAllAtOnce is true, add all mana at once without prompting
        // ========================================================================
        if (producesAllAtOnce && produces.length > 1) {
          // Multi-mana producer like Rakdos Carnarium - add ALL colors at once
          const manaAdded: string[] = [];
          const amountPerColor = produces.length > 0
            ? Math.max(1, Math.floor(baseAmount / produces.length))
            : 1;
          
          for (const manaColor of produces) {
            const poolKey = colorToPoolKey[manaColor] || 'colorless';
            (game.state.manaPool[pid] as any)[poolKey] += amountPerColor * effectiveMultiplier;
            recordAddedMana(poolKey, amountPerColor * effectiveMultiplier);
            if (isTreasureSource) {
              try {
                recordTreasureManaProduced(game.state, String(pid), String(poolKey) as any, amountPerColor * effectiveMultiplier);
              } catch {}
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
          
          // Broadcast mana pool update
          broadcastManaPoolUpdate(io, gameId, pid, game.state.manaPool[pid] as any, `Tapped ${cardName}`, game);
        }
        // If produces multiple colors but NOT all at once (like "any color"), prompt user for choice
        else if (produces.length > 1) {
          const totalAmount = baseAmount * effectiveMultiplier;
          
          // Get extra mana from effects like Caged Sun, Nissa, Crypt Ghast
          const extraMana = getExtraManaProduction(game.state, permanent, pid, produces[0]);
          const totalExtra = extraMana.reduce((acc, e) => acc + e.amount, 0);
          const finalTotal = totalAmount + totalExtra;
          const tapManaProduction = calculateManaProduction(game.state, permanent, pid);
          const bonusAnyAmount = getAnyColorBonusManaAmount(tapManaProduction);
          
          // Resolution Queue: request a color choice from player
          ResolutionQueueManager.addStep(gameId, {
            type: ResolutionStepType.MANA_COLOR_SELECTION,
            playerId: pid as PlayerID,
            sourceId: permanentId,
            sourceName: cardName,
            sourceImage: (permanent.card as any)?.image_uris?.small || (permanent.card as any)?.image_uris?.normal,
            description: `Choose a color for ${cardName}'s mana.`,
            mandatory: true,
            selectionKind: 'any_color',
            permanentId,
            cardName,
            amount: finalTotal,
            allowedColors: produces.filter((color) => ['W', 'U', 'B', 'R', 'G'].includes(String(color || '').toUpperCase())),
            ...getChosenTypeManaSelectionFields(ability),
          } as any);

          if (bonusAnyAmount > 0) {
            queueAnyColorBonusManaSelection({
              gameId,
              playerId: pid as PlayerID,
              permanentId,
              cardName,
              permanent,
              amount: bonusAnyAmount,
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
          return; // Exit early - wait for color choice
        } else {
          // Single color production
          const manaColor = produces[0];
          const poolKey = colorToPoolKey[manaColor] || 'colorless';
          
          // Calculate base amount with multiplier
          // Use ability.amount if specified (e.g., Sol Ring produces 2), default to 1
          const baseAmount = ability.amount ?? 1;
          let totalAmount = baseAmount * effectiveMultiplier;
          
          // ========================================================================
          // Apply extra mana from effects like:
          // - Caged Sun: +1 mana of chosen color when tapping lands for that color
          // - Nissa, Who Shakes the World: Forests produce +1 green
          // - Crypt Ghast: Swamps produce +1 black
          // - Zendikar Resurgent: Lands produce +1 of same color
          // - Mana Flare: Lands produce +1 of same color (all players)
          // ========================================================================
          const extraMana = getExtraManaProduction(game.state, permanent, pid, manaColor);
          for (const extra of extraMana) {
            const extraPoolKey = colorToPoolKey[extra.color] || poolKey;
            (game.state.manaPool[pid] as any)[extraPoolKey] += extra.amount;
            recordAddedMana(extraPoolKey, extra.amount);
            if (isTreasureSource) {
              try {
                recordTreasureManaProduced(game.state, String(pid), String(extraPoolKey) as any, extra.amount);
              } catch {}
            }
            totalAmount += extra.amount;
          }
          
          // Add the base mana (after multiplier)
          (game.state.manaPool[pid] as any)[poolKey] += baseAmount * effectiveMultiplier;
          recordAddedMana(poolKey, baseAmount * effectiveMultiplier);
          if (isTreasureSource) {
            try {
              recordTreasureManaProduced(game.state, String(pid), String(poolKey) as any, baseAmount * effectiveMultiplier);
            } catch {}
          }
          
          // Generate descriptive message
          let message = `${getPlayerName(game, pid)} tapped ${cardName}`;
          if (effectiveMultiplier > 1 && extraMana.length > 0) {
            message += ` for ${totalAmount} {${manaColor}} mana (×${effectiveMultiplier} + ${extraMana.length} extra).`;
          } else if (effectiveMultiplier > 1) {
            message += ` for ${totalAmount} {${manaColor}} mana (×${effectiveMultiplier}).`;
          } else if (extraMana.length > 0) {
            message += ` for ${totalAmount} {${manaColor}} mana (+${extraMana.reduce((a, e) => a + e.amount, 0)} extra).`;
          } else if (baseAmount > 1) {
            message += ` for ${baseAmount} {${manaColor}} mana.`;
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
          
          // Broadcast mana pool update
          broadcastManaPoolUpdate(io, gameId, pid, game.state.manaPool[pid] as any, `Tapped ${cardName}`, game);

          const tapManaProduction = calculateManaProduction(game.state, permanent, pid, manaColor);
          const bonusAnyAmount = getAnyColorBonusManaAmount(tapManaProduction);
          if (bonusAnyAmount > 0) {
            queueAnyColorBonusManaSelection({
              gameId,
              playerId: pid as PlayerID,
              permanentId,
              cardName,
              permanent,
              amount: bonusAnyAmount,
            });
            broadcastGame(io, game, gameId);
            return;
          }
        }
      }
    }
  }
  
  if (typeof game.bumpSeq === "function") {
    game.bumpSeq();
  }

  queueTapTriggersForTappedPermanents(io, game, gameId, [String(permanentId)], String(pid));
  
      appendEvent(gameId, (game as any).seq ?? 0, "tapPermanent", {
        playerId: pid,
        permanentId,
        addedMana: Object.keys(recordedAddedMana).length > 0 ? { ...recordedAddedMana } : undefined,
        manaCost: recordedManaCost || undefined,
        lifeLost: recordedLifeLost > 0 ? recordedLifeLost : undefined,
        lifeLossIsDamage: recordedLifeLost > 0 ? recordedLifeLossIsDamage : undefined,
      });
  
  broadcastGame(io, game, gameId);
}
