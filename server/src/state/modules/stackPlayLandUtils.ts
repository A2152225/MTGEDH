import type { PlayerID } from '../../../../shared/src/index.js';
import type { GameContext } from '../context.js';
import { uid, parsePT } from '../utils.js';
import { debug, debugWarn, debugEnv } from '../../utils/debug.js';
import { stampPermanentEntryTimestamp, stampAttachmentTimestamp } from '../../../../rules-engine/src/permanentTimestamps.js';

import { recalculatePlayerEffects } from './game-state-effects.js';
import { getLandfallTriggers } from './triggered-abilities.js';
import { isInterveningIfSatisfied } from './triggers/intervening-if.js';
import { cleanupCardLeavingExile, removeCardFromAnyPlayerExile } from './playable-from-exile.js';
import { getEffectiveBasicLandTypes } from './mana-abilities.js';
import { detectETBTappedPattern, evaluateConditionalLandETB, getLandSubtypes } from '../../socket/land-helpers.js';
import { getPlayableLandCandidates } from './can-respond.js';
import { updateLandPlayPermissions } from './land-permissions.js';
import { creatureWillHaveHaste } from './creatureEntryHasteUtils.js';
import { triggerETBEffectsForPermanent } from './triggerEtbPermanentEffects.js';
import { markPermanentEnteredFromZone } from './triggerDelayedEffectUtils.js';
import { hydratePermanentCardOracleInPlace } from './cardOracleHydration.js';
import { repairReplayCardSourceZones } from './stackReplayUtils.js';
import { tryDeferPlayLandForWouldEnterReplacement, tryApplyLandWouldEnterNamedSacrificeReplacement } from './land-would-enter-replacement.js';

export interface PlayLandEntryOptions {
  playedFromExile?: boolean;
  playedFromGraveyard?: boolean;
  skipLandPlayCountIncrement?: boolean;
}

/**
 * When playing a transform/MDFC land, use the land face only.
 * Combined type lines like "Land // Creature" must not enter as 0-toughness creatures (704.5f).
 */
export function resolveLandCardFaceForBattlefieldEntry(card: any): any {
  if (!card) return card;

  const layout = String(card.layout || '').toLowerCase();
  const cardFaces = Array.isArray(card.card_faces) ? card.card_faces : [];

  if ((layout === 'transform' || layout === 'double_faced_token') && cardFaces.length >= 1) {
    const frontFace = cardFaces[0];
    if (/\bland\b/i.test(String(frontFace?.type_line || ''))) {
      return {
        ...card,
        name: frontFace.name || card.name,
        type_line: frontFace.type_line,
        oracle_text: frontFace.oracle_text || '',
        mana_cost: frontFace.mana_cost ?? '',
        image_uris: frontFace.image_uris || card.image_uris,
        power: undefined,
        toughness: undefined,
        layout: card.layout,
        card_faces: card.card_faces,
        transformed: false,
      };
    }
  }

  if (layout === 'modal_dfc' && cardFaces.length >= 1) {
    const selectedIndex = typeof card.selectedMDFCFace === 'number' ? card.selectedMDFCFace : undefined;
    const landFaceIndex = selectedIndex ?? cardFaces.findIndex((face: any) =>
      /\bland\b/i.test(String(face?.type_line || '')),
    );
    if (landFaceIndex >= 0) {
      const landFace = cardFaces[landFaceIndex];
      if (landFace && /\bland\b/i.test(String(landFace.type_line || ''))) {
        return {
          ...card,
          name: landFace.name || card.name,
          type_line: landFace.type_line,
          oracle_text: landFace.oracle_text || '',
          mana_cost: landFace.mana_cost ?? '',
          image_uris: landFace.image_uris || card.image_uris,
          power: undefined,
          toughness: undefined,
          selectedMDFCFace: landFaceIndex,
        };
      }
    }
  }

  return card;
}

