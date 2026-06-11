import type { PlayerID } from '../../../../shared/src/index.js';
import type { GameContext } from '../context.js';
import { parsePT, uid } from '../utils.js';
import { ResolutionQueueManager, ResolutionStepType } from '../resolution/index.js';
import { detectLinkedExileEffect } from './triggers/linked-exile.js';
import { recordCardLeftGraveyardThisTurn } from './turn-tracking.js';
import { debug, debugWarn } from '../../utils/debug.js';
import { appendEvent } from '../../db/index.js';
import { markPermanentEnteredFromZone, parseBattlefieldCounterClause, addCreatureType } from './triggerDelayedEffectUtils.js';
import { destroyPermanent, movePermanentToExile } from './counters_tokens.js';
import { triggerETBEffectsForPermanent } from './triggerEtbPermanentBridge.js';
import { movePermanentToHand } from './zones.js';
import { appendQueuedResolutionPromptEvent } from './resolutionPromptEvents.js';
import { queueCastFromExileResolutionPrompt } from './triggerCastFromExileUtils.js';
import { applyTriggeredReanimationEntryRiders } from './triggerReanimationRiders.js';
import { skipRetiredTriggerLegacyHandler } from './oracleIrTriggerLegacyRouting.js';

function splitRulesTextIntoSentences(text: string): string[] {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .split(/(?<=\.)\s+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function extractGraveyardZoneChangeSentence(text: string, destination: 'battlefield' | 'hand'): string {
  const normalizedText = String(text || '').replace(/\s+/g, ' ').trim();
  const clausePattern = destination === 'battlefield'
    ? /(?:return|put)\s+.+?\s+from\s+(?:your|a|any|an\s+opponent['']?s?)\s+graveyard\s+(?:to|onto)\s+the\s+battlefield(?:\s+tapped)?(?:\s+under\s+(?:your|its owner['']s)\s+control)?(?:\s+with\s+[^.]+?\s+counters?\s+on\s+it)?(?:\s+attached\s+to\s+[^.]+?)?(?:\s+and\s+attach\s+[^.]+?\s+to\s+it)?/i
    : /(?:return|put)\s+.+?\s+from\s+(?:your|a|any|an\s+opponent['']?s?)\s+graveyard\s+to\s+(?:your\s+hand|its\s+owner['']s\s+hand)/i;
  const clauseMatch = normalizedText.match(clausePattern);
  if (clauseMatch) {
    return clauseMatch[0];
  }

  const destinationPattern = destination === 'battlefield'
    ? /\b(?:to|onto)\s+the\s+battlefield\b/i
    : /\bto\s+(?:your\s+hand|its\s+owner['']s\s+hand)\b/i;

  const matchedSentence = splitRulesTextIntoSentences(text).find((sentence) => (
    /^(?:return|put)\b/i.test(sentence)
    && /\bgraveyard\b/i.test(sentence)
    && destinationPattern.test(sentence)
  ));

  return matchedSentence || normalizedText;
}

export function applyRetiredTriggerLegacyGraveyardZoneChangeBatch(
  params: {
    readonly ctx: GameContext;
    readonly controller: PlayerID;
    readonly sourceName: string;
    readonly desc: string;
    readonly triggerItem: any;
    readonly state: any;
  },
): boolean {
  if (skipRetiredTriggerLegacyHandler(params.desc, params.sourceName)) {
    return false;
  }

  const {
    ctx,
    controller,
    sourceName,
    desc,
    triggerItem,
    state,
  } = params;

    // Pattern: "exile target [type] card from a graveyard" or "exile up to one target card from any graveyard"
  if (/exile\s+(?:up\s+to\s+one\s+)?target\s+(?:(?:[^.]+?)\s+)?card(?:\s+with\s+mana\s+value\s+[^.]+?)?\s+from\s+(?:your|a|any|an\s+opponent['’]?s?)\s+graveyard/i.test(desc)) {
    const targets = Array.isArray((triggerItem as any).targets) ? (triggerItem as any).targets : [];
    const targetCardId = String(targets[0] || '').trim();
    if (!targetCardId) {
      return true;
    }

    const zonesAll = (state as any).zones || {};
    let targetOwnerId: string | null = null;
    let removedCard: any = null;

    for (const [playerId, playerZonesAny] of Object.entries(zonesAll)) {
      const playerZones = playerZonesAny as any;
      const graveyard = Array.isArray(playerZones?.graveyard) ? playerZones.graveyard : [];
      const graveyardIndex = graveyard.findIndex((card: any) => card && String(card.id || '') === targetCardId);
      if (graveyardIndex === -1) continue;

      removedCard = graveyard[graveyardIndex];
      graveyard.splice(graveyardIndex, 1);
      playerZones.graveyardCount = graveyard.length;
      targetOwnerId = String(playerId);
      break;
    }

    if (!removedCard || !targetOwnerId) {
      return true;
    }

    const taggedCard = {
      ...(removedCard as any),
      zone: 'exile',
      ...(triggerItem.source ? { exiledWithSourceId: String(triggerItem.source) } : {}),
      ...(sourceName ? { exiledWithSourceName: sourceName } : {}),
      ...(triggerItem.card?.oracle_id ? { exiledWithOracleId: String(triggerItem.card.oracle_id) } : {}),
    };

    const ownerZones = (state as any).zones?.[targetOwnerId];
    if (ownerZones) {
      ownerZones.exile = Array.isArray(ownerZones.exile) ? ownerZones.exile : [];
      ownerZones.exile.push(taggedCard);
      ownerZones.exileCount = ownerZones.exile.length;
    }

    const battlefield = Array.isArray(state.battlefield) ? state.battlefield : [];
    const sourcePermanent = battlefield.find((perm: any) => perm && String(perm.id || '') === String(triggerItem.source || ''));
    if (sourcePermanent) {
      (sourcePermanent as any).exiledCards = Array.isArray((sourcePermanent as any).exiledCards)
        ? (sourcePermanent as any).exiledCards
        : [];
      (sourcePermanent as any).exiledCards.push({ ...taggedCard, exiledWith: String(triggerItem.source || '') || undefined });
    }

    const shouldCreateCastableCopy = /\bcopy it\b/i.test(desc)
      && /\byou may cast the copy without paying its mana cost\b/i.test(desc);
    if (shouldCreateCastableCopy) {
      const controllerZones = (state as any).zones?.[controller];
      if (controllerZones) {
        controllerZones.exile = Array.isArray(controllerZones.exile) ? controllerZones.exile : [];
        const copiedCard = {
          ...(removedCard as any),
          id: uid('graveyard_copy'),
          zone: 'exile',
          isCopy: true,
          copiedFromCardId: String((removedCard as any)?.id || ''),
          canBePlayedBy: controller,
          playableUntilTurn: Number((state as any)?.turnNumber ?? 0),
          withoutPayingManaCost: true,
          ceaseOnResolution: true,
          ceaseOnCounter: true,
          graveyardGeneratedCopy: true,
          castFromExileDeclineDestination: 'cease_to_exist',
        };
        controllerZones.exile.push(copiedCard);
        controllerZones.exileCount = controllerZones.exile.length;

        const gameId = String((ctx as any).gameId || '').trim();
        if (gameId && gameId !== 'unknown' && !(ctx as any).isReplaying) {
          queueCastFromExileResolutionPrompt(
            ctx,
            gameId,
            String(controller) as PlayerID,
            String(sourceName || 'Ability'),
            String((triggerItem as any).source || '').trim() || undefined,
            (triggerItem as any)?.sourceImage || (triggerItem as any)?.card?.image_uris?.small || (triggerItem as any)?.card?.image_uris?.normal,
            copiedCard,
          );
        }

        debug(2, `[executeTriggerEffect] ${sourceName} created castable exile copy of ${removedCard?.name || targetCardId}`);
      }
    }

    debug(2, `[executeTriggerEffect] ${sourceName} exiled ${removedCard?.name || targetCardId} from ${targetOwnerId}'s graveyard`);
    return true;
  }
  
  // Pattern: "exile target creature/permanent ... until ~ leaves the battlefield" (Oblivion Ring-style)
  // This is a LINKED exile - the exiled card returns when the source permanent leaves
  const linkedExileMatch = desc.match(/exile (?:target |that )?([^.]+) until [^.]* leaves the battlefield/i);
  if (linkedExileMatch) {
    const targets = triggerItem.targets || [];
    if (targets.length > 0) {
      const targetPerm = (state.battlefield || []).find((p: any) => p?.id === targets[0]);
      if (targetPerm) {
        const sourceId = String(triggerItem.sourceId || triggerItem.permanentId || triggerItem.source || '').trim();
        const sourceOracleId = String(triggerItem.card?.id || '').trim();
        const exiledCardName = targetPerm.card?.name || targetPerm.id;

        movePermanentToExile(ctx, targetPerm.id, {
          ...(sourceId ? { exiledWithSourceId: sourceId, exiledWithSourceName: sourceName } : {}),
          ...(sourceOracleId ? { exiledWithOracleId: sourceOracleId } : {}),
          linkedExileData: {
            exilingPermanentId: sourceId,
            exilingPermanentName: sourceName,
            originalOwner: String(targetPerm.owner || ''),
            originalController: String(targetPerm.controller || targetPerm.owner || ''),
          },
        });

        if (targetPerm.isToken || targetPerm.card?.isToken) {
          debug(2, `[executeTriggerEffect] ${exiledCardName} token ceases to exist (not added to exile, no return)`);
        } else {
          debug(2, `[executeTriggerEffect] ${sourceName} exiled ${exiledCardName} - will return when ${sourceName} leaves the battlefield`);
        }
      }
    }
    return true;
  }
  
  // Pattern: "exile target creature" or "exile it" (simple exile, no return)
  const simpleExileSentence = splitRulesTextIntoSentences(desc).find((sentence) => /^exile\b/i.test(sentence)) || desc;
  const exileMatch = /\bat\s+the\s+beginning\s+of\s+the\s+next\s+end\s+step\b/i.test(simpleExileSentence)
    ? null
    : (simpleExileSentence.match(/^exile\s+(?:(?:two|three|four|five|\d+)\s+)?target\s+(?:creatures?|permanents?|cards?)\.?$/i) ||
       simpleExileSentence.match(/^exile\s+(?:target\s+(?:creature|permanent)|it|that creature)\.?$/i));
  if (exileMatch) {
    const targets = triggerItem.targets || [];
    for (const targetId of targets) {
      const targetPerm = (state.battlefield || []).find((p: any) => p?.id === targetId);
      if (targetPerm) {
        // Check if the source card has a linked exile effect
        const sourceCard = triggerItem.card;
        const linkedEffect = sourceCard ? detectLinkedExileEffect(sourceCard) : null;
        
        // Use movePermanentToExile to properly handle commander replacement effects
        // Import and use the function from counters_tokens
        try {
          const oracleLower = String(triggerItem.card?.oracle_text || '').toLowerCase();
          const shouldTagExiledWith = oracleLower.includes('exiled with');

          const sourceId = triggerItem.sourceId || triggerItem.permanentId || triggerItem.source;
          const sourceOracleId = triggerItem.card?.id;
          movePermanentToExile(ctx, targetPerm.id, {
            ...(shouldTagExiledWith && sourceId ? { exiledWithSourceId: sourceId, exiledWithSourceName: sourceName } : {}),
            ...(shouldTagExiledWith && sourceOracleId ? { exiledWithOracleId: String(sourceOracleId) } : {}),
            ...(linkedEffect?.hasLinkedExile
              ? {
                  linkedExileData: {
                    exilingPermanentId: String(sourceId || ''),
                    exilingPermanentName: sourceName,
                    originalOwner: String(targetPerm.owner || ''),
                    originalController: String(targetPerm.controller || targetPerm.owner || ''),
                  },
                }
              : {}),
          });

          if (linkedEffect?.hasLinkedExile && targetPerm.card && !targetPerm.isToken && !targetPerm.card?.isToken) {
            debug(2, `[executeTriggerEffect] ${sourceName} exiled ${targetPerm.card?.name || targetPerm.id} (linked - returns when ${sourceName} leaves)`);
          } else if (!targetPerm.isToken && !targetPerm.card?.isToken) {
            debug(2, `[executeTriggerEffect] Exiled ${targetPerm.card?.name || targetPerm.id}`);
          }
        } catch (err) {
          debugWarn(1, `[executeTriggerEffect] Error calling movePermanentToExile:`, err);
        }
      }
    }
    return true;
  }
  
  // Pattern: "destroy target creature" or "destroy it"  
  const destroyMatch = desc.match(/destroy (?:target (?:creature(?: or planeswalker)?|planeswalker|permanent|noncreature permanent|noncreature artifact|artifact|enchantment|land)|it|that creature)/i);
  if (destroyMatch) {
    const targets = triggerItem.targets || [];
    if (targets.length > 0) {
      const targetPerm = (state.battlefield || []).find((p: any) => p?.id === targets[0]);
      if (targetPerm) {
        if (destroyPermanent(ctx, targetPerm.id)) {
          debug(2, `[executeTriggerEffect] Destroyed ${targetPerm.card?.name || targetPerm.id}`);
        }
      }
    }
    return true;
  }

    // Pattern: "return any number of target [type] cards with total power N or less from a graveyard to the battlefield"
    const graveyardBattlefieldSentence = extractGraveyardZoneChangeSentence(desc, 'battlefield');
    const graveyardMultiToBattlefieldMatch = graveyardBattlefieldSentence.match(/^(?:return|put)\s+any\s+number\s+of\s+target\s+(?:(?:creature|artifact|enchantment|land|instant|sorcery|planeswalker|nonland|noncreature)\s+)?cards?\s+with\s+total\s+power\s+\d+\s+or\s+less\s+from\s+(?:your|a|any|an\s+opponent['’]?s?)\s+graveyard\s+(?:to|onto)\s+the\s+battlefield(?:\s+tapped)?(?:\s+under\s+(your|its owner['’]s)\s+control)?(?:\s+with\s+[^.]+?\s+counters?\s+on\s+it)?\.?$/i);
    if (graveyardMultiToBattlefieldMatch) {
      const targetIds = Array.isArray(triggerItem.targets)
        ? triggerItem.targets.map((value: any) => String(value || '').trim()).filter(Boolean)
        : [];
      if (targetIds.length === 0) {
        return true;
      }

      const zones = state.zones || {};
      const battlefield = state.battlefield = state.battlefield || [];
      const entersTapped = /\bthe\s+battlefield\s+tapped\b/i.test(String(graveyardMultiToBattlefieldMatch[0] || ''));
      const controllerMode = String(graveyardMultiToBattlefieldMatch[1] || '').toLowerCase();
      const battlefieldCounters = parseBattlefieldCounterClause(desc) || {};

      for (const targetId of targetIds) {
        let sourceOwnerId = '';
        let card: any;

        for (const [ownerId, playerZones] of Object.entries(zones as Record<string, any>)) {
          const graveyard = Array.isArray(playerZones?.graveyard) ? playerZones.graveyard : [];
          const idx = graveyard.findIndex((entry: any) => String(entry?.id || '') === targetId);
          if (idx === -1) continue;

          sourceOwnerId = String(ownerId);
          [card] = graveyard.splice(idx, 1);
          playerZones.graveyardCount = graveyard.length;
          break;
        }

        if (!(card && sourceOwnerId)) {
          continue;
        }

        recordCardLeftGraveyardThisTurn(ctx, sourceOwnerId, card);

        const typeLine = String(card?.type_line || '').toLowerCase();
        const isCreature = typeLine.includes('creature');
        const isPlaneswalker = typeLine.includes('planeswalker');
        const hasHaste =
          String(card?.oracle_text || '').toLowerCase().includes('haste') ||
          (Array.isArray(card?.keywords) && card.keywords.some((keyword: any) => String(keyword || '').toLowerCase() === 'haste'));
        const battlefieldControllerId = controllerMode.includes('owner') ? sourceOwnerId : String(controller);

        const permanent: any = {
          id: uid('perm'),
          controller: battlefieldControllerId,
          owner: sourceOwnerId,
          tapped: entersTapped,
          counters: { ...battlefieldCounters },
          basePower: isCreature ? parsePT(card?.power) : undefined,
          baseToughness: isCreature ? parsePT(card?.toughness) : undefined,
          summoningSickness: isCreature && !hasHaste,
          card: { ...card, zone: 'battlefield' },
        };

        if (isPlaneswalker && card?.loyalty) {
          const loyaltyValue = parseInt(String(card.loyalty), 10);
          if (!Number.isNaN(loyaltyValue)) {
            permanent.counters = { ...permanent.counters, loyalty: loyaltyValue };
            permanent.loyalty = loyaltyValue;
            permanent.baseLoyalty = loyaltyValue;
          }
        }

        markPermanentEnteredFromZone(permanent, 'graveyard');
        battlefield.push(permanent);
        if (!(ctx as any).isReplaying) {
          triggerETBEffectsForPermanent(ctx, permanent, battlefieldControllerId as PlayerID);
        }
        debug(2, `[executeTriggerEffect] ${sourceName} returned ${card?.name || targetId} from ${sourceOwnerId}'s graveyard to the battlefield under ${battlefieldControllerId}'s control`);
      }
      return true;
    }

    // Pattern: "return target [type] card from a graveyard to the battlefield"
    const graveyardToBattlefieldMatch = graveyardBattlefieldSentence.match(/^(?:return|put)\s+(?:up\s+to\s+one\s+)?target\s+(?:(?:[^.]+?)\s+)?card(?:\s+with\s+mana\s+value\s+.+?)?\s+from\s+(?:your|a|any|an\s+opponent['’]?s?)\s+graveyard\s+(?:to|onto)\s+the\s+battlefield(?:\s+tapped)?(?:\s+under\s+(your|its owner['’]s)\s+control)?(?:\s+with\s+[^.]+?\s+counters?\s+on\s+it)?(?:\s+attached\s+to\s+[^.]+?)?(?:\s+and\s+attach\s+[^.]+?\s+to\s+it)?\.?$/i);
    const hasSingleTargetGraveyardToBattlefieldEffect = /\b(?:return|put)\s+(?:up\s+to\s+one\s+)?target\b[\s\S]*?\bfrom\s+(?:your|a|any|an\s+opponent['’]?s?)\s+graveyard\b[\s\S]*?\b(?:to|onto)\s+the\s+battlefield\b/i.test(desc);
    if (graveyardToBattlefieldMatch || hasSingleTargetGraveyardToBattlefieldEffect) {
      const targets = Array.isArray(triggerItem.targets) ? triggerItem.targets : [];
      const targetId = String(targets[0] || '').trim();
      if (!targetId) {
        // Unresolved keyword target choices like soulshift should fall through to keyword handling.
      } else {

      const zones = state.zones || {};
      let sourceOwnerId = '';
      let card: any;

      for (const [ownerId, playerZones] of Object.entries(zones as Record<string, any>)) {
        const graveyard = Array.isArray(playerZones?.graveyard) ? playerZones.graveyard : [];
        const idx = graveyard.findIndex((entry: any) => String(entry?.id || '') === targetId);
        if (idx === -1) continue;

        sourceOwnerId = String(ownerId);
        [card] = graveyard.splice(idx, 1);
        playerZones.graveyardCount = graveyard.length;
        break;
      }

      if (!(card && sourceOwnerId)) {
        return true;
      }

      recordCardLeftGraveyardThisTurn(ctx, sourceOwnerId, card);

      const battlefield = state.battlefield = state.battlefield || [];
      const typeLine = String(card?.type_line || '').toLowerCase();
      const isCreature = typeLine.includes('creature');
      const isPlaneswalker = typeLine.includes('planeswalker');
      const hasHaste =
        String(card?.oracle_text || '').toLowerCase().includes('haste') ||
        (Array.isArray(card?.keywords) && card.keywords.some((keyword: any) => String(keyword || '').toLowerCase() === 'haste'));
      const entersTapped = /\bthe\s+battlefield\s+tapped\b/i.test(String(graveyardToBattlefieldMatch?.[0] || graveyardBattlefieldSentence || desc));
      const controllerModeMatch = String(graveyardToBattlefieldMatch?.[1] || '').trim()
        || String(graveyardBattlefieldSentence.match(/\bunder\s+(your|its owner['’]s)\s+control\b/i)?.[1] || '').trim();
      const controllerMode = controllerModeMatch.toLowerCase();
      const battlefieldControllerId = controllerMode.includes('owner') ? sourceOwnerId : String(controller);
      const battlefieldCounters = parseBattlefieldCounterClause(desc) || {};

      const permanent: any = {
        id: uid('perm'),
        controller: battlefieldControllerId,
        owner: sourceOwnerId,
        tapped: entersTapped,
        counters: battlefieldCounters,
        basePower: isCreature ? parsePT(card?.power) : undefined,
        baseToughness: isCreature ? parsePT(card?.toughness) : undefined,
        summoningSickness: isCreature && !hasHaste,
        card: { ...card, zone: 'battlefield' },
      };

      if (isPlaneswalker && card?.loyalty) {
        const loyaltyValue = parseInt(String(card.loyalty), 10);
        if (!Number.isNaN(loyaltyValue)) {
          permanent.counters = { ...permanent.counters, loyalty: loyaltyValue };
          permanent.loyalty = loyaltyValue;
          permanent.baseLoyalty = loyaltyValue;
        }
      }

      markPermanentEnteredFromZone(permanent, 'graveyard');
      battlefield.push(permanent);
      debug(2, `[executeTriggerEffect] ${sourceName} returned ${card?.name || targetId} from ${sourceOwnerId}'s graveyard to the battlefield under ${battlefieldControllerId}'s control`);
      applyTriggeredReanimationEntryRiders(ctx, permanent, sourceName, battlefieldControllerId as PlayerID, desc, String(permanent.card?.name || targetId || ''));

      // Trailing color/type rider — "That creature is a black Zombie in addition to its other colors and types."
      try {
        const COLOR_WORD_TO_LETTER_TRIG: Record<string, string> = {
          white: 'W', blue: 'U', black: 'B', red: 'R', green: 'G',
        };
        const colorTypePattern = /(?:that\s+(?:creature|permanent|card)|it)\s+is\s+a\s+(white|blue|black|red|green)\s+([A-Za-z][A-Za-z'-]+)\s+in\s+addition\s+to\s+(?:its|their)\s+other\s+colors?\s+and\s+types?/i;
        const ctMatch = colorTypePattern.exec(desc);
        if (ctMatch) {
          const colorWord = String(ctMatch[1] || '').toLowerCase();
          const subtype = String(ctMatch[2] || '').replace(/^./, (c) => c.toUpperCase());
          const colorLetter = COLOR_WORD_TO_LETTER_TRIG[colorWord];
          if (subtype) {
            addCreatureType(permanent, subtype);
          }
          if (colorLetter) {
            permanent.card = permanent.card || {};
            permanent.card.colors = Array.isArray(permanent.card.colors) ? permanent.card.colors.slice() : [];
            if (!permanent.card.colors.includes(colorLetter)) {
              permanent.card.colors.push(colorLetter);
            }
          }
          debug(2, `[executeTriggerEffect] ${sourceName} added color/type ${colorWord}/${subtype} to ${permanent.card?.name || targetId}`);
        }
      } catch (err) {
        debugWarn(1, '[executeTriggerEffect] trigger-side color/type rider failed:', err);
      }

      // Trailing scry rider — "Scry N." or "If it's your turn, scry N."
      try {
        const stateAnyT: any = (ctx as any).state;
        const gameIdLocalT: string | undefined = (ctx as any).gameId;
        const isReplayingT = !!(ctx as any).isReplaying;
        if (gameIdLocalT && gameIdLocalT !== 'unknown' && !isReplayingT) {
          const scryRiderPatternT = /(?:^|\.\s+|\s)(?:if\s+it['\u2019]s\s+your\s+turn\s*,\s*)?scry\s+(\d+)\s*(?:\.|$)/i;
          const sm = scryRiderPatternT.exec(desc);
          if (sm) {
            const scryN = Math.max(0, Number(sm[1] || 0));
            const requiresOwnTurn = /if\s+it['\u2019]s\s+your\s+turn/i.test(String(sm[0] || ''));
            const turnPlayer = String(stateAnyT?.turnPlayer || '');
            const controllerId = String(battlefieldControllerId);
            const ownTurn = !requiresOwnTurn || turnPlayer === controllerId;
            if (scryN > 0 && ownTurn) {
              const sourceIdStr = String((triggerItem as any).id || (triggerItem as any).source || '');
              const existing = ResolutionQueueManager
                .getStepsForPlayer(gameIdLocalT, controllerId as any)
                .find((s: any) => s.type === ResolutionStepType.SCRY && (s as any)?.sourceId && sourceIdStr && String((s as any).sourceId) === sourceIdStr);
              if (!existing) {
                const step = ResolutionQueueManager.addStep(gameIdLocalT, {
                  type: ResolutionStepType.SCRY,
                  playerId: controllerId,
                  description: `${sourceName}: Scry ${scryN}`,
                  mandatory: true,
                  sourceId: sourceIdStr || undefined,
                  sourceName,
                  scryCount: scryN,
                } as any);
                appendQueuedResolutionPromptEvent(ctx, {
                  playerId: controllerId as any,
                  sourceId: sourceIdStr || String((step as any)?.sourceId || '').trim(),
                  queuedResolutionStep: step,
                });
                debug(2, `[executeTriggerEffect] ${sourceName} queued trailing scry ${scryN} for ${controllerId}`);
              }
            }
          }
        }
      } catch (err) {
        debugWarn(1, '[executeTriggerEffect] trigger-side scry rider failed:', err);
      }

      // Trailing Aura "attached to ..." rider — Iridescent Drake / Animate-Dead family.
      // When the just-reanimated card is an Aura and the trigger text says
      // "attached to <self> / it / <source name>", set permanent.attachedTo to the
      // trigger source permanent so the Aura enters legally attached.
      try {
        const reanimatedTypeLine = String(permanent.card?.type_line || '').toLowerCase();
        const isAura = reanimatedTypeLine.includes('aura');
        if (isAura) {
          const triggerSourceId = String((triggerItem as any).source || '').trim();
          const sourceNameLower = String(sourceName || '').toLowerCase();
          const escapedSourceName = sourceNameLower.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
          const attachAlternation = escapedSourceName
            ? `(?:it|~|${escapedSourceName})`
            : `(?:it|~)`;
          const attachPattern = new RegExp(`attached\\s+to\\s+${attachAlternation}\\b`, 'i');
          if (attachPattern.test(desc) && triggerSourceId) {
            // Verify the trigger source still exists on the battlefield as a creature
            // (Auras attach to creatures by default; defer non-creature subtype handling
            // for now since current Iridescent Drake / Animate Dead patterns target creatures).
            const attachTarget = (state.battlefield || []).find((p: any) => String(p?.id || '') === triggerSourceId);
            if (attachTarget) {
              permanent.attachedTo = triggerSourceId;
              debug(2, `[executeTriggerEffect] ${sourceName} attached reanimated Aura ${permanent.card?.name || targetId} to ${triggerSourceId}`);
            }
          }
        }
      } catch (err) {
        debugWarn(1, '[executeTriggerEffect] trigger-side aura-attach rider failed:', err);
      }

      // Trigger-side source-enchantment attach rider — Necromancy / Animate Dead family.
      // The trigger source permanent resolves first, then the ETB trigger reanimates a creature
      // and explicitly attaches the source enchantment to that creature.
      try {
        const triggerSourceId = String((triggerItem as any).source || '').trim();
        const sourceNameLower = String(sourceName || '').toLowerCase();
        const escapedSourceName = sourceNameLower.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
        const sourceAttachPattern = new RegExp(
          `attach\\s+(?:this\\s+enchantment|${escapedSourceName || '~'}|~)\\s+to\\s+it\\b`,
          'i'
        );
        const attachSource = triggerSourceId
          ? (state.battlefield || []).find((p: any) => String(p?.id || '') === triggerSourceId)
          : null;
        if (attachSource && sourceAttachPattern.test(desc)) {
          const currentTypeLine = String(attachSource?.card?.type_line || '').trim();
          if (/\benchantment\b/i.test(currentTypeLine) && !/\baura\b/i.test(currentTypeLine)) {
            attachSource.card = attachSource.card || {};
            attachSource.card.type_line = currentTypeLine.includes('—')
              ? `${currentTypeLine} Aura`
              : `${currentTypeLine} — Aura`;
          }

          if (attachSource.attachedTo) {
            const previousTarget = (state.battlefield || []).find((p: any) => String(p?.id || '') === String(attachSource.attachedTo));
            if (previousTarget) {
              (previousTarget as any).attachments = Array.isArray((previousTarget as any).attachments)
                ? (previousTarget as any).attachments.filter((id: string) => id !== String(attachSource.id || ''))
                : [];
            }
          }

          attachSource.attachedTo = String(permanent.id || targetId || '');
          (permanent as any).attachments = Array.isArray((permanent as any).attachments)
            ? (permanent as any).attachments
            : [];
          if (!(permanent as any).attachments.includes(String(attachSource.id || ''))) {
            (permanent as any).attachments.push(String(attachSource.id || ''));
          }

          try {
            const replayGameId = String((ctx as any).gameId || '').trim();
            if (replayGameId) {
              appendEvent(replayGameId, (state as any).seq ?? 0, 'attachEnchantmentPermanent', {
                playerId: controller,
                enchantmentId: String(attachSource.id || ''),
                enchantmentName: String(attachSource.card?.name || sourceName || 'Enchantment'),
                targetPermanentId: String(permanent.id || targetId || ''),
                targetPermanentName: String(permanent.card?.name || targetId || 'Permanent'),
              });
            }
          } catch (err) {
            debugWarn(1, '[executeTriggerEffect] appendEvent(attachEnchantmentPermanent) failed:', err);
          }

          debug(2, `[executeTriggerEffect] ${sourceName} attached source enchantment ${attachSource.card?.name || attachSource.id} to ${permanent.card?.name || targetId}`);
        }
      } catch (err) {
        debugWarn(1, '[executeTriggerEffect] trigger-side source enchantment attach rider failed:', err);
      }

      if (!(ctx as any).isReplaying) {
        triggerETBEffectsForPermanent(ctx, permanent, battlefieldControllerId as PlayerID);
      }

      return true;
      }
    }

    // Pattern: "return target [type] card from a graveyard to its owner's hand"
    const graveyardToHandMatch = desc.match(/return\s+(?:up\s+to\s+one\s+)?target\s+(?:(?:[^.]+?)\s+)?card(?:\s+with\s+mana\s+value\s+.+?)?\s+from\s+(?:your|a|any|an\s+opponent['’]?s?)\s+graveyard\s+to\s+(?:your|its owner['’]s)\s+hand/i);
    if (graveyardToHandMatch) {
      const targets = Array.isArray(triggerItem.targets) ? triggerItem.targets : [];
      const targetId = String(targets[0] || '').trim();
      if (!targetId) {
        // Unresolved keyword target choices like soulshift should fall through to keyword handling.
      } else {

      const zones = state.zones || {};
      for (const [ownerId, playerZones] of Object.entries(zones as Record<string, any>)) {
        const graveyard = Array.isArray(playerZones?.graveyard) ? playerZones.graveyard : [];
        const idx = graveyard.findIndex((card: any) => String(card?.id || '') === targetId);
        if (idx === -1) continue;

        const [card] = graveyard.splice(idx, 1);
        recordCardLeftGraveyardThisTurn(ctx, String(ownerId), card);
        playerZones.hand = Array.isArray(playerZones.hand) ? playerZones.hand : [];
        playerZones.hand.push({ ...card, zone: 'hand' });
        playerZones.graveyardCount = graveyard.length;
        playerZones.handCount = playerZones.hand.length;
        debug(2, `[executeTriggerEffect] ${sourceName} returned ${card?.name || targetId} from ${ownerId}'s graveyard to hand`);
        break;
      }
      return true;
      }
    }
  
  // Pattern: "return target creature to its owner's hand" (bounce)
  const bounceMatch = desc.match(/return (?:target|a) (?:creature|permanent) (?:card )?(?:from [^.]+ )?to its owner's hand/i);
  if (bounceMatch) {
    const targets = triggerItem.targets || [];
    if (targets.length > 0) {
      const targetPerm = (state.battlefield || []).find((p: any) => p?.id === targets[0]);
      if (targetPerm) {
        const card = targetPerm.card;
        if (movePermanentToHand(ctx, targetPerm.id)) {
          debug(2, `[executeTriggerEffect] Returned ${card?.name || targetPerm.id} to owner's hand`);
        }
      }
    }
    return true;
  }
  
  // Pattern: "exile the top card of your library" (Prosper, Theater of Horrors, etc.)
  // These cards let you play the exiled card until end of turn or end of next turn
  const exileTopCardMatch = desc.match(/exile the top card of your library/i);
  if (exileTopCardMatch) {
    // Get the controller's library
    const lib = (ctx as any).libraries?.get(controller);
    if (lib && lib.length > 0) {
      // Remove top card from library
      const topCard = lib.shift();
      (ctx as any).libraries?.set(controller, lib);
      
      // Update library count
      const zones = state.zones?.[controller];
      if (zones) {
        zones.libraryCount = lib.length;
      }
      
      // Add to exile zone with "can play" flag
      state.exile = state.exile || [];
      const exiledCard = {
        ...topCard,
        zone: 'exile',
        canBePlayedBy: controller,
        playableUntilTurn: (state.turnNumber || 0) + 1, // Until end of next turn
        exiledBy: sourceName,
      };
      state.exile.push(exiledCard);
      
      // Also track in a pending impulse draw state for the UI
      state.pendingImpulseDraws = state.pendingImpulseDraws || {};
      state.pendingImpulseDraws[controller] = state.pendingImpulseDraws[controller] || [];
      state.pendingImpulseDraws[controller].push({
        cardId: topCard.id,
        cardName: topCard.name,
        exiledBy: sourceName,
        playableUntilTurn: (state.turnNumber || 0) + 1,
      });
      
      debug(2, `[executeTriggerEffect] ${sourceName}: Exiled ${topCard.name || 'card'} from ${controller}'s library (can play until end of next turn)`);
    }
    return true;
  }
  
  return false;
}
