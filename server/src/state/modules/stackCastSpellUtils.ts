import type { PlayerID } from '../../../../shared/src/index.js';
import type { GameContext } from '../context.js';
import { uid, cardManaValue } from '../utils.js';
import { debug, debugWarn, debugEnv } from '../../utils/debug.js';
import { cleanupCardLeavingExile, removeCardFromAnyPlayerExile } from './playable-from-exile.js';
import { castCommander } from './commander.js';
import { extractModalModesFromOracleText } from '../../utils/oraclePromptContext.js';
import { deriveSelfEntryCountersFromOracleIR } from '../../../../rules-engine/src/oracleIRSelfEntryCounters.js';
import { repairReplayCardSourceZones } from './stackReplayUtils.js';
import {
  recordCommittedCrimeThisTurn,
  recordGraveyardPermanentTypesCastThisTurn,
} from './turn-tracking.js';
import { getCascadeInstancesForCast } from './cascadeCastGrants.js';

function removeCardIdFromZonesLibrary(zones: Record<string, any>, playerId: string, cardId: string): boolean {
  const playerZones = zones?.[playerId];
  if (!playerZones || !Array.isArray(playerZones.library) || !cardId) return false;
  const idx = playerZones.library.findIndex((c: any) => c && String(c.id || '') === cardId);
  if (idx === -1) return false;
  playerZones.library.splice(idx, 1);
  if (typeof playerZones.libraryCount === 'number') {
    playerZones.libraryCount = Math.max(0, playerZones.libraryCount - 1);
  }
  return true;
}

/**
 * Cast a spell from hand onto the stack.
 */
