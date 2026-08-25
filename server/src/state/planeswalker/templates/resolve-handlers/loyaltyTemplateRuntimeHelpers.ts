// server/src/state/planeswalker/templates/resolve-handlers/loyaltyTemplateRuntimeHelpers.ts
// Origin parent: server/src/state/planeswalker/templates/resolve.ts
// Cluster moved: remaining private helpers used by tryResolvePlaneswalkerLoyaltyTemplate cases
//   (discard/upsert, token parse, mana pool, mill/destroy/exile, damage, constraints, tokens).
// Public entry symbols: discardHandCardsToGraveyard, upsertPlaneswalkerPlayableFromExileGrant,
//   parseTokenDescriptorToTypeLineAndColors, extractQuotedAbilities, getPlayerById, getOpponents,
//   getOrInitManaPool, addRestrictedMana, addUnrestrictedManaSymbols, isCreatureOfSubtype,
//   millCards, destroyPermanents, exilePermanents, applyDamageToPlayer,
//   recordCreatureDealtDamageToPlayerThisTurn, findCreatureOnBattlefieldById, applyDamageToPermanent,
//   recordCreatureDamagedByCreatureThisTurn, permanentHasKeyword, getControlConstraint,
//   getManaValueConstraint, satisfiesManaValueConstraint, normalizeCardNameForCompare,
//   toAvailableCard, getSourcePlaneswalkerColors, predefinedArtifactTokens.

import type { GameContext } from "../../../context.js";
import type { PlayerID } from "../../../../../../shared/src/types.js";
import { destroyPermanent, movePermanentToExile } from "../../../modules/counters_tokens.js";
import { buildDurablePlayableFromExilePermission, upsertDurablePermission } from "../../../modules/durable-permissions.js";
import { applyDamageToPermanentWithCounterEffects } from "../../../modules/counter-common-effects.js";
import { applyCreatureDamageFromSource } from "../../../modules/combat-damage-processing.js";
import { pushCardToPlayerGraveyardWithReplacements } from "../../../modules/graveyardEntryUtils.js";
import { getBattlefield, modifyLifeLikeStack } from "../utils.js";

export function discardHandCardsToGraveyard(
  ctx: GameContext,
  playerId: string,
  hand: any[],
  graveyard: any[],
): void {
  for (const card of hand) {
    if (card) {
      pushCardToPlayerGraveyardWithReplacements(ctx, String(playerId), card, graveyard);
    }
  }
}


export function upsertPlaneswalkerPlayableFromExileGrant(
  state: any,
  controller: PlayerID,
  cardIds: readonly string[],
  sourceName: string,
  sourceText: string,
  action: 'play' | 'cast',
  expiresAtTurn: number,
): void {
  const affectedCardIds = cardIds.map((cardId) => String(cardId || '').trim()).filter(Boolean);
  if (affectedCardIds.length === 0) return;

  upsertDurablePermission(state, buildDurablePlayableFromExilePermission({
    playerId: controller,
    cardIds: affectedCardIds,
    action,
    duration: 'this_turn',
    turnApplied: Number(state?.turnNumber ?? state?.turn ?? 0) || 0,
    expiresAtTurn,
    sourceName,
    sourceText,
  }));
}

export function parseTokenDescriptorToTypeLineAndColors(rawDescriptor: string): {
  typeLine: string;
  colors: string[];
  isArtifact: boolean;
} {
  const d = String(rawDescriptor || "");
  const lower = d.toLowerCase();

  const colors: string[] = [];
  if (lower.includes("white")) colors.push("W");
  if (lower.includes("blue")) colors.push("U");
  if (lower.includes("black")) colors.push("B");
  if (lower.includes("red")) colors.push("R");
  if (lower.includes("green")) colors.push("G");
  // "colorless" => no color symbols

  const parts: string[] = ["Token"];
  if (lower.includes("legendary")) parts.push("Legendary");

  const typeOrder: Array<{ key: string; label: string }> = [
    { key: "artifact", label: "Artifact" },
    { key: "enchantment", label: "Enchantment" },
    { key: "creature", label: "Creature" },
    { key: "planeswalker", label: "Planeswalker" },
    { key: "land", label: "Land" },
  ];

  for (const t of typeOrder) {
    if (lower.includes(t.key)) parts.push(t.label);
  }

  const isArtifact = lower.includes("artifact");

  let typeLine = parts.join(" ");

  // Preserve explicit subtypes if present (em dash)
  const dashIdx = d.indexOf("—");
  if (dashIdx >= 0) {
    const sub = d.slice(dashIdx + 1).trim();
    if (sub) typeLine = `${typeLine} — ${sub}`;
  }

  return { typeLine, colors, isArtifact };
}

