/**
 * Origin parent: server/src/socket/interaction.ts
 *
 * Cluster moved: activateBattlefieldAbility grant-keyword, control-change,
 * fight, counter-add, counter-move, and tap/untap families.
 *
 * Public entry symbols: tryHandleActivateGrantFightCounterTap.
 */

import type { PlayerID } from "../../../../shared/src/index.js";
import { permanentHasCreatureType } from "../../../../shared/src/creatureTypes.js";
import { getActivatedAbilityConfig } from "../../../../rules-engine/src/cards/activatedAbilityCards.js";
import { creatureHasHaste } from "../game-actions.js";
import { requestPlayerSelection } from "../player-selection.js";
import { ResolutionQueueManager, ResolutionStepType } from "../../state/resolution/index.js";
import { debug } from "../../utils/debug.js";
import { parseGrantAbilityCreatureTarget } from "./interactionActivateGrantAbilityTargetParse.js";
import {
  broadcastGame,
  calculateTotalAvailableMana,
  consumeManaFromPool,
  getEffectivePower,
  getEffectiveToughness,
  getOrInitManaPool,
  parseManaCost,
  validateManaPayment,
} from "../util";
import type { ActivateBattlefieldAbilityContext } from "./interactionActivateBattlefieldAbilityContext.js";
import {
  calculateInteractionManaPoolDelta,
  persistQueuedBattlefieldAbilityStepActivation,
  snapshotInteractionManaPool,
} from "./interactionActivationEventPersistence.js";
import { WORD_TO_NUMBER } from "./interactionSpecialLandAndHideaway.js";

