/**
 * Origin parent: server/src/socket/interaction.ts
 *
 * Cluster moved: activateBattlefieldAbility level-up, outlast, monstrosity,
 * adapt, and creature-upgrade families.
 *
 * Public entry symbols: tryHandleActivateLevelOutlastUpgrade.
 */

import { parseUpgradeAbilities as parseCreatureUpgradeAbilities } from "../../../../rules-engine/src/creatureUpgradeAbilities";
import { appendEvent } from "../../db";
import { triggerAbilityActivatedTriggers } from "../../state/modules/triggers/ability-activated.js";
import { notifySpellOrAbilityPutOnStack } from "../../state/modules/stackPutNotify.js";
import {
  broadcastGame,
  calculateTotalAvailableMana,
  consumeManaFromPool,
  getOrInitManaPool,
  getPlayerName,
  parseManaCost,
  validateAndConsumeManaCostFromPool,
  validateManaPayment,
} from "../util";
import type { ActivateBattlefieldAbilityContext } from "./interactionActivateBattlefieldAbilityContext.js";
import { getUpgradedCreatureTypes } from "./interactionTutorSearchCriteriaParsing.js";

export async function tryHandleActivateLevelOutlastUpgrade(
  ctx: ActivateBattlefieldAbilityContext,
  persistAbilityActivatedTriggerPushes: (gameId: string, game: any, triggeredAbilities: any[]) => void,
): Promise<boolean> {
  const {
    io,
    socket,
    game,
    gameId,
    pid,
    permanentId,
    abilityId,
    permanent,
    cardName,
    oracleText,
    scopedAbilityText,
    scopedAbilityFullText,
    isGenericActivatedAbilityId,
    splitSecondLockActive,
  } = ctx;

  // Handle Level Up abilities (Rule 702.87)
  // "Level up [cost]" means "[Cost]: Put a level counter on this permanent. Activate only as a sorcery."
  const levelUpMatch = oracleText.match(/level\s+up\s+(\{[^}]+\}(?:\{[^}]+\})*)/i);
  const isLevelUpAbility = /-level-up-(\d+)$/i.test(abilityId) || /-levelup-(\d+)$/i.test(abilityId) || abilityId === 'level-up';
  
  if (isLevelUpAbility && levelUpMatch) {
    const levelUpCost = levelUpMatch[1];
    
    // Level up is sorcery speed only (Rule 702.87a)
    const phase = (game.state as any).phase || '';
    const isMainPhase = phase.toLowerCase().includes('main');
    const stack = game.state?.stack || [];
    const activePlayer = (game.state as any).turnPlayer || (game.state as any).activePlayer;
    
    if (activePlayer !== pid) {
      socket.emit("error", {
        code: "NOT_YOUR_TURN",
        message: "Level up can only be activated on your turn (sorcery speed)",
      });
      return true;
    }
    
    if (!isMainPhase || stack.length > 0) {
      socket.emit("error", {
        code: "SORCERY_SPEED_ONLY",
        message: "Level up can only be activated at sorcery speed (main phase, empty stack)",
      });
      return true;
    }
    
    // Parse and pay the mana cost
    const parsedCost = parseManaCost(levelUpCost);
    const pool = getOrInitManaPool(game.state, pid);
    const totalAvailable = calculateTotalAvailableMana(pool, []);
    
    const validationError = validateManaPayment(totalAvailable, parsedCost.colors, parsedCost.generic);
    if (validationError) {
      socket.emit("error", { code: "INSUFFICIENT_MANA", message: validationError });
      return true;
    }
    
    consumeManaFromPool(pool, parsedCost.colors, parsedCost.generic, '[activateBattlefieldAbility:level-up]');
    
    game.state.stack = game.state.stack || [];
    const levelUpStackId = `ability_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    game.state.stack.push({
      id: levelUpStackId,
      type: 'ability',
      controller: pid,
      source: permanentId,
      sourceName: cardName,
      description: 'Put a level counter on this permanent',
      activatedAbilityText: scopedAbilityFullText,
      abilityType: 'level_up',
      levelUpParams: {
        amount: 1,
      },
    } as any);
    notifySpellOrAbilityPutOnStack(game as any, levelUpStackId);

    io.to(gameId).emit('chat', {
      id: `m_${Date.now()}`,
      gameId,
      from: 'system',
      message: `⚡ ${getPlayerName(game, pid)} activated ${cardName}'s level up ability. Ability on the stack.`,
      ts: Date.now(),
    });

    if (typeof game.bumpSeq === 'function') {
      game.bumpSeq();
    }

    appendEvent(gameId, (game as any).seq ?? 0, 'activateBattlefieldAbility', {
      playerId: pid,
      permanentId,
      abilityId,
      cardName,
      abilityText: 'Put a level counter on this permanent',
      activatedAbilityText: scopedAbilityFullText,
      abilityType: 'level_up',
      levelUpParams: {
        amount: 1,
      },
    });

    broadcastGame(io, game, gameId);
    return true;
  }
  
  // Handle Outlast abilities (Rule 702.107)
  // "Outlast [cost]" means "[Cost], {T}: Put a +1/+1 counter on this creature. Activate only as a sorcery."
  const outlastMatch = oracleText.match(/outlast\s+(\{[^}]+\}(?:\{[^}]+\})*)/i);
  const isOutlastAbility = /-outlast-(\d+)$/i.test(abilityId) || abilityId === 'outlast';
  
  if (isOutlastAbility && outlastMatch) {
    const outlastCost = outlastMatch[1];
    
    // Outlast is sorcery speed only (Rule 702.107a)
    const phase = (game.state as any).phase || '';
    const isMainPhase = phase.toLowerCase().includes('main');
    const stack = game.state?.stack || [];
    const activePlayer = (game.state as any).turnPlayer || (game.state as any).activePlayer;
    
    if (activePlayer !== pid) {
      socket.emit("error", {
        code: "NOT_YOUR_TURN",
        message: "Outlast can only be activated on your turn (sorcery speed)",
      });
      return true;
    }
    
    if (!isMainPhase || stack.length > 0) {
      socket.emit("error", {
        code: "SORCERY_SPEED_ONLY",
        message: "Outlast can only be activated at sorcery speed (main phase, empty stack)",
      });
      return true;
    }
    
    // Outlast requires tapping the creature (Rule 702.107a)
    if (permanent.tapped) {
      socket.emit("error", {
        code: "ALREADY_TAPPED",
        message: `${cardName} is already tapped and cannot use outlast`,
      });
      return true;
    }
    
    // Parse and pay the mana cost
    const parsedCost = parseManaCost(outlastCost);
    const pool = getOrInitManaPool(game.state, pid);
    const totalAvailable = calculateTotalAvailableMana(pool, []);
    
    const validationError = validateManaPayment(totalAvailable, parsedCost.colors, parsedCost.generic);
    if (validationError) {
      socket.emit("error", { code: "INSUFFICIENT_MANA", message: validationError });
      return true;
    }
    
    consumeManaFromPool(pool, parsedCost.colors, parsedCost.generic, '[activateBattlefieldAbility:outlast]');
    
    // Tap the creature as part of the cost
    permanent.tapped = true;

    game.state.stack = game.state.stack || [];
    const outlastStackId = `ability_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    game.state.stack.push({
      id: outlastStackId,
      type: 'ability',
      controller: pid,
      source: permanentId,
      sourceName: cardName,
      description: 'Put a +1/+1 counter on this creature',
      activatedAbilityText: scopedAbilityFullText,
      abilityType: 'outlast',
      outlastParams: {
        amount: 1,
        counterType: '+1/+1',
      },
    } as any);
    notifySpellOrAbilityPutOnStack(game as any, outlastStackId);

    io.to(gameId).emit('chat', {
      id: `m_${Date.now()}`,
      gameId,
      from: 'system',
      message: `⚡ ${getPlayerName(game, pid)} activated ${cardName}'s outlast ability. Ability on the stack.`,
      ts: Date.now(),
    });

    if (typeof game.bumpSeq === 'function') {
      game.bumpSeq();
    }

    appendEvent(gameId, (game as any).seq ?? 0, 'activateBattlefieldAbility', {
      playerId: pid,
      permanentId,
      abilityId,
      cardName,
      abilityText: 'Put a +1/+1 counter on this creature',
      activatedAbilityText: scopedAbilityFullText,
      abilityType: 'outlast',
      outlastParams: {
        amount: 1,
        counterType: '+1/+1',
      },
      tappedPermanents: [permanentId],
    });

    broadcastGame(io, game, gameId);
    return true;
  }

  // Handle Monstrosity abilities (Rule 702.94)
  // "{cost}: Monstrosity N" means "If this permanent isn't monstrous, put N +1/+1 counters on it and it becomes monstrous."
  const monstrosityMatch = oracleText.match(/(\{[^}]+\}(?:\{[^}]+\})*)\s*:\s*monstrosity\s+(\d+)/i);
  const isMonstrosityAbility = /-monstrosity-(\d+)$/i.test(abilityId);

  if (isMonstrosityAbility && monstrosityMatch) {
    const monstrosityCost = monstrosityMatch[1];
    const monstrosityN = parseInt(monstrosityMatch[2], 10);
    const isAlreadyMonstrous = (permanent as any).isMonstrous === true || (permanent as any).monstrous === true;

    if (isAlreadyMonstrous) {
      socket.emit("error", {
        code: "ALREADY_MONSTROUS",
        message: `${cardName} is already monstrous`,
      });
      return true;
    }

    const parsedCost = parseManaCost(monstrosityCost);
    const pool = getOrInitManaPool(game.state, pid);
    const totalAvailable = calculateTotalAvailableMana(pool, []);

    const validationError = validateManaPayment(totalAvailable, parsedCost.colors, parsedCost.generic);
    if (validationError) {
      socket.emit("error", { code: "INSUFFICIENT_MANA", message: validationError });
      return true;
    }

    consumeManaFromPool(pool, parsedCost.colors, parsedCost.generic, '[activateBattlefieldAbility:monstrosity]');

    game.state.stack = game.state.stack || [];
    const monstrosityStackId = `ability_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    game.state.stack.push({
      id: monstrosityStackId,
      type: 'ability',
      controller: pid,
      source: permanentId,
      sourceName: cardName,
      description: `Monstrosity ${monstrosityN}`,
      activatedAbilityText: scopedAbilityFullText,
      abilityType: 'monstrosity',
      monstrosityParams: {
        amount: monstrosityN,
      },
    } as any);
    notifySpellOrAbilityPutOnStack(game as any, monstrosityStackId);

    io.to(gameId).emit('chat', {
      id: `m_${Date.now()}`,
      gameId,
      from: 'system',
      message: `⚡ ${getPlayerName(game, pid)} activated ${cardName}'s monstrosity ability. Ability on the stack.`,
      ts: Date.now(),
    });

    if (typeof game.bumpSeq === 'function') {
      game.bumpSeq();
    }

    appendEvent(gameId, (game as any).seq ?? 0, 'activateBattlefieldAbility', {
      playerId: pid,
      permanentId,
      abilityId,
      cardName,
      abilityText: `Monstrosity ${monstrosityN}`,
      activatedAbilityText: scopedAbilityFullText,
      abilityType: 'monstrosity',
      monstrosityParams: {
        amount: monstrosityN,
      },
    });

    broadcastGame(io, game, gameId);
    return true;
  }

  // Handle Adapt abilities (Rule 702.140)
  // "{cost}: Adapt N" means "If this permanent has no +1/+1 counters on it, put N +1/+1 counters on it."
  const adaptMatch = oracleText.match(/(\{[^}]+\}(?:\{[^}]+\})*)\s*:\s*adapt\s+(\d+)/i);
  const isAdaptAbility = /-adapt-(\d+)$/i.test(abilityId);

  if (isAdaptAbility && adaptMatch) {
    const adaptCost = adaptMatch[1];
    const adaptN = parseInt(adaptMatch[2], 10);
    const currentCounters = Number((permanent as any)?.counters?.['+1/+1'] || 0);

    if (currentCounters > 0) {
      socket.emit("error", {
        code: "ALREADY_HAS_COUNTERS",
        message: `${cardName} already has +1/+1 counters`,
      });
      return true;
    }

    const parsedCost = parseManaCost(adaptCost);
    const pool = getOrInitManaPool(game.state, pid);
    const totalAvailable = calculateTotalAvailableMana(pool, []);

    const validationError = validateManaPayment(totalAvailable, parsedCost.colors, parsedCost.generic);
    if (validationError) {
      socket.emit("error", { code: "INSUFFICIENT_MANA", message: validationError });
      return true;
    }

    consumeManaFromPool(pool, parsedCost.colors, parsedCost.generic, '[activateBattlefieldAbility:adapt]');

    game.state.stack = game.state.stack || [];
    const adaptStackId = `ability_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    game.state.stack.push({
      id: adaptStackId,
      type: 'ability',
      controller: pid,
      source: permanentId,
      sourceName: cardName,
      description: `Adapt ${adaptN}`,
      activatedAbilityText: scopedAbilityFullText,
      abilityType: 'adapt',
      adaptParams: {
        amount: adaptN,
      },
    } as any);
    notifySpellOrAbilityPutOnStack(game as any, adaptStackId);

    io.to(gameId).emit('chat', {
      id: `m_${Date.now()}`,
      gameId,
      from: 'system',
      message: `⚡ ${getPlayerName(game, pid)} activated ${cardName}'s adapt ability. Ability on the stack.`,
      ts: Date.now(),
    });

    if (typeof game.bumpSeq === 'function') {
      game.bumpSeq();
    }

    appendEvent(gameId, (game as any).seq ?? 0, 'activateBattlefieldAbility', {
      playerId: pid,
      permanentId,
      abilityId,
      cardName,
      abilityText: `Adapt ${adaptN}`,
      activatedAbilityText: scopedAbilityFullText,
      abilityType: 'adapt',
      adaptParams: {
        amount: adaptN,
      },
    });

    broadcastGame(io, game, gameId);
    return true;
  }
  
  // Handle creature upgrade abilities (Figure of Destiny, Warden of the First Tree, etc.)
  // These are activated abilities that transform or upgrade a creature
  const upgradeAbilities = parseCreatureUpgradeAbilities(oracleText, cardName);
  const hasExplicitUpgradeAbilityId = !abilityId.includes('-ability-') && (abilityId.startsWith("upgrade-") || abilityId.includes("-becomes-"));
  const normalizedScopedUpgradeText = String(scopedAbilityFullText || scopedAbilityText || '')
    .replace(new RegExp(String(cardName || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), '~')
    .replace(/\s+/g, ' ')
    .trim();
  const matchedUpgradeIndex = upgradeAbilities.findIndex((candidate) =>
    String(candidate?.fullText || '').replace(/\s+/g, ' ').trim() === normalizedScopedUpgradeText
  );
  const isGenericUpgradeAbility = isGenericActivatedAbilityId && matchedUpgradeIndex >= 0;
  if (hasExplicitUpgradeAbilityId || isGenericUpgradeAbility) {
    // Parse the upgrade ability from oracle text
    if (upgradeAbilities.length === 0) {
      socket.emit("error", {
        code: "NO_UPGRADE_ABILITY",
        message: `${cardName} does not have any upgrade abilities`,
      });
      return true;
    }
    
    // Determine which upgrade ability to activate based on abilityId
    const upgradeIndex = hasExplicitUpgradeAbilityId
      ? (parseInt(abilityId.replace(/^upgrade-|\-becomes-.*$/g, ''), 10) || 0)
      : matchedUpgradeIndex;
    const upgrade = upgradeAbilities[upgradeIndex < upgradeAbilities.length ? upgradeIndex : 0];
    
    if (!upgrade) {
      socket.emit("error", {
        code: "INVALID_UPGRADE_ABILITY",
        message: `Upgrade ability not found on ${cardName}`,
      });
      return true;
    }
    
    // Check if condition is met (e.g., "If ~ is a Spirit")
    if (upgrade.requiredTypes && upgrade.requiredTypes.length > 0) {
      const currentTypes = getUpgradedCreatureTypes(permanent);
      const meetsCondition = upgrade.requiredTypes.every(reqType => 
        currentTypes.some(t => t.toLowerCase() === reqType.toLowerCase())
      );
      
      if (!meetsCondition) {
        socket.emit("error", {
          code: "UPGRADE_CONDITION_NOT_MET",
          message: `${cardName} must be a ${upgrade.requiredTypes.join(' ')} to activate this ability`,
        });
        return true;
      }
    }

    if (splitSecondLockActive) {
      socket.emit('error', {
        code: 'SPLIT_SECOND_LOCK',
        message: "Can't activate abilities while a spell with split second is on the stack.",
      });
      return true;
    }

    const pool = getOrInitManaPool(game.state, pid);
    const paid = validateAndConsumeManaCostFromPool(pool as any, String(upgrade.cost || '').trim(), {
      logPrefix: '[activateBattlefieldAbility:upgrade]',
    });
    if (!paid.ok) {
      const paymentError = 'error' in paid ? (paid.error || 'Insufficient mana.') : 'Insufficient mana.';
      socket.emit('error', {
        code: 'INSUFFICIENT_MANA',
        message: paymentError,
      });
      return true;
    }
    
    // Put the upgrade ability on the stack
    const stackItem = {
      id: `ability_upgrade_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      type: 'ability' as const,
      controller: pid,
      source: permanentId,
      sourceName: cardName,
      description: normalizedScopedUpgradeText || upgrade.fullText,
      abilityType: 'creature-upgrade',
      upgradeData: {
        newTypes: upgrade.newTypes,
        newPower: upgrade.newPower,
        newToughness: upgrade.newToughness,
        keywords: upgrade.keywords,
        counterCount: upgrade.counterCount,
        counterType: upgrade.counterType,
      },
    } as any;
    
    game.state.stack = game.state.stack || [];
    game.state.stack.push(stackItem);

    // Fire triggers that care about ability activation (e.g., Harsh Mentor, Rings of Brighthearth).
    // Best-effort: non-mana abilities use the stack.
    try {
      const triggeredAbilities = triggerAbilityActivatedTriggers(game as any, {
        activatedBy: pid as any,
        sourcePermanentId: permanentId as any,
        isManaAbility: false,
        abilityText: normalizedScopedUpgradeText || upgrade.fullText,
        stackItemId: stackItem.id,
      });
      persistAbilityActivatedTriggerPushes(gameId, game, triggeredAbilities);
    } catch {}
    
    if (typeof game.bumpSeq === "function") {
      game.bumpSeq();
    }
    
    appendEvent(gameId, (game as any).seq ?? 0, "activateUpgradeAbility", { 
      playerId: pid, 
      permanentId, 
      abilityId,
      cardName,
      upgradeIndex,
    });
    
    io.to(gameId).emit("chat", {
      id: `m_${Date.now()}`,
      gameId,
      from: "system",
      message: `⚡ ${getPlayerName(game, pid)} activated ${cardName}'s upgrade ability. (${String(normalizedScopedUpgradeText || upgrade.fullText).slice(0, 80)}...)`,
      ts: Date.now(),
    });
    
    broadcastGame(io, game, gameId);
    return true;
  }
  

  return false;
}
