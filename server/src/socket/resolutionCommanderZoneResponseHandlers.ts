/**
 * socket/resolutionCommanderZoneResponseHandlers.ts
 *
 * Commander-zone choice response helper (stay vs command zone / linked exile /
 * flicker return). Extracted from resolution.ts. Wired through resolutionHandlerDeps.
 */

import type { Server } from "socket.io";
import { appendEvent } from "../db/index.js";
import type { GameContext } from "../state/context.js";
import { returnExiledCardToBattlefield, scheduleExiledCardReturnToBattlefield } from "../state/modules/executeSpellEffect.js";
import { cleanupCardLeavingExile } from "../state/modules/playable-from-exile.js";
import { registerLinkedExile } from "../state/modules/triggers/linked-exile.js";
import { queueExiledFromBattlefieldTriggers } from "../state/modules/triggers/zone-change.js";
import {
  type ResolutionStep,
  type ResolutionStepResponse,
} from "../state/resolution/index.js";
import type { PlayerID } from "../../../shared/src/types.js";
import { debug, debugWarn } from "../utils/debug.js";
import { getPlayerName } from "./util.js";

function removeCardFromPlayerZoneMirror(
  game: any,
  playerId: string,
  zone: string,
  commanderId: string | undefined,
  cardId: string | undefined,
): void {
  const players = Array.isArray(game?.state?.players) ? game.state.players : [];
  const player = players.find((entry: any) => String(entry?.id || '') === String(playerId));
  const list = player?.[zone];
  if (!Array.isArray(list)) return;
  const index = list.findIndex((entry: any) =>
    entry
    && (String(entry.id || '') === String(commanderId || '') || String(entry.id || '') === String(cardId || '')),
  );
  if (index !== -1) list.splice(index, 1);
}

/**
 * Handle commander zone choice response
 */
