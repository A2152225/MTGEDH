/**
 * Origin parent: server/src/socket/ai.ts
 *
 * Cluster moved: findCastableSpells.
 *
 * Public entry symbols: findCastableSpells.
 */
import type { PlayerID } from "../../../../shared/src/types.js";
import { getCastableSpellCandidates } from "../../state/modules/can-respond.js";
import {
  getAvailableMana,
  getTotalManaFromPool,
  parseManaCost,
  type ParsedManaCost,
} from "../../state/modules/mana-check.js";
import {
  chooseMultikickerTimesForChargeInvest,
  expandManaCostWithMultikicker,
  isMultikickerChargeCounterManaInvest,
  parseMultikickerManaCost,
} from "../../state/modules/multikickerCastUtils.js";
import { getMaxAffordableSpellX, isSpellWorthCastingAtX } from "../../state/modules/spellXCastUtils.js";
import { getEffectiveAdditionalCost } from "../game-actions.js";
import { debug } from "../../utils/debug.js";
import { getAIHandlerDeps } from "../aiHandlerDeps.js";
import type { AICastableSpellCandidate } from "./aiActionCandidateTypes.js";
import { getAIParsedManaCostAmount } from "./aiChoicePromptHandlers.js";
import { canAIPayAdditionalCost } from "./aiManaCostHelpers.js";
import { canAIAssembleSpellPaymentPlan } from "./aiSpellPaymentPlanHelpers.js";

function getAIActionContext(game: any): any {
  return getAIHandlerDeps().getAIActionContext(game);
}

function isAISpellContextuallyUseful(game: any, playerId: PlayerID, card: any): boolean {
  return getAIHandlerDeps().isAISpellContextuallyUseful(game, playerId, card);
}

function calculateResponseSpellPriority(
  card: any,
  game: any,
  playerId: PlayerID,
  adjustedCost?: { generic: number; colors: Record<string, number> },
): number {
  return getAIHandlerDeps().calculateResponseSpellPriority(card, game, playerId, adjustedCost);
}

function isAIFailedSpellCastCard(game: any, playerId: string, cardId: string): boolean {
  return getAIHandlerDeps().isAIFailedSpellCastCard(game, playerId, cardId);
}

function calculateSpellPriority(
  card: any,
  game: any,
  playerId: PlayerID,
  adjustedCost?: { generic: number; colors: Record<string, number> },
): number {
  return getAIHandlerDeps().calculateSpellPriority(card, game, playerId, adjustedCost);
}

/**
 * Find all supported spells the AI can currently afford to cast.
 * This includes hand spells plus the top card of the library when the same
 * player-side permission helpers allow it.
 * Uses shared mana calculation system for consistency with human players
 */