export function castSpell(
  ctx: GameContext,
  playerId: PlayerID,
  cardOrId: any,
  targets?: any[],
  xValue?: number,
) {
  const { state, bumpSeq } = ctx;
  const zones = state.zones = state.zones || {};
  let castFromExile = false;
  let castFromGraveyard = false;
  let castFromLibrary = false;
  let castFromCommand = false;
  const explicitSourceZone = typeof cardOrId === 'object' && cardOrId
    ? String(cardOrId?.fromZone || cardOrId?.castSourceZone || cardOrId?.source || '').toLowerCase().trim()
    : '';

  let card: any;
  const cardId = typeof cardOrId === 'string' ? cardOrId : cardOrId?.id;

  if (cardId) {
    if (Array.isArray(state.stack)) {
      const alreadyOnStack = state.stack.some(
        (s: any) => s?.card?.id === cardId && s?.controller === playerId,
      );
      if (alreadyOnStack) {
        // Always strip stale hand/exile/etc. copies. Live AI can otherwise loop forever
        // paying for a ghost still sitting in hand after the real card is on the stack.
        const repaired = repairReplayCardSourceZones(ctx, playerId, cardId);
        if (repaired.total > 0) {
          debug(1, `castSpell: repaired ${repaired.total} stale source-zone entr${repaired.total === 1 ? 'y' : 'ies'} for card ${cardId} already on stack`);
        }
        if ((ctx as any).isReplaying) {
          debugEnv('DEBUG_REPLAY_RESTORE', '[replay-restore] castSpell replay idempotency hit', {
            playerId,
            cardId,
            reason: 'already_on_stack',
            repaired,
          });
        }
        debug(1, `castSpell: card ${cardId} already on stack for ${playerId}, skipping (replay idempotency)`);
        return;
      }
    }
    if (Array.isArray(state.battlefield)) {
      const alreadyOnBattlefield = state.battlefield.some(
        (p: any) =>
          p?.controller === playerId
          && (
            String(p?.id || '') === String(cardId)
            // Tokens, including copied permanent spells, are new objects and must
            // never make their source card look like it is already on the battlefield.
            || (p?.isToken !== true && p?.card?.isToken !== true && p?.card?.id === cardId)
          ),
      );
      if (alreadyOnBattlefield) {
        // Same dual-zone repair for live play (not only replay restore).
        const repaired = repairReplayCardSourceZones(ctx, playerId, cardId);
        if (repaired.total > 0) {
          debug(1, `castSpell: repaired ${repaired.total} stale source-zone entr${repaired.total === 1 ? 'y' : 'ies'} for card ${cardId} already on battlefield`);
        }
        if ((ctx as any).isReplaying) {
          debugEnv('DEBUG_REPLAY_RESTORE', '[replay-restore] castSpell replay idempotency hit', {
            playerId,
            cardId,
            reason: 'already_on_battlefield',
            repaired,
          });
        }
        debug(1, `castSpell: card ${cardId} already on battlefield for ${playerId}, skipping (replay idempotency)`);
        return;
      }
    }
  }

  if (typeof cardOrId === 'string') {
    const z = zones[playerId];
    if (!z) {
      debugWarn(2, `castSpell: no zone found for player ${playerId}`);
      return;
    }
    if (!Array.isArray(z.hand)) {
      debugWarn(2, `castSpell: hand is not an array for player ${playerId} (type: ${typeof z.hand})`);
      return;
    }
    const handCards = z.hand as any[];
    const commandZoneInfo = (state.commandZone || {})[playerId] as any;
    const commandZoneCards = Array.isArray(commandZoneInfo?.commanderCards) ? (commandZoneInfo.commanderCards as any[]) : null;
    const libraryCards = Array.isArray((ctx as any).libraries?.get?.(playerId))
      ? (((ctx as any).libraries.get(playerId)) as any[])
      : (Array.isArray((ctx as any).libraries?.[playerId]) ? (((ctx as any).libraries[playerId]) as any[]) : null);
    const idx = handCards.findIndex((c: any) => c && c.id === cardOrId);
    if (idx !== -1) {
      card = handCards.splice(idx, 1)[0];
      z.handCount = handCards.length;
      removeCardIdFromZonesLibrary(zones, String(playerId), String(cardOrId));
    } else {
      const removedExileCard = removeCardFromAnyPlayerExile(state, String(cardOrId));
      if (removedExileCard) {
        card = removedExileCard.card;
        castFromExile = true;
      } else {
        const gyCards = Array.isArray((z as any).graveyard) ? ((z as any).graveyard as any[]) : null;
        const gyIdx = gyCards ? gyCards.findIndex((c: any) => c && c.id === cardOrId) : -1;
        if (gyCards && gyIdx !== -1) {
          card = gyCards.splice(gyIdx, 1)[0];
          (z as any).graveyardCount = gyCards.length;
          castFromGraveyard = true;
        } else if (libraryCards) {
          const libraryIdx = libraryCards.findIndex((c: any) => c && c.id === cardOrId);
          if (libraryIdx !== -1) {
            card = libraryCards.splice(libraryIdx, 1)[0];
            castFromLibrary = true;
            removeCardIdFromZonesLibrary(zones, String(playerId), String(cardOrId));
          } else if (explicitSourceZone === 'command' && commandZoneCards) {
            const commandIdx = commandZoneCards.findIndex((c: any) => c && c.id === cardOrId);
            if (commandIdx !== -1) {
              card = commandZoneCards[commandIdx];
              castFromCommand = true;
            } else {
              debug(1, `castSpell: card ${cardOrId} not found in hand, exile, graveyard, library, or command zone for player ${playerId} (may be replay)`);
              return;
            }
          } else {
            debug(1, `castSpell: card ${cardOrId} not found in hand, exile, graveyard, or library for player ${playerId} (may be replay)`);
            return;
          }
        } else {
          debug(1, `castSpell: card ${cardOrId} not found in hand, exile, graveyard, or library for player ${playerId} (may be replay)`);
          return;
        }
      }
    }
  } else {
    card = cardOrId;
    if (!card) {
      debugWarn(2, `castSpell: card is null or undefined for player ${playerId}`);
      return;
    }
    const z = zones[playerId];
    if (z && Array.isArray(z.hand)) {
      const handCards = z.hand as any[];
      const idx = handCards.findIndex((c: any) => c && c.id === card.id);
      if (idx !== -1) {
        handCards.splice(idx, 1);
        z.handCount = handCards.length;
      }
    }

    const removedExileCard = removeCardFromAnyPlayerExile(state, String(card?.id || ''));
    if (removedExileCard) {
      card = removedExileCard.card;
      castFromExile = true;
    }

    if (z && Array.isArray((z as any).graveyard)) {
      const gyCards = (z as any).graveyard as any[];
      const gyIdx = gyCards.findIndex((c: any) => c && c.id === card.id);
      if (gyIdx !== -1) {
        gyCards.splice(gyIdx, 1);
        (z as any).graveyardCount = gyCards.length;
        castFromGraveyard = true;
      }
    }

    const libraryCards = Array.isArray((ctx as any).libraries?.get?.(playerId))
      ? (((ctx as any).libraries.get(playerId)) as any[])
      : (Array.isArray((ctx as any).libraries?.[playerId]) ? (((ctx as any).libraries[playerId]) as any[]) : undefined);
    if (libraryCards) {
      const libraryIdx = libraryCards.findIndex((c: any) => c && c.id === card.id);
      if (libraryIdx !== -1) {
        libraryCards.splice(libraryIdx, 1);
        castFromLibrary = true;
      }
    }
    // Always scrub zones.library ghosts — cast-from-hand removes the Map copy but
    // historically left the same id in zones.library, which dual-zones the card.
    removeCardIdFromZonesLibrary(zones, String(playerId), String(card?.id || ''));

    if (!castFromLibrary && explicitSourceZone === 'command') {
      castFromCommand = true;
    }

    if (!castFromLibrary && explicitSourceZone === 'library') {
      castFromLibrary = true;
    }
  }

  if (castFromExile) {
    cleanupCardLeavingExile(state as any, card);
  }

  try {
    const stepStr = String((state as any).step || '').toUpperCase();
    const isMainPhase =
      stepStr === 'MAIN1' ||
      stepStr === 'MAIN2' ||
      stepStr === 'MAIN' ||
      stepStr === 'MAIN_1' ||
      stepStr === 'MAIN_2' ||
      stepStr.includes('MAIN');
    const active = String((state as any).activePlayer || (state as any).turnPlayer || '');
    const isOwnTurn = active && active === String(playerId);
    (card as any).castDuringMainPhase = isMainPhase;
    (card as any).castDuringOwnMainPhase = isMainPhase && isOwnTurn;
    (card as any).castStep = (state as any).step;
    (card as any).castPhase = (state as any).phase;
  } catch {
    // Best-effort metadata only.
  }

  const targetDetails: Array<{ id: string; type: 'permanent' | 'player' | 'spell' | 'ability'; name?: string; controllerId?: string; controllerName?: string }> = [];
  if (targets && targets.length > 0) {
    for (const target of targets) {
      const targetId = typeof target === 'string' ? target : target.id;
      const targetKind = typeof target === 'object' ? target.kind : undefined;

      if (targetKind === 'player') {
        const player = (state.players || []).find((p: any) => p.id === targetId);
        targetDetails.push({
          id: targetId,
          type: 'player',
          name: player?.name || targetId,
        });
        continue;
      }

      if (targetKind === 'stack' || (!targetKind && Array.isArray(state.stack) && state.stack.some((s: any) => String(s?.id || '') === String(targetId)))) {
        const stackItem = (state.stack || []).find((s: any) => String(s?.id || '') === String(targetId));
        const isAbility = stackItem
          && (stackItem.type === 'ability' || stackItem.type === 'triggered_ability');
        const controllerId = stackItem?.controller;
        const controllerPlayer = controllerId ? (state.players || []).find((p: any) => p.id === controllerId) : undefined;
        targetDetails.push({
          id: targetId,
          type: isAbility ? 'ability' : 'spell',
          name: stackItem?.card?.name || stackItem?.sourceName || stackItem?.description,
          controllerId,
          controllerName: controllerPlayer?.name,
        });
        continue;
      }

      const perm = (state.battlefield || []).find((p: any) => p.id === targetId);
      let permName = perm?.card?.name;
      if (!permName && (perm?.card as any)?.card_faces?.[0]?.name) {
        permName = (perm.card as any).card_faces[0].name;
      }
      const controllerId = perm?.controller;
      const controllerPlayer = controllerId ? (state.players || []).find((p: any) => p.id === controllerId) : undefined;
      targetDetails.push({
        id: targetId,
        type: 'permanent',
        name: permName,
        controllerId: controllerId,
        controllerName: controllerPlayer?.name,
      });
    }
  }

  const spellManaValue = cardManaValue(card, xValue);

  const castSourceZone = castFromGraveyard
    ? 'graveyard'
    : castFromExile
      ? 'exile'
      : castFromCommand || explicitSourceZone === 'command'
        ? 'command'
        : castFromLibrary || explicitSourceZone === 'library'
          ? 'library'
          : 'hand';

  const stackItem: any = {
    id: uid('stack'),
    type: 'spell',
    controller: playerId,
    card: { ...card, zone: 'stack' },
    targets: targets || [],
    targetDetails: targetDetails.length > 0 ? targetDetails : undefined,
    xValue,
    manaValue: spellManaValue,
    fromZone: castSourceZone,
    castSourceZone,
    source: castSourceZone,
    isCommander: castSourceZone === 'command' || card?.isCommander === true,
    castFromHand: castSourceZone === 'hand',
    castFromExile: castSourceZone === 'exile',
    castFromGraveyard: castSourceZone === 'graveyard',
    castFromLibrary: castSourceZone === 'library',
  };

  const derivedEntryCounters = deriveSelfEntryCountersFromOracleIR({
    oracleText: String(card?.oracle_text || ''),
    cardName: String(card?.name || ''),
    xValue: Number.isFinite(Number(xValue)) ? Number(xValue) : undefined,
    wasKicked: card?.wasKicked === true
      || Number(card?.timesKicked) > 0
      || Number(card?.kickerPaidCount) > 0,
  });
  if (derivedEntryCounters) {
    const existingCounters = stackItem.card?.entersBattlefieldWithCounters && typeof stackItem.card.entersBattlefieldWithCounters === 'object'
      ? stackItem.card.entersBattlefieldWithCounters as Record<string, number>
      : undefined;
    const mergedCounters: Record<string, number> = { ...(existingCounters || {}) };
    for (const [counterType, rawCount] of Object.entries(derivedEntryCounters)) {
      const count = Number(rawCount || 0);
      if (!Number.isFinite(count) || count <= 0) continue;
      mergedCounters[counterType] = Math.max(Number(mergedCounters[counterType] || 0), count);
    }
    if (Object.keys(mergedCounters).length > 0) {
      stackItem.entersBattlefieldWithCounters = { ...mergedCounters };
      if (stackItem.card && typeof stackItem.card === 'object') {
        stackItem.card.entersBattlefieldWithCounters = { ...mergedCounters };
      }
    }
  }

  try {
    if (stackItem.card && typeof stackItem.card === 'object') {
      stackItem.card.fromZone = castSourceZone;
      stackItem.card.castSourceZone = castSourceZone;
      stackItem.card.source = castSourceZone;
      stackItem.card.isCommander = castSourceZone === 'command' || stackItem.card.isCommander === true;
      stackItem.card.castFromHand = castSourceZone === 'hand';
      stackItem.card.castFromExile = castSourceZone === 'exile';
      stackItem.card.castFromGraveyard = castSourceZone === 'graveyard';
      stackItem.card.castFromLibrary = castSourceZone === 'library';
    }
  } catch {
    // best-effort only
  }

  try {
    recordCommittedCrimeThisTurn(state, String(playerId), targetDetails);
  } catch {
    // best-effort only
  }

  const hadCastFromExileThisTurn = Boolean((state as any).castFromExileThisTurn?.[String(playerId)]);
  if (castFromExile) {
    try {
      const stateAny = state as any;
      stateAny.playedCardFromExileThisTurn = stateAny.playedCardFromExileThisTurn || {};
      stateAny.playedCardFromExileThisTurn[String(playerId)] = true;

      stateAny.playedFromExileThisTurn = stateAny.playedFromExileThisTurn || {};
      stateAny.playedFromExileThisTurn[String(playerId)] = true;
      stateAny.cardsPlayedFromExileThisTurn = stateAny.cardsPlayedFromExileThisTurn || {};
      stateAny.cardsPlayedFromExileThisTurn[String(playerId)] = (stateAny.cardsPlayedFromExileThisTurn[String(playerId)] || 0) + 1;

      stateAny.castFromExileThisTurn = stateAny.castFromExileThisTurn || {};
      stateAny.castFromExileThisTurn[String(playerId)] = true;
    } catch {
      // best-effort only
    }
  }

  if (castFromGraveyard) {
    try {
      const stateAny = state as any;
      stateAny.castFromGraveyardThisTurn = stateAny.castFromGraveyardThisTurn || {};
      stateAny.castFromGraveyardThisTurn[String(playerId)] = true;
      recordGraveyardPermanentTypesCastThisTurn(stateAny, playerId, card);
    } catch {
      // best-effort only
    }
  }

  const cascadeCount = getCascadeInstancesForCast(state, String(playerId), card, {
    castSourceZone,
    isFirstSpellCastFromExileThisTurn: castFromExile && !hadCastFromExileThisTurn,
  });
  if (cascadeCount > 0) {
    (state as any).pendingCascade = (state as any).pendingCascade || {};
    const queue = (state as any).pendingCascade[playerId] = (state as any).pendingCascade[playerId] || [];
    const baseLen = queue.length;
    for (let i = 0; i < cascadeCount; i++) {
      queue.push({
        sourceName: card?.name || 'Cascade',
        sourceCardId: card?.id,
        manaValue: spellManaValue,
        instance: baseLen + i + 1,
      });
    }
  }

  if (card.selectedModes && Array.isArray(card.selectedModes)) {
    stackItem.selectedModes = card.selectedModes;

    const oracleText = card.oracle_text || '';
    const modalInfo = extractModalModesFromOracleText(oracleText);
    if (modalInfo && Array.isArray(modalInfo.options)) {
      stackItem.selectedModeDescriptions = card.selectedModes.map((modeId: string) => {
        const modeNum = parseInt(modeId.replace('mode_', ''), 10);
        const modeOption = modalInfo.options[modeNum - 1];
        if (modeOption?.raw) {
          return modeOption.raw.trim();
        }
        return `Mode ${modeNum}`;
      });
    }
  }

  if (card.selectedAdditionalCostModes && Array.isArray(card.selectedAdditionalCostModes)) {
    stackItem.selectedAdditionalCostModes = card.selectedAdditionalCostModes;
  }

  if (card.selectedSpreeModes && Array.isArray(card.selectedSpreeModes)) {
    stackItem.selectedSpreeModes = card.selectedSpreeModes;
  }

  state.stack = state.stack || [];
  state.stack.push(stackItem as any);

  // Same-id duplicates are invalid physical-card state. Remove every residual
  // source-zone copy after the authoritative stack item has been created so a
  // replay/import ghost cannot be cast a second time.
  if (card?.id) {
    const repaired = repairReplayCardSourceZones(ctx, String(playerId), String(card.id));
    if (repaired.total > 0) {
      debug(
        1,
        `castSpell: removed ${repaired.total} residual source-zone entr${repaired.total === 1 ? 'y' : 'ies'} after casting card ${card.id}`,
      );
    }
  }

  if (castSourceZone === 'command' && card?.id) {
    castCommander(ctx, playerId, String(card.id));
  }

  bumpSeq();
}