export async function tryHandleActivateGrantFightCounterTap(
  ctx: ActivateBattlefieldAbilityContext,
  parseActivationCost: (oracleText: string, abilityPattern: RegExp) => {
    requiresTap: boolean;
    manaCost: string;
    costText: string;
  },
  parseTapUntapAbilityText: (text: string) => {
    action: 'tap' | 'untap' | 'both';
    types: string[];
    count: number;
    excludeSource: boolean;
    controller?: 'you' | 'opponent' | 'any';
  } | null,
  payBattlefieldAbilityManaCostOrQueue: (params: any) => 'paid' | 'queued' | 'failed',
  queueCounterTargetStepForBattlefieldAbility: (params: any) => any,
  costRequiresSelfExert: (costText: string) => boolean,
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
    scopedAbilityFullText,
    isGenericActivatedAbilityId,
  } = ctx;

  // Handle activated abilities that grant abilities/keywords to target creatures.
  // Supports both trailing-duration text ("Target creature gains flying until end of turn")
  // and leading-duration text ("Until end of turn, target creature gains ...").
  // Examples: Fire Nation Palace ("{1}{R}, {T}: Target creature you control gains firebending 4")
  //           Sokrates, Athenian Teacher ("{T}: Until end of turn, target creature gains ...")
  //           Otepec Huntmaster ("{T}: Target Dinosaur gains haste until end of turn.")
  // Note: This also applies to instants/sorceries that grant abilities, but those are handled
  // during spell resolution via the targeting system
  const scopedGrantResolvedAbilityText = String(scopedAbilityFullText).replace(/^[^:]+:\s*/, '').trim();
  const scopedGrantActivatedAbilityText = String(scopedAbilityFullText || '').trim();
  const parsedGrantTarget = parseGrantAbilityCreatureTarget(scopedGrantResolvedAbilityText);
  const hasExplicitGrantAbilityId = /-grant-ability-(\d+)$/i.test(abilityId) || abilityId === 'grant-ability';

  if (parsedGrantTarget && (hasExplicitGrantAbilityId || isGenericActivatedAbilityId)) {
    const targetRestriction = parsedGrantTarget.controllerRestriction === 'you'
      ? 'you control'
      : parsedGrantTarget.controllerRestriction === 'opponent'
        ? 'an opponent controls'
        : 'any';
    const abilityGranted = parsedGrantTarget.abilityGranted;
    const creatureTypeFilter = parsedGrantTarget.creatureType;
    
    debug(2, `[activateBattlefieldAbility] Grant ability detected: ${cardName} - "${abilityGranted}" (restriction: ${targetRestriction})`);

    const costPrefix = String(scopedAbilityFullText).split(':')[0] || '';
    const requiresTap = /\{t\}/i.test(costPrefix);
    const manaCost = (costPrefix.match(/\{[^}]+\}/g) || [])
      .filter((symbol) => !/^\{t\}$/i.test(symbol))
      .join('');
    
    // Determine if this targets own or opponent creatures
    const targetsOwnCreatures = targetRestriction.includes('you control');
    const targetsOpponentCreatures = targetRestriction.includes("opponent");
    const typeNoun = creatureTypeFilter || 'creature';
    const targetDescription = targetsOpponentCreatures
      ? `${typeNoun} an opponent controls`
      : targetsOwnCreatures
        ? `${typeNoun} you control`
        : typeNoun;
    const promptTargetDescription = targetsOpponentCreatures
      ? `a target ${typeNoun} an opponent controls`
      : targetsOwnCreatures
        ? `a target ${typeNoun} you control`
        : `a target ${typeNoun}`;
    const powerAtLeastMatch = scopedGrantResolvedAbilityText.match(/\bwith power (\d+) or greater\b/i);
    const powerAtMostMatch = scopedGrantResolvedAbilityText.match(/\bwith power (\d+) or less\b/i);
    const minPower = powerAtLeastMatch ? Number(powerAtLeastMatch[1]) : undefined;
    const maxPower = powerAtMostMatch ? Number(powerAtMostMatch[1]) : undefined;
    
    // Get valid target creatures
    const validTargets = battlefield.filter((p: any) => {
      const pTypeLine = (p.card?.type_line || "").toLowerCase();
      if (creatureTypeFilter) {
        if (!permanentHasCreatureType(p, creatureTypeFilter)) return false;
      } else if (!pTypeLine.includes("creature")) {
        return false;
      }
      if (typeof minPower === 'number' && Number.isFinite(minPower) && getEffectivePower(p, game.state) < minPower) {
        return false;
      }
      if (typeof maxPower === 'number' && Number.isFinite(maxPower) && getEffectivePower(p, game.state) > maxPower) {
        return false;
      }
      
      if (targetsOpponentCreatures) {
        return p.controller !== pid; // Opponent's creatures
      }

      if (targetsOwnCreatures) {
        return p.controller === pid; // Own creatures
      }

      return true; // Any creature
    });
    
    if (validTargets.length === 0) {
      socket.emit("error", {
        code: "NO_VALID_TARGETS",
        message: targetsOpponentCreatures
          ? `No opponent ${typeNoun}s to target`
          : targetsOwnCreatures
            ? `You have no ${typeNoun}s to target`
            : `No ${typeNoun}s to target`,
      });
      return true;
    }

    const isCreaturePermanent = /\bcreature\b/i.test(typeLine) && !/\bland\b/i.test(typeLine);
    if (requiresTap && isCreaturePermanent) {
      if ((permanent as any).summoningSickness && !creatureHasHaste(permanent, battlefield, pid)) {
        socket.emit('error', {
          code: 'SUMMONING_SICKNESS',
          message: `${cardName} has summoning sickness and cannot use tap abilities this turn`,
        });
        return true;
      }
    }

    if (requiresTap && (permanent as any).tapped) {
      socket.emit("error", {
        code: "ALREADY_TAPPED",
        message: `${cardName} is already tapped`,
      });
      return true;
    }

    let manaPoolBeforePayment: Record<string, number> | undefined;
    let poolAfterPayment: any;
    if (manaCost) {
      const parsedCost = parseManaCost(manaCost);
      const pool = getOrInitManaPool(game.state, pid);
      manaPoolBeforePayment = snapshotInteractionManaPool(pool);
      const totalAvailable = calculateTotalAvailableMana(pool, []);
      const validationError = validateManaPayment(totalAvailable, parsedCost.colors, parsedCost.generic);
      if (validationError) {
        socket.emit("error", { code: "INSUFFICIENT_MANA", message: validationError });
        return true;
      }
      consumeManaFromPool(pool, parsedCost.colors, parsedCost.generic, '[activateBattlefieldAbility:grant-ability]');
      poolAfterPayment = pool;
    }

    if (requiresTap) {
      (permanent as any).tapped = true;
    }
    const tappedPermanentsForCost = requiresTap ? [String(permanentId)] : [];

    // Unified Resolution Queue prompt
    const existing = ResolutionQueueManager
      .getStepsForPlayer(gameId, pid as any)
      .find((s: any) => s?.type === ResolutionStepType.TARGET_SELECTION && (s as any)?.battlefieldAbilityTargetSelection === true && String((s as any)?.abilityId || '') === String(abilityId) && String(s?.sourceId) === String(permanentId));

    if (!existing) {
      const queuedStep = ResolutionQueueManager.addStep(gameId, {
        type: ResolutionStepType.TARGET_SELECTION,
        playerId: pid as PlayerID,
        sourceId: permanentId,
        sourceName: cardName,
        sourceImage: card?.image_uris?.small || card?.image_uris?.normal,
        description: `${cardName}: Choose ${promptTargetDescription} to gain ${abilityGranted} until end of turn.`,
        mandatory: false,
        validTargets: validTargets.map((c: any) => ({
          id: c.id,
          label: `${c.card?.name || 'Creature'} (${getEffectivePower(c, game.state)}/${getEffectiveToughness(c, game.state)})`,
          description: c.card?.type_line || 'Creature',
          imageUrl: c.card?.image_uris?.small || c.card?.image_uris?.normal,
        })),
        targetTypes: ['ability_grant_target'],
        minTargets: 1,
        maxTargets: 1,
        targetDescription,

        battlefieldAbilityTargetSelection: true,
        permanentId,
        abilityId,
        cardName,
        abilityText: scopedGrantResolvedAbilityText,
        activatedAbilityText: scopedGrantActivatedAbilityText || undefined,
        tappedPermanentsForCost,
      } as any);

      if (typeof game.bumpSeq === 'function') {
        game.bumpSeq();
      }
      persistQueuedBattlefieldAbilityStepActivation({
        gameId,
        game,
        playerId: String(pid),
        permanentId: String(permanentId),
        abilityId: String(abilityId),
        cardName,
        abilityText: scopedGrantResolvedAbilityText,
        activatedAbilityText: scopedGrantActivatedAbilityText || undefined,
        tappedPermanents: tappedPermanentsForCost,
        paymentManaDelta: manaPoolBeforePayment && poolAfterPayment
          ? calculateInteractionManaPoolDelta(manaPoolBeforePayment, poolAfterPayment)
          : undefined,
        queuedStep: {
          ...(queuedStep as any),
          id: String((queuedStep as any)?.id || ''),
        },
      });
      broadcastGame(io, game, gameId);
    }
    return true;
  }

  // Handle Control Change abilities (Humble Defector, etc.)
  // Check registry first, then fall back to pattern matching for unregistered cards
  const abilityConfig = getActivatedAbilityConfig(cardName);
  const controlChangeAbilityText = String(
    scopedAbilityFullText || abilityConfig?.tapAbility?.effect || oracleText || ''
  ).trim();
  const hasControlChangeAbility = /(?:target\s+opponent\s+gains\s+control|opponent\s+gains\s+control)/i.test(controlChangeAbilityText);
  
  if (hasControlChangeAbility) {
    // Get effect details from registry first, then fall back to oracle text parsing
    let drawCards = abilityConfig?.tapAbility?.effect?.match(/draw (\w+) card/i)?.[1];
    
    // Fallback: Parse draw count directly from oracle text if not found in registry
    if (!drawCards) {
      const oracleDrawMatch = controlChangeAbilityText.match(/draw (\w+) card/i);
      if (oracleDrawMatch) {
        drawCards = oracleDrawMatch[1].toLowerCase();
      }
    }
    
    // Convert word numbers to actual count using module-level constant
    const drawCount = drawCards ? (WORD_TO_NUMBER[drawCards.toLowerCase()] || 0) : 0;
    let manaPoolBeforePayment: Record<string, number> | undefined;
    let poolAfterPayment: any;
    
    debug(2, `[activateBattlefieldAbility] Control change ability on ${cardName}: drawCards=${drawCards}, drawCount=${drawCount}`);
    
    // Parse the cost
    const { requiresTap, manaCost } = parseActivationCost(controlChangeAbilityText, /(?:draw|opponent gains control)/i);
    
    if (requiresTap && (permanent as any).tapped) {
      socket.emit("error", {
        code: "ALREADY_TAPPED",
        message: `${cardName} is already tapped`,
      });
      return true;
    }
    
    // Check timing restriction from registry
    const timingRestriction = abilityConfig?.tapAbility?.timingRestriction;
    if (timingRestriction === 'your_turn' && game.state?.turnPlayer !== pid) {
      socket.emit("error", {
        code: "WRONG_TIMING",
        message: `${cardName} can only be activated during your turn`,
      });
      return true;
    }
    
    if (manaCost) {
      // Validate and consume mana
      const parsedCost = parseManaCost(manaCost);
      const pool = getOrInitManaPool(game.state, pid);
      manaPoolBeforePayment = snapshotInteractionManaPool(pool);
      const totalAvailable = calculateTotalAvailableMana(pool, []);
      
      const validationError = validateManaPayment(totalAvailable, parsedCost.colors, parsedCost.generic);
      if (validationError) {
        socket.emit("error", { code: "INSUFFICIENT_MANA", message: validationError });
        return true;
      }
      
      consumeManaFromPool(pool, parsedCost.colors, parsedCost.generic, '[activateBattlefieldAbility:control-change]');
      poolAfterPayment = pool;
    }
    
    // Tap the permanent if required
    if (requiresTap) {
      (permanent as any).tapped = true;
    }

    const playerSelectionEffectData = {
      type: 'control_change' as const,
      permanentId,
      drawCards: drawCount,
      opponentOnly: true,
    };

    // Queue opponent selection via Resolution Queue (ResolutionStepType.PLAYER_CHOICE)
    // The queued step carries effectData so the response can apply the control change.
    const playerSelectionStepId = requestPlayerSelection(
      io,
      gameId,
      pid as any,
      cardName,
      controlChangeAbilityText,
      playerSelectionEffectData,
      true,
      false
    );

    const playerChoiceQueue = ResolutionQueueManager.getQueue(gameId);
    const playerChoiceStep = Array.isArray(playerChoiceQueue?.steps)
      ? playerChoiceQueue.steps.find((step: any) => String(step?.id || '') === String(playerSelectionStepId || ''))
      : undefined;
    
    debug(2, `[activateBattlefieldAbility] Control change ability on ${cardName}: ${manaCost ? `paid ${manaCost}, ` : ''}${requiresTap ? 'tapped, ' : ''}prompting for opponent selection`);
    if (typeof game.bumpSeq === 'function') {
      game.bumpSeq();
    }
    persistQueuedBattlefieldAbilityStepActivation({
      gameId,
      game,
      playerId: String(pid),
      permanentId: String(permanentId),
      abilityId: String(abilityId),
      cardName,
      activatedAbilityText: String(controlChangeAbilityText || '').trim(),
      tappedPermanents: requiresTap ? [String(permanentId)] : undefined,
      paymentManaDelta: manaPoolBeforePayment && poolAfterPayment ? calculateInteractionManaPoolDelta(manaPoolBeforePayment, poolAfterPayment) : undefined,
      queuedStep: playerChoiceStep ? { ...(playerChoiceStep as any) } : {
        id: String(playerSelectionStepId || ''),
        type: ResolutionStepType.PLAYER_CHOICE,
        playerId: pid,
        description: controlChangeAbilityText,
        mandatory: true,
        sourceId: permanentId,
        sourceName: cardName,
        permanentId,
        opponentOnly: true,
        isOptional: false,
        effectData: playerSelectionEffectData,
      },
    });
    broadcastGame(io, game, gameId);
    return true;
  }

  // Handle Fight abilities (Brash Taunter, etc.)
  // Pattern: "{Cost}: This creature fights target creature you don't control"
  // Pattern: "{Cost}: This creature fights another target creature" (can target any creature)
  const hasFightAbility = scopedAbilityFullText.includes("fights") || scopedAbilityFullText.includes("fight");
  const isFightAbility = hasFightAbility && /\{[^}]+\}[^:]*:\s*[^.]*fights?/i.test(scopedAbilityFullText);
  
  if (isFightAbility) {
    // Parse the cost
    const { requiresTap, manaCost } = parseActivationCost(scopedAbilityFullText, /fights?/i);
    let manaPoolBeforePayment: Record<string, number> | undefined;
    let poolAfterPayment: any;
    
    if (requiresTap && (permanent as any).tapped) {
      socket.emit("error", {
        code: "ALREADY_TAPPED",
        message: `${cardName} is already tapped`,
      });
      return true;
    }
    
    if (manaCost) {
      // Validate and consume mana
      const parsedCost = parseManaCost(manaCost);
      const pool = getOrInitManaPool(game.state, pid);
      manaPoolBeforePayment = snapshotInteractionManaPool(pool);
      poolAfterPayment = pool;
      const totalAvailable = calculateTotalAvailableMana(pool, []);
      
      const validationError = validateManaPayment(totalAvailable, parsedCost.colors, parsedCost.generic);
      if (validationError) {
        socket.emit("error", { code: "INSUFFICIENT_MANA", message: validationError });
        return true;
      }
      
      consumeManaFromPool(pool, parsedCost.colors, parsedCost.generic, '[activateBattlefieldAbility:fight]');
    }
    
    // Tap the permanent if required
    if (requiresTap) {
      (permanent as any).tapped = true;
    }
    
    // Determine fight target restrictions from oracle text
    // "another target creature" = any creature except itself
    // "target creature you don't control" = opponent's creatures only
    // "target creature" = typically opponent's creatures unless specified otherwise
    let fightController: 'opponent' | 'any' | 'you' = 'any';
    if (scopedAbilityFullText.includes("you don't control") || scopedAbilityFullText.includes("you do not control")) {
      fightController = 'opponent';
    } else if (scopedAbilityFullText.includes("another target creature") || scopedAbilityFullText.includes("fights another target")) {
      fightController = 'any'; // Can fight any creature including your own
    } else if (scopedAbilityFullText.includes("target creature you control")) {
      fightController = 'you';
    }
    
    // Queue fight target selection via Resolution Queue
    const fightStep = ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.FIGHT_TARGET,
      playerId: pid as PlayerID,
      sourceId: permanentId,
      sourceName: cardName,
      abilityId,
      sourceImage: card?.image_uris?.small || card?.image_uris?.normal,
      description: scopedAbilityFullText,
      activatedAbilityText: scopedAbilityFullText,
      mandatory: true,
      targetFilter: {
        types: ['creature'],
        controller: fightController,
        excludeSource: true,
      },
      title: `${cardName} - Fight`,
    });
    
    debug(2, `[activateBattlefieldAbility] Fight ability on ${cardName}: ${manaCost ? `paid ${manaCost}, ` : ''}prompting for target creature (controller: ${fightController})`);
    if (typeof game.bumpSeq === 'function') {
      game.bumpSeq();
    }
    persistQueuedBattlefieldAbilityStepActivation({
      gameId,
      game,
      playerId: String(pid),
      permanentId: String(permanentId),
      abilityId: String(abilityId),
      cardName,
      activatedAbilityText: String(scopedAbilityFullText || '').trim(),
      tappedPermanents: requiresTap ? [String(permanentId)] : undefined,
      paymentManaDelta: manaPoolBeforePayment && poolAfterPayment ? calculateInteractionManaPoolDelta(manaPoolBeforePayment, poolAfterPayment) : undefined,
      queuedStep: {
        id: String((fightStep as any).id || ''),
        type: ResolutionStepType.FIGHT_TARGET,
        playerId: pid,
        sourceId: permanentId,
        sourceName: cardName,
        abilityId,
        sourceImage: card?.image_uris?.small || card?.image_uris?.normal,
        description: scopedAbilityFullText,
        activatedAbilityText: scopedAbilityFullText,
        mandatory: true,
        targetFilter: {
          types: ['creature'],
          controller: fightController,
          excludeSource: true,
        },
        title: `${cardName} - Fight`,
      },
    });
    broadcastGame(io, game, gameId);
    return true;
  }
  
  // Handle Counter-adding abilities (Gwafa Hazid, Sage of Fables, Gavony Township, Ozolith, Immaculate Magistrate, etc.)
  // Pattern: "{Cost}: Put a [counterType] counter on target [anything]" or "Put a counter for each..."
  // Examples:
  // - Gwafa Hazid: "{W}{U}, {T}: Put a bribery counter on target creature you don't control. Its controller draws a card."
  // - Sage of Fables: "{2}: Put a +1/+1 counter on target creature."
  // - Gavony Township: "{2}{G}{W}, {T}: Put a +1/+1 counter on each creature you control."
  // - Ozolith, the Shattered Spire: "{1}, {T}: Put a +1/+1 counter on target creature you control. Activate only as a sorcery."
  // - Immaculate Magistrate: "{T}: Put a +1/+1 counter on target creature for each Elf you control."
  // Works on: creatures, permanents, lands, artifacts, enchantments, planeswalkers, etc.
  const counterMatch = scopedAbilityFullText.match(/put (?:a|an|one|two|three) ([^\s]+) counters? on target ([^.]+?)(?:\s+you\s+(don't\s+control|control|don't own|own))?(?:\s+for each ([^.]+?))?(?:\.|,|$)/i);
  const isCounterAbility = Boolean(counterMatch);
  
  if (isCounterAbility && counterMatch) {
    const counterType = counterMatch[1].toLowerCase().replace(/[^a-z0-9+\-]/g, ''); // e.g., "bribery", "+1/+1", "loyalty"
    const targetType = counterMatch[2].trim(); // e.g., "creature", "permanent", "artifact", "land"
    const targetRestriction = counterMatch[3] ? counterMatch[3].toLowerCase() : null;
    const scalingText = counterMatch[4] ? counterMatch[4].trim() : null; // e.g., "Elf you control"
    
    // Parse the cost
    const { requiresTap, manaCost } = parseActivationCost(scopedAbilityFullText, /put (?:a|an|one) [^\s]+ counter/i);
    let manaPoolBeforePayment: Record<string, number> | undefined;
    let poolAfterPayment: any;

    const isCreaturePermanent = /\bcreature\b/.test(typeLine) && !typeLine.includes('land');
    if (requiresTap && isCreaturePermanent) {
      if ((permanent as any).summoningSickness && !creatureHasHaste(permanent, battlefield, pid)) {
        socket.emit('error', {
          code: 'SUMMONING_SICKNESS',
          message: `${cardName} has summoning sickness and cannot use tap abilities this turn`,
        });
        return true;
      }
    }
    
    if (requiresTap && (permanent as any).tapped) {
      socket.emit("error", {
        code: "ALREADY_TAPPED",
        message: `${cardName} is already tapped`,
      });
      return true;
    }
    
    if (manaCost) {
      const pool = getOrInitManaPool(game.state, pid);
      manaPoolBeforePayment = snapshotInteractionManaPool(pool);
      poolAfterPayment = pool;
      const paymentResult = payBattlefieldAbilityManaCostOrQueue({
        game,
        gameId,
        pid,
        permanentId: String(permanentId),
        abilityId: String(abilityId),
        cardName,
        card,
        manaCost,
        requiresTap,
        activatedAbilityText: scopedAbilityFullText,
        activationPaymentContext: 'battlefield_counter_target',
        deferredActivationFields: {
          counterType,
          targetController: targetRestriction?.includes("don't control") || targetRestriction?.includes('do not control')
            ? 'opponent'
            : targetRestriction?.includes('you control')
              ? 'you'
              : 'any',
          targetType,
          scalingText,
          scopedAbilityFullText,
        },
      });
      if (paymentResult === 'failed') {
        socket.emit('error', {
          code: 'INSUFFICIENT_MANA',
          message: `Cannot pay ${manaCost} to activate ${cardName}.`,
        });
        return true;
      }
      if (paymentResult === 'queued') {
        if (typeof game.bumpSeq === 'function') {
          game.bumpSeq();
        }
        broadcastGame(io, game, gameId);
        return true;
      }
    }
    
    // Tap the permanent if required
    if (requiresTap) {
      (permanent as any).tapped = true;
    }
    
    // Determine target restrictions
    let targetController: 'opponent' | 'any' | 'you' = 'any';
    if (targetRestriction) {
      if (targetRestriction.includes("don't control") || targetRestriction.includes("do not control")) {
        targetController = 'opponent';
      } else if (targetRestriction.includes("you control")) {
        targetController = 'you';
      }
    }

    const counterStep = queueCounterTargetStepForBattlefieldAbility({
      gameId,
      game,
      pid,
      permanentId: String(permanentId),
      abilityId: String(abilityId),
      card,
      cardName,
      scopedAbilityFullText,
      counterType,
      targetController,
      scalingText,
      targetType,
      requiresTap,
      manaPoolBeforePayment,
      poolAfterPayment,
    });
    if (!counterStep) {
      if (requiresTap) {
        (permanent as any).tapped = false;
      }
      socket.emit('error', {
        code: 'NO_VALID_TARGETS',
        message: targetController === 'opponent'
          ? `No valid opponent ${targetType || 'permanent'} targets for ${cardName}.`
          : `No valid ${targetType || 'permanent'} targets for ${cardName}.`,
      });
      return true;
    }
    
    debug(2, `[activateBattlefieldAbility] Counter ability on ${cardName}: ${manaCost ? `paid ${manaCost}, ` : ''}prompting for target (controller: ${targetController}, counter: ${counterType})`);
    broadcastGame(io, game, gameId);
    return true;
  }
  
  // Handle Counter-moving abilities (Nesting Grounds, Resourceful Defense, etc.)
  // Pattern: "{Cost}: Move a counter from target permanent you control onto a second target permanent"
  // Example: Nesting Grounds: "{1}, {T}: Move a counter from target permanent you control onto a second target permanent. Activate only as a sorcery."
  const moveCounterMatch = scopedAbilityFullText.match(/move (?:a|one) counter from target permanent(?:\s+you\s+control)?/i);
  const isMoveCounterAbility = Boolean(moveCounterMatch);
  
  if (isMoveCounterAbility) {
    // Parse the cost
    const { requiresTap, manaCost } = parseActivationCost(scopedAbilityFullText, /move (?:a|one) counter/i);
    let manaPoolBeforePayment: Record<string, number> | undefined;
    let poolAfterPayment: any;
    
    if (requiresTap && (permanent as any).tapped) {
      socket.emit("error", {
        code: "ALREADY_TAPPED",
        message: `${cardName} is already tapped`,
      });
      return true;
    }
    
    if (manaCost) {
      // Validate and consume mana
      const parsedCost = parseManaCost(manaCost);
      const pool = getOrInitManaPool(game.state, pid);
      manaPoolBeforePayment = snapshotInteractionManaPool(pool);
      poolAfterPayment = pool;
      const totalAvailable = calculateTotalAvailableMana(pool, []);
      
      const validationError = validateManaPayment(totalAvailable, parsedCost.colors, parsedCost.generic);
      if (validationError) {
        socket.emit("error", { code: "INSUFFICIENT_MANA", message: validationError });
        return true;
      }
      
      consumeManaFromPool(pool, parsedCost.colors, parsedCost.generic, '[activateBattlefieldAbility:move-counter]');
    }
    
    // Tap the permanent if required
    if (requiresTap) {
      (permanent as any).tapped = true;
    }

    // Unified Resolution Queue prompt
    const movementStep = ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.COUNTER_MOVEMENT,
      playerId: pid as PlayerID,
      sourceId: permanentId,
      sourceName: cardName,
      sourceImage: card?.image_uris?.small || card?.image_uris?.normal,
      description: scopedAbilityFullText,
      mandatory: true,
      sourceFilter: {
        controller: 'you',
        requiresCounters: true,
      },
      targetFilter: {
        controller: 'any',
        excludeSource: true,
      },
      title: cardName,
    });

    debug(2, `[activateBattlefieldAbility] Move counter ability on ${cardName}: ${manaCost ? `paid ${manaCost}, ` : ''}queued counter movement step`);
    if (typeof game.bumpSeq === 'function') {
      game.bumpSeq();
    }
    persistQueuedBattlefieldAbilityStepActivation({
      gameId,
      game,
      playerId: String(pid),
      permanentId: String(permanentId),
      abilityId: String(abilityId),
      cardName,
      activatedAbilityText: String(scopedAbilityFullText || '').trim(),
      tappedPermanents: requiresTap ? [String(permanentId)] : undefined,
      paymentManaDelta: manaPoolBeforePayment && poolAfterPayment ? calculateInteractionManaPoolDelta(manaPoolBeforePayment, poolAfterPayment) : undefined,
      queuedStep: {
        id: String((movementStep as any).id || ''),
        type: ResolutionStepType.COUNTER_MOVEMENT,
        playerId: pid,
        sourceId: permanentId,
        sourceName: cardName,
        sourceImage: card?.image_uris?.small || card?.image_uris?.normal,
        description: scopedAbilityFullText,
        mandatory: true,
        sourceFilter: {
          controller: 'you',
          requiresCounters: true,
        },
        targetFilter: {
          controller: 'any',
          excludeSource: true,
        },
        title: cardName,
      },
    });
    broadcastGame(io, game, gameId);
    return true;
  }
  
  // Handle Tap/Untap abilities (Saryth, Merrow Reejerey, Argothian Elder, etc.)
  // Parse ability text to detect tap/untap abilities
  const tapUntapParams = parseTapUntapAbilityText(scopedAbilityFullText);
  const isTapUntapAbility = Boolean(tapUntapParams);
  
  if (isTapUntapAbility && tapUntapParams) {
    // Parse the cost
    const { requiresTap, manaCost, costText } = parseActivationCost(scopedAbilityFullText, /(?:tap|untap)/i);
    let manaPoolBeforePayment: Record<string, number> | undefined;
    let poolAfterPayment: any;
    
    if (requiresTap && (permanent as any).tapped) {
      socket.emit("error", {
        code: "ALREADY_TAPPED",
        message: `${cardName} is already tapped`,
      });
      return true;
    }
    
    if (manaCost) {
      // Validate and consume mana
      const parsedCost = parseManaCost(manaCost);
      const pool = getOrInitManaPool(game.state, pid);
      manaPoolBeforePayment = snapshotInteractionManaPool(pool);
      poolAfterPayment = pool;
      const totalAvailable = calculateTotalAvailableMana(pool, []);
      
      const validationError = validateManaPayment(totalAvailable, parsedCost.colors, parsedCost.generic);
      if (validationError) {
        socket.emit("error", { code: "INSUFFICIENT_MANA", message: validationError });
        return true;
      }
      
      consumeManaFromPool(pool, parsedCost.colors, parsedCost.generic, '[activateBattlefieldAbility:tap-untap]');
    }
    
    // Tap the permanent if required
    if (requiresTap) {
      (permanent as any).tapped = true;
    }

    const tapUntapAbilityText = String(
      scopedAbilityFullText.includes(':')
        ? scopedAbilityFullText.split(':').slice(1).join(':')
        : scopedAbilityFullText,
    ).trim();
    const tapUntapRequiresSelfExert = costRequiresSelfExert(costText);

    // Queue tap/untap target selection via Resolution Queue
    const tapUntapStep = ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.TAP_UNTAP_TARGET,
      playerId: pid as PlayerID,
      sourceId: permanentId,
      sourceName: cardName,
      sourceImage: card?.image_uris?.small || card?.image_uris?.normal,
      description: scopedAbilityFullText,
      mandatory: true,
      action: tapUntapParams.action,
      targetFilter: {
        types: tapUntapParams.types as any[],
        controller: tapUntapParams.controller,
        tapStatus: 'any',
        excludeSource: tapUntapParams.excludeSource,
      },
      targetCount: tapUntapParams.count,
      title: cardName,
      battlefieldAbilityTapUntapSelection: true,
      permanentId,
      abilityId,
      cardName,
      abilityText: tapUntapAbilityText || String(scopedAbilityFullText || '').trim(),
      activatedAbilityText: String(scopedAbilityFullText || '').trim(),
      tappedPermanentsForCost: requiresTap ? [String(permanentId)] : [],
      ...(tapUntapRequiresSelfExert ? { requiresSelfExertForCost: true } : null),
    });
    
    debug(2, `[activateBattlefieldAbility] Tap/Untap ability on ${cardName}: ${manaCost ? `paid ${manaCost}, ` : ''}prompting for ${tapUntapParams.count} target(s)`);
    if (typeof game.bumpSeq === 'function') {
      game.bumpSeq();
    }
    persistQueuedBattlefieldAbilityStepActivation({
      gameId,
      game,
      playerId: String(pid),
      permanentId: String(permanentId),
      abilityId: String(abilityId),
      cardName,
      activatedAbilityText: String(scopedAbilityFullText || '').trim(),
      tappedPermanents: requiresTap ? [String(permanentId)] : undefined,
      paymentManaDelta: manaPoolBeforePayment && poolAfterPayment ? calculateInteractionManaPoolDelta(manaPoolBeforePayment, poolAfterPayment) : undefined,
      queuedStep: {
        id: String((tapUntapStep as any).id || ''),
        type: ResolutionStepType.TAP_UNTAP_TARGET,
        playerId: pid,
        sourceId: permanentId,
        sourceName: cardName,
        sourceImage: card?.image_uris?.small || card?.image_uris?.normal,
        description: scopedAbilityFullText,
        mandatory: true,
        action: tapUntapParams.action,
        targetFilter: {
          types: tapUntapParams.types as any[],
          controller: tapUntapParams.controller,
          tapStatus: 'any',
          excludeSource: tapUntapParams.excludeSource,
        },
        targetCount: tapUntapParams.count,
        title: cardName,
        battlefieldAbilityTapUntapSelection: true,
        permanentId,
        abilityId,
        cardName,
        abilityText: tapUntapAbilityText || String(scopedAbilityFullText || '').trim(),
        activatedAbilityText: String(scopedAbilityFullText || '').trim(),
        tappedPermanentsForCost: requiresTap ? [String(permanentId)] : [],
        ...(tapUntapRequiresSelfExert ? { requiresSelfExertForCost: true } : null),
      },
    });
    broadcastGame(io, game, gameId);
    return true;
  }
  

  return false;
}
