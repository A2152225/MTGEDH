/**
 * Origin: server/src/state/modules/triggers/intervening-if.ts
 * Cluster: graveyard permanent-card count, permanent status, combat, attachments, colors, player/team helpers
 * (countPermanentCardsInGraveyard through isTiedForExtreme)
 * Public: countPermanentCardsInGraveyard, isPermanentModified, didSourceDealDamageToOpponentThisTurn, didSourceDealDamageToAnyPlayerThisTurn,
 * anyCreatureAttackedThisTurn, getPermanentPower, getPermanentPowerMaybe, getPermanentToughness,
 * getPermanentToughnessMaybe, getControlledCreatures, getAttackingCreatures, getAttackersDeclaredThisCombat,
 * getAttackingTotalPower, countCardTypesInGraveyard, getSpellsCastThisTurn, getSpellColorsThisTurnEntry,
 * getSpellsCastThisTurnByPlayerCount, getSpellsCastLastTurnCount, getSpellsCastLastTurnByPlayerCounts,
 * isPermanentEquipped, isPermanentEnchanted, isEquippedConservative, getAuraCountConservative,
 * permanentHasKeyword, isPermanentRed, isPermanentWhite, isPermanentBlack, isEnchantingTalePermanent,
 * isPermanentAttacking, isPermanentBlocking, isPermanentBlocked, isCreatureDiedThisTurn,
 * didPermanentLeaveBattlefieldThisTurn, getTurnPlayerId, getActivePlayerId, getOpponentIds,
 * getOpponentInfo, getTeamMemberIds, getAllPlayerIds, isTiedForExtreme
 */

import type { GameContext } from "../context.js";
import { calculateAllPTBonuses } from "../../utils.js";
import { isPermanentCard } from "./intervening-if-this-turn-counts.js";
import { parseMaybeNumber, getGraveyard } from "./intervening-if-zone-lookups.js";

function countPermanentCardsInGraveyard(ctx: GameContext, playerId: string): number {
  return getGraveyard(ctx, playerId).filter((c: any) => isPermanentCard(c)).length;
}

function isPermanentModified(ctx: GameContext, perm: any): boolean {
  if (!perm) return false;
  const counters = perm?.counters;
  if (counters && typeof counters === 'object') {
    for (const v of Object.values(counters)) {
      if (typeof v === 'number' && v > 0) return true;
    }
  }
  if (isPermanentEquipped(ctx, perm)) return true;
  if (isPermanentEnchanted(ctx, perm)) return true;
  return false;
}


function didSourceDealDamageToOpponentThisTurn(ctx: GameContext, controllerId: string, sourcePermanentId: string): boolean | null {
  const { opponents, unknown } = getOpponentInfo(ctx, controllerId);
  if (unknown) return null;
  if (!opponents.length) return false;

  const tracker = (ctx as any).state?.creaturesThatDealtDamageToPlayer;
  if (tracker && typeof tracker === 'object') {
    return opponents.some((oppId) => {
      const entry = tracker?.[oppId];
      return !!(entry && typeof entry === 'object' && entry[sourcePermanentId]);
    });
  }

  return null;
}

function didSourceDealDamageToAnyPlayerThisTurn(ctx: GameContext, sourcePermanentId: string): boolean {
  const tracker = (ctx as any).state?.creaturesThatDealtDamageToPlayer;
  if (!tracker || typeof tracker !== 'object') return false;
  const sid = String(sourcePermanentId || '');
  if (!sid) return false;
  return Object.values(tracker).some((entry: any) => entry && typeof entry === 'object' && !!entry[sid]);
}


function anyCreatureAttackedThisTurn(ctx: GameContext): boolean {
  const tracked = (ctx as any).state?.creaturesAttackedThisTurn;
  if (tracked && typeof tracked === 'object') {
    return Object.values(tracked).some((v: any) => typeof v === 'number' && v > 0);
  }
  const battlefield = (ctx as any).state?.battlefield || [];
  if (!Array.isArray(battlefield)) return false;
  return battlefield.some((p: any) => {
    if (!p) return false;
    const tl = String(p.card?.type_line || '').toLowerCase();
    if (!tl.includes('creature')) return false;
    return p.attackedThisTurn === true || !!p.attacking || p.isAttacking === true;
  });
}

