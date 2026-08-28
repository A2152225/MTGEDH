// server/src/state/modules/can-respond-handlers/canRespondCommandZoneCandidates.ts
// Origin parent: server/src/state/modules/can-respond.ts
// Cluster moved: getCommandZoneCommanderCandidates plus exclusive command-zone
// lookup helpers and getCastableCommanderCandidates.
// Public entry symbols: getCommandZoneCommanderCandidates, getCastableCommanderCandidates.

import type { GameContext } from '../../context.js';
import type { PlayerID } from '../../../../../shared/src/index.js';
import { parseManaCost, normalizeParsedManaCost, canPayManaCostWithAvailableSources } from '../mana-check.js';
import { applyCostAdjustmentToParsedCost, buildCostAdjustmentPlan } from '../cost-adjustments.js';
import { getEffectiveAdditionalCost } from '../../../socket/game-actions.js';
import { debugWarn } from '../../../utils/debug.js';
import { getDurableCommandZonePermissionForCard } from '../durable-permissions.js';
import { hydrateCardOracleInPlace } from '../cardOracleHydration.js';
import type { SharedCommanderAvailabilityCandidate, SharedCommanderCastCandidate } from './canRespondTypes.js';
import { isSplitSecondLockActive } from './canRespondSplitSecondLandPredicates.js';
import { hasFlashOrInstant } from './canRespondTopLibraryFlashExile.js';
import { canPaySourceGrantedAdditionalCost } from './canRespondGraveyardSpellPermission.js';
import { normalizeParsedCostForAnyTypeManaSpending } from './canRespondHandCastEvaluation.js';

function getCommandZoneCommanderCards(commandZone: any): any[] {
  if (Array.isArray(commandZone?.commanderCards)) {
    return commandZone.commanderCards;
  }

  if (Array.isArray(commandZone?.commanders)) {
    return commandZone.commanders;
  }

  return [];
}

function getCommandZoneCommanderIds(commandZone: any): string[] {
  if (Array.isArray(commandZone?.inCommandZone)) {
    return commandZone.inCommandZone.map((entry: unknown) => String(entry || '').trim()).filter(Boolean);
  }

  // Legacy games may lack inCommandZone; fall back to commanderIds only when unset.
  if (Array.isArray(commandZone?.commanderIds)) {
    return commandZone.commanderIds.map((entry: unknown) => String(entry || '').trim()).filter(Boolean);
  }

  return [];
}

function isTokenOrCopyCommanderLookalike(entry: any, entryCard: any): boolean {
  if (!entry && !entryCard) return false;
  if (entry?.isToken === true || entryCard?.isToken === true) return true;
  if (entry?.isCopy === true || entryCard?.isCopy === true) return true;
  if (entry?.isCopyOfPrintedCard === true || entryCard?.isCopyOfPrintedCard === true) return true;
  if (String(entry?.copiedFromPermanentId || entryCard?.copiedFromPermanentId || '').trim()) return true;
  const typeLine = String(entryCard?.type_line || entryCard?.typeLine || entry?.type_line || '').toLowerCase();
  if (/\btoken\b/.test(typeLine)) return true;
  return false;
}

type CommanderZonePresenceHit = {
  zone: 'battlefield' | 'stack';
  entryId: string;
  cardId: string;
  cardName: string;
  isCommander: boolean;
  isToken: boolean;
  controller: string;
  matchReason: 'same_card_id' | 'isCommander_name';
};

/**
 * Find BF/stack entries that look like this commander instance.
 * Name-only matches require isCommander===true and must not be tokens/copies.
 * Same-named non-commander permanents (or tokens) are ignored.
 */
