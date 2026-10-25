/**
 * Origin parent: server/src/socket/interaction.ts
 *
 * Cluster moved: activateBattlefieldAbility mana-ability family (tap-mana-* /
 * native_* plus Doubling Cube).
 *
 * Public entry symbols: tryHandleActivateMana.
 */

import { notifyNoncombatPlayerDamage } from '../../state/modules/triggers/player-dealt-damage-ir.js';
import type { PlayerID } from "../../../../shared/src/index.js";
import type { ActivatedAbilityConditionRequirement } from "../../state/modules/activated-ability-conditions.js";
import { detectActivatedAbilityConditionRequirement } from "../../state/modules/activated-ability-conditions.js";
import { getActiveAbilityConditions } from "../../state/modules/game-state-effects.js";
import { getManaAbilitiesForPermanent, resolvePermanentChosenColorSymbol } from "../../state/modules/mana-abilities";
import { createResolutionStep, ResolutionQueueManager, ResolutionStepType } from "../../state/resolution/index.js";
import { appendEvent } from "../../db";
import { debug, debugWarn } from "../../utils/debug.js";
import {
  broadcastGame,
  broadcastManaPoolUpdate,
  calculateManaProduction,
  getPlayerName,
} from "../util";
import type { ActivateBattlefieldAbilityContext } from "./interactionActivateBattlefieldAbilityContext.js";
import {
  getAnyColorBonusManaAmount,
  getChosenTypeManaSelectionFields,
  queueAnyColorBonusManaSelection,
} from "./interactionManaAbilityActivationShape.js";
import { getLifePaymentForActivationCost } from "./interactionSpecialLandAndHideaway.js";