function getPermanentPower(perm: any, ctx?: GameContext): number {
  const candidates = [perm?.effectivePower, perm?.power];
  for (const c of candidates) {
    const n = parseMaybeNumber(c);
    if (n !== null) return n;
  }

  const base = parseMaybeNumber(perm?.basePower) ?? parseMaybeNumber(perm?.card?.power) ?? 0;
  if (!ctx) return base;

  try {
    const bonus = calculateAllPTBonuses(perm, (ctx as any).state);
    if (bonus && typeof bonus.power === 'number') {
      return base + bonus.power;
    }
  } catch {
    // best-effort; fall back to base
  }

  return base;
}

function getPermanentPowerMaybe(perm: any, ctx?: GameContext): number | null {
  const candidates = [perm?.effectivePower, perm?.power];
  for (const c of candidates) {
    const n = parseMaybeNumber(c);
    if (n !== null) return n;
  }

  const baseRaw = parseMaybeNumber(perm?.basePower) ?? parseMaybeNumber(perm?.card?.power);
  if (baseRaw === null) return null;
  if (!ctx) return baseRaw;

  try {
    const bonus = calculateAllPTBonuses(perm, (ctx as any).state);
    if (bonus && typeof bonus.power === 'number') {
      return baseRaw + bonus.power;
    }
  } catch {
    // best-effort; fall back to base
  }

  return baseRaw;
}

function getPermanentToughness(perm: any, ctx?: GameContext): number {
  const candidates = [perm?.effectiveToughness, perm?.toughness];
  for (const c of candidates) {
    const n = parseMaybeNumber(c);
    if (n !== null) return n;
  }

  const base = parseMaybeNumber(perm?.baseToughness) ?? parseMaybeNumber(perm?.card?.toughness) ?? 0;
  if (!ctx) return base;

  try {
    const bonus = calculateAllPTBonuses(perm, (ctx as any).state);
    if (bonus && typeof bonus.toughness === 'number') {
      return base + bonus.toughness;
    }
  } catch {
    // best-effort; fall back to base
  }

  return base;
}

function getPermanentToughnessMaybe(perm: any, ctx?: GameContext): number | null {
  const candidates = [perm?.effectiveToughness, perm?.toughness];
  for (const c of candidates) {
    const n = parseMaybeNumber(c);
    if (n !== null) return n;
  }

  const baseRaw = parseMaybeNumber(perm?.baseToughness) ?? parseMaybeNumber(perm?.card?.toughness);
  if (baseRaw === null) return null;
  if (!ctx) return baseRaw;

  try {
    const bonus = calculateAllPTBonuses(perm, (ctx as any).state);
    if (bonus && typeof bonus.toughness === 'number') {
      return baseRaw + bonus.toughness;
    }
  } catch {
    // best-effort; fall back to base
  }

  return baseRaw;
}

function getControlledCreatures(ctx: GameContext, controllerId: string): any[] {
  const battlefield = (ctx as any).state?.battlefield || [];
  return (Array.isArray(battlefield) ? battlefield : []).filter((p: any) => {
    if (!p || p.controller !== controllerId) return false;
    const tl = String(p.card?.type_line || "").toLowerCase();
    return tl.includes("creature");
  });
}

function getAttackingCreatures(ctx: GameContext, controllerId: string): any[] {
  return getControlledCreatures(ctx, controllerId).filter((p: any) => !!p.attacking || p.isAttacking === true);
}

function getAttackersDeclaredThisCombat(ctx: GameContext, playerId: string): any[] {
  const map = (ctx as any).state?.attackersDeclaredThisCombatByPlayer;
  const v = map?.[playerId];
  return Array.isArray(v) ? v : [];
}

function getAttackingTotalPower(ctx: GameContext, controllerId: string): number {
  return getAttackingCreatures(ctx, controllerId).reduce((sum: number, p: any) => sum + getPermanentPower(p), 0);
}