function findCommanderBattlefieldOrStackHits(
  state: any,
  playerId: PlayerID,
  commanderId: string,
  commander: any,
): CommanderZonePresenceHit[] {
  const battlefield = Array.isArray(state?.battlefield) ? state.battlefield : [];
  const stack = Array.isArray(state?.stack) ? state.stack : [];
  const commanderName = String(commander?.name || '').trim();
  const hits: CommanderZonePresenceHit[] = [];

  const pushHit = (
    zone: 'battlefield' | 'stack',
    entry: any,
    entryCard: any,
    matchReason: CommanderZonePresenceHit['matchReason'],
  ) => {
    const entryCardId = String(entryCard?.id || '').trim();
    hits.push({
      zone,
      entryId: String(entry?.id || entryCardId || '').trim(),
      cardId: entryCardId,
      cardName: String(entryCard?.name || '').trim(),
      isCommander: entry?.isCommander === true,
      isToken: isTokenOrCopyCommanderLookalike(entry, entryCard),
      controller: String(entry?.controller || '').trim(),
      matchReason,
    });
  };

  for (const entry of battlefield) {
    const entryCard = entry?.card;
    const entryCardId = String(entryCard?.id || '').trim();
    const entryCardName = String(entryCard?.name || '').trim();
    const isCommander = entry?.isCommander === true;
    const isToken = isTokenOrCopyCommanderLookalike(entry, entryCard);
    const controller = String(entry?.controller || '').trim();

    if (entryCardId && entryCardId === commanderId) {
      pushHit('battlefield', entry, entryCard, 'same_card_id');
      continue;
    }
    // Name match only for a real non-token commander permanent — never bare name equality.
    if (
      isCommander &&
      controller === String(playerId || '') &&
      commanderName.length > 0 &&
      entryCardName === commanderName &&
      !isToken
    ) {
      pushHit('battlefield', entry, entryCard, 'isCommander_name');
    }
  }

  for (const entry of stack) {
    const entryType = String(entry?.type || '').toLowerCase();
    // Only an actual commander SPELL on the stack counts — not triggers/abilities whose
    // sourceCard happens to be (or be named like) the commander.
    if (entryType && entryType !== 'spell') continue;
    const spellCard = entry?.card || entry?.spell?.card;
    const spellCardId = String(spellCard?.id || '').trim();
    if (spellCardId && spellCardId === commanderId) {
      pushHit('stack', entry, spellCard, 'same_card_id');
    }
  }

  return hits;
}

/**
 * @deprecated Prefer findCommanderBattlefieldOrStackHits. Kept for call-site clarity.
 * When the commander id is listed in inCommandZone, callers must NOT treat BF/stack
 * leftovers as blocking (undo/replay can leave ghosts on both CZ and BF).
 */
function isCommanderAlreadyOnBattlefieldOrStack(
  state: any,
  playerId: PlayerID,
  commanderId: string,
  commander: any,
): boolean {
  return findCommanderBattlefieldOrStackHits(state, playerId, commanderId, commander).length > 0;
}

