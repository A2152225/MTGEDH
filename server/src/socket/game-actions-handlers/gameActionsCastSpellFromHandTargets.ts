/**
 * Origin parent: server/src/socket/game-actions.ts
 *
 * Cluster moved: handleCastSpellFromHand cast-time targeting (CR 601.2c) -
 * Aura host selection, instant/sorcery target prompts, and validation of
 * already-chosen targets before payment.
 *
 * Public entry symbols: tryPromptCastSpellTargetsFromHand.
 */
import type { Socket } from "socket.io";
import type { PlayerID } from "../../../../shared/src/index.js";
import {
  canPermanentBeTargetedByPlayer,
  categorizeSpellWithoutPrimaryRetirement,
  evaluateTargeting,
  parseTargetRequirements,
} from "../../rules-engine/targeting";
import { ResolutionQueueManager, ResolutionStepType } from "../../state/resolution/index.js";
import { debug, debugError } from "../../utils/debug.js";
import { getPlayerName } from "../util";
import { buildPendingCastCostMetadata } from "./gameActionsCastCostFormatting.js";
import type { SpellCastSourceZone } from "./gameActionsCastCostReduction.js";
import { getPendingCastPaymentFields } from "./gameActionsCommandZoneAndAlternateCastCosts.js";
import { persistQueuedSpellCastStepContinuation } from "./gameActionsSpellCopyHeroicTriggers.js";
import {
  buildGroupedSpellTargetMetadata,
  buildSpellTargetListFromRequirements,
  buildSpellTargetSelectionClauses,
  resolveTargetCount,
  shouldPreferParsedTargetReqs,
} from "./gameActionsSpellTargetSelection.js";

export type CastSpellTargetsFromHandArgs = {
  socket: Socket;
  game: any;
  gameId: string;
  playerId: string;
  cardId: string;
  cardInHand: any;
  oracleText: string;
  typeLine: string;
  isInstantOrSorcery: boolean;
  targets: any;
  xValue: number | undefined;
  skipInteractivePrompts: boolean;
  shouldSkipAllPrompts: boolean;
  castSourceZone: SpellCastSourceZone;
  selectedFaceIndex: number | undefined;
  selectedModes: any;
  selectedAdditionalCostModes: any;
  entwineCost: string | undefined;
  alternateCostId: string | undefined;
  bypassExilePermissionCheck: boolean;
};

export type CastSpellTargetsFromHandContinue = {
  kind: "continue";
  isAura: boolean;
  auraTargetType: "creature" | "player" | "opponent" | "permanent" | "artifact" | "land" | null;
  auraControllerRestriction: "you_control" | "opponent_controls" | "any";
  spellSpec: any;
  targetReqs: any;
  preferParsedTargetReqs: boolean;
  multiTargetClauses: any[];
};

