// server/src/socket/util-handlers/gameStateEmitNormalize.ts
// Origin parent: server/src/socket/util.ts
// Cluster moved: shared emit battlefield cache, token grouping for emit,
//   normalizeViewForEmit, logStateDebug.
// Public entry symbols: optimizeBattlefieldTokensForEmit, normalizeViewForEmit,
//   logStateDebug.
// optimizeBattlefieldTokensForEmit is re-exported from util.ts.

import type { CardCostAdjustment } from "../../../../shared/src/index.js";
import { applyStaticAbilitiesToBattlefield } from "../../../../rules-engine/src/staticAbilities.js";
import { getCostAdjustmentInfo, canAct, canRespond } from "../../state/modules/can-respond.js";
import { getDevotionManaAmount, getCreatureCountManaAmount } from "../../state/modules/mana-abilities.js";
import {
  repairNonPermanentBattlefieldGhosts,
  isImpossibleFaceUpNonPermanentBattlefieldCard,
} from "../../state/modules/stackReplayUtils.js";
import { debug, debugWarn, debugEnv } from "../../utils/debug.js";
import { registerTokenGroupMembers } from "../tokenGroupResolve.js";
import { getPlayableCardIds } from "./getPlayableCardIds.js";
import { getGraveyardAbilityHints } from "./getGraveyardAbilityHints.js";
import { defaultPlayerZones } from "./playerStateZones.js";

type SharedEmitBattlefieldCache = {
  seq: number;
  battlefield: any[];
  tokenGroupingApplied?: boolean;
  originalBattlefieldCount?: number;
};

function getSharedEmitBattlefieldCache(game: any): SharedEmitBattlefieldCache | null {
  const seq = Number(game?.seq ?? 0);
  const cached = game?._sharedEmitBattlefieldCache as SharedEmitBattlefieldCache | undefined;
  if (cached && cached.seq === seq) {
    return cached;
  }
  return null;
}

const MIN_TOKEN_GROUPING_REDUCTION_RATIO = 0.9;