export function findCastableSpells(
  game: any,
  playerId: PlayerID,
  options?: { responseOnly?: boolean },
): AICastableSpellCandidate[] {
  const ctx = getAIActionContext(game);
  const responseOnly = options?.responseOnly === true;
  const manaPool = getAvailableMana(game.state, playerId);
  const totalMana = getTotalManaFromPool(manaPool);
  debug(1, '[AI] Available mana pool:', {
    total: totalMana,
    colors: manaPool,
  });

  const sharedCandidates = getCastableSpellCandidates(ctx, playerId, {
    mode: responseOnly ? 'response' : 'main',
    skipIgnoredCards: true,
    allowAlternateCosts: false,
    allowUnknownCostFallback: false,
  });

  if (sharedCandidates.length === 0) {
    debug(1, `[AI] findCastableSpells: No shared spell candidates${responseOnly ? ' at response speed' : ''}`);
    return [];
  }

  const castable = sharedCandidates
    .filter((candidate) => candidate.payability === 'normal' && candidate.cost)
    .filter((candidate) => {
      const castCard = candidate.castCard || candidate.card;
      const useful = isAISpellContextuallyUseful(game, playerId, castCard);
      if (!useful) {
        debug(1, `[AI] findCastableSpells: Skipping ${castCard?.name || candidate.card?.name || 'spell'} because the current board has no legal context for it`);
      }
      return useful;
    })
    .filter((candidate) => {
      // Check additional non-mana costs first to make sure AI can pay them before checking mana payment plan
      const card = candidate.card;
      const castCard = candidate.castCard || card;
      const cardId = String(card?.id || '').trim();
      if (cardId && isAIFailedSpellCastCard(game, String(playerId), cardId)) {
        debug(
          1,
          `[AI] findCastableSpells: Skipping ${castCard?.name || cardId} — cast already failed this turn`,
        );
        return false;
      }
      if (cardId) {
        const battlefield = Array.isArray(game.state?.battlefield) ? game.state.battlefield : [];
        const alreadyPresent = battlefield.some((permanent: any) =>
          permanent
          && String(permanent.controller || '') === String(playerId)
          && String(permanent.card?.id || '') === cardId,
        );
        if (alreadyPresent) {
          debug(
            1,
            `[AI] findCastableSpells: Skipping ${castCard?.name || cardId} — same card id already on battlefield (stale hand ghost)`,
          );
          return false;
        }
      }
      if (castCard) {
        const addCost = getEffectiveAdditionalCost(castCard, castCard.oracle_text || '');
        if (addCost && !canAIPayAdditionalCost(game, playerId, candidate, addCost)) {
          debug(1, `[AI] findCastableSpells: Skipping spell ${castCard.name} because additional cost cannot be paid:`, addCost);
          return false;
        }
      }

      const excludedHandCardIds = candidate.sourceZone === 'hand'
        ? [String(candidate.card?.id || '').trim()].filter(Boolean)
        : [];
      const oracleText = String(candidate.castCard?.oracle_text || candidate.castCard?.oracleText || '');
      const baseManaCost = String(
        candidate.manaCost
        || candidate.castCard?.mana_cost
        || candidate.castCard?.manaCost
        || '',
      ).trim();

      if (candidate.cost?.hasX) {
        const maxX = getMaxAffordableSpellX(game, playerId, baseManaCost, {
          excludedHandCardIds,
        });
        if (!isSpellWorthCastingAtX(oracleText, maxX)) {
          debug(
            1,
            `[AI] findCastableSpells: Skipping ${candidate.castCard?.name || candidate.card?.name} because X=${maxX} would have no meaningful effect`,
          );
          return false;
        }
      }

      let paymentCost = candidate.payableCost || candidate.cost!;
      if (isMultikickerChargeCounterManaInvest(oracleText)) {
        const timesKicked = chooseMultikickerTimesForChargeInvest(game, playerId, candidate.castCard || candidate.card, {
          baseManaCost: baseManaCost || '{0}',
          excludedHandCardIds,
        });
        if (timesKicked <= 0) {
          debug(
            1,
            `[AI] findCastableSpells: Skipping ${candidate.castCard?.name || candidate.card?.name} because multikicker charge invest would enter with 0 counters`,
          );
          return false;
        }
        const expanded = expandManaCostWithMultikicker(
          baseManaCost || '{0}',
          parseMultikickerManaCost(oracleText),
          timesKicked,
        );
        paymentCost = parseManaCost(expanded);
        (candidate as any).__aiTimesKicked = timesKicked;
        (candidate as any).__aiPaymentCost = paymentCost;
      }

      return canAIAssembleSpellPaymentPlan(game, playerId, paymentCost, excludedHandCardIds);
    })
    .map((candidate) => {
      const typeLine = String(candidate.castCard?.type_line || '').toLowerCase();
      const paymentCost = (candidate as any).__aiPaymentCost || candidate.payableCost || candidate.cost;
      const timesKicked = Number.isFinite((candidate as any).__aiTimesKicked)
        ? Math.max(0, Math.floor(Number((candidate as any).__aiTimesKicked)))
        : undefined;
      const cmc = getAIParsedManaCostAmount(
        (paymentCost || candidate.cost) as ParsedManaCost,
      );

      return {
        card: candidate.card,
        castCard: candidate.castCard,
        sourceZone: candidate.sourceZone,
        faceIndex: typeof candidate.castCard?.faceIndex === 'number' ? candidate.castCard.faceIndex : undefined,
        cost: candidate.cost,
        paymentCost,
        timesKicked,
        cmc,
        typeLine,
        priority: responseOnly
          ? calculateResponseSpellPriority(candidate.castCard, game, playerId, candidate.cost)
          : calculateSpellPriority(candidate.castCard, game, playerId, candidate.cost),
      } satisfies AICastableSpellCandidate;
    });

  if (castable.length > 0) {
    debug(1, `[AI] findCastableSpells: Found ${castable.length} castable spell(s):`,
      castable.map((spell) => `${spell.castCard?.name || spell.card?.name} from ${spell.sourceZone} (CMC ${spell.cmc}, priority ${spell.priority})`));
  } else {
    debug(1, `[AI] findCastableSpells: Shared candidates exist but none use a normal AI-supported cost${responseOnly ? ' at response speed' : ''}`);
  }
  
  // Sort by priority (highest first)
  castable.sort((a, b) => b.priority - a.priority);
  
  return castable;
}