export function tryPromptCastSpellTargetsFromHand(
  args: CastSpellTargetsFromHandArgs,
): CastSpellTargetsFromHandContinue | void {
  const {
    socket,
    game,
    gameId,
    playerId,
    cardId,
    cardInHand,
    oracleText,
    typeLine,
    isInstantOrSorcery,
    targets,
    xValue,
    skipInteractivePrompts,
    shouldSkipAllPrompts,
    castSourceZone,
    selectedFaceIndex,
    selectedModes,
    selectedAdditionalCostModes,
    entwineCost,
    alternateCostId,
    bypassExilePermissionCheck,
  } = args;

      // Check if this spell requires targets (oracleText is already defined above)
      // IMPORTANT: Only check for targeting if:
      // 1. The spell is an instant/sorcery, OR
      // 2. The spell is an Aura enchantment (Auras target when cast)
      // Non-Aura permanents (creatures, artifacts, regular enchantments, planeswalkers) don't require 
      // targets when cast, even if they have activated/triggered abilities with "target" in the text.
      // This includes Equipment (which are artifacts) - they enter unattached and equipping is a separate ability.
      // An Aura is an enchantment with "Aura" in the type line AND "Enchant" at the start of its oracle text
      const isAura = typeLine.includes('aura') && /^enchant\s+/i.test(oracleText);
      // Use the isInstantOrSorcery already declared above (line 2101)
      const requiresTargetingCheck = isInstantOrSorcery || isAura;
      
      // For Auras, determine valid targets based on "Enchant X" text
      // Common patterns: "Enchant creature", "Enchant player", "Enchant opponent", "Enchant permanent"
      // Also handles: "Enchant creature you control", "Enchant creature an opponent controls", etc.
      let auraTargetType: 'creature' | 'player' | 'opponent' | 'permanent' | 'artifact' | 'land' | null = null;
      let auraControllerRestriction: 'you_control' | 'opponent_controls' | 'any' = 'any';
      if (isAura) {
        const enchantMatch = oracleText.match(/enchant\s+(creature|player|opponent|permanent|artifact|land|enchantment)(?:\s+(you control|an opponent controls))?/i);
        if (enchantMatch) {
          auraTargetType = enchantMatch[1].toLowerCase() as typeof auraTargetType;
          // Check for controller restriction
          if (enchantMatch[2]) {
            const restriction = enchantMatch[2].toLowerCase();
            if (restriction === 'you control') {
              auraControllerRestriction = 'you_control';
            } else if (restriction === 'an opponent controls') {
              auraControllerRestriction = 'opponent_controls';
            }
          }
        }
      }
      
      // Use comprehensive targeting detection for instants/sorceries
      // This catches ALL spells with "target" in their text, not just specific patterns
      const spellSpec = (requiresTargetingCheck && !isAura) ? categorizeSpellWithoutPrimaryRetirement(cardInHand.name || '', oracleText) : null;
      
      // If categorizeSpell didn't find a pattern but the spell has "target" in text,
      // use the comprehensive detection
      const targetReqs = (isInstantOrSorcery && !isAura) ? parseTargetRequirements(oracleText, {
        xValue,
        gameState: game.state,
        controllerId: String(playerId),
        sourceName: String(cardInHand.name || ''),
      }) : null;
      const preferParsedTargetReqs = shouldPreferParsedTargetReqs(targetReqs);
      const multiTargetClauses = !isAura
        ? buildSpellTargetSelectionClauses(game, String(playerId), String(cardInHand.name || ''), oracleText, xValue)
        : [];
      const resolvedMinTargets = spellSpec && !preferParsedTargetReqs
        ? resolveTargetCount(spellSpec.minTargets, (spellSpec as any).minTargetsIsX === true, xValue)
        : resolveTargetCount(targetReqs?.minTargets, (targetReqs as any)?.minTargetsIsX === true, xValue);
      const resolvedMaxTargets = spellSpec && !preferParsedTargetReqs
        ? resolveTargetCount(spellSpec.maxTargets, (spellSpec as any).maxTargetsIsX === true, xValue)
        : resolveTargetCount(targetReqs?.maxTargets, (targetReqs as any)?.maxTargetsIsX === true, xValue);
      
      // Only request target selection if:
      // 1. The spell still requires targets after resolving X (min > 0, or optional up-to-X with max > 0)
      // 2. AND no targets have been provided yet
      // This prevents double-targeting when completeCastSpell is called with targets already set
      const needsTargetSelection = ((spellSpec && !preferParsedTargetReqs) && resolvedMinTargets > 0 && (!targets || targets.length === 0)) || 
                                   (targetReqs && targetReqs.needsTargets && resolvedMaxTargets > 0 && (!targets || targets.length === 0));
      
      // DEBUG: Log targeting logic to debug infinite loop
      debug(2, `[handleCastSpellFromHand] ${cardInHand.name}: spellSpec=${!!spellSpec}, targetReqs=${!!targetReqs}, needsTargetSelection=${needsTargetSelection}, hasTargets=${!!(targets && targets.length > 0)}`);
      
      // Handle Aura targeting separately from spell targeting
      // CRITICAL FIX: Skip Aura target request if we're completing a previous cast
      if (!skipInteractivePrompts && isAura && auraTargetType && (!targets || targets.length === 0)) {
        // Build valid targets based on Aura's enchant type
        let validTargets: { id: string; kind: string; name: string; isOpponent?: boolean; controller?: string; imageUrl?: string }[] = [];
        
        if (auraTargetType === 'player') {
          // Enchant player - can target any player
          validTargets = (game.state.players || []).map((p: any) => ({
            id: p.id,
            kind: 'player',
            name: p.name || p.id,
            isOpponent: p.id !== playerId,
          }));
        } else if (auraTargetType === 'opponent') {
          // Enchant opponent - can only target opponents (Curses typically)
          validTargets = (game.state.players || [])
            .filter((p: any) => p.id !== playerId)
            .map((p: any) => ({
              id: p.id,
              kind: 'player',
              name: p.name || p.id,
              isOpponent: true,
            }));
        } else if (auraTargetType === 'creature') {
          // Enchant creature - target creatures on battlefield
          // Apply controller restriction if present ("you control" or "an opponent controls")
          validTargets = (game.state.battlefield || [])
            .filter((p: any) => {
              const tl = (p.card?.type_line || '').toLowerCase();
              if (!tl.includes('creature')) return false;
              
              // Apply controller restriction
              if (auraControllerRestriction === 'you_control' && p.controller !== playerId) return false;
              if (auraControllerRestriction === 'opponent_controls' && p.controller === playerId) return false;
              if (!canPermanentBeTargetedByPlayer(p, game.state, playerId as PlayerID)) return false;
              
              return true;
            })
            .map((p: any) => ({
              id: p.id,
              kind: 'permanent',
              name: p.card?.name || 'Unknown',
              controller: p.controller,
              isOpponent: p.controller !== playerId,
              imageUrl: p.card?.image_uris?.small || p.card?.image_uris?.normal,
            }));
        } else if (auraTargetType === 'permanent') {
          // Enchant permanent - any permanent
          validTargets = (game.state.battlefield || [])
            .filter((p: any) => canPermanentBeTargetedByPlayer(p, game.state, playerId as PlayerID))
            .map((p: any) => ({
              id: p.id,
              kind: 'permanent',
              name: p.card?.name || 'Unknown',
              controller: p.controller,
              isOpponent: p.controller !== playerId,
              imageUrl: p.card?.image_uris?.small || p.card?.image_uris?.normal,
            }));
        } else if (auraTargetType === 'artifact') {
          validTargets = (game.state.battlefield || [])
            .filter((p: any) => (p.card?.type_line || '').toLowerCase().includes('artifact')
              && canPermanentBeTargetedByPlayer(p, game.state, playerId as PlayerID))
            .map((p: any) => ({
              id: p.id,
              kind: 'permanent',
              name: p.card?.name || 'Unknown',
              controller: p.controller,
              isOpponent: p.controller !== playerId,
              imageUrl: p.card?.image_uris?.small || p.card?.image_uris?.normal,
            }));
        } else if (auraTargetType === 'land') {
          validTargets = (game.state.battlefield || [])
            .filter((p: any) => (p.card?.type_line || '').toLowerCase().includes('land')
              && canPermanentBeTargetedByPlayer(p, game.state, playerId as PlayerID))
            .map((p: any) => ({
              id: p.id,
              kind: 'permanent',
              name: p.card?.name || 'Unknown',
              controller: p.controller,
              isOpponent: p.controller !== playerId,
              imageUrl: p.card?.image_uris?.small || p.card?.image_uris?.normal,
            }));
        }
        
        if (validTargets.length === 0) {
          socket.emit("error", {
            code: "NO_VALID_TARGETS",
            message: `No valid targets for ${cardInHand.name} (Enchant ${auraTargetType})`,
          });
          return;
        }
        
        // Generate effectId for tracking this cast through the workflow
        const effectId = `cast_${cardId}_${Date.now()}`;
        
        // Store pending cast info for after targets are selected (like requestCastSpell does)
        // This ensures target selection response can find the pending spell and request payment
        // IMPORTANT: Copy the full card object to prevent issues where card info is deleted
        // before it can be read during the target > pay workflow (fixes loop issue)
        (game.state as any).pendingSpellCasts = (game.state as any).pendingSpellCasts || {};
        const paymentMetadata = buildPendingCastCostMetadata(game, playerId, cardInHand, 'hand');
        (game.state as any).pendingSpellCasts[effectId] = {
          cardId,
          cardName: cardInHand.name,
          manaCost: cardInHand.mana_cost || "",
          playerId,
          validTargetIds: validTargets.map((t: any) => t.id),
          card: { ...cardInHand }, // Copy full card object to preserve oracle text, type line, etc.
          ...getPendingCastPaymentFields(paymentMetadata),
        };
        
        // Use Resolution Queue for Aura target selection
        const auraTargetStep = ResolutionQueueManager.addStep(gameId, {
          type: ResolutionStepType.TARGET_SELECTION,
          playerId: playerId as PlayerID,
          description: `Choose target for ${cardInHand.name}`,
          mandatory: true,
          sourceId: effectId,
          sourceName: cardInHand.name,
          sourceImage: cardInHand.image_uris?.small || cardInHand.image_uris?.normal,
          validTargets: validTargets.map((t: any) => ({
            id: t.id,
            label: t.name,
            description: t.kind,
            imageUrl: t.imageUrl,
          })),
          targetTypes: ['aura_target'],
          minTargets: 1,
          maxTargets: 1,
          targetDescription: `Enchant ${auraTargetType}`,
          // Store spell casting context for payment request after targets selected
          spellCastContext: {
            cardId,
            cardName: cardInHand.name,
            manaCost: cardInHand.mana_cost || "",
            playerId,
            effectId,
            oracleText: cardInHand.oracle_text || '',
          typeLine: String(cardInHand.type_line || ''),
            imageUrl: cardInHand.image_uris?.small || cardInHand.image_uris?.normal,
          },
        });

        persistQueuedSpellCastStepContinuation(gameId, game, {
          playerId,
          cardId,
          effectId,
          pendingSpellCast: {
            ...((game.state as any).pendingSpellCasts?.[effectId] || {}),
          },
          queuedResolutionStep: {
            ...(auraTargetStep as any),
          },
        });
        
        debug(2, `[castSpellFromHand] Added TARGET_SELECTION step for Aura target (enchant ${auraTargetType}) for ${cardInHand.name}`);
        return; // Wait for target selection via Resolution Queue
      }
      
      // Handle targeting for instants/sorceries
      // Use BOTH spellSpec (for known patterns) and targetReqs (for any "target" text)
      if (needsTargetSelection) {
        // This spell requires targets - check if we have them already
        const requiredMinTargets = resolvedMinTargets;
        const requiredMaxTargets = resolvedMaxTargets;
        
        // CRITICAL: Check if there's already a pending cast for this card to prevent infinite loop
        // If a pending cast exists, it means we've already requested targets before
        if (!skipInteractivePrompts) {
          const existingPendingCast = (game.state as any).pendingSpellCasts ? 
            Object.values((game.state as any).pendingSpellCasts).find((pc: any) => pc.cardId === cardId) : null;
          
          if (existingPendingCast) {
            debugError(1, `[castSpellFromHand] LOOP PREVENTION: Pending cast already exists for ${cardInHand.name}. This should not happen!`);
            socket.emit("error", {
              code: "TARGETING_LOOP_DETECTED",
              message: `Targeting error for ${cardInHand.name}. Please try casting again.`,
            });
            return;
          }
        }
        
        // CRITICAL FIX: Skip target request if we're completing a previous cast (prevents infinite loop)
        debug(2, `[handleCastSpellFromHand] Checking if need to request targets: skipInteractivePrompts=${skipInteractivePrompts}, hasTargets=${!!(targets && targets.length > 0)}, minRequired=${requiredMinTargets}`);
        
        if (!skipInteractivePrompts && (!targets || targets.length < requiredMinTargets)) {
          debug(2, `[handleCastSpellFromHand] Requesting targets for ${cardInHand.name} (minTargets: ${requiredMinTargets}, maxTargets: ${requiredMaxTargets})`);
          // Need to request targets from the player
          // Build valid targets based on what the spell can target
          let validTargetList: { id: string; kind: string; name: string; isOpponent?: boolean; controller?: string; imageUrl?: string; typeLine?: string }[] = [];
          
          if (multiTargetClauses.length > 1) {
            const failingClause = multiTargetClauses.find((clause) => clause.validTargetList.length < clause.minTargets);
            if (failingClause) {
              socket.emit("error", {
                code: "NO_VALID_TARGETS",
                message: `No valid targets for ${cardInHand.name} (${failingClause.targetDescription})`,
              });
              return;
            }

            validTargetList = multiTargetClauses
              .flatMap((clause) => clause.validTargetList)
              .filter((target, index, all) => all.findIndex((candidate) => String(candidate.id) === String(target.id)) === index);
          } else if (spellSpec && !preferParsedTargetReqs) {
            const validRefs = evaluateTargeting(game.state as any, playerId, spellSpec);
            validTargetList = validRefs.map((t: any) => {
              if (t.kind === 'permanent') {
                const perm = (game.state.battlefield || []).find((p: any) => p.id === t.id);
                return {
                  id: t.id,
                  kind: t.kind,
                  name: perm?.card?.name || 'Unknown',
                  imageUrl: perm?.card?.image_uris?.small || perm?.card?.image_uris?.normal,
                  controller: perm?.controller,
                  isOpponent: perm?.controller !== playerId,
                };
              } else if (t.kind === 'stack') {
                const stackItem = (game.state.stack || []).find((s: any) => s.id === t.id);
                return {
                  id: t.id,
                  kind: t.kind,
                  name: stackItem?.card?.name || 'Unknown Spell',
                  imageUrl: stackItem?.card?.image_uris?.small || stackItem?.card?.image_uris?.normal,
                  controller: stackItem?.controller,
                  isOpponent: stackItem?.controller !== playerId,
                  typeLine: stackItem?.card?.type_line,
                };
              } else {
                const player = (game.state.players || []).find((p: any) => p.id === t.id);
                return {
                  id: t.id,
                  kind: t.kind,
                  name: player?.name || t.id,
                  isOpponent: t.id !== playerId,
                };
              }
            });
          } else if (targetReqs) {
            validTargetList = buildSpellTargetListFromRequirements(game, String(playerId), targetReqs);
          }
          
          if (validTargetList.length === 0) {
            socket.emit("error", {
              code: "NO_VALID_TARGETS",
              message: `No valid targets for ${cardInHand.name}`,
            });
            return;
          }

          const groupedTargetResult = buildGroupedSpellTargetMetadata(
            game,
            String(playerId),
            targetReqs,
            validTargetList,
          );
          const targetGrouping = groupedTargetResult.metadata;
          if (groupedTargetResult.missingRequiredPlayerIds.length > 0) {
            socket.emit("error", {
              code: "NO_VALID_TARGETS",
              message: `Cannot cast ${cardInHand.name}: no legal target for ${groupedTargetResult.missingRequiredPlayerIds
                .map((id) => getPlayerName(game, id))
                .join(', ')}`,
            });
            return;
          }
          const groupedMinTargets = targetGrouping
            ? targetGrouping.groups.reduce((sum: number, group: any) => sum + Number(group.minTargets || 0), 0)
            : requiredMinTargets;
          const groupedMaxTargets = targetGrouping
            ? targetGrouping.groups.reduce((sum: number, group: any) => sum + Math.min(Number(group.maxTargets || 0), group.targets.length), 0)
            : requiredMaxTargets;
          
          // Emit target selection request
          const targetDescription = preferParsedTargetReqs
            ? targetReqs?.targetDescription || spellSpec?.targetDescription || 'target'
            : targetReqs?.targetDescription || spellSpec?.targetDescription || 'target';
          const effectId = `cast_${cardId}_${Date.now()}`;
          
          // Store pending cast info for after targets are selected (like requestCastSpell does)
          // This ensures target selection response can find the pending spell and request payment
          // IMPORTANT: Copy the full card object to prevent issues where card info is deleted
          // before it can be read during the target > pay workflow (fixes loop issue)
          (game.state as any).pendingSpellCasts = (game.state as any).pendingSpellCasts || {};
          const paymentMetadata = buildPendingCastCostMetadata(game, playerId, cardInHand, castSourceZone);
          (game.state as any).pendingSpellCasts[effectId] = {
            cardId,
            cardName: cardInHand.name,
            manaCost: cardInHand.mana_cost || "",
            rawManaCost: cardInHand.mana_cost || "",
            playerId,
            fromZone: castSourceZone,
            faceIndex: selectedFaceIndex,
            xValue,
            selectedModes: Array.isArray(selectedModes) ? [...selectedModes] : undefined,
            selectedAdditionalCostModes: Array.isArray(selectedAdditionalCostModes) ? [...selectedAdditionalCostModes] : undefined,
            selectedSpreeModes: Array.isArray((cardInHand as any).selectedSpreeModes)
              ? [...((cardInHand as any).selectedSpreeModes as string[])]
              : undefined,
            castWithEntwine: (cardInHand as any).castWithEntwine === true,
            entwineCost,
            validTargetIds: validTargetList.map((t: any) => t.id),
            ...(targetGrouping ? { targetGrouping } : {}),
            card: { ...cardInHand }, // Copy full card object to preserve oracle text, type line, etc.
            ...getPendingCastPaymentFields(paymentMetadata),
            forcedAlternateCostId: alternateCostId,
            castWithoutPayingManaCost: alternateCostId === 'free' || (cardInHand as any).castWithoutPayingManaCost === true,
            bypassExilePermissionCheck,
          };
          
          // Check for per-opponent targeting (e.g., Dismantling Wave)
          // For these spells, group targets by controller and let player select one per opponent
          if (targetGrouping) {
            const legacyTargetsPerOpponent = targetGrouping.groupPlayers === 'each_opponent'
              ? Object.fromEntries(targetGrouping.groups.map((group: any) => [group.playerId, group.targets]))
              : undefined;
            const perOpponentTargetStep = ResolutionQueueManager.addStep(gameId, {
              type: ResolutionStepType.TARGET_SELECTION,
              playerId: playerId as PlayerID,
              description: `Choose targets for ${cardInHand.name}`,
              mandatory: true,
              sourceId: effectId,
              sourceName: cardInHand.name,
              sourceImage: cardInHand.image_uris?.small || cardInHand.image_uris?.normal,
              validTargets: validTargetList.map((t: any) => ({
                id: t.id,
                label: t.name,
                description: t.kind,
                imageUrl: t.imageUrl,
                controller: t.controller,
              })),
              targetTypes: ['spell_target'],
              minTargets: groupedMinTargets,
              maxTargets: groupedMaxTargets,
              targetDescription,
              targetGrouping,
              perOpponent: targetGrouping.groupPlayers === 'each_opponent',
              ...(legacyTargetsPerOpponent ? { targetsPerOpponent: legacyTargetsPerOpponent } : {}),
              opponents: targetGrouping.groups.map((group: any) => ({ id: group.playerId, name: group.label || group.playerId })),
              minTargetsPerOpponent: targetGrouping.minTargetsPerGroup,
              maxTargetsPerOpponent: targetGrouping.maxTargetsPerGroup,
              spellCastContext: {
                cardId,
                cardName: cardInHand.name,
                manaCost: cardInHand.mana_cost || "",
                playerId,
                effectId,
                oracleText,
                imageUrl: cardInHand.image_uris?.small || cardInHand.image_uris?.normal,
                targetGrouping,
              },
            });

            persistQueuedSpellCastStepContinuation(gameId, game, {
              playerId,
              cardId,
              effectId,
              pendingSpellCast: {
                ...((game.state as any).pendingSpellCasts?.[effectId] || {}),
              },
              queuedResolutionStep: {
                ...(perOpponentTargetStep as any),
              },
            });
            
            debug(2, `[castSpellFromHand] Added grouped TARGET_SELECTION step for ${cardInHand.name} (${targetGrouping.groups.length} players)`);
            return; // Wait for target selection via Resolution Queue
          }
          
          if (multiTargetClauses.length > 1) {
            const targetSteps: any[] = [];
            for (const clause of multiTargetClauses) {
              const targetStep = ResolutionQueueManager.addStep(gameId, {
                type: ResolutionStepType.TARGET_SELECTION,
                playerId: playerId as PlayerID,
                description: `Choose ${clause.targetDescription} for ${cardInHand.name}`,
                mandatory: clause.minTargets > 0,
                sourceId: effectId,
                sourceName: cardInHand.name,
                sourceImage: cardInHand.image_uris?.small || cardInHand.image_uris?.normal,
                validTargets: clause.validTargetList.map((t: any) => ({
                  id: t.id,
                  label: t.name,
                  description: t.kind,
                  imageUrl: t.imageUrl,
                })),
                targetTypes: ['spell_target'],
                minTargets: clause.minTargets,
                maxTargets: clause.maxTargets,
                targetDescription: clause.targetDescription,
                spellCastContext: {
                  cardId,
                  cardName: cardInHand.name,
                  manaCost: cardInHand.mana_cost || "",
                  playerId,
                  effectId,
                  oracleText,
                  imageUrl: cardInHand.image_uris?.small || cardInHand.image_uris?.normal,
                },
              });
              targetSteps.push({ ...(targetStep as any) });
            }

            persistQueuedSpellCastStepContinuation(gameId, game, {
              playerId,
              cardId,
              effectId,
              pendingSpellCast: {
                ...((game.state as any).pendingSpellCasts?.[effectId] || {}),
              },
              queuedResolutionSteps: targetSteps,
            });

            debug(2, `[castSpellFromHand] Added ${multiTargetClauses.length} TARGET_SELECTION steps for ${cardInHand.name}`);
          } else {
            const targetStep = ResolutionQueueManager.addStep(gameId, {
              type: ResolutionStepType.TARGET_SELECTION,
              playerId: playerId as PlayerID,
              description: `Choose ${targetDescription} for ${cardInHand.name}`,
              mandatory: true,
              sourceId: effectId,
              sourceName: cardInHand.name,
              sourceImage: cardInHand.image_uris?.small || cardInHand.image_uris?.normal,
              validTargets: validTargetList.map((t: any) => ({
                id: t.id,
                label: t.name,
                description: t.kind,
                imageUrl: t.imageUrl,
              })),
              targetTypes: ['spell_target'],
              minTargets: requiredMinTargets,
              maxTargets: requiredMaxTargets,
              targetDescription,
              // Store spell casting context for payment request after targets selected
              spellCastContext: {
                cardId,
                cardName: cardInHand.name,
                manaCost: cardInHand.mana_cost || "",
                playerId,
                effectId,
                oracleText,
                imageUrl: cardInHand.image_uris?.small || cardInHand.image_uris?.normal,
              },
            });

            persistQueuedSpellCastStepContinuation(gameId, game, {
              playerId,
              cardId,
              effectId,
              pendingSpellCast: {
                ...((game.state as any).pendingSpellCasts?.[effectId] || {}),
              },
              queuedResolutionStep: {
                ...(targetStep as any),
              },
            });
            
            debug(2, `[castSpellFromHand] Added TARGET_SELECTION step for ${requiredMinTargets}-${requiredMaxTargets} target(s) for ${cardInHand.name} (${targetDescription})`);
          }
          return; // Wait for target selection via Resolution Queue
        } else {
          debug(2, `[handleCastSpellFromHand] Skipping target request - already have ${targets?.length || 0} target(s) or skipInteractivePrompts=${skipInteractivePrompts}`);
        }
        
        // Validate provided targets if we have a spellSpec
        if (shouldSkipAllPrompts && multiTargetClauses.length > 1 && targets && targets.length > 0) {
          debug(2, `[handleCastSpellFromHand] Validating ${targets.length} queued multi-clause target(s) for ${cardInHand.name}`);
          const validTargetIds = new Set(
            multiTargetClauses
              .flatMap((clause) => clause.validTargetList)
              .map((target) => String(target.id))
          );

          for (const target of targets) {
            const targetId = typeof target === 'string' ? target : target.id;
            if (!validTargetIds.has(String(targetId))) {
              debugError(1, `[handleCastSpellFromHand] INVALID QUEUED TARGET: ${targetId} not in queued clause set`);
              socket.emit("error", {
                code: "INVALID_TARGET",
                message: `Invalid target for ${cardInHand.name}`,
              });
              return;
            }
          }
          debug(2, `[handleCastSpellFromHand] Queued multi-clause targets validated successfully`);
        } else if (spellSpec && targets && targets.length > 0) {
          debug(2, `[handleCastSpellFromHand] Validating ${targets.length} target(s) for ${cardInHand.name}`);
          const validRefs = evaluateTargeting(game.state as any, playerId, spellSpec);
          const validTargetIds = new Set(validRefs.map((t: any) => t.id));
          
          for (const target of targets) {
            const targetId = typeof target === 'string' ? target : target.id;
            if (!validTargetIds.has(targetId)) {
              debugError(1, `[handleCastSpellFromHand] INVALID TARGET: ${targetId} not in valid set`);
              socket.emit("error", {
                code: "INVALID_TARGET",
                message: `Invalid target for ${cardInHand.name}`,
              });
              return;
            }
          }
          debug(2, `[handleCastSpellFromHand] All targets validated successfully`);
        }
      } // Close if (needsTargetSelection)
      
      debug(2, `[handleCastSpellFromHand] ======== DEBUG END ========`);

  return {
    kind: "continue",
    isAura,
    auraTargetType,
    auraControllerRestriction,
    spellSpec,
    targetReqs,
    preferParsedTargetReqs,
    multiTargetClauses,
  };
}
