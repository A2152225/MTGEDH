// server/src/state/modules/turn-handlers/turnClearManaPool.ts
// Origin parent: server/src/state/modules/turn.ts
// Cluster moved: clearManaPool — Rule 106.4 empty-mana at step/phase
// boundaries, with Horizon Stone / Omnath / Kruphix retention.
// Public entry symbols: clearManaPool.
// Leaf must not import turn.ts or turn-handlers/index.ts.

import type { GameContext } from "../../context.js";
import { debug, debugWarn } from "../../../utils/debug.js";
import {
  TEMPORARY_RETAINED_MANA_COLORS,
  getTemporaryRetainedManaForPlayer,
  syncTemporaryRetainedManaToPool,
} from "./turnTemporaryRetainedMana.js";
import { readOracleManaRetentionEffects } from "./turnManaRetentionOracle.js";

/** Small helper to prepend ISO timestamp to debug logs */
function ts() {
  return new Date().toISOString();
}

/**
 * Clear the mana pool for all players.
 * Called when phases change, as mana empties from pools at the end of each step/phase.
 * 
 * Rule 106.4: Unless a player has an effect preventing mana from emptying (like
 * Horizon Stone, Omnath Locus of Mana, or Kruphix God of Horizons), all unspent
 * mana empties from the pool at the end of each step and phase.
 */