function countCardTypesInGraveyard(ctx: GameContext, playerId: string): number {
  const types = new Set<string>();
  for (const c of getGraveyard(ctx, playerId)) {
    const tl = String(c?.type_line || "").toLowerCase();
    if (!tl) continue;
    if (tl.includes("artifact")) types.add("artifact");
    if (tl.includes("creature")) types.add("creature");
    if (tl.includes("enchantment")) types.add("enchantment");
    if (tl.includes("instant")) types.add("instant");
    if (tl.includes("sorcery")) types.add("sorcery");
    if (tl.includes("kindred")) types.add("kindred");
    if (tl.includes("land")) types.add("land");
    if (tl.includes("planeswalker")) types.add("planeswalker");
    if (tl.includes("battle")) types.add("battle");
    if (tl.includes("tribal")) types.add("kindred");
  }
  return types.size;
}

function getSpellsCastThisTurn(ctx: GameContext): any[] {
  const spells = (ctx as any).state?.spellsCastThisTurn;
  return Array.isArray(spells) ? spells : [];
}

function getSpellColorsThisTurnEntry(spell: any): string[] | null {
  const raw =
    (spell as any)?.card?.colors ??
    (spell as any)?.colors ??
    (spell as any)?.card?.color_identity ??
    (spell as any)?.color_identity;
  if (!Array.isArray(raw)) return null;
  return raw
    .map((c: any) => String(c || '').trim().toUpperCase())
    .filter((c: string) => c.length > 0);
}

function getSpellsCastThisTurnByPlayerCount(ctx: GameContext, playerId: string): number {
  return getSpellsCastThisTurn(ctx).filter((s: any) => String(s?.casterId || "") === playerId).length;
}

function getSpellsCastLastTurnCount(ctx: GameContext): number | null {
  const v = (ctx as any).state?.spellsCastLastTurnCount;
  return typeof v === "number" ? v : null;
}

function getSpellsCastLastTurnByPlayerCounts(ctx: GameContext): Record<string, number> | null {
  const v = (ctx as any).state?.spellsCastLastTurnByPlayerCounts;
  if (!v || typeof v !== 'object') return null;
  return v as Record<string, number>;
}

function isPermanentEquipped(ctx: GameContext, perm: any): boolean {
  if (!perm) return false;
  if (perm.isEquipped === true) return true;
  if (Array.isArray(perm.attachedEquipment) && perm.attachedEquipment.length > 0) return true;
  const attachments = Array.isArray(perm.attachments) ? perm.attachments : [];
  if (!attachments.length) return false;
  const battlefield = (ctx as any).state?.battlefield || [];
  return attachments.some((id: any) => {
    const a = (Array.isArray(battlefield) ? battlefield : []).find((p: any) => p?.id === id);
    const tl = String(a?.card?.type_line || '').toLowerCase();
    return tl.includes('equipment');
  });
}

function isPermanentEnchanted(ctx: GameContext, perm: any): boolean {
  if (!perm) return false;
  const attachments = Array.isArray(perm.attachments) ? perm.attachments : [];
  if (!attachments.length) return false;
  const battlefield = (ctx as any).state?.battlefield || [];
  return attachments.some((id: any) => {
    const a = (Array.isArray(battlefield) ? battlefield : []).find((p: any) => p?.id === id);
    const tl = String(a?.card?.type_line || '').toLowerCase();
    return tl.includes('aura');
  });
}

function countBattlefieldAttachmentsByType(
  ctx: GameContext,
  perm: any,
  typeWordLower: 'aura' | 'equipment'
): { count: number; unknown: boolean } | null {
  if (!perm) return null;

  const attachments = Array.isArray((perm as any).attachments) ? (perm as any).attachments : null;
  const attachedEquipment = Array.isArray((perm as any).attachedEquipment) ? (perm as any).attachedEquipment : null;

  // If we have no attachment id lists, we can't safely conclude anything.
  if (!attachments && !attachedEquipment) return null;

  const ids = new Set<string>();
  for (const id of attachments ?? []) ids.add(String(id));
  for (const id of attachedEquipment ?? []) ids.add(String(id));
  if (ids.size === 0) return { count: 0, unknown: false };

  const battlefield = (ctx as any).state?.battlefield;
  if (!Array.isArray(battlefield)) return null;

  let count = 0;
  let unknown = false;
  for (const id of ids) {
    const a = battlefield.find((p: any) => p && String(p.id || '') === id);
    if (!a) {
      unknown = true;
      continue;
    }
    const tl = String(a?.card?.type_line || '').toLowerCase();
    if (tl.includes(typeWordLower)) count++;
  }

  return { count, unknown };
}