export function extractQuotedAbilities(text: string): string[] {
  const abilities: string[] = [];
  const rx = /"([^"]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = rx.exec(text))) {
    const a = String(m[1] || "").trim();
    if (a) abilities.push(a);
  }
  return abilities;
}

export function getPlayerById(ctx: GameContext, playerId: PlayerID): any {
  const players = ((ctx as any).state?.players as any[]) || [];
  return players.find((p: any) => p?.id === playerId) || null;
}

export function getOpponents(ctx: GameContext, controller: PlayerID): PlayerID[] {
  const players = ((ctx as any).state?.players as any[]) || [];
  return players.map((p: any) => p?.id).filter((id: any) => id && id !== controller);
}

export function getOrInitManaPool(state: any, playerId: PlayerID): any {
  state.manaPool = state.manaPool || {};
  const pool = (state.manaPool[playerId] = state.manaPool[playerId] || {
    white: 0,
    blue: 0,
    black: 0,
    red: 0,
    green: 0,
    colorless: 0,
    generic: 0,
    restricted: [],
  });
  if (!Array.isArray((pool as any).restricted)) (pool as any).restricted = [];
  return pool;
}

export function addRestrictedMana(
  state: any,
  playerId: PlayerID,
  color: "white" | "blue" | "black" | "red" | "green" | "colorless",
  amount: number,
  restriction: any,
  sourceId?: string,
  sourceName?: string
) {
  if (amount <= 0) return;
  const pool = getOrInitManaPool(state, playerId);
  const restricted: any[] = (pool as any).restricted;
  const existing = restricted.find(
    (e) => e?.type === color && e?.restriction === restriction && e?.sourceId === sourceId
  );
  if (existing) {
    existing.amount = (existing.amount || 0) + amount;
  } else {
    restricted.push({ type: color, amount, restriction, sourceId, sourceName });
  }
}

export function addUnrestrictedManaSymbols(state: any, playerId: PlayerID, symbols: string) {
  const pool = getOrInitManaPool(state, playerId);
  const parts = String(symbols || "")
    .trim()
    .match(/\{[WUBRGC]\}/g);
  if (!parts) return;

  for (const sym of parts) {
    switch (sym) {
      case "{W}":
        pool.white++;
        break;
      case "{U}":
        pool.blue++;
        break;
      case "{B}":
        pool.black++;
        break;
      case "{R}":
        pool.red++;
        break;
      case "{G}":
        pool.green++;
        break;
      case "{C}":
        pool.colorless++;
        break;
    }
  }
}

export function isCreatureOfSubtype(perm: any, subtypeLower: string): boolean {
  const typeLine = String(perm?.card?.type_line || "").toLowerCase();
  if (!typeLine.includes("creature")) return false;
  // Very simple subtype check: match substring after em dash.
  return typeLine.includes(subtypeLower);
}

export function millCards(ctx: GameContext, playerId: PlayerID, count: number): any[] {
  const state = (ctx as any).state;
  const zones = state?.zones || {};
  const lib: any[] = zones[playerId]?.library || [];
  const gy: any[] = zones[playerId]?.graveyard || [];
  const actual = Math.max(0, Math.min(count | 0, lib.length));
  const milled = lib.splice(0, actual);
  gy.unshift(...milled);
  zones[playerId].libraryCount = lib.length;
  zones[playerId].graveyardCount = gy.length;
  return milled;
}