export function clearManaPool(ctx: GameContext) {
  try {
    if (!(ctx as any).state) return;

    const players = Array.isArray((ctx as any).state.players)
      ? (ctx as any).state.players.map((p: any) => p.id)
      : [];

    if (!players.length) return;

    (ctx as any).state.manaPool = (ctx as any).state.manaPool || {};

    // Detect mana retention effects inline (to avoid circular dependencies)
    const detectManaRetentionEffectsLocal = (gameState: any, playerId: string) => {
      const effects: { permanentId: string; cardName: string; type: string; colors?: string[]; color?: string }[] = [];
      const battlefield = gameState?.battlefield || [];

      for (const permanent of battlefield) {
        if (!permanent || permanent.controller !== playerId) continue;

        const cardName = (permanent.card?.name || "").toLowerCase();
        const oracleText = (permanent.card?.oracle_text || "").toLowerCase();

        // Omnath, Locus of Mana - Green mana doesn't empty
        if (cardName.includes("omnath, locus of mana") || 
            (oracleText.includes("green mana") && oracleText.includes("doesn't empty"))) {
          effects.push({
            permanentId: permanent.id,
            cardName: permanent.card?.name || "Omnath",
            type: 'doesnt_empty',
            colors: ['green'],
          });
        }
        
        // Leyline Tyrant - Red mana doesn't empty
        // Oracle text: "You don't lose unspent red mana as steps and phases end."
        // Handle different apostrophe styles (straight ' vs curly ')
        if (cardName.includes("leyline tyrant") ||
            (oracleText.includes("red mana") && 
             (oracleText.includes("don't lose") || oracleText.includes("don’t lose") || 
              oracleText.includes("doesn't empty") || oracleText.includes("doesn’t empty")))) {
          effects.push({
            permanentId: permanent.id,
            cardName: permanent.card?.name || "Leyline Tyrant",
            type: 'doesnt_empty',
            colors: ['red'],
          });
        }
        
        // Ozai, the Phoenix King - Unspent mana becomes red instead
        // Pattern: "If you would lose unspent mana, that mana becomes red instead"
        // Handle different apostrophe styles and slight text variations
        if (cardName.includes("ozai") || 
            (oracleText.includes("lose unspent mana") && oracleText.includes("becomes red instead")) ||
            (oracleText.includes("would lose") && oracleText.includes("mana") && oracleText.includes("becomes red"))) {
          effects.push({
            permanentId: permanent.id,
            cardName: permanent.card?.name || "Ozai, the Phoenix King",
            type: 'becomes_color',
            color: 'red',
          });
        }
        
        // Kruphix, God of Horizons / Horizon Stone - Unspent mana becomes colorless
        if (cardName.includes("kruphix") || cardName.includes("horizon stone") ||
            oracleText.includes("mana becomes colorless instead")) {
          effects.push({
            permanentId: permanent.id,
            cardName: permanent.card?.name || "Horizon Stone",
            type: 'becomes_colorless',
          });
        }
        
        // Upwelling / Eladamri's Vineyard style - All mana doesn't empty
        if (cardName.includes("upwelling") ||
            (oracleText.includes("mana pools") && oracleText.includes("don't empty"))) {
          effects.push({
            permanentId: permanent.id,
            cardName: permanent.card?.name || "Upwelling",
            type: 'all_doesnt_empty',
          });
        }
      }

      for (const effect of readOracleManaRetentionEffects(battlefield, playerId)) {
        if (!effects.some((existing) => existing.permanentId === effect.permanentId)) effects.push(effect);
      }

      return effects;
    };

    for (const pid of players) {
      const currentPool = (ctx as any).state.manaPool[pid] || {};
      const temporaryRetained = getTemporaryRetainedManaForPlayer((ctx as any).state, pid);
      const hasTemporaryRetention = TEMPORARY_RETAINED_MANA_COLORS.some((color) => (temporaryRetained[color] || 0) > 0);

      // Detect mana retention effects from battlefield permanents
      const retentionEffects = detectManaRetentionEffectsLocal((ctx as any).state, pid);

      // Collect colors that should be retained
      const colorsToRetain = new Set<string>();
      let convertToColorless = false;
      let convertToColor: string | null = null;
      let retainAllMana = false;

      for (const effect of retentionEffects) {
        if (effect.type === 'all_doesnt_empty') {
          retainAllMana = true;
        } else if (effect.type === 'becomes_colorless') {
          convertToColorless = true;
        } else if (effect.type === 'doesnt_empty' && effect.colors) {
          for (const color of effect.colors) {
            colorsToRetain.add(color);
          }
        } else if (effect.type === 'becomes_color' && effect.color) {
          // Track conversion to a specific color (Ozai -> red)
          convertToColor = effect.color;
        }
      }

      // Also check legacy doesNotEmpty flag on the pool itself
      if (currentPool.doesNotEmpty) {
        const targetColor = currentPool.convertsTo || (currentPool.convertsToColorless ? 'colorless' : null);
        if (targetColor) {
          if (targetColor === 'colorless') {
            convertToColorless = true;
          } else {
            convertToColor = targetColor;
          }
        } else {
          retainAllMana = true;
        }
      }

      if (retainAllMana) {
        // Mana doesn't empty at all (e.g., Upwelling, or legacy doesNotEmpty without convertsTo)
        syncTemporaryRetainedManaToPool((ctx as any).state, pid);
        debug(2, `${ts()} [clearManaPool] Player ${pid}: Mana pool preserved (all mana doesn't empty)`);
        continue;
      }

      const newPool: any = {
        white: 0,
        blue: 0,
        black: 0,
        red: 0,
        green: 0,
        colorless: 0,
      };
      let totalConvertedToColor = 0;
      let totalConvertedToColorless = 0;

      for (const color of TEMPORARY_RETAINED_MANA_COLORS) {
        const currentAmount = Math.max(0, Number((currentPool as any)[color] || 0));
        if (currentAmount <= 0) continue;

        const temporarilyRetainedAmount = Math.min(currentAmount, Math.max(0, Number(temporaryRetained[color] || 0)));
        const remainingAmount = Math.max(0, currentAmount - temporarilyRetainedAmount);

        newPool[color] += temporarilyRetainedAmount;

        if (convertToColor && convertToColor !== 'colorless') {
          if (color === convertToColor || colorsToRetain.has(color)) newPool[color] += remainingAmount;
          else totalConvertedToColor += remainingAmount;
        } else if (convertToColorless) {
          if (color === 'colorless' || colorsToRetain.has(color)) newPool[color] += remainingAmount;
          else totalConvertedToColorless += remainingAmount;
        } else if (colorsToRetain.has(color)) {
          newPool[color] += remainingAmount;
        }
      }

      if (convertToColor && convertToColor !== 'colorless') {
        newPool[convertToColor] = (newPool[convertToColor] || 0) + totalConvertedToColor;
      }
      if (convertToColorless) {
        newPool.colorless = (newPool.colorless || 0) + totalConvertedToColorless;
      }

      if (currentPool.restricted) {
        if (convertToColor && convertToColor !== 'colorless') {
          newPool.restricted = currentPool.restricted.map((entry: any) => ({
            ...entry,
            type: colorsToRetain.has(entry.type) ? entry.type : convertToColor,
          }));
        } else if (convertToColorless) {
          newPool.restricted = currentPool.restricted.map((entry: any) => ({
            ...entry,
            type: colorsToRetain.has(entry.type) ? entry.type : 'colorless',
          }));
        } else if (colorsToRetain.size > 0) {
          newPool.restricted = currentPool.restricted.filter((entry: any) => colorsToRetain.has(entry.type));
          if (newPool.restricted.length === 0) delete newPool.restricted;
        }
      }

      (ctx as any).state.manaPool[pid] = newPool;
      syncTemporaryRetainedManaToPool((ctx as any).state, pid);

      if (convertToColor && convertToColor !== 'colorless') {
        debug(1, `${ts()} [clearManaPool] Player ${pid}: Converted ${totalConvertedToColor} mana to ${convertToColor}, retained colors: ${Array.from(colorsToRetain).join(', ') || 'none'}, temporary retention: ${hasTemporaryRetention}`);
      } else if (convertToColorless) {
        debug(1, `${ts()} [clearManaPool] Player ${pid}: Converted ${totalConvertedToColorless} mana to colorless, retained colors: ${Array.from(colorsToRetain).join(', ') || 'none'}, temporary retention: ${hasTemporaryRetention}`);
      } else if (colorsToRetain.size > 0 || hasTemporaryRetention) {
        const retainedInfo = TEMPORARY_RETAINED_MANA_COLORS
          .map((color) => `${color}: ${newPool[color] || 0}`)
          .filter((entry) => !entry.endsWith(': 0'))
          .join(', ');
        debug(2, `${ts()} [clearManaPool] Player ${pid}: Retained mana ${retainedInfo || 'none'}`);
      }
    }

    debug(2, `${ts()} [clearManaPool] Processed mana pools for all players`);
  } catch (err) {
    debugWarn(1, `${ts()} clearManaPool failed:`, err);
  }
}