function isEquippedConservative(ctx: GameContext, perm: any): boolean | null {
  if (!perm) return null;
  if (typeof (perm as any).isEquipped === 'boolean') return (perm as any).isEquipped;
  if (Array.isArray((perm as any).attachedEquipment)) return (perm as any).attachedEquipment.length > 0;
  const info = countBattlefieldAttachmentsByType(ctx, perm, 'equipment');
  if (!info) return null;
  if (info.count > 0) return true;
  return info.unknown ? null : false;
}

function getAuraCountConservative(ctx: GameContext, perm: any): { count: number; unknown: boolean } | null {
  return countBattlefieldAttachmentsByType(ctx, perm, 'aura');
}

function permanentHasKeyword(perm: any, keywordLower: string): boolean | null {
  if (!perm) return null;
  const keyword = String(keywordLower || '').toLowerCase();
  if (!keyword) return null;

  const oracleTextLower = String(perm?.card?.oracle_text || '').toLowerCase();
  const granted = Array.isArray((perm as any).grantedAbilities) ? (perm as any).grantedAbilities : [];
  const grantedLower = granted.map((a: any) => String(a || '').toLowerCase());

  // Keyword counters exist in some implementations (e.g., flying counters).
  const counters = (perm as any).counters;
  const hasKeywordCounter =
    counters && typeof counters === 'object' ? Object.keys(counters).some((k) => String(k || '').toLowerCase() === keyword) : false;

  // If we have no ability info at all, be conservative.
  const hasAnyInfo = Boolean(oracleTextLower) || grantedLower.length > 0 || Boolean(counters);
  if (!hasAnyInfo) return null;

  if (hasKeywordCounter) return true;
  if (oracleTextLower.includes(keyword)) return true;
  if (grantedLower.some((a: string) => a.includes(keyword))) return true;

  return false;
}

function isPermanentRed(perm: any): boolean | null {
  if (!perm) return null;
  const colors =
    (perm as any)?.colors ??
    (perm as any)?.color_identity ??
    (perm as any)?.card?.colors ??
    (perm as any)?.card?.color_identity;
  if (Array.isArray(colors)) {
    const set = new Set(colors.map((c: any) => String(c || '').toUpperCase()));
    return set.has('R');
  }

  const color = (perm as any)?.color ?? (perm as any)?.card?.color;
  if (typeof color === 'string' && color) {
    const c = color.trim();
    if (!c) return null;
    if (c.toLowerCase() === 'colorless' || c.toUpperCase() === 'C') return false;
    return c.toUpperCase() === 'R' || c.toLowerCase() === 'red';
  }

  return null;
}

function isPermanentWhite(perm: any): boolean | null {
  if (!perm) return null;
  const colors =
    (perm as any)?.colors ??
    (perm as any)?.color_identity ??
    (perm as any)?.card?.colors ??
    (perm as any)?.card?.color_identity;
  if (Array.isArray(colors)) {
    const set = new Set(colors.map((c: any) => String(c || '').toUpperCase()));
    return set.has('W');
  }

  const color = (perm as any)?.color ?? (perm as any)?.card?.color;
  if (typeof color === 'string' && color) {
    const c = color.trim();
    if (!c) return null;
    if (c.toLowerCase() === 'colorless' || c.toUpperCase() === 'C') return false;
    return c.toUpperCase() === 'W' || c.toLowerCase() === 'white';
  }

  return null;
}

function isPermanentBlack(perm: any): boolean | null {
  if (!perm) return null;
  const colors =
    (perm as any)?.colors ??
    (perm as any)?.color_identity ??
    (perm as any)?.card?.colors ??
    (perm as any)?.card?.color_identity;
  if (Array.isArray(colors)) {
    const set = new Set(colors.map((c: any) => String(c || '').toUpperCase()));
    return set.has('B');
  }

  const color = (perm as any)?.color ?? (perm as any)?.card?.color;
  if (typeof color === 'string' && color) {
    const c = color.trim();
    if (!c) return null;
    if (c.toLowerCase() === 'colorless' || c.toUpperCase() === 'C') return false;
    return c.toUpperCase() === 'B' || c.toLowerCase() === 'black';
  }

  return null;
}