export async function tryHandleActivateMana(
  ctx: ActivateBattlefieldAbilityContext,
  getManaAbilityLifeEffect: (card: any, producesColoredMana: boolean) => { amount: number; isDamage: boolean },
  getActivatedAbilityConditionErrorPayload: (
    requirement: ActivatedAbilityConditionRequirement,
    game: any,
    playerId: string,
    cardName: string,
  ) => { code: string; message: string },
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
    typeLine,
  } = ctx;

  // Handle mana abilities (tap-mana-* or native_*)
  if (!abilityId.includes('-ability-') && (abilityId.startsWith("tap-mana") || abilityId.startsWith("native_"))) {
    // Validate: permanent must not be tapped
    if ((permanent as any).tapped) {
      socket.emit("error", {
        code: "ALREADY_TAPPED",
        message: `${cardName} is already tapped`,
      });
      return true;
    }
    
    // Check for Metalcraft requirement (Mox Opal)
    // Rule 702.80 - Metalcraft abilities only work if you control 3+ artifacts
    const manaAbilityRequirement = detectActivatedAbilityConditionRequirement(oracleText);
    if (manaAbilityRequirement) {
      const activeConditions = getActiveAbilityConditions(game as any, pid);
      if (!activeConditions[manaAbilityRequirement.key]) {
        socket.emit("error", getActivatedAbilityConditionErrorPayload(manaAbilityRequirement, game, pid, cardName));
        return true;
      }
    }
    
    // Determine mana color from ability ID
    let manaColor = "colorless";
    const manaColorMap: Record<string, string> = {
      "tap-mana-w": "W",
      "tap-mana-u": "U",
      "tap-mana-b": "B",
      "tap-mana-r": "R",
      "tap-mana-g": "G",
      "tap-mana-any": "any", // Will need to prompt for color choice
      "tap-mana": "C",
      "native_w": "W",
      "native_u": "U",
      "native_b": "B",
      "native_r": "R",
      "native_g": "G",
      "native_c": "C",
      "native_any": "any", // Will need to prompt for color choice
      "native_chosen_color": resolvePermanentChosenColorSymbol(permanent) || "any",
      "native_commander_any": "any", // Commander color identity restriction resolved in calculateManaProduction
    };
    manaColor = manaColorMap[abilityId] || (abilityId.startsWith('native_commander_any') ? 'any' : "C");
    
    // Calculate actual mana production (handles multipliers, enchantments, etc.)
    const manaProduction = calculateManaProduction(game.state, permanent, pid, manaColor, abilityId);
    const lifePaymentForCost = getLifePaymentForActivationCost(manaProduction.activationCost);

    if (lifePaymentForCost > 0) {
      const currentLife = Number((game.state as any)?.life?.[pid] ?? game.state.startingLife ?? 40);
      if (!Number.isFinite(currentLife) || currentLife < lifePaymentForCost) {
        socket.emit('error', {
          code: 'INSUFFICIENT_LIFE',
          message: `Need to pay ${lifePaymentForCost} life to activate ${cardName}.`,
        });
        return true;
      }
    }

    // Tap the permanent
    (permanent as any).tapped = true;
    
    // Add mana to pool
    game.state.manaPool = game.state.manaPool || {};
    game.state.manaPool[pid] = game.state.manaPool[pid] || {
      white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0
    };
    
    // Add the calculated amount of mana
    const actualColor = manaProduction.colors[0] || manaColor;
    const manaAmount = manaProduction.totalAmount;
    
    // If producing "any" color mana, prompt user for color choice
    if (manaColor === 'any' || manaProduction.requiresColorChoice === true || actualColor === 'any') {
      const rawManaLifeEffect = getManaAbilityLifeEffect(permanent.card, true);
      const manaLifeEffect = rawManaLifeEffect.isDamage || lifePaymentForCost <= 0
        ? rawManaLifeEffect
        : { amount: 0, isDamage: false };
      const allowedColors = Array.isArray(manaProduction.colors)
        ? manaProduction.colors.filter((color) => ['W', 'U', 'B', 'R', 'G'].includes(String(color || '').toUpperCase()))
        : [];
      const activatedManaAbilities = getManaAbilitiesForPermanent(game.state, permanent, pid);
      const activatedManaAbility = activatedManaAbilities.find((entry) => entry.id === abilityId) || activatedManaAbilities[0];
      const queuedManaChoiceStep = createResolutionStep({
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
        amount: manaAmount,
        allowedColors: allowedColors.length > 0 ? allowedColors : undefined,
        abilityId,
        ...getChosenTypeManaSelectionFields(activatedManaAbility),
        lifeToPayForCost: lifePaymentForCost > 0 ? lifePaymentForCost : undefined,
        tappedPermanentsForCost: [permanentId],
        manaLifeLossAmount: manaLifeEffect.amount > 0 ? manaLifeEffect.amount : undefined,
        manaLifeLossIsDamage: manaLifeEffect.amount > 0 ? manaLifeEffect.isDamage : undefined,
      } as any);

      try {
        appendEvent(gameId, (game as any).seq ?? 0, 'activateBattlefieldAbility', {
          playerId: pid,
          permanentId,
          abilityId,
          cardName,
          tappedPermanents: [permanentId],
          queuedResolutionStep: queuedManaChoiceStep,
        });
      } catch (err) {
        debugWarn(1, '[activateBattlefieldAbility] appendEvent(any-color mana queued step) failed:', err);
      }

      ResolutionQueueManager.addStep(gameId, queuedManaChoiceStep as any);

      const bonusAnyAmount = getAnyColorBonusManaAmount(manaProduction);
      if (bonusAnyAmount > 0) {
        queueAnyColorBonusManaSelection({
          gameId,
          playerId: pid as PlayerID,
          permanentId,
          cardName,
          permanent,
          amount: bonusAnyAmount,
          abilityId,
        });
      }
      
      broadcastGame(io, game, gameId);
      return true;
    }
    
    const colorToPoolKey: Record<string, string> = {
      'W': 'white',
      'U': 'blue',
      'B': 'black',
      'R': 'red',
      'G': 'green',
      'C': 'colorless',
      // Note: 'any' color is now handled above by prompting for color choice
    };

    const addsAllColorsAtOnce = Array.isArray(manaProduction.colors)
      && !manaProduction.requiresColorChoice
      && manaProduction.colors.length > 1;
    const addedMana: Record<string, number> = {};
    let persistedManaColor = actualColor;
    let manaDescription = '';

    if (addsAllColorsAtOnce) {
      const amountPerColor = Math.max(1, Math.floor(manaAmount / manaProduction.colors.length));
      for (const manaSymbol of manaProduction.colors) {
        const normalizedManaSymbol = String(manaSymbol || '').toUpperCase();
        const poolKey = String(colorToPoolKey[normalizedManaSymbol] || 'colorless');
        (game.state.manaPool[pid] as any)[poolKey] = ((game.state.manaPool[pid] as any)[poolKey] || 0) + amountPerColor;
        addedMana[poolKey] = Number(addedMana[poolKey] || 0) + amountPerColor;
      }

      persistedManaColor = 'MULTI';
      manaDescription = manaProduction.colors
        .map((manaSymbol) => `{${String(manaSymbol || '').toUpperCase()}}`.repeat(amountPerColor))
        .join('');
    } else {
      const poolKey = String(colorToPoolKey[actualColor] || 'colorless');
      (game.state.manaPool[pid] as any)[poolKey] = ((game.state.manaPool[pid] as any)[poolKey] || 0) + manaAmount;
      addedMana[poolKey] = manaAmount;
      manaDescription = manaAmount > 1 
        ? `${manaAmount} ${actualColor === 'C' ? 'colorless' : actualColor} mana`
        : `${actualColor === 'C' ? 'colorless' : actualColor} mana`;
    }
    
    io.to(gameId).emit("chat", {
      id: `m_${Date.now()}`,
      gameId,
      from: "system",
      message: `${getPlayerName(game, pid)} tapped ${cardName} for ${manaDescription}.`,
      ts: Date.now(),
    });
    
    const rawManaLifeEffect = getManaAbilityLifeEffect(permanent.card, actualColor !== 'C');
    const manaLifeEffect = rawManaLifeEffect.isDamage || lifePaymentForCost <= 0
      ? rawManaLifeEffect
      : { amount: 0, isDamage: false };
    if (lifePaymentForCost > 0) {
      game.state.life = game.state.life || {};
      const startingLife = game.state.startingLife || 40;
      const currentLife = game.state.life[pid] ?? startingLife;
      game.state.life[pid] = currentLife - lifePaymentForCost;

      try {
        (game.state as any).lifeLostThisTurn = (game.state as any).lifeLostThisTurn || {};
        (game.state as any).lifeLostThisTurn[String(pid)] =
          ((game.state as any).lifeLostThisTurn[String(pid)] || 0) + lifePaymentForCost;
      } catch {}

      const player = (game.state.players || []).find((p: any) => p.id === pid);
      if (player) {
        player.life = game.state.life[pid];
      }
    }

    if (manaLifeEffect.amount > 0) {
      game.state.life = game.state.life || {};
      const startingLife = game.state.startingLife || 40;
      const currentLife = game.state.life[pid] ?? startingLife;
      game.state.life[pid] = currentLife - manaLifeEffect.amount;

      try {
        if (manaLifeEffect.isDamage) {
          (game.state as any).damageTakenThisTurnByPlayer = (game.state as any).damageTakenThisTurnByPlayer || {};
          (game.state as any).damageTakenThisTurnByPlayer[String(pid)] =
            ((game.state as any).damageTakenThisTurnByPlayer[String(pid)] || 0) + manaLifeEffect.amount;
          notifyNoncombatPlayerDamage(game as any, String(pid), manaLifeEffect.amount);
        }

        (game.state as any).lifeLostThisTurn = (game.state as any).lifeLostThisTurn || {};
        (game.state as any).lifeLostThisTurn[String(pid)] =
          ((game.state as any).lifeLostThisTurn[String(pid)] || 0) + manaLifeEffect.amount;
      } catch {}

      const player = (game.state.players || []).find((p: any) => p.id === pid);
      if (player) {
        player.life = game.state.life[pid];
      }

      io.to(gameId).emit("chat", {
        id: `m_${Date.now()}`,
        gameId,
        from: "system",
        message: manaLifeEffect.isDamage
          ? `${cardName} dealt ${manaLifeEffect.amount} damage to ${getPlayerName(game, pid)} (${currentLife} → ${game.state.life[pid]}).`
          : `${getPlayerName(game, pid)} pays ${manaLifeEffect.amount} life for ${cardName} (${currentLife} → ${game.state.life[pid]}).`,
        ts: Date.now(),
      });
    }
    
    // ===== FORBIDDEN ORCHARD TRIGGER =====
    // "When you tap Forbidden Orchard for mana, target opponent creates a 1/1 colorless Spirit creature token."
    const lowerCardName = cardName.toLowerCase();
    if (lowerCardName === 'forbidden orchard') {
      // Get opponents from game.state.players
      const players = game.state?.players || [];
      const opponents = players.filter((p: any) => p?.id != null && p.id !== pid && !p.hasLost);
      
      if (opponents.length > 0) {
        // Queue opponent choice via the generic option-choice flow.
        ResolutionQueueManager.addStep(gameId, {
          type: ResolutionStepType.OPTION_CHOICE,
          playerId: pid as PlayerID,
          sourceId: permanentId,
          sourceName: 'Forbidden Orchard',
          sourceImage: card?.image_uris?.small || card?.image_uris?.normal,
          description: 'Choose target opponent to create a 1/1 colorless Spirit creature token.',
          mandatory: true,
          options: opponents.map((p: any) => ({
            id: String(p.id),
            label: String(p.name || p.id),
          })),
          minSelections: 1,
          maxSelections: 1,
          forbiddenOrchardTargetChoice: true,
          permanentId,
          cardName: 'Forbidden Orchard',
        });
        
        debug(2, `[activateBattlefieldAbility] Forbidden Orchard: queued target opponent selection for ${pid}`);
        // Do not return early; mana ability processing continues, but the game enters resolution mode.
      }
    }
    
    if (typeof game.bumpSeq === "function") {
      game.bumpSeq();
    }

    const bonusAnyAmount = getAnyColorBonusManaAmount(manaProduction);
    if (bonusAnyAmount > 0) {
      queueAnyColorBonusManaSelection({
        gameId,
        playerId: pid as PlayerID,
        permanentId,
        cardName,
        permanent,
        amount: bonusAnyAmount,
        abilityId,
      });
    }
    
    // Broadcast mana pool update to ensure client sees the new floating mana
    broadcastManaPoolUpdate(io, gameId, pid, game.state.manaPool[pid] as any, `Tapped ${cardName}`, game);

    // Intervening-if support: mark that this ability produced mana this turn (best-effort).
    try {
      const stateAny = game.state as any;
      stateAny.addedManaWithThisAbilityThisTurn = stateAny.addedManaWithThisAbilityThisTurn || {};
      stateAny.addedManaWithThisAbilityThisTurn[String(pid)] = stateAny.addedManaWithThisAbilityThisTurn[String(pid)] || {};
      const permKey = String(permanentId);
      const abilityKeyRaw = abilityId != null ? String(abilityId) : '';
      const k = abilityKeyRaw ? `${permKey}:${abilityKeyRaw}` : permKey;
      (stateAny.addedManaWithThisAbilityThisTurn[String(pid)] as any)[k] = true;
    } catch {}

    if (lifePaymentForCost > 0) {
      appendEvent(gameId, (game as any).seq ?? 0, "activateBattlefieldAbility", {
        playerId: pid,
        permanentId,
        abilityId,
        cardName,
        abilityText: '',
        activatedAbilityText: '',
        usesStack: false,
        tappedPermanents: [permanentId],
        lifePaidForCost: lifePaymentForCost,
      });
    }
    
    appendEvent(gameId, (game as any).seq ?? 0, "activateManaAbility", {
      playerId: pid,
      permanentId,
      abilityId,
      manaColor: persistedManaColor,
      addedMana,
      lifeLost: manaLifeEffect.amount || undefined,
      lifeLossIsDamage: manaLifeEffect.amount ? manaLifeEffect.isDamage === true : undefined,
    });
    
    broadcastGame(io, game, gameId);
    return true;
  }
  
  // Handle Doubling Cube: "{3}, {T}: Double the amount of each type of mana in your mana pool"
  if (cardName.toLowerCase().includes('doubling cube') || 
      (oracleText.includes('double') && oracleText.includes('mana') && oracleText.includes('mana pool'))) {
    // Validate: permanent must not be tapped
    if ((permanent as any).tapped) {
      socket.emit("error", {
        code: "ALREADY_TAPPED",
        message: `${cardName} is already tapped`,
      });
      return true;
    }
    
    // Check if player can pay {3}
    const manaPool = game.state.manaPool[pid] || {
      white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0
    };
    
    const totalMana = manaPool.white + manaPool.blue + manaPool.black + 
                      manaPool.red + manaPool.green + manaPool.colorless;
    
    if (totalMana < 3) {
      socket.emit("error", {
        code: "INSUFFICIENT_MANA",
        message: `Not enough mana to activate ${cardName}. Need {3}, have ${totalMana}`,
      });
      return true;
    }
    
    // Consume {3} generic mana from pool (prioritize colorless, then colors)
    let remaining = 3;
    const poolCopy = { ...manaPool };
    
    // First use colorless
    const colorlessUsed = Math.min(remaining, poolCopy.colorless);
    poolCopy.colorless -= colorlessUsed;
    remaining -= colorlessUsed;
    
    // Then use colors if needed
    if (remaining > 0) {
      const colors = ['white', 'blue', 'black', 'red', 'green'] as const;
      for (const color of colors) {
        if (remaining <= 0) break;
        const used = Math.min(remaining, poolCopy[color]);
        poolCopy[color] -= used;
        remaining -= used;
      }
    }
    
    // Double all remaining mana in the pool
    game.state.manaPool[pid] = {
      white: poolCopy.white * 2,
      blue: poolCopy.blue * 2,
      black: poolCopy.black * 2,
      red: poolCopy.red * 2,
      green: poolCopy.green * 2,
      colorless: poolCopy.colorless * 2,
    };
    
    // Tap the permanent
    (permanent as any).tapped = true;
    
    io.to(gameId).emit("chat", {
      id: `m_${Date.now()}`,
      gameId,
      from: "system",
      message: `${getPlayerName(game, pid)} activated ${cardName}, doubling their mana pool.`,
      ts: Date.now(),
    });
    
    if (typeof game.bumpSeq === "function") {
      game.bumpSeq();
    }
    
    // Broadcast mana pool update
    broadcastManaPoolUpdate(io, gameId, pid, game.state.manaPool[pid] as any, `Activated ${cardName}`, game);
    
    appendEvent(gameId, (game as any).seq ?? 0, "activateDoublingCube", { playerId: pid, permanentId });
    
    broadcastGame(io, game, gameId);
    return true;
  }

  return false;
}