/* Place a land onto the battlefield for a player (simplified) */
export function playLand(ctx: GameContext, playerId: PlayerID, cardOrId: any) {
  const { state, bumpSeq } = ctx;
  const zones = state.zones = state.zones || {};
  let playedFromExile = false;
  let playedFromGraveyard = false;

  // Handle both card object and cardId string
  let card: any;
  const cardId = typeof cardOrId === 'string' ? cardOrId : cardOrId?.id;

  // Check if this card is already on the battlefield (idempotency for replay)
  if (cardId && Array.isArray(state.battlefield)) {
    const alreadyOnBattlefield = state.battlefield.some(
      (p: any) => p?.card?.id === cardId && p?.controller === playerId
    );
    if (alreadyOnBattlefield) {
      // Always strip stale hand copies in live play too — otherwise canPlayLand/AI can
      // keep seeing a ghost land that can never actually be played.
      const repaired = repairReplayCardSourceZones(state, playerId, cardId);
      if (repaired.total > 0) {
        debug(1, `playLand: repaired ${repaired.total} stale source-zone entr${repaired.total === 1 ? 'y' : 'ies'} for card ${cardId} already on battlefield`);
      }
      if ((ctx as any).isReplaying) {
        debugEnv('DEBUG_REPLAY_RESTORE', '[replay-restore] playLand replay idempotency hit', {
          playerId,
          cardId,
          reason: 'already_on_battlefield',
          repaired,
        });
      }
      debug(1, `playLand: card ${cardId} already on battlefield for ${playerId}, skipping (replay idempotency)`);
      return;
    }
  }

  if (typeof cardOrId === 'string') {
    // Find card in player's hand
    const z = zones[playerId];
    if (!z) {
      debugWarn(2, `playLand: no zone found for player ${playerId}`);
      return;
    }
    if (!Array.isArray(z.hand)) {
      debugWarn(2, `playLand: hand is not an array for player ${playerId} (type: ${typeof z.hand})`);
      return;
    }
    const handCards = z.hand as any[];
    const idx = handCards.findIndex((c: any) => c && c.id === cardOrId);
    if (idx !== -1) {
      // Remove card from hand
      card = handCards.splice(idx, 1)[0];
      z.handCount = handCards.length;
    } else {
      // Fallback: allow playing lands from exile when an effect permits it.
      const removedExileCard = removeCardFromAnyPlayerExile(state, String(cardOrId));
      if (removedExileCard) {
        card = removedExileCard.card;
        playedFromExile = true;
      } else {
        // Fallback: allow playing lands from graveyard when an effect permits it (e.g., Crucible of Worlds).
        const gyCards = Array.isArray((z as any).graveyard) ? ((z as any).graveyard as any[]) : null;
        const gyIdx = gyCards ? gyCards.findIndex((c: any) => c && c.id === cardOrId) : -1;
        const canPlayRequestedLandFromGraveyard = getPlayableLandCandidates({
          state,
          libraries: (ctx as any).libraries,
        } as any, playerId).some((candidate) =>
          candidate.sourceZone === 'graveyard' && String(candidate.card?.id || '') === String(cardOrId)
        );
        if (canPlayRequestedLandFromGraveyard && gyCards && gyIdx !== -1) {
          card = gyCards.splice(gyIdx, 1)[0];
          (z as any).graveyardCount = gyCards.length;
          playedFromGraveyard = true;
        } else {
          const lib = ctx.libraries.get(playerId) || [];
          if (Array.isArray(lib) && lib.length > 0 && String(lib[0]?.id || '') === String(cardOrId)) {
            card = lib.shift();
            ctx.libraries.set(playerId, lib);
            z.libraryCount = lib.length;
          } else {
            // During replay, card might not be in its expected zone anymore - this is okay
            debug(1, `playLand: card ${cardOrId} not found in expected zone(s) for player ${playerId} (may be replay)`);
            return;
          }
        }
      }
    }
  } else {
    // Card object passed directly (legacy or event replay)
    card = cardOrId;
    if (!card) {
      debugWarn(2, `playLand: card is null or undefined for player ${playerId}`);
      return;
    }
    // Try to remove from hand if it exists there
    const z = zones[playerId];
    if (z && Array.isArray(z.hand)) {
      const handCards = z.hand as any[];
      const idx = handCards.findIndex((c: any) => c.id === card.id);
      if (idx !== -1) {
        handCards.splice(idx, 1);
        z.handCount = handCards.length;
      }
    }

    // Also try to remove from exile if it exists there (e.g., replay or exile-cast flows).
    const removedExileCard = removeCardFromAnyPlayerExile(state, String(card?.id || ''));
    if (removedExileCard) {
      card = removedExileCard.card;
      playedFromExile = true;
    }

    // Also try to remove from graveyard if it exists there (e.g., Conduit/Crucible flows or replay).
    if (z && Array.isArray((z as any).graveyard)) {
      const gyCards = (z as any).graveyard as any[];
      const gyIdx = gyCards.findIndex((c: any) => c && c.id === card.id);
      if (gyIdx !== -1) {
        gyCards.splice(gyIdx, 1);
        (z as any).graveyardCount = gyCards.length;
        playedFromGraveyard = true;
      }
    }

    const lib = ctx.libraries.get(playerId) || [];
    const libIdx = Array.isArray(lib) ? lib.findIndex((c: any) => c && c.id === card.id) : -1;
    if (libIdx !== -1) {
      lib.splice(libIdx, 1);
      ctx.libraries.set(playerId, lib);
      if (z) {
        z.libraryCount = lib.length;
      }
    }
  }

  // If this land was played from exile due to impulse-like permissions, consume that permission now.
  // Also strip the permission tags so they don't leak into battlefield representations.
  if (playedFromExile) {
    cleanupCardLeavingExile(state as any, card);
  }

  card = resolveLandCardFaceForBattlefieldEntry(card);

  const tl = (card.type_line || '').toLowerCase();
  const isLand = /\bland\b/.test(tl);
  if (
    isLand
    && tryDeferPlayLandForWouldEnterReplacement(ctx, playerId, card, { playedFromExile, playedFromGraveyard })
  ) {
    bumpSeq();
    return;
  }

  if (
    isLand
    && tryApplyLandWouldEnterNamedSacrificeReplacement(ctx, playerId, card, { playedFromExile, playedFromGraveyard })
  ) {
    bumpSeq();
    return;
  }

  finishPlayLandBattlefieldEntry(ctx, playerId, card, { playedFromExile, playedFromGraveyard });
}