function isEnchantingTalePermanent(perm: any): boolean | null {
  if (!perm) return null;
  // "Enchanting Tales have the expansion code WOT" (Scryfall reminder text).
  const c: any = (perm as any).card || {};
  const set = c.set ?? c.set_code ?? c.expansion ?? c.expansion_code ?? c.expansionCode;
  if (typeof set === 'string' && set) return String(set).toLowerCase() === 'wot';

  // Some card payloads may store printing metadata differently; if present and non-WOT, treat as false.
  const printingSet = c.printingSet ?? c.printing_set;
  if (typeof printingSet === 'string' && printingSet) return String(printingSet).toLowerCase() === 'wot';

  return null;
}

function isPermanentAttacking(perm: any): boolean {
  return !!perm?.attacking || perm?.isAttacking === true;
}

function isPermanentBlocking(perm: any): boolean {
  if ((perm as any)?.isBlocking === true) return true;
  const blocking = (perm as any)?.blocking;
  if (Array.isArray(blocking)) return blocking.length > 0;
  if (typeof blocking === 'boolean') return blocking;
  return Boolean(blocking);
}

function isPermanentBlocked(perm: any): boolean {
  const blockedBy = perm?.blockedBy;
  return Array.isArray(blockedBy) ? blockedBy.length > 0 : !!blockedBy;
}

function isCreatureDiedThisTurn(ctx: GameContext): boolean | null {
  const v = (ctx as any).state?.creatureDiedThisTurn;
  if (typeof v === 'boolean') return v;

  const map = (ctx as any).state?.creaturesDiedThisTurnByController;
  if (map && typeof map === 'object') {
    let total = 0;
    for (const entry of Object.values(map)) {
      if (typeof entry === 'number') total += entry;
    }
    return total > 0;
  }

  return null;
}

function didPermanentLeaveBattlefieldThisTurn(ctx: GameContext, playerId: string): boolean {
  const map = (ctx as any).state?.permanentLeftBattlefieldThisTurn;
  const v = map && typeof map === 'object' ? (map as any)[playerId] : undefined;
  return typeof v === 'boolean' ? v : false;
}

function getTurnPlayerId(ctx: GameContext): string | null {
  const state: any = (ctx as any).state || {};
  return (state.turnPlayer || state.activePlayer || null) as string | null;
}

function getActivePlayerId(ctx: GameContext): string | null {
  const state: any = (ctx as any).state || {};
  return (state.activePlayer || state.turnPlayer || null) as string | null;
}

function getOpponentIds(ctx: GameContext, controllerId: string): string[] {
  const state: any = (ctx as any).state || {};
  const players = Array.isArray(state.players) ? state.players : [];
  return players
    .map((p: any) => String(p?.id || ""))
    .filter((id: string) => id && id !== controllerId);
}

function getOpponentInfo(
  ctx: GameContext,
  controllerId: string
): { opponents: string[]; unknown: boolean } {
  const stateAny: any = (ctx as any).state || {};
  const players = Array.isArray(stateAny.players) ? stateAny.players : [];
  const otherIds = players
    .map((p: any) => String(p?.id || ''))
    .filter((id: string) => Boolean(id) && id !== String(controllerId));

  const anyTeamData =
    (stateAny.team && typeof stateAny.team === 'object' && Object.keys(stateAny.team).length > 0) ||
    (stateAny.teams && typeof stateAny.teams === 'object' && Object.keys(stateAny.teams).length > 0) ||
    (stateAny.playerTeam && typeof stateAny.playerTeam === 'object' && Object.keys(stateAny.playerTeam).length > 0) ||
    players.some((p: any) => Boolean(p?.team ?? p?.teamId ?? p?.playerTeam));

  if (!anyTeamData) return { opponents: otherIds, unknown: false };

  const controllerTeam = getPlayerTeamId(ctx, controllerId);
  if (!controllerTeam) return { opponents: otherIds, unknown: true };

  const opponents: string[] = [];
  let unknown = false;
  for (const pid of otherIds) {
    const t = getPlayerTeamId(ctx, pid);
    if (!t) {
      unknown = true;
      continue;
    }
    if (String(t) !== String(controllerTeam)) opponents.push(pid);
  }

  return { opponents, unknown };
}

