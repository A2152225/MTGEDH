// server/src/state/modules/apply-event-handlers/applyEventGraveyardCastCostReplay.ts
// B42: replay of non-mana graveyard-ability costs recorded on activateGraveyardAbility.
//  - nonManaCost (B41 unearth/embalm/eternalize text such as "Pay eight {E}" / "Pay 2 life"): energy and life
//    were paid live by payGraveyardKeywordImmediateCosts; the discard part replays via its own DISCARD_SELECTION event.
//  - beamedUpPermanentIdsForCost (beam me up): return the recorded creatures to their owners' hands.
// Public entry symbols: applyRecordedGraveyardKeywordNonManaCost, applyRecordedBeamUpReturnCost.

import type { GameContext } from "../../context";
import { parseEnergyCost, payEnergyCost, payEquipLifeCost } from "../equipNonManaCosts.js";
import { movePermanentToHand } from "../zones-handlers/zonesMovePermanentToHand.js";

const NUM: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };

export function applyRecordedGraveyardKeywordNonManaCost(ctx: GameContext, playerId: string, nonManaCost: unknown): void {
  const text = String(nonManaCost || '').trim();
  if (!text || !playerId) return;
  for (const raw of text.split(/,\s*/)) {
    const part = raw.trim();
    if (!part || (/^(\{[^}]+\})+$/.test(part) && !/\{E\}/i.test(part))) continue;
    const energy = parseEnergyCost(part);
    if (energy !== null) { payEnergyCost(ctx.state as any, playerId, `Pay ${energy} {E}`); continue; }
    const life = part.match(/^pay\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+life$/i);
    if (life) {
      const n = /^\d+$/.test(life[1]) ? Number(life[1]) : (NUM[life[1].toLowerCase()] || 0);
      if (n > 0) payEquipLifeCost(ctx.state as any, playerId, `Pay ${n} life`);
    }
  }
}

export function applyRecordedBeamUpReturnCost(ctx: GameContext, ids: unknown): void {
  if (!Array.isArray(ids)) return;
  for (const id of ids) {
    const permanentId = String(id || '').trim();
    if (!permanentId) continue;
    if (!(ctx.state as any)?.battlefield?.some((p: any) => p && String(p.id) === permanentId)) continue;
    movePermanentToHand(ctx, permanentId);
  }
}
