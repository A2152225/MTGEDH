/**
 * socket/resolution-handlers/optionChoiceExilePlayPermissionPrompts.ts
 *
 * Origin parent: server/src/socket/resolution.ts (handleOptionChoiceResponse).
 * Cluster moved: the two OPTION_CHOICE prompts that decide what happens to a card sitting in exile -
 * `grantPlayableFromExileChoice` (pick which of the exiled cards may be played, clearing the tags on
 * the others and writing both the transient `playableFromExile` map and the durable permission) and
 * the rebound prompt keyed by `reboundCardId` (cast the exiled card for free by pushing it onto the
 * stack, or decline and send it to its owner's graveyard through the replacement pipeline).
 * Public entry symbols: handleGrantPlayableFromExileChoice, handleReboundCastChoice.
 *
 * The rebound branch keeps its own inline selection parsing (it defaults to 'decline' rather than
 * null, unlike the shared `extractOptionChoiceSelectionId`). Both branches always returned, so each
 * call site is `await handler(...); return;`.
 *
 * Wired through resolutionHandlerDeps. Must not import resolution.ts.
 */

import type { Server } from "socket.io";
import { appendEvent } from "../../db/index.js";
import {
  type ResolutionStep,
  type ResolutionStepResponse,
} from "../../state/resolution/index.js";
import type { PlayerID } from "../../../../shared/src/types.js";
import { buildDurablePlayableFromExilePermission, upsertDurablePermission } from "../../state/modules/durable-permissions.js";
import { pushCardToPlayerGraveyardWithReplacements } from "../../state/modules/graveyardEntryUtils.js";
import { cleanupCardLeavingExile, removePlayableFromExileForCard, stripPlayableFromExileTags } from "../../state/modules/playable-from-exile.js";
import { uid } from "../../state/utils.js";
import { debug, debugWarn } from "../../utils/debug.js";
import { getPlayerName } from "../util.js";
import { extractOptionChoiceSelectionId } from "./resolutionOptionChoiceSelectionIds.js";

/** "Choose one of the exiled cards. You may play it <window>." */
export async function handleGrantPlayableFromExileChoice(
  io: Server,
  game: any,
  gameId: string,
  step: ResolutionStep,
  response: ResolutionStepResponse,
): Promise<void> {
  const stepData = step as any;
  const playerId = response.playerId;

  const chosenCardId = extractOptionChoiceSelectionId(response.selections);
  const controllerId = String(stepData.grantPlayableFromExileController || playerId);
  const sourceName = String(stepData.grantPlayableFromExileSourceName || step.sourceName || 'Ability');
  const cardIds: string[] = Array.isArray(stepData.grantPlayableFromExileCardIds)
    ? stepData.grantPlayableFromExileCardIds.map(String)
    : [];
  const currentTurn = Number((game.state as any).turnNumber ?? 0) || 0;
  const rawUntilTurn = Number(stepData.grantPlayableFromExileUntilTurn);
  const playableUntilTurn = Number.isFinite(rawUntilTurn) ? rawUntilTurn : currentTurn;
  const playWindowText = String(stepData.grantPlayableFromExileWindowText || '').trim() || 'this turn';

  if (!chosenCardId || cardIds.length === 0 || !cardIds.includes(String(chosenCardId))) {
    debugWarn(2, `[Resolution] grantPlayableFromExileChoice: invalid selection`);
    return;
  }

  const allZones = ((game.state as any).zones || {}) as Record<string, any>;
  for (const zoneOwner of Object.keys(allZones)) {
    const exileZone = Array.isArray(allZones[zoneOwner]?.exile) ? allZones[zoneOwner].exile : [];
    for (const exiledCard of exileZone) {
      const exiledCardId = String(exiledCard?.id || '').trim();
      if (!exiledCardId || !cardIds.includes(exiledCardId)) {
        continue;
      }

      removePlayableFromExileForCard(game.state as any, exiledCardId);
      stripPlayableFromExileTags(exiledCard);

      if (exiledCardId === String(chosenCardId)) {
        exiledCard.canBePlayedBy = controllerId;
        exiledCard.playableUntilTurn = playableUntilTurn;
      }
    }
  }

  ;(game.state as any).playableFromExile = (game.state as any).playableFromExile || {};
  const pfe = (((game.state as any).playableFromExile[controllerId] =
    (game.state as any).playableFromExile[controllerId] || {}) as any);
  pfe[String(chosenCardId)] = playableUntilTurn;
  upsertDurablePermission(game.state as any, buildDurablePlayableFromExilePermission({
    playerId: controllerId as PlayerID,
    cardIds: [String(chosenCardId)],
    action: 'play',
    duration: playableUntilTurn > currentTurn ? 'until_end_of_next_turn' : 'this_turn',
    turnApplied: currentTurn,
    expiresAtTurn: playableUntilTurn,
    sourceName,
  }));

  try {
    await appendEvent(gameId, (game as any).seq || 0, 'grantPlayableFromExileChoiceResolve', {
      playerId,
      controllerId,
      sourceId: String(step.sourceId || '').trim() || undefined,
      sourceName,
      resolvedStepId: String(step.id || '').trim() || undefined,
      chosenCardId: String(chosenCardId),
      cardIds,
      playableUntilTurn,
      turnApplied: currentTurn,
      playWindowText,
    });
  } catch (err) {
    debugWarn(1, '[Resolution] appendEvent(grantPlayableFromExileChoiceResolve) failed:', err);
  }

  io.to(gameId).emit('chat', {
    id: `m_${Date.now()}`,
    gameId,
    from: 'system',
    message: `${sourceName}: ${getPlayerName(game, controllerId)} chose an exiled card to play ${playWindowText}.`,
    ts: Date.now(),
  });

  if (typeof (game as any).bumpSeq === 'function') {
    (game as any).bumpSeq();
  }
}