export function handleCommanderZoneResponse(
  io: Server,
  game: any,
  gameId: string,
  step: ResolutionStep,
  response: ResolutionStepResponse
): void {
  const pid = response.playerId;
  const selection = response.selections;
  // Check if selection indicates going to command zone
  // Handle multiple selection types
  const goToCommandZone = selection === true || 
    (typeof selection === 'string' && selection === 'command') ||
    (Array.isArray(selection) && selection.includes('command'));
  
  // Get the commander info from step
  const stepData = step as any;
  const commanderId = stepData.commanderId;
  const commanderName = stepData.commanderName || 'Commander';
  const destinationZone = (stepData.destinationZone || stepData.fromZone || 'graveyard') as
    | 'graveyard'
    | 'exile'
    | 'hand'
    | 'library';
  const libraryPosition = (stepData.libraryPosition || 'shuffle') as 'top' | 'bottom' | 'shuffle';
  const card = stepData.card;
  const exileTag = stepData.exileTag as
    | {
        exiledWithSourceId?: string;
        exiledWithOracleId?: string;
        exiledWithSourceName?: string;
      }
    | undefined;
  const linkedExileData = stepData.linkedExileData as
    | {
        exilingPermanentId?: string;
        exilingPermanentName?: string;
        originalOwner?: string;
        originalController?: string;
      }
    | undefined;
  const flickerReturnData = stepData.flickerReturnData as
    | {
        ownerId?: string;
        cardId?: string;
        returnAt?: 'immediate' | 'next_end_step' | 'owners_next_end_step' | 'end_of_combat';
        sourceName?: string;
      }
    | undefined;
  
  if (goToCommandZone) {
    // Update commander tracking so it can be cast from the command zone.
    // This is the authoritative source for whether a commander is in the command zone.
    try {
      if (typeof (game as any).moveCommanderToCZ === 'function' && commanderId) {
        (game as any).moveCommanderToCZ(pid, commanderId);
      } else {
        const commanderInfo = (game.state as any)?.commandZone?.[pid];
        if (commanderInfo) {
          const inCommandZone = ((commanderInfo as any).inCommandZone as string[]) || [];
          if (commanderId && !inCommandZone.includes(commanderId)) {
            inCommandZone.push(commanderId);
            (commanderInfo as any).inCommandZone = inCommandZone;
            if ((game.state as any)?.commandZone) {
              (game.state as any).commandZone[pid] = commanderInfo;
            }
          }
        }
      }
    } catch (err) {
      debugWarn(1, `[Resolution] Failed to mark commander in command zone:`, err);
    }

    // Actually move commander to command zone
    const zones = game.state?.zones?.[pid];
    if (zones && card) {
      // Remove from source zone
      const sourceZone = (zones as any)[destinationZone];
      let removedFromZone: any = null;
      if (Array.isArray(sourceZone)) {
        const cardIndex = sourceZone.findIndex((c: any) => c.id === commanderId || c.id === card.id);
        if (cardIndex !== -1) {
          removedFromZone = sourceZone.splice(cardIndex, 1)[0];
          if (destinationZone === 'exile' && removedFromZone) {
            cleanupCardLeavingExile(game.state as any, removedFromZone);
          }
          // Update zone count
          const countKey = `${destinationZone}Count` as keyof typeof zones;
          if (typeof zones[countKey] === 'number') {
            (zones[countKey] as number)--;
          }
        }
      }
      
      // Add to command zone
      zones.commandZone = zones.commandZone || [];
      if (destinationZone === 'exile' && !removedFromZone) {
        cleanupCardLeavingExile(game.state as any, card);
      }
      zones.commandZone.push({ ...(removedFromZone || card), zone: 'command' });
      zones.commandZoneCount = zones.commandZone.length;
      removeCardFromPlayerZoneMirror(game, pid, destinationZone, commanderId, card?.id);
    }
    
    // Also remove from battlefield if present
    const battlefield = game.state?.battlefield || [];
    const permIndex = battlefield.findIndex((p: any) => 
      p.id === commanderId || p.card?.id === commanderId || p.card?.id === card?.id
    );
    if (permIndex !== -1) {
      battlefield.splice(permIndex, 1);
    }
    
    debug(2, `[Resolution] Moved ${commanderName} from ${destinationZone} to command zone`);
    
    io.to(gameId).emit("chat", {
      id: `m_${Date.now()}`,
      gameId,
      from: "system",
      message: `${getPlayerName(game, pid)} moved ${commanderName} to the command zone.`,
      ts: Date.now(),
    });
  } else {
    // IMPORTANT: If this was a deferred commander replacement,
    // the card was removed from the battlefield but NOT yet put into the destination zone.
    // Ensure it actually ends up in the chosen zone.

    if (destinationZone === 'library') {
      try {
        const cardToInsert = { ...(card as any), zone: 'library' };

        if (libraryPosition === 'top') {
          if (typeof (game as any).putCardsOnTopOfLibrary === 'function') {
            (game as any).putCardsOnTopOfLibrary(pid, [cardToInsert]);
          }
        } else if (libraryPosition === 'bottom') {
          if (typeof (game as any).putCardsOnBottomOfLibrary === 'function') {
            (game as any).putCardsOnBottomOfLibrary(pid, [cardToInsert]);
          }
        } else {
          // Shuffle: insert then shuffle for a uniform position.
          if (typeof (game as any).putCardsOnTopOfLibrary === 'function') {
            (game as any).putCardsOnTopOfLibrary(pid, [cardToInsert]);
          }
          if (typeof (game as any).shuffleLibrary === 'function') {
            (game as any).shuffleLibrary(pid);
          }
        }
      } catch (err) {
        debugWarn(1, `[Resolution] Failed to place ${commanderName} into library:`, err);
      }
    } else {
      const zones = game.state?.zones?.[pid];
      if (zones && card) {
        const destZoneName = destinationZone;
        const destZone = (zones as any)[destZoneName];

        // If the card isn't already in the destination zone, add it.
        if (Array.isArray(destZone)) {
          const alreadyThere = destZone.some((c: any) => c?.id === commanderId || c?.id === card.id);
          if (!alreadyThere) {
            const zoneValue = destZoneName === 'exile' ? 'exile' : destZoneName;
            destZone.push({
              ...card,
              ...(destZoneName === 'exile' && exileTag ? { ...exileTag } : null),
              zone: zoneValue,
            });
            const countKey = `${destZoneName}Count` as keyof typeof zones;
            if (typeof zones[countKey] === 'number') {
              (zones[countKey] as number)++;
            }
          }
        } else {
          // If destination zone container doesn't exist, create as array.
          (zones as any)[destZoneName] = [
            {
              ...card,
              ...(destZoneName === 'exile' && exileTag ? { ...exileTag } : null),
              zone: destZoneName === 'exile' ? 'exile' : destZoneName,
            },
          ];
          const countKey = `${destZoneName}Count`;
          (zones as any)[countKey] = 1;
        }
      }
    }

    if (destinationZone === 'exile' && linkedExileData?.exilingPermanentId && card) {
      registerLinkedExile(
        {
          state: game.state,
          bumpSeq: typeof game.bumpSeq === 'function' ? game.bumpSeq.bind(game) : (() => {}),
          gameId,
          commandZone: (game as any).commandZone,
          libraries: (game as any).libraries,
        } as any,
        String(linkedExileData.exilingPermanentId),
        String(linkedExileData.exilingPermanentName || step.sourceName || 'Linked Exile Source'),
        card,
        String(linkedExileData.originalOwner || pid || ''),
        String(linkedExileData.originalController || linkedExileData.originalOwner || pid || ''),
      );
    }

    if (destinationZone === 'exile' && stepData?.commanderZoneFromBattlefield === true && card) {
      const originalPermanent = stepData?.commanderZoneOriginalPermanent && typeof stepData.commanderZoneOriginalPermanent === 'object'
        ? stepData.commanderZoneOriginalPermanent
        : {
            id: String(stepData?.sourceId || step.sourceId || commanderId || card.id || '').trim(),
            controller: String(stepData?.controller || stepData?.originalController || pid || '').trim(),
            owner: String(pid || '').trim(),
            card,
          };
      queueExiledFromBattlefieldTriggers(game as GameContext, originalPermanent);
    }

    if (destinationZone === 'exile' && flickerReturnData?.cardId && card) {
      const flickerCtx = {
        state: game.state,
        bumpSeq: typeof game.bumpSeq === 'function' ? game.bumpSeq.bind(game) : (() => {}),
        gameId,
        commandZone: (game as any).commandZone,
        libraries: (game as any).libraries,
      } as any;
      const ownerId = String(flickerReturnData.ownerId || pid || '').trim() as PlayerID;
      const cardId = String(flickerReturnData.cardId || card.id || '').trim();
      const returnAt = flickerReturnData.returnAt || 'immediate';
      const sourceName = String(flickerReturnData.sourceName || step.sourceName || 'Flicker effect');

      if (returnAt === 'immediate') {
        returnExiledCardToBattlefield(flickerCtx, ownerId, cardId, sourceName);
      } else {
        scheduleExiledCardReturnToBattlefield(flickerCtx, ownerId, cardId, returnAt, sourceName);
      }
    }

    debug(2, `[Resolution] ${commanderName} stays in ${destinationZone}`);
    
    io.to(gameId).emit("chat", {
      id: `m_${Date.now()}`,
      gameId,
      from: "system",
      message: `${getPlayerName(game, pid)} let ${commanderName} go to ${destinationZone}.`,
      ts: Date.now(),
    });
  }
  
  // Clear legacy pending state if present
  if (game.state.pendingCommanderZoneChoice?.[pid]) {
    const choices = game.state.pendingCommanderZoneChoice[pid];
    const index = choices.findIndex((c: any) => c.commanderId === commanderId);
    if (index !== -1) {
      choices.splice(index, 1);
      if (choices.length === 0) {
        delete game.state.pendingCommanderZoneChoice[pid];
      }
    }
  }

  try {
    appendEvent(gameId, (game as any).seq ?? 0, 'commanderZoneChoice', {
      playerId: pid,
      sourceId: String(stepData?.sourceId || step.sourceId || commanderId || '').trim() || undefined,
      sourceName: commanderName,
      resolvedStepId: String((step as any)?.id || '').trim() || undefined,
      commanderId,
      commanderName,
      moveToCommandZone: goToCommandZone,
      destinationZone,
      libraryPosition,
      card: card && typeof card === 'object' ? JSON.parse(JSON.stringify(card)) : undefined,
      ...(exileTag ? { exileTag: JSON.parse(JSON.stringify(exileTag)) } : {}),
      ...(linkedExileData ? { linkedExileData: JSON.parse(JSON.stringify(linkedExileData)) } : {}),
      ...(flickerReturnData ? { flickerReturnData: JSON.parse(JSON.stringify(flickerReturnData)) } : {}),
    });
  } catch (err) {
    debugWarn(1, '[Resolution] appendEvent(commanderZoneChoice) failed:', err);
  }
  
  if (typeof game.bumpSeq === "function") {
    game.bumpSeq();
  }
}