export function optimizeBattlefieldTokensForEmit(
  battlefield: any[],
  game?: any,
): {
  battlefield: any[];
  tokenGroupingApplied?: boolean;
  originalBattlefieldCount?: number;
} {
  const tokenGroups = new Map<string, { prototype: any; ids: string[] }>();
  const nonTokenPermanents: any[] = [];

  for (const perm of battlefield) {
    if (!perm) continue;

    const hasEquipment = perm.attachedEquipment?.length > 0 || perm.isEquipped;
    const hasAuras = perm.attachments?.length > 0;
    const isAttachedToSomething = !!perm.attachedTo;
    const hasDamage = (perm.damageTaken || 0) > 0 || (perm.damageMarked || 0) > 0 || (perm.markedDamage || 0) > 0;
    // `attacking` is the live combat flag set by declareAttackers (string player/planeswalker id).
    // `isAttacking` is not consistently set, so omit it and attacking tokens stay grouped as
    // `group_*` during declare blockers — client then sends invalid attackerIds.
    const isInCombat =
      perm.isBlocking ||
      perm.isAttacking ||
      (typeof perm.attacking === 'string' && perm.attacking.length > 0) ||
      (Array.isArray(perm.blocking) && perm.blocking.length > 0);

    const hasModifiers = perm.modifiers?.length > 0;
    const hasTemporaryEffects = perm.temporaryEffects?.length > 0;
    const hasTempPTMod = !!perm.tempPTMod;
    const hasTemporaryProtection = perm.temporaryProtection?.length > 0;
    const hasTempMods = hasModifiers || hasTemporaryEffects || hasTempPTMod || hasTemporaryProtection;

    const isGroupableToken =
      perm.isToken === true &&
      !hasEquipment &&
      !hasAuras &&
      !isAttachedToSomething &&
      !hasDamage &&
      !isInCombat &&
      !hasTempMods;

    if (isGroupableToken) {
      const card = perm.card || {};
      const countersStr = Object.entries(perm.counters || {})
        .filter(([, v]) => (v as number) > 0)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => `${k}:${v}`)
        .join(',');

      const grantedAbilitiesStr = (perm.grantedAbilities || [])
        .slice()
        .sort()
        .join('|');

      const oracleText = (card.oracle_text || '').toLowerCase();
      const staticAbilities: string[] = [];
      const keywordPatterns = [
        'flying', 'first strike', 'double strike', 'deathtouch', 'lifelink',
        'vigilance', 'trample', 'haste', 'hexproof', 'indestructible',
        'menace', 'reach', 'defender', 'flash', 'shroud', 'protection',
        'infect', 'wither', 'persist', 'undying', 'annihilator',
        'intimidate', 'skulk', 'prowess', 'afflict', 'afterlife',
      ];
      for (const keyword of keywordPatterns) {
        if (oracleText.includes(keyword)) {
          staticAbilities.push(keyword);
        }
      }
      if (oracleText.includes('power and toughness are each equal to')) {
        staticAbilities.push('variable_pt');
      }

      const staticAbilitiesStr = staticAbilities.sort().join('|');
      const colorsStr = (card.colors || []).slice().sort().join('');

      const key = [
        `ctrl:${perm.controller}`,
        `name:${card.name || ''}`,
        `p:${perm.effectivePower ?? perm.basePower ?? card.power ?? 0}`,
        `t:${perm.effectiveToughness ?? perm.baseToughness ?? card.toughness ?? 0}`,
        `tap:${perm.tapped ? 1 : 0}`,
        `sick:${perm.summoningSickness ? 1 : 0}`,
        `cnt:${countersStr}`,
        `grantedAbil:${grantedAbilitiesStr}`,
        `staticAbil:${staticAbilitiesStr}`,
        `col:${colorsStr}`,
      ].join('|');

      const existing = tokenGroups.get(key);
      if (existing) {
        existing.ids.push(perm.id);
      } else {
        tokenGroups.set(key, { prototype: perm, ids: [perm.id] });
      }
    } else {
      nonTokenPermanents.push(perm);
    }
  }

  const optimizedBattlefield = [...nonTokenPermanents];
  let hasGroupedTokens = false;

  for (const [, group] of tokenGroups) {
    if (group.ids.length === 1) {
      optimizedBattlefield.push({
        ...group.prototype,
        isToken: true,
      });
    } else {
      hasGroupedTokens = true;
      const groupId = `group_${group.ids[0]}`;
      if (game) {
        registerTokenGroupMembers(game, groupId, group.ids);
      }
      optimizedBattlefield.push({
        ...group.prototype,
        tokenCount: group.ids.length,
        isGroupedTokens: true,
        isToken: true,
        id: groupId,
        originalId: group.ids[0],
        // Client can use real ids when present; server still resolves virtual refs after restart.
        groupedTokenIds: group.ids.slice(),
      });
    }
  }

  const originalCount = battlefield.length;
  const optimizedCount = optimizedBattlefield.length;

  if (hasGroupedTokens || optimizedCount < originalCount * MIN_TOKEN_GROUPING_REDUCTION_RATIO) {
    if (hasGroupedTokens) {
      debug(2, `[TokenOptimization] Applied grouping: ${originalCount} → ${optimizedCount} entries, has grouped tokens with counts`);
    } else {
      debug(2, `[TokenOptimization] Reduced battlefield from ${originalCount} to ${optimizedCount} entries (${Math.round((1 - optimizedCount / originalCount) * 100)}% reduction)`);
    }
    return {
      battlefield: optimizedBattlefield,
      tokenGroupingApplied: true,
      originalBattlefieldCount: originalCount,
    };
  }

  return { battlefield };
}

function augmentBattlefieldManaAmountsForEmit(battlefield: any[], game: any): void {
  if (!Array.isArray(battlefield) || !game?.state) return;

  for (const perm of battlefield) {
    if (!perm || perm.tapped) continue;

    const controller = perm.controller;
    if (!controller) continue;

    const devotionMana = getDevotionManaAmount(game.state, perm, controller);
    if (devotionMana && devotionMana.amount > 0) {
      perm.manaAmount = devotionMana.amount;
      perm.manaColor = devotionMana.color;
    }

    const creatureCountMana = getCreatureCountManaAmount(game.state, perm, controller);
    if (creatureCountMana && creatureCountMana.amount > 0 && !perm.manaAmount) {
      perm.manaAmount = creatureCountMana.amount;
      perm.manaColor = creatureCountMana.color;
    }
  }
}

function buildSharedEmitBattlefieldCache(game: any, sourceBattlefield: any[]): SharedEmitBattlefieldCache {
  const seq = Number(game?.seq ?? 0);
  let battlefield = sourceBattlefield;

  try {
    if (battlefield.length > 0) {
      battlefield = applyStaticAbilitiesToBattlefield(battlefield, game?.state);
    }
  } catch (e) {
    debugWarn(1, "Failed to apply static abilities to battlefield:", e);
  }

  let tokenGroupingApplied: boolean | undefined;
  let originalBattlefieldCount: number | undefined;
  try {
    const optimized = optimizeBattlefieldTokensForEmit(battlefield, game);
    battlefield = optimized.battlefield;
    tokenGroupingApplied = optimized.tokenGroupingApplied;
    originalBattlefieldCount = optimized.originalBattlefieldCount;
  } catch (e) {
    debugWarn(1, "Token grouping optimization failed:", e);
  }

  try {
    augmentBattlefieldManaAmountsForEmit(battlefield, game);
  } catch (e) {
    debugWarn(1, "Failed to augment mana amounts:", e);
  }

  const cache: SharedEmitBattlefieldCache = {
    seq,
    battlefield,
    tokenGroupingApplied,
    originalBattlefieldCount,
  };
  if (game) {
    game._sharedEmitBattlefieldCache = cache;
    // Emit projection only — do not replace authoritative battlefield (oracle text, ids, etc.).
  }
  return cache;
}