export function finishPlayLandBattlefieldEntry(
  ctx: GameContext,
  playerId: PlayerID,
  card: any,
  opts: PlayLandEntryOptions = {},
) {
  const { state, bumpSeq } = ctx;
  const playedFromExile = Boolean(opts.playedFromExile);
  const playedFromGraveyard = Boolean(opts.playedFromGraveyard);

  const tl = (card.type_line || '').toLowerCase();
  const isCreature = /\bcreature\b/.test(tl);
  const isLand = /\bland\b/.test(tl);
  const baseP = isCreature ? parsePT((card as any).power) : undefined;
  const baseT = isCreature ? parsePT((card as any).toughness) : undefined;

  // Check if the permanent has haste from any source (own text or battlefield effects)
  // Rule 702.10: Haste allows ignoring summoning sickness
  const battlefield = state.battlefield || [];
  const hasHaste = isCreature && creatureWillHaveHaste(card, playerId, battlefield);

  // Rule 302.6: Summoning sickness applies to CREATURES (including creature lands like Dryad Arbor)
  const hasSummoningSickness = isCreature && !hasHaste;

  // Check if land enters tapped based on oracle text
  const oracleText = card.oracle_text || '';
  const etbTappedStatus = detectETBTappedPattern(oracleText);

  let shouldEnterTapped = false;

  if (isLand) {
    if (etbTappedStatus === 'always') {
      shouldEnterTapped = true;
      debug(2, `[playLand] ${card.name || 'Land'} enters tapped (ETB-tapped pattern detected)`);
    } else if (etbTappedStatus === 'conditional') {
      const otherLandCount = battlefield.filter((p: any) => {
        if (p.controller !== playerId) return false;
        const typeLine = (p.card?.type_line || '').toLowerCase();
        return typeLine.includes('land');
      }).length;

      const controlledLandTypes: string[] = [];
      let basicLandCount = 0;
      for (const p of battlefield) {
        if (p.controller !== playerId) continue;
        const typeLine = (p.card?.type_line || '').toLowerCase();

        if (typeLine.includes('basic')) {
          basicLandCount++;
        }

        const staticSubtypes = getLandSubtypes(typeLine).filter(subtype => !['Plains', 'Island', 'Swamp', 'Mountain', 'Forest'].includes(subtype));
        const effectiveBasicTypes = getEffectiveBasicLandTypes(state, p).map(subtype => subtype.charAt(0).toUpperCase() + subtype.slice(1));
        controlledLandTypes.push(...staticSubtypes, ...effectiveBasicTypes);
      }

      const oracleTextLower = oracleText.toLowerCase();
      const hasBattleLandPattern = oracleTextLower.includes('two or more basic lands');

      const allPlayers = state.players || [];
      const opponentCount = allPlayers.filter((p: any) => p.id !== playerId).length;

      if (hasBattleLandPattern) {
        shouldEnterTapped = basicLandCount < 2;
        debug(2, `[playLand] ${card.name || 'Land'} battle land check: ${basicLandCount} basic lands - enters ${shouldEnterTapped ? 'tapped' : 'untapped'}`);
      } else {
        const controlledPermanents = battlefield.filter((p: any) => p.controller === playerId);

        const opponentLandCount = battlefield.filter((p: any) => {
          if (p.controller === playerId) return false;
          const typeLine = (p.card?.type_line || '').toLowerCase();
          return typeLine.includes('land');
        }).length;

        const evaluation = evaluateConditionalLandETB(
          oracleText,
          otherLandCount,
          controlledLandTypes,
          undefined,
          basicLandCount,
          opponentCount,
          controlledPermanents,
          opponentLandCount,
        );
        shouldEnterTapped = evaluation.shouldEnterTapped;
        debug(2, `[playLand] ${card.name || 'Land'} conditional ETB: ${evaluation.reason}`);
      }
    }
  }

  state.battlefield = state.battlefield || [];
  state.battlefield.push({
    id: uid('perm'),
    controller: playerId,
    owner: playerId,
    tapped: shouldEnterTapped,
    counters: {},
    basePower: baseP,
    baseToughness: baseT,
    summoningSickness: hasSummoningSickness,
    card: { ...card, zone: 'battlefield' },
  } as any);
  stampPermanentEntryTimestamp(state, state.battlefield[state.battlefield.length - 1]);
  if (!opts.skipLandPlayCountIncrement) {
    state.landsPlayedThisTurn = state.landsPlayedThisTurn || {};
    state.landsPlayedThisTurn[playerId] = (state.landsPlayedThisTurn[playerId] ?? 0) + 1;
  }

  const newPermanent = state.battlefield[state.battlefield.length - 1];
  hydratePermanentCardOracleInPlace(newPermanent);
  if (playedFromGraveyard) {
    markPermanentEnteredFromZone(newPermanent, 'graveyard');
  } else if (playedFromExile) {
    markPermanentEnteredFromZone(newPermanent, 'exile');
  }

  // During event-log replay, ETB/landfall triggers are restored via pushTriggeredAbility
  // and resolveTopOfStack events — re-pushing them here duplicates stack work and drifts zones.
  if (!(ctx as any).isReplaying) {
  try {
    triggerETBEffectsForPermanent(ctx, newPermanent, playerId, true);
  } catch (err) {
    debugWarn(1, '[playLand] Failed to run triggerETBEffectsForPermanent for played land:', err);
  }

  try {
    const landfallTriggers = getLandfallTriggers(ctx, playerId, newPermanent);
    if (landfallTriggers.length > 0) {
      debug(2, `[playLand] Found ${landfallTriggers.length} landfall trigger(s) for player ${playerId}`);

      state.stack = state.stack || [];

      for (const trigger of landfallTriggers) {
        try {
          const triggerSourceId = String(trigger.sourceId || trigger.permanentId || '').trim();
          const sourcePerm = trigger.sourceZone === 'battlefield'
            ? state.battlefield?.find((p: any) => p?.id === triggerSourceId)
            : undefined;
          const sourceSubjectSnapshot = trigger.interveningIfSubjectSnapshot && typeof trigger.interveningIfSubjectSnapshot === 'object'
            ? { ...(trigger.interveningIfSubjectSnapshot as any) }
            : undefined;
          const raw = String(trigger.effect || '').trim();
          let text = raw;
          if (text && !/^(?:when|whenever|at)\b/i.test(text)) {
            text = `Whenever a land enters the battlefield under your control, ${text}`;
          }
          const satisfied = isInterveningIfSatisfied(
            ctx as any,
            String(playerId),
            text,
            sourceSubjectSnapshot || sourcePerm,
            /\bthat player\b/i.test(text)
              ? {
                  thatPlayerId: String(playerId),
                  referencedPlayerId: String(playerId),
                  theirPlayerId: String(playerId),
                }
              : undefined
          );
          if (satisfied === false) {
            debug(2, `[playLand] Skipping landfall trigger due to unmet intervening-if: ${trigger.cardName} - ${text}`);
            continue;
          }
        } catch {
          // Conservative fallback: keep the trigger if evaluation fails.
        }

        const triggerId = uid('trigger');
        const stackedSourceId = String(trigger.sourceId || trigger.permanentId || '').trim();
        state.stack.push({
          id: triggerId,
          type: 'triggered_ability',
          controller: playerId,
          source: stackedSourceId,
          ...(trigger.permanentId ? { permanentId: trigger.permanentId } : {}),
          sourceName: trigger.cardName,
          ...(trigger.sourceZone ? { sourceZone: trigger.sourceZone } : {}),
          ...(trigger.sourceCard ? { card: { ...(trigger.sourceCard as any) } } : {}),
          ...(trigger.interveningIfSubjectSnapshot
            ? { interveningIfSubjectSnapshot: { ...(trigger.interveningIfSubjectSnapshot as any) } }
            : {}),
          description: `Landfall - ${trigger.effect}`,
          triggerType: 'landfall',
          mandatory: trigger.mandatory,
          effect: trigger.effect,
          requiresChoice: trigger.requiresChoice,
          requiresTarget: trigger.requiresTarget,
          targetType: trigger.targetType,
          isModal: trigger.isModal,
          modalOptions: trigger.modalOptions,
        } as any);
        debug(2, `[playLand] Pushed landfall trigger onto stack: ${trigger.cardName} - ${trigger.effect}${trigger.requiresTarget ? ` (requires ${trigger.targetType} target)` : ''}`);
      }
    }
  } catch (err) {
    debugWarn(1, '[playLand] Failed to process landfall triggers:', err);
  }
  }

  try {
    updateLandPlayPermissions(ctx as any, playerId);
  } catch (err) {
    debugWarn(1, '[playLand] Failed to update land play permissions:', err);
  }

  try {
    recalculatePlayerEffects(ctx);
  } catch (err) {
    debugWarn(1, '[playLand] Failed to recalculate player effects:', err);
  }

  if (playedFromExile) {
    try {
      const stateAny = state as any;
      stateAny.playedCardFromExileThisTurn = stateAny.playedCardFromExileThisTurn || {};
      stateAny.playedCardFromExileThisTurn[String(playerId)] = true;

      stateAny.playedFromExileThisTurn = stateAny.playedFromExileThisTurn || {};
      stateAny.playedFromExileThisTurn[String(playerId)] = true;
      stateAny.cardsPlayedFromExileThisTurn = stateAny.cardsPlayedFromExileThisTurn || {};
      stateAny.cardsPlayedFromExileThisTurn[String(playerId)] = (stateAny.cardsPlayedFromExileThisTurn[String(playerId)] || 0) + 1;

      stateAny.playedLandFromExileThisTurn = stateAny.playedLandFromExileThisTurn || {};
      stateAny.playedLandFromExileThisTurn[String(playerId)] = true;
    } catch {
      // best-effort only
    }
  }

  if (playedFromGraveyard) {
    try {
      const stateAny = state as any;
      stateAny.playedLandFromGraveyardThisTurn = stateAny.playedLandFromGraveyardThisTurn || {};
      stateAny.playedLandFromGraveyardThisTurn[String(playerId)] = true;
    } catch {
      // best-effort only
    }
  }

  bumpSeq();
}
