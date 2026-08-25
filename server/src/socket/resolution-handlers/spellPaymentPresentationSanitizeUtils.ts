/**
 * socket/resolution-handlers/spellPaymentPresentationSanitizeUtils.ts
 *
 * Origin parent: server/src/socket/resolution.ts (client step presentation).
 * Cluster moved: mergeExtraAlternateCosts and hydrateSpellPaymentPresentationFieldsForClient.
 * Public entry symbols: hydrateSpellPaymentPresentationFieldsForClient, mergeExtraAlternateCosts.
 *
 * Must not import resolution.ts.
 */

import { buildCommanderFreeCastPaymentExtras } from "../../state/modules/alternate-costs.js";
import {
  buildPendingCastPaymentManaCost,
  buildSpellPaymentPresentationFields,
} from "./resolutionPendingCastPaymentPrompt.js";
import { ensureGame } from "../util.js";

export function mergeExtraAlternateCosts(
  existing: any[] | undefined,
  incoming: any[] | undefined,
): any[] | undefined {
  if (!Array.isArray(incoming) || incoming.length === 0) return existing;
  if (!Array.isArray(existing) || existing.length === 0) return incoming.slice();
  const merged = existing.map((c) => ({ ...c }));
  const byId = new Map(merged.map((c, idx) => [String(c?.id || ''), idx]));
  for (const extra of incoming) {
    const id = String(extra?.id || '');
    if (!id) continue;
    if (byId.has(id)) {
      const idx = byId.get(id)!;
      merged[idx] = { ...merged[idx], ...extra };
    } else {
      byId.set(id, merged.length);
      merged.push(extra);
    }
  }
  return merged;
}

/**
 * Ensure spell-payment prompts keep alternate-cost presentation fields when
 * sanitizing for the client. Hydrates from pendingSpellCasts when the step
 * was queued without oracleText / extras (e.g. after target selection gaps).
 */
export function hydrateSpellPaymentPresentationFieldsForClient(
  gameId: string,
  step: any,
  fields: Record<string, any>,
  resolvedOracleText?: string,
): void {
  if (step?.spellPaymentRequired !== true) return;

  if (!fields.oracleText && resolvedOracleText) {
    fields.oracleText = resolvedOracleText;
  }

  try {
    const game = ensureGame(gameId);
    if (!game?.state) return;
    const effectId = String(fields.effectId || step.effectId || '').trim();
    const pending = effectId
      ? (game.state as any)?.pendingSpellCasts?.[effectId]
      : null;

    if (pending) {
      const presentation = buildSpellPaymentPresentationFields(pending, {
        game,
        playerId: String(step.playerId || pending.playerId || ''),
      });
      if (!fields.oracleText && presentation.oracleText) {
        fields.oracleText = presentation.oracleText;
      }
      fields.extraAlternateCosts = mergeExtraAlternateCosts(
        fields.extraAlternateCosts,
        presentation.extraAlternateCosts as any[] | undefined,
      );
      if (!fields.preferredAlternateCostId && presentation.preferredAlternateCostId) {
        fields.preferredAlternateCostId = presentation.preferredAlternateCostId;
      }
      if (!fields.fromZone && presentation.fromZone) {
        fields.fromZone = presentation.fromZone;
      }
      if (!fields.typeLine && !fields.type_line && (presentation.typeLine || presentation.type_line)) {
        const hydratedTypeLine = String(presentation.typeLine || presentation.type_line || '').trim();
        if (hydratedTypeLine) {
          fields.typeLine = hydratedTypeLine;
          fields.type_line = hydratedTypeLine;
        }
      }
      if (fields.xValue == null && pending.xValue != null) {
        fields.xValue = pending.xValue;
      }
      if (!fields.forcedAlternateCostId && pending.forcedAlternateCostId) {
        fields.forcedAlternateCostId = pending.forcedAlternateCostId;
      }
      if (!fields.convokeOptions && pending.convokeOptions) {
        fields.convokeOptions = pending.convokeOptions;
      }
      if (!fields.sneakOptions && pending.sneakOptions) {
        fields.sneakOptions = pending.sneakOptions;
      }
      if (!fields.harmonizeOptions && pending.harmonizeOptions) {
        fields.harmonizeOptions = pending.harmonizeOptions;
      }
    }

    // Commander-free can also apply when there is no pendingCast (graveyard queue path).
    if (!fields.preferredAlternateCostId || !fields.extraAlternateCosts) {
      const oracleForCommander = String(
        fields.oracleText
        || pending?.oracleText
        || pending?.card?.oracle_text
        || resolvedOracleText
        || '',
      ).trim();
      if (oracleForCommander) {
        const commanderFree = buildCommanderFreeCastPaymentExtras(
          {
            state: game.state,
            commandZone: (game as any).commandZone ?? game.state?.commandZone ?? {},
          } as any,
          String(step.playerId || '') as any,
          { oracle_text: oracleForCommander, name: fields.cardName || step.cardName },
        );
        if (commanderFree) {
          if (!fields.preferredAlternateCostId) {
            fields.preferredAlternateCostId = commanderFree.preferredAlternateCostId;
          }
          fields.extraAlternateCosts = mergeExtraAlternateCosts(
            fields.extraAlternateCosts,
            commanderFree.extraAlternateCosts,
          );
        }
      }
    }
  } catch {
    // best-effort hydration
  }
}