/** Rebound: cast the exiled card without paying its mana cost, or let it go to the graveyard. */
export async function handleReboundCastChoice(
  io: Server,
  game: any,
  gameId: string,
  step: ResolutionStep,
  response: ResolutionStepResponse,
): Promise<void> {
  const stepData = step as any;
  const selectedOption = response.selections;
  const playerId = response.playerId;

  const reboundCardId = stepData.reboundCardId;

  // Extract the choice - 'cast' or 'decline'
  let choice = 'decline';
  if (Array.isArray(selectedOption) && selectedOption.length > 0) {
    choice = typeof selectedOption[0] === 'string' ? selectedOption[0] : (selectedOption[0] as any)?.id || 'decline';
  } else if (typeof selectedOption === 'string') {
    choice = selectedOption;
  } else if (typeof selectedOption === 'object' && selectedOption !== null) {
    choice = (selectedOption as any).id || (selectedOption as any).value || 'decline';
  }

  // Find the card in exile
  const zones = game.state?.zones?.[playerId];
  if (!zones || !zones.exile) {
    debugWarn(2, `[Resolution] Rebound: No exile zone found for player ${playerId}`);
    return;
  }

  const cardIndex = zones.exile.findIndex((c: any) => c.id === reboundCardId);
  if (cardIndex === -1) {
    debugWarn(2, `[Resolution] Rebound: Card ${reboundCardId} not found in exile`);
    return;
  }

  const exiledCard = zones.exile[cardIndex];

  if (choice === 'cast') {
    // Player chose to cast - remove from exile and put on stack
    zones.exile.splice(cardIndex, 1);
    zones.exileCount = zones.exile.length;

    cleanupCardLeavingExile(game.state as any, exiledCard);

    // Add to stack as a spell (without paying mana cost)
    const stackItem = {
      id: uid("rebound_spell"),
      type: 'spell',
      card: { ...exiledCard, zone: 'stack', reboundPending: false, reboundTriggered: false },
      controller: playerId,
      targets: [],
      castFromRebound: true, // Mark that this was cast from rebound (goes to graveyard, not exile again)
      castFromHand: false, // Not cast from hand this time
    };
    game.state.stack = game.state.stack || [];
    game.state.stack.push(stackItem);

    // Emit chat message
    io.to(gameId).emit("chat", {
      id: `m_${Date.now()}`,
      gameId,
      from: "system",
      message: `🔄 ${getPlayerName(game, playerId)} cast ${exiledCard.name} from rebound!`,
      ts: Date.now(),
    });

    debug(2, `[Resolution] Rebound: ${playerId} cast ${exiledCard.name} from exile`);
  } else {
    // Player declined - move card from exile to graveyard
    zones.exile.splice(cardIndex, 1);
    zones.exileCount = zones.exile.length;

    cleanupCardLeavingExile(game.state as any, exiledCard);

    const reboundDeclineCtx = {
      state: game.state,
      libraries: (game as any).libraries,
      bumpSeq: typeof (game as any).bumpSeq === 'function' ? (game as any).bumpSeq.bind(game) : (() => {}),
      rng: (game as any).rng,
      gameId,
    } as any;

    zones.graveyard = zones.graveyard || [];
    pushCardToPlayerGraveyardWithReplacements(reboundDeclineCtx, String(playerId), exiledCard, zones.graveyard, {
      extraFields: { reboundPending: false, reboundTriggered: false },
    });
    zones.graveyardCount = zones.graveyard.length;

    // Emit chat message
    io.to(gameId).emit("chat", {
      id: `m_${Date.now()}`,
      gameId,
      from: "system",
      message: `${getPlayerName(game, playerId)} declined to cast ${exiledCard.name} from rebound - moved to graveyard.`,
      ts: Date.now(),
    });

    debug(2, `[Resolution] Rebound: ${playerId} declined to cast ${exiledCard.name}, moved to graveyard`);
  }

  // Bump sequence
  if (typeof (game as any).bumpSeq === "function") {
    (game as any).bumpSeq();
  }
}
