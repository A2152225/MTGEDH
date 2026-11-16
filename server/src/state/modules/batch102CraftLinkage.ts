// server/src/state/modules/batch102CraftLinkage.ts
// Stamp craft-exile linkage so "exiled cards used to craft this Equipment"
// can be found via craftedFromCards / exiledWithSourceId.
// Public: linkCraftedMaterials, applyPendingCraftLinkage, gatherCraftedMaterialCards.

import { stampLiveExileCardWithSource } from './exileWithSourceStamp.js';

function typeLineOf(entry: any): string {
  return String(entry?.card?.type_line || entry?.type_line || entry?.typeLine || '');
}

export function linkCraftedMaterials(state: any, craftedPermanent: any, exiledCards: any[]): number {
  if (!craftedPermanent || !Array.isArray(exiledCards) || !exiledCards.length) return 0;
  const sourceId = String(craftedPermanent.id || craftedPermanent.card?.id || '').trim();
  const linked: any[] = [];
  for (const card of exiledCards) {
    if (!card) continue;
    stampLiveExileCardWithSource(card, sourceId || undefined);
    card.craftedIntoId = sourceId;
    card.usedToCraftId = sourceId;
    linked.push(card);
  }
  craftedPermanent.craftedFromCards = linked;
  craftedPermanent.craftExiledCards = linked;
  if (sourceId && state) {
    const zones = state.zones = state.zones || {};
    for (const pid of Object.keys(zones)) {
      const exile: any[] = Array.isArray(zones[pid]?.exile) ? zones[pid].exile : [];
      for (let i = 0; i < exile.length; i++) {
        const card = exile[i];
        if (linked.some((c) => String(c?.id || '') === String(card?.id || ''))) {
          stampLiveExileCardWithSource(card, sourceId);
          card.craftedIntoId = sourceId;
          card.usedToCraftId = sourceId;
        }
      }
    }
  }
  return linked.length;
}

export function applyPendingCraftLinkage(permanent: any, state?: any): number {
  if (!permanent) return 0;
  const pending = permanent.pendingCraftExiledCards || permanent.pendingCraftMaterials;
  if (!Array.isArray(pending) || !pending.length) return 0;
  const n = linkCraftedMaterials(state, permanent, pending);
  delete permanent.pendingCraftExiledCards;
  delete permanent.pendingCraftMaterials;
  return n;
}

export function gatherCraftedMaterialCards(state: any, craftedPermanent: any): any[] {
  const stored = craftedPermanent?.craftedFromCards || craftedPermanent?.craftExiledCards || craftedPermanent?.exiledCardsUsedToCraft;
  if (Array.isArray(stored) && stored.length) return stored;
  const eqId = String(craftedPermanent?.id || craftedPermanent?.card?.id || '');
  const out: any[] = [];
  const zones = state?.zones || {};
  for (const pid of Object.keys(zones)) {
    const exile: any[] = Array.isArray(zones[pid]?.exile) ? zones[pid].exile : [];
    for (const card of exile) {
      const linked = String(card?.exiledWithSourceId || card?.exiledWith || card?.craftedIntoId || card?.usedToCraftId || '');
      if (linked && linked === eqId) out.push(card);
    }
  }
  return out;
}

export function isCreatureCard(entry: any): boolean {
  return /\bcreature\b/i.test(typeLineOf(entry));
}