function getPlayerTeamId(ctx: GameContext, playerId: string): string | null {
  const stateAny: any = (ctx as any).state || {};
  const direct = stateAny?.team?.[playerId] ?? stateAny?.teams?.[playerId] ?? stateAny?.playerTeam?.[playerId];
  if (typeof direct === 'string' && direct) return direct;

  const players = Array.isArray(stateAny.players) ? stateAny.players : [];
  const p = players.find((pp: any) => String(pp?.id || '') === String(playerId));
  const fromPlayer = p?.team ?? p?.teamId ?? p?.playerTeam;
  return typeof fromPlayer === 'string' && fromPlayer ? fromPlayer : null;
}

function getTeamMemberIds(ctx: GameContext, controllerId: string): string[] {
  const teamId = getPlayerTeamId(ctx, controllerId);
  if (!teamId) return [String(controllerId)];

  const stateAny: any = (ctx as any).state || {};
  const players = Array.isArray(stateAny.players) ? stateAny.players : [];
  const ids = players
    .map((p: any) => String(p?.id || ''))
    .filter((id: string) => Boolean(id));

  const members = ids.filter((pid) => {
    const t = getPlayerTeamId(ctx, pid);
    return typeof t === 'string' && String(t) === String(teamId);
  });

  // Safety: ensure controller is included.
  if (!members.includes(String(controllerId))) members.push(String(controllerId));
  return Array.from(new Set(members));
}

function getAllPlayerIds(ctx: GameContext, controllerId: string): string[] {
  const state: any = (ctx as any).state || {};
  const players = Array.isArray(state.players) ? state.players : [];
  const ids = players
    .map((p: any) => String(p?.id || ''))
    .filter((id: string) => Boolean(id));
  if (controllerId && !ids.includes(controllerId)) ids.push(controllerId);
  return Array.from(new Set(ids));
}

function isTiedForExtreme(
  allIds: string[],
  controllerId: string,
  getValue: (pid: string) => number,
  extreme: 'most' | 'least'
): boolean {
  if (!allIds.length) return false;

  const yourValue = getValue(controllerId);
  const values = allIds.map((pid) => getValue(pid));
  const extremeValue = extreme === 'most' ? Math.max(...values) : Math.min(...values);
  if (yourValue !== extremeValue) return false;

  const tiedCount = values.filter((v) => v === extremeValue).length;
  return tiedCount >= 2;
}

export {
  countPermanentCardsInGraveyard,
  isPermanentModified,
  didSourceDealDamageToOpponentThisTurn,
  didSourceDealDamageToAnyPlayerThisTurn,
  anyCreatureAttackedThisTurn,
  getPermanentPower,
  getPermanentPowerMaybe,
  getPermanentToughness,
  getPermanentToughnessMaybe,
  getControlledCreatures,
  getAttackingCreatures,
  getAttackersDeclaredThisCombat,
  getAttackingTotalPower,
  countCardTypesInGraveyard,
  getSpellsCastThisTurn,
  getSpellColorsThisTurnEntry,
  getSpellsCastThisTurnByPlayerCount,
  getSpellsCastLastTurnCount,
  getSpellsCastLastTurnByPlayerCounts,
  isPermanentEquipped,
  isPermanentEnchanted,
  isEquippedConservative,
  getAuraCountConservative,
  permanentHasKeyword,
  isPermanentRed,
  isPermanentWhite,
  isPermanentBlack,
  isEnchantingTalePermanent,
  isPermanentAttacking,
  isPermanentBlocking,
  isPermanentBlocked,
  isCreatureDiedThisTurn,
  didPermanentLeaveBattlefieldThisTurn,
  getTurnPlayerId,
  getActivePlayerId,
  getOpponentIds,
  getOpponentInfo,
  getTeamMemberIds,
  getAllPlayerIds,
  isTiedForExtreme,
};