export function destroyPermanents(ctx: GameContext, permanentIds: string[]) {
  for (const id of permanentIds) {
    destroyPermanent(ctx, id, true);
  }
}

export function exilePermanents(ctx: GameContext, permanentIds: string[]) {
  for (const id of permanentIds) {
    movePermanentToExile(ctx, id);
  }
}

export function applyDamageToPlayer(ctx: GameContext, playerId: PlayerID, amount: number) {
  const dmg = Math.max(0, amount | 0);
  if (dmg <= 0) return;
  // We track damage/life-loss explicitly below; avoid double-counting via modifyLifeLikeStack.
  modifyLifeLikeStack(ctx, playerId, -dmg, { trackLifeChangeThisTurn: false });

  // Best-effort per-turn tracking to help intervening-if evaluation.
  try {
    const stateAny = (ctx as any).state as any;
    stateAny.damageTakenThisTurnByPlayer = stateAny.damageTakenThisTurnByPlayer || {};
    stateAny.damageTakenThisTurnByPlayer[String(playerId)] =
      (stateAny.damageTakenThisTurnByPlayer[String(playerId)] || 0) + dmg;
  } catch {}

  try {
    const stateAny = (ctx as any).state as any;
    stateAny.lifeLostThisTurn = stateAny.lifeLostThisTurn || {};
    stateAny.lifeLostThisTurn[String(playerId)] = (stateAny.lifeLostThisTurn[String(playerId)] || 0) + dmg;
  } catch {}
}

export function recordCreatureDealtDamageToPlayerThisTurn(
  ctx: GameContext,
  sourceCreature: any,
  targetPlayerId: PlayerID,
  amount: number
) {
  const sourceId = String(sourceCreature?.id || '');
  const dmg = Math.max(0, amount | 0);
  if (!sourceId || dmg <= 0) return;
  try {
    const stateAny = (ctx as any).state as any;
    const tl = String(sourceCreature?.card?.type_line || '').toLowerCase();
    if (!tl.includes('creature')) return;

    const creatureName = String(sourceCreature?.card?.name || 'Unknown Creature');
    stateAny.creaturesThatDealtDamageToPlayer = stateAny.creaturesThatDealtDamageToPlayer || {};
    const perPlayer = (stateAny.creaturesThatDealtDamageToPlayer[String(targetPlayerId)] =
      stateAny.creaturesThatDealtDamageToPlayer[String(targetPlayerId)] || {});
    perPlayer[sourceId] = {
      creatureName,
      totalDamage: (perPlayer[sourceId]?.totalDamage || 0) + dmg,
      lastDamageTime: Date.now(),
    };
  } catch {
    // best-effort only
  }
}

export function findCreatureOnBattlefieldById(ctx: GameContext, id: string): any | null {
  const pid = String(id || '');
  if (!pid) return null;
  const battlefield = getBattlefield(ctx);
  const perm = battlefield.find((p: any) => String(p?.id) === pid);
  if (!perm) return null;
  const tl = String(perm?.card?.type_line || '').toLowerCase();
  if (!tl.includes('creature')) return null;
  return perm;
}