export function getCommandZoneCommanderCandidates(
  ctx: GameContext,
  playerId: PlayerID,
): SharedCommanderAvailabilityCandidate[] {
  try {
    const state = ctx?.state as any;
    if (!state) return [];

    const commandZone = state.commandZone?.[playerId];
    if (!commandZone) return [];

    const commanderCards = getCommandZoneCommanderCards(commandZone);
    const inCommandZone = getCommandZoneCommanderIds(commandZone);
    if (commanderCards.length === 0 || inCommandZone.length === 0) {
      return [];
    }

    const candidates: SharedCommanderAvailabilityCandidate[] = [];

    for (const commanderKey of inCommandZone) {
      const commander = commanderCards.find((card: any) => {
        const cardId = String(card?.id || '').trim();
        const cardName = String(card?.name || '').trim();
        return cardId === commanderKey || cardName === commanderKey;
      });
      if (!commander) {
        debugWarn(1, `[getCommandZoneCommanderCandidates] No commanderCards entry for inCommandZone key ${commanderKey}; excluding`);
        continue;
      }

      const commanderId = String(commander?.id || commanderKey).trim();
      if (!commanderId) continue;

      // inCommandZone is authoritative for cast eligibility. After undo/reload, the same
      // commander id can incorrectly remain on BF/stack as a ghost while also listed in CZ.
      // Log those hits for diagnosis, but do NOT exclude the CZ cast candidate.
      const presenceHits = findCommanderBattlefieldOrStackHits(state, playerId, commanderId, commander);
      if (presenceHits.length > 0) {
        debugWarn(1, `[getCommandZoneCommanderCandidates] Commander ${commanderId} (${commander?.name || '?'}) is inCommandZone but also present on BF/stack (undo drift?). Allowing CZ cast.`, {
          hits: presenceHits,
        });
      }

      // Post-reload stubs may keep name/image but lose mana_cost/oracle; repair before gating.
      try {
        hydrateCardOracleInPlace(commander);
      } catch {
        /* best-effort */
      }

      const manaCost = String(commander?.mana_cost || commander?.manaCost || '').trim();
      if (!manaCost) {
        debugWarn(1, `[getCommandZoneCommanderCandidates] Commander ${commanderId} (${commander?.name || '?'}) has no mana_cost after hydrate; excluding from cast candidates`);
        continue;
      }

      try {
        const durableCommandPermission = getDurableCommandZonePermissionForCard(state, playerId, commander, 'cast');
        const commandZonePermissionCostMode = String(durableCommandPermission?.costMode || '').trim() || undefined;
        const spendManaAsThoughAnyType = (durableCommandPermission?.metadata as any)?.spendManaAsThoughAnyType === true;
        const parsedCost = parseManaCost(commandZonePermissionCostMode === 'without_paying_mana_cost' ? '' : manaCost);
        const commanderTax = Number((commandZone as any).taxById?.[commanderId] ?? (commandZone as any).taxById?.[commanderKey] ?? 0) || 0;
        const costAdjustmentPlan = buildCostAdjustmentPlan(state, playerId, commander);
        const costAdjustment = costAdjustmentPlan.totalAdjustment;
        const adjustedCost = normalizeParsedManaCost(
          applyCostAdjustmentToParsedCost(parsedCost, costAdjustmentPlan, commanderTax),
        );
        const payableCost = spendManaAsThoughAnyType
          ? normalizeParsedCostForAnyTypeManaSpending(adjustedCost)
          : adjustedCost;
        const addCost = getEffectiveAdditionalCost(commander, commander.oracle_text || commander.oracleText || '');
        const typeLine = String(commander?.type_line || commander?.typeLine || '').toLowerCase();
        const canPayCost = canPayManaCostWithAvailableSources(state, playerId, payableCost, Infinity, {
          restrictedSpendPurpose: {
            spellCard: commander,
            isCommander: true,
            ...(typeLine.includes('creature') ? { isCreature: true } : {}),
            ...(typeLine.includes('artifact') ? { isArtifact: true } : {}),
            ...((typeLine.includes('instant') || typeLine.includes('sorcery')) ? { isInstantOrSorcery: true } : {}),
            ...(typeLine.includes('legendary') ? { isLegendary: true } : {}),
          },
        })
          && (!addCost || canPaySourceGrantedAdditionalCost(state, playerId, commander, addCost as any));

        const cmc = adjustedCost.generic + Object.values(adjustedCost.colors).reduce((sum, value) => sum + value, 0);

        candidates.push({
          card: commander,
          commanderId,
          manaCost,
          cost: {
            ...adjustedCost,
            cmc,
          },
          grantsFlash: hasFlashOrInstant(commander)
            || durableCommandPermission?.timingOverride?.asThoughFlash === true
            || durableCommandPermission?.timingOverride?.ignoreTiming === true,
          isBackground: typeLine.includes('background'),
          commanderTax,
          costAdjustment,
          canPayCost,
          ...(commandZonePermissionCostMode ? { commandZonePermissionCostMode } : {}),
          ...(spendManaAsThoughAnyType ? {
            spendManaAsThoughAnyType: true,
            payableCost: {
              ...payableCost,
              cmc,
            },
          } : {}),
        });
      } catch (costErr) {
        debugWarn(1, `[getCommandZoneCommanderCandidates] Commander ${commanderId} (${commander?.name || '?'}) excluded: costParseError`, costErr);
      }
    }

    if (candidates.length === 0 && inCommandZone.length > 0) {
      debugWarn(1, '[getCommandZoneCommanderCandidates] Produced zero candidates despite inCommandZone entries', {
        playerId: String(playerId),
        inCommandZone,
        commanderCardIds: commanderCards.map((c: any) => String(c?.id || '')),
        commanderNames: commanderCards.map((c: any) => String(c?.name || '')),
        commanderManaCosts: commanderCards.map((c: any) => String(c?.mana_cost || c?.manaCost || '')),
        stackSize: Array.isArray(state?.stack) ? state.stack.length : 0,
        stackTypes: Array.isArray(state?.stack) ? state.stack.map((s: any) => String(s?.type || '')) : [],
        battlefieldCommanderFlags: Array.isArray(state?.battlefield)
          ? state.battlefield
              .filter((p: any) => p?.isCommander === true || String(p?.card?.name || '') === String(commanderCards[0]?.name || ''))
              .map((p: any) => ({
                id: p?.id,
                cardId: p?.card?.id,
                name: p?.card?.name,
                isCommander: p?.isCommander === true,
                isToken: p?.isToken === true,
                controller: p?.controller,
              }))
          : [],
      });
    }

    return candidates;
  } catch (err) {
    debugWarn(1, '[getCommandZoneCommanderCandidates] Error:', err);
    return [];
  }
}

export function getCastableCommanderCandidates(
  ctx: GameContext,
  playerId: PlayerID,
): SharedCommanderCastCandidate[] {
  try {
    const state = ctx?.state as any;
    if (!state) return [];

    if (isSplitSecondLockActive(state)) {
      return [];
    }

    return getCommandZoneCommanderCandidates(ctx, playerId)
      .filter((candidate) => candidate.canPayCost)
      .map(({ canPayCost: _canPayCost, ...candidate }) => candidate);
  } catch (err) {
    debugWarn(1, '[getCastableCommanderCandidates] Error:', err);
    return [];
  }
}
