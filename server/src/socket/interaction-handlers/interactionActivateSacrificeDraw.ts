/**
 * Origin parent: server/src/socket/interaction.ts
 *
 * Cluster moved: activateBattlefieldAbility sacrifice-to-draw family
 * (Sunbaked Canyon, Horizon Canopy, Commander's Sphere, etc.).
 *
 * Public entry symbols: tryHandleActivateSacrificeDraw, finishSacrificeDrawActivation.
 */

import { appendEvent } from "../../db";
import { sacrificePermanent } from "../../state/modules/upkeep-triggers.js";
import { applySacrificeDrawFromAuthoritativeLibrary } from "../../state/modules/applyEventReplayCardMoveLibraryHelpers.js";
import {
  broadcastGame,
  getPlayerName,
} from "../util";
import { payBattlefieldAbilityManaCostOrQueue } from "./interactionActivateBattlefieldAbilityHelpers.js";
import type { ActivateBattlefieldAbilityContext } from "./interactionActivateBattlefieldAbilityContext.js";

export async function finishSacrificeDrawActivation(params: {
  io: ActivateBattlefieldAbilityContext['io'];
  game: any;
  gameId: string;
  pid: string;
  permanentId: string;
  abilityId: string;
  cardName: string;
  manaCost?: string;
  requiresTap: boolean;
}): Promise<void> {
  const { io, game, gameId, pid, permanentId, abilityId, cardName, manaCost, requiresTap } = params;
  const battlefield = Array.isArray(game.state?.battlefield) ? game.state.battlefield : [];
  const permanent = battlefield.find((entry: any) => entry && String(entry.id) === String(permanentId));
  if (!permanent) return;

  if (requiresTap && !(permanent as any).tapped) {
    (permanent as any).tapped = true;
  }

  sacrificePermanent(game as any, String(permanentId), pid);

  const drawnCards = applySacrificeDrawFromAuthoritativeLibrary(game as any, pid);
  const drawnCardIds = drawnCards
    .map((card: any) => String(card?.id || '').trim())
    .filter(Boolean);

  if (drawnCards.length > 0) {
    io.to(gameId).emit("chat", {
      id: `m_${Date.now()}`,
      gameId,
      from: "system",
      message: `${getPlayerName(game, pid)} sacrificed ${cardName} and drew a card.`,
      ts: Date.now(),
    });
  } else {
    io.to(gameId).emit("chat", {
      id: `m_${Date.now()}`,
      gameId,
      from: "system",
      message: `${getPlayerName(game, pid)} sacrificed ${cardName} but had no cards to draw.`,
      ts: Date.now(),
    });
  }

  if (typeof game.bumpSeq === "function") {
    game.bumpSeq();
  }

  appendEvent(gameId, (game as any).seq ?? 0, "activateSacrificeDrawAbility", {
    playerId: pid,
    permanentId,
    abilityId,
    cardName,
    manaCost,
    requiresTap,
    ...(drawnCardIds.length > 0 ? { drawnCardIds } : {}),
  });

  broadcastGame(io, game, gameId);
}

export async function tryHandleActivateSacrificeDraw(
  ctx: ActivateBattlefieldAbilityContext,
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
    card,
    cardName,
    scopedAbilityFullText,
  } = ctx;

  const hasLegacyAbilityToken = (token: string) => !abilityId.includes('-ability-') && abilityId.includes(token);

  // Handle sacrifice-to-draw abilities (Sunbaked Canyon, Horizon Canopy, Commander's Sphere, etc.)
  // Patterns:
  // - "{cost}, {T}, Sacrifice ~: Draw a card"
  // - "Sacrifice ~: Draw a card"
  // The client generates abilityId like "{cardId}-ability-{index}" for general activated abilities
  // Only process if oracle text actually has the sacrifice-to-draw pattern
  const hasSacrificeDrawPattern = scopedAbilityFullText.includes("sacrifice") && scopedAbilityFullText.includes("draw a card");
  const isSacrificeDrawAbility = (hasLegacyAbilityToken("sacrifice-draw") || abilityId.includes("-ability-")) && hasSacrificeDrawPattern;
  if (isSacrificeDrawAbility) {
    // Parse optional mana/tap costs from oracle text.
    const sacrificeCostMatch = scopedAbilityFullText.match(/^(?:(\{[^}]+\}(?:\s*\{[^}]+\})*)\s*,\s*)?(?:(\{T\})\s*,\s*)?sacrifice\s+([^:]+):\s*draw a card\.?$/i);
    
    if (sacrificeCostMatch) {
      const sacrificeSubject = String(sacrificeCostMatch[3] || '').trim().toLowerCase();
      const selfSacrificeSubjects = new Set([
        '~',
        'this',
        'this artifact',
        'this creature',
        'this enchantment',
        'this land',
        'this permanent',
        String(cardName || '').trim().toLowerCase(),
      ]);

      if (!selfSacrificeSubjects.has(sacrificeSubject)) {
        // Costs like "Sacrifice a creature: Draw a card" need the generic activation-cost flow.
      } else {
      const manaCostStr = sacrificeCostMatch[1];
      const requiresTap = Boolean(sacrificeCostMatch[2]);

      if (requiresTap && (permanent as any).tapped) {
        socket.emit("error", {
          code: "ALREADY_TAPPED",
          message: `${cardName} is already tapped`,
        });
        return true;
      }

      if (manaCostStr) {
        const paymentResult = payBattlefieldAbilityManaCostOrQueue({
          game,
          gameId,
          pid,
          permanentId,
          abilityId,
          cardName,
          card,
          manaCost: manaCostStr,
          requiresTap,
          activatedAbilityText: scopedAbilityFullText,
          activationPaymentContext: 'sacrifice_draw',
        });
        if (paymentResult === 'queued') return true;
        if (paymentResult === 'failed') {
          socket.emit("error", {
            code: "INSUFFICIENT_MANA",
            message: `Not enough mana to activate ${cardName}.`,
          });
          return true;
        }
        io.to(gameId).emit("chat", {
          id: `m_${Date.now()}`,
          gameId,
          from: "system",
          message: `${getPlayerName(game, pid)} paid ${manaCostStr}.`,
          ts: Date.now(),
        });
      }

      await finishSacrificeDrawActivation({
        io,
        game,
        gameId,
        pid,
        permanentId,
        abilityId,
        cardName,
        manaCost: manaCostStr,
        requiresTap,
      });
      return true;
      }
    }
  }
  

  return false;
}