export function applyDamageToPermanent(
  ctx: GameContext,
  permanentId: string,
  amount: number,
  options?: { sourcePermanentId?: string },
) {
  const battlefield = getBattlefield(ctx);
  const perm = battlefield.find((p: any) => p?.id === permanentId);
  if (!perm) return;

  const dmg = Math.max(0, amount | 0);
  const sourcePermanentId = String(options?.sourcePermanentId || '').trim();
  const sourcePerm = sourcePermanentId
    ? battlefield.find((p: any) => String(p?.id || '') === sourcePermanentId)
    : null;
  // Track excess damage (best-effort): damage beyond remaining toughness in this event.
  try {
    const stateAny = (ctx as any).state as any;
    const tl = String(perm?.card?.type_line || '').toLowerCase();
    const isCreature = tl.includes('creature');
    if (isCreature) {
      const toughness = parseInt(String((perm as any).baseToughness ?? perm?.card?.toughness ?? '0'), 10) || 0;
      const prev = (perm as any).damageMarked || 0;
      const remaining = Math.max(0, toughness - prev);
      if (remaining > 0 && dmg > remaining) {
        stateAny.excessDamageThisTurnByCreatureId = stateAny.excessDamageThisTurnByCreatureId || {};
        stateAny.excessDamageThisTurnByCreatureId[String(permanentId)] = true;

        // Legacy alias used by some intervening-if templates.
        stateAny.excessDamageThisTurnByPermanentId = stateAny.excessDamageThisTurnByPermanentId || {};
        stateAny.excessDamageThisTurnByPermanentId[String(permanentId)] = true;
        (perm as any).wasDealtExcessDamageThisTurn = true;
      }
    }
  } catch {}
  const damageResult = sourcePerm
    ? applyCreatureDamageFromSource(ctx, sourcePerm, perm, dmg, 'damageMarked')
    : applyDamageToPermanentWithCounterEffects(perm, dmg, 'damageMarked');
  if (damageResult.prevented) return;
  (perm as any).damageThisTurn = ((perm as any).damageThisTurn || 0) + dmg;
  (perm as any).tookDamageThisTurn = true;
}

export function recordCreatureDamagedByCreatureThisTurn(
  ctx: GameContext,
  sourceCreatureId: string,
  targetCreatureId: string,
  amount?: number
) {
  const dmg = Math.max(0, Number(amount ?? 1));
  if (!sourceCreatureId || !targetCreatureId || dmg <= 0) return;
  try {
    const stateAny = (ctx as any).state as any;
    stateAny.creaturesDamagedByThisCreatureThisTurn = stateAny.creaturesDamagedByThisCreatureThisTurn || {};
    stateAny.creaturesDamagedByThisCreatureThisTurn[String(sourceCreatureId)] =
      stateAny.creaturesDamagedByThisCreatureThisTurn[String(sourceCreatureId)] || {};
    stateAny.creaturesDamagedByThisCreatureThisTurn[String(sourceCreatureId)][String(targetCreatureId)] = true;
  } catch {
    // best-effort only
  }
}

export function permanentHasKeyword(perm: any, keywordLower: string): boolean {
  const kw = String(keywordLower || '').toLowerCase().trim();
  if (!kw) return false;

  const cardKeywords: any[] = Array.isArray(perm?.card?.keywords) ? perm.card.keywords : [];
  if (cardKeywords.some((k: any) => String(k || '').toLowerCase().trim() === kw)) return true;

  const granted: any[] = Array.isArray(perm?.grantedAbilities) ? perm.grantedAbilities : [];
  if (granted.some((a: any) => String(a || '').toLowerCase().includes(kw))) return true;

  const temporary: any[] = Array.isArray(perm?.temporaryAbilities) ? perm.temporaryAbilities : [];
  if (temporary.some((t: any) => String(t?.ability || '').toLowerCase().includes(kw))) return true;

  // Best-effort fallback: oracle text contains the keyword as a word.
  const oracle = String(perm?.card?.oracle_text || '').toLowerCase();
  if (oracle && new RegExp(`\\b${kw.replace(/[-/\\^$*+?.()|[\\]{}]/g, '\\$&')}\\b`, 'i').test(oracle)) return true;

  return false;
}

export function getControlConstraint(effectTextLower: string): 'you' | 'not_you' | null {
  if (effectTextLower.includes('you control')) return 'you';
  if (effectTextLower.includes("you don't control") || effectTextLower.includes('an opponent controls') || effectTextLower.includes('opponent controls')) {
    return 'not_you';
  }
  return null;
}

export function getManaValueConstraint(effectTextLower: string): { op: '<=' | '>='; value: number } | null {
  const m = effectTextLower.match(/mana value (\d+) or (less|greater)/i);
  if (!m) return null;
  const value = parseInt(m[1], 10);
  if (!Number.isFinite(value)) return null;
  const op = m[2].toLowerCase() === 'less' ? '<=' : '>=';
  return { op, value };
}