function applySharedBattlefieldCacheToView(view: any, game: any): void {
  if (!view?.battlefield || !Array.isArray(view.battlefield) || view.battlefield.length === 0) {
    return;
  }

  // Scrub impossible face-up instant/sorcery ghosts before reusing or building
  // the emit projection. Repairs must invalidate any cache for this seq.
  try {
    const repaired = repairNonPermanentBattlefieldGhosts(game);
    if (repaired > 0) {
      if (game) {
        game._sharedEmitBattlefieldCache = undefined;
      }
      if (Array.isArray(game?.state?.battlefield)) {
        // viewFor may have copied ghosts before repair; prefer authoritative BF.
        view.battlefield = game.state.battlefield.map((perm: any) => ({ ...perm }));
      } else {
        view.battlefield = view.battlefield.filter(
          (perm: any) => !isImpossibleFaceUpNonPermanentBattlefieldCard(perm),
        );
      }
      debug(1, `applySharedBattlefieldCacheToView: removed ${repaired} non-permanent battlefield ghost(s)`);
    }
  } catch (err) {
    debugWarn(1, "applySharedBattlefieldCacheToView: ghost repair failed", err);
  }

  if (!Array.isArray(view.battlefield) || view.battlefield.length === 0) {
    return;
  }

  let cache = getSharedEmitBattlefieldCache(game);
  if (!cache) {
    cache = buildSharedEmitBattlefieldCache(game, view.battlefield);
  }

  view.battlefield = cache.battlefield;
  if (cache.tokenGroupingApplied) {
    view.tokenGroupingApplied = true;
    view.originalBattlefieldCount = cache.originalBattlefieldCount;
  }
}

export function normalizeViewForEmit(rawView: any, game: any) {
  try {
    const view = rawView || {};
    view.zones = view.zones || {};
    const players =
      Array.isArray(view.players)
        ? view.players
        : game &&
          game.state &&
          Array.isArray(game.state.players)
        ? game.state.players
        : [];
    for (const p of players) {
      const pid = p?.id ?? p?.playerId;
      if (!pid) continue;
      view.zones[pid] = view.zones[pid] ?? defaultPlayerZones();
    }

    // Mirror minimal shape back into authoritative game.state.zones to avoid other server modules observing undefined.
    try {
      if (game && game.state) {
        game.state.zones = game.state.zones || {};
        for (const pid of Object.keys(view.zones)) {
          if (!game.state.zones[pid]) game.state.zones[pid] = view.zones[pid];
          else {
            const src = view.zones[pid];
            const dst = game.state.zones[pid];
            dst.hand = Array.isArray(dst.hand)
              ? dst.hand
              : Array.isArray(src.hand)
              ? src.hand
              : [];
            dst.handCount =
              typeof dst.handCount === "number"
                ? dst.handCount
                : Array.isArray(dst.hand)
                ? dst.hand.length
                : 0;
            dst.library = Array.isArray(dst.library)
              ? dst.library
              : Array.isArray(src.library)
              ? src.library
              : [];
            dst.libraryCount =
              typeof dst.libraryCount === "number"
                ? dst.libraryCount
                : Array.isArray(dst.library)
                ? dst.library.length
                : 0;
            dst.graveyard = Array.isArray(dst.graveyard)
              ? dst.graveyard
              : Array.isArray(src.graveyard)
              ? src.graveyard
              : [];
            dst.graveyardCount =
              typeof dst.graveyardCount === "number"
                ? dst.graveyardCount
                : Array.isArray(dst.graveyard)
                ? dst.graveyard.length
                : 0;
          }
        }
      }
    } catch {
      // non-fatal
    }

    applySharedBattlefieldCacheToView(view, game);

    // Add playable cards highlighting for the current priority player
    // This helps players see which cards/permanents they can play/activate
    try {
      view.playableCards = [];
      view.graveyardAbilityHints = {};
      view.canAct = false;
      view.canRespond = false;

      if (game && game.state && view.viewer) {
        const priority = game.state.priority;
        const viewerId = view.viewer;

        // Only add playable cards for the current priority holder viewing their own game
        if (priority === viewerId) {
          const playableCardIds = getPlayableCardIds(game, viewerId);
          view.playableCards = playableCardIds || [];
          view.graveyardAbilityHints = {
            [viewerId]: getGraveyardAbilityHints(game, viewerId),
          };

          // Add canAct and canRespond flags to the view
          // These are calculated server-side to ensure consistency with game rules
          try {
            view.canAct = canAct(game as any, viewerId);
            view.canRespond = canRespond(game as any, viewerId);
          } catch (err) {
            debugWarn(1, "Failed to calculate canAct/canRespond:", err);
            // Fallback: use playableCards as indicator
            view.canAct = playableCardIds && playableCardIds.length > 0;
            view.canRespond = view.canAct; // Conservative fallback
          }
        }
      }
    } catch (e) {
      // non-fatal - don't break the whole view if playable calculation fails
      debugWarn(1, "Failed to calculate playable cards:", e);
    }

    try {
      if (game && game.state && view.viewer) {
        const viewerId = view.viewer;
        const zones = game.state.zones?.[viewerId];

        if (zones?.hand && Array.isArray(zones.hand)) {
          const costAdjustments: Record<string, CardCostAdjustment> = {};

          for (const card of zones.hand) {
            if (!card || typeof card === 'string' || !card.id) continue;

            const adjustmentInfo = getCostAdjustmentInfo(game.state, viewerId, card);
            if (adjustmentInfo) {
              costAdjustments[card.id] = {
                originalCost: adjustmentInfo.originalCost,
                adjustedCost: adjustmentInfo.adjustedCost,
                adjustment: adjustmentInfo.adjustment,
                genericAdjustment: adjustmentInfo.genericAdjustment,
                sources: adjustmentInfo.sources.map(s => s.name),
                isIncrease: adjustmentInfo.adjustment > 0,
              };
            }
          }

          if (Object.keys(costAdjustments).length > 0) {
            view.costAdjustments = costAdjustments;
          }
        }
      }
    } catch (e) {
      // non-fatal - don't break the whole view if cost adjustment calculation fails
      debugWarn(1, "Failed to calculate cost adjustments:", e);
    }

    return view;
  } catch (e) {
    debugWarn(1, "normalizeViewForEmit failed:", e);
    return rawView || {};
  }
}