export function satisfiesManaValueConstraint(cardOrPerm: any, mv: { op: '<=' | '>='; value: number } | null): boolean {
  if (!mv) return true;
  const raw = (cardOrPerm as any)?.card?.cmc ?? (cardOrPerm as any)?.cmc;
  const cmc = typeof raw === 'number' ? raw : Number(raw ?? NaN);
  if (!Number.isFinite(cmc)) return false;
  return mv.op === '<=' ? cmc <= mv.value : cmc >= mv.value;
}

export function normalizeCardNameForCompare(name: string): string {
  return String(name || '')
    .toLowerCase()
    .replace(/[’']/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

export function toAvailableCard(card: any) {
  return {
    id: card.id,
    name: card.name,
    type_line: card.type_line,
    oracle_text: card.oracle_text,
    image_uris: card.image_uris,
    mana_cost: card.mana_cost,
    cmc: card.cmc,
    colors: card.colors,
    power: (card as any).power,
    toughness: (card as any).toughness,
    loyalty: (card as any).loyalty,
  };
}

/**
 * Best-effort lookup of the planeswalker's color set (Scryfall-style `colors`/`color_identity`).
 * Used for templates like "shares a color with this planeswalker".
 */
export function getSourcePlaneswalkerColors(ctx: GameContext, controller: PlayerID, sourceName: string, triggerItem: any): string[] {
  const battlefield = getBattlefield(ctx);
  const sourceId = triggerItem?.sourceId || triggerItem?.sourcePermanentId || triggerItem?.planeswalker?.id || triggerItem?.source;

  const sourcePerm =
    (sourceId ? battlefield.find((p: any) => p?.id === sourceId) : null) ||
    battlefield.find((p: any) =>
      p?.controller === controller &&
      String(p?.card?.name || '').toLowerCase() === String(sourceName || '').toLowerCase() &&
      String(p?.card?.type_line || '').toLowerCase().includes('planeswalker')
    );

  const rawColors: unknown = sourcePerm?.card?.colors ?? sourcePerm?.card?.color_identity;
  const colors = Array.isArray(rawColors) ? rawColors.map(c => String(c || '').toUpperCase()).filter(Boolean) : [];
  return Array.from(new Set(colors));
}

export const predefinedArtifactTokens: Record<
  string,
  { name: string; typeLine: string; abilities: string[]; colors: string[] }
> = {
  food: {
    name: "Food",
    typeLine: "Token Artifact — Food",
    abilities: ["{2}, {T}, Sacrifice this artifact: You gain 3 life."],
    colors: [],
  },
  treasure: {
    name: "Treasure",
    typeLine: "Token Artifact — Treasure",
    abilities: ["{T}, Sacrifice this artifact: Add one mana of any color."],
    colors: [],
  },
  clue: {
    name: "Clue",
    typeLine: "Token Artifact — Clue",
    abilities: ["{2}, Sacrifice this artifact: Draw a card."],
    colors: [],
  },
  map: {
    name: "Map",
    typeLine: "Token Artifact — Map",
    abilities: ["{1}, {T}, Sacrifice this artifact: Target creature you control explores. Activate only as a sorcery."],
    colors: [],
  },
  blood: {
    name: "Blood",
    typeLine: "Token Artifact — Blood",
    abilities: ["{1}, {T}, Discard a card, Sacrifice this artifact: Draw a card."],
    colors: [],
  },
  gold: {
    name: "Gold",
    typeLine: "Token Artifact — Gold",
    abilities: ["Sacrifice this artifact: Add one mana of any color."],
    colors: [],
  },
  powerstone: {
    name: "Powerstone",
    typeLine: "Token Artifact — Powerstone",
    abilities: ["{T}: Add {C}. This mana can't be spent to cast a nonartifact spell."],
    colors: [],
  },
  shard: {
    name: "Shard",
    typeLine: "Token Artifact — Shard",
    abilities: ["{2}, {T}, Sacrifice this artifact: Draw a card."],
    colors: [],
  },
};