/* --- Debug logging helper (env-gated) --- */
export function logStateDebug(prefix: string, gameId: string, view: any) {
  try {
    const enabled = process.env.DEBUG_STATE === "1";
    if (!enabled) return;

    const players = Array.isArray(view?.players) ? view.players : [];
    const playerIds = players
      .map((p: any) => p?.id ?? p?.playerId)
      .filter(Boolean);
    const playerLabels = players
      .map((p: any) => {
        const playerId = String(p?.id ?? p?.playerId ?? '').trim();
        if (!playerId) return '';
        const playerName = String(p?.name || '').trim();
        return playerName ? `${playerName}:${playerId}` : playerId;
      })
      .filter(Boolean);
    const zoneKeys = view?.zones ? Object.keys(view.zones) : [];

    // Pick the first player (if any) and derive a compact summary
    const firstPid = playerIds[0];
    const z = firstPid && view?.zones ? view.zones[firstPid] : null;
    const lib = z && Array.isArray(z.library) ? z.library : [];
    const firstLib = lib[0];
    const lastLib =
      lib.length > 1 ? lib[lib.length - 1] : lib.length === 1 ? lib[0] : null;

    debug(1,
      `[STATE_DEBUG] ${prefix} gameId=${gameId} players=[${playerLabels.join(
        ","
      )}] zones=[${zoneKeys.join(
        ","
      )}] handCount=${z?.handCount ?? 0} libraryCount=${z?.libraryCount ?? 0}`
    );

    debugEnv('DEBUG_REPLAY_RESTORE', `[replay-restore] ${prefix} gameId=${gameId}`, {
      phase: String(view?.phase || ''),
      step: String(view?.step || ''),
      turn: Number(view?.turn ?? 0) || undefined,
      turnNumber: Number(view?.turnNumber ?? 0) || undefined,
      priority: String(view?.priority || ''),
      turnPlayer: String(view?.turnPlayer || ''),
      players: playerLabels,
      zoneKeys,
    });

    // Compact library sample instead of full JSON dump
    debug(2, `[STATE_DEBUG] ${prefix} librarySample gameId=${gameId}`, {
      firstLibraryCard: firstLib
        ? {
            id: firstLib.id,
            name: firstLib.name,
            type_line: firstLib.type_line,
          }
        : null,
      lastLibraryCard: lastLib
        ? {
            id: lastLib.id,
            name: lastLib.name,
            type_line: lastLib.type_line,
          }
        : null,
    });
  } catch (e) {
    // non-fatal
  }
}
