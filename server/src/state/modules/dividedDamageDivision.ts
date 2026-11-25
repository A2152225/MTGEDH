/**
 * server/src/state/modules/dividedDamageDivision.ts
 *
 * Pure helpers for CR 601.2d "divided as you choose" damage. Detect the clause, parse a
 * known total (fixed N or announced X), validate a per-target map (at least 1 to each
 * known total (fixed N, announced X, or equal to its power when the source is on the
 * battlefield), validate a per-target map (at least 1 to each
 * chosen target, sum equals the total), and build the even split used when no human
 * choice was recorded (AI, self-play, or a skipped prompt).
 */

import { getCurrentPowerToughnessForRules } from './currentPowerToughness.js';

export type DamageDivisionMap = Record<string, number>;

const DIVIDED_AS_YOU_CHOOSE_RE = /\bdivided\s+as\s+you\s+choose\b/i;
const DIVIDED_AMOUNT_RE = /\bdeals?\s+(X|\d+)\s+damage\s+divided\s+as\s+you\s+choose\b/i;
const EQUAL_TO_SOURCE_PT_RE = /\bdeals?\s+damage\s+equal\s+to\s+(?:its|his|her|their|this creature'?s|that creature'?s|his or her)\s+(power|toughness)\b/i;

export function isDividedAsYouChooseText(oracleText: unknown): boolean {
  return DIVIDED_AS_YOU_CHOOSE_RE.test(String(oracleText || ''));
}

export function normalizeDamageDivisionTargetIds(targetRefs: unknown): string[] {
  if (!Array.isArray(targetRefs)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const entry of targetRefs) {
    const id = String(typeof entry === 'string' ? entry : (entry as any)?.id || '').trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

export function normalizeDamageDivisionMap(raw: unknown): DamageDivisionMap | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const out: DamageDivisionMap = {};
  let any = false;
  for (const [rawId, rawAmount] of Object.entries(raw as Record<string, unknown>)) {
    const id = String(rawId || '').trim();
    const amount = Math.floor(Number(rawAmount));
    if (!id || !Number.isFinite(amount) || amount < 0) continue;
    out[id] = amount;
    any = true;
  }
  return any ? out : undefined;
}

export function parseDividedAsYouChooseTotal(oracleText: unknown, xValue?: unknown): number | null {
  if (!isDividedAsYouChooseText(oracleText)) return null;
  const match = String(oracleText || '').match(DIVIDED_AMOUNT_RE);
  if (!match) return null;
  const token = String(match[1] || '').trim();
  if (/^x$/i.test(token)) {
    const x = Math.floor(Number(xValue));
    return Number.isFinite(x) && x >= 0 ? x : null;
  }
  const n = Math.floor(Number(token));
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export function resolveDividedAsYouChooseTotal(args: {
  readonly oracleText: unknown;
  readonly xValue?: unknown;
  readonly gameOrState?: any;
  readonly sourceId?: unknown;
  readonly sourcePermanent?: any;
}): number | null {
  const parsed = parseDividedAsYouChooseTotal(args.oracleText, args.xValue);
  if (parsed !== null) return parsed;
  if (!isDividedAsYouChooseText(args.oracleText)) return null;
  const match = String(args.oracleText || '').match(EQUAL_TO_SOURCE_PT_RE);
  if (!match) return null;
  const stat = String(match[1] || 'power').toLowerCase();
  const state = args.gameOrState?.state && typeof args.gameOrState.state === 'object'
    ? args.gameOrState.state
    : args.gameOrState;
  const sourceId = String(args.sourceId || '').trim();
  const permanent = args.sourcePermanent
    || (sourceId && Array.isArray(state?.battlefield)
      ? state.battlefield.find((entry: any) => String(entry?.id || '').trim() === sourceId)
      : undefined);
  if (!permanent || !state) return null;
  try {
    const pt = getCurrentPowerToughnessForRules(permanent, state);
    const value = stat === 'toughness' ? pt.toughness : pt.power;
    const n = Math.floor(Number(value));
    return Number.isFinite(n) && n >= 0 ? n : null;
  } catch {
    return null;
  }
}

export function buildEvenDamageDivision(
  targetIds: readonly string[],
  total: number,
): DamageDivisionMap {
  const ids = normalizeDamageDivisionTargetIds(targetIds);
  const out: DamageDivisionMap = {};
  if (ids.length === 0) return out;
  const amount = Math.max(0, Math.floor(Number(total) || 0));
  const base = Math.floor(amount / ids.length);
  let remainder = amount - base * ids.length;
  for (const id of ids) {
    out[id] = base + (remainder > 0 ? 1 : 0);
    if (remainder > 0) remainder -= 1;
  }
  return out;
}

export type DamageDivisionValidation =
  | { ok: true; division: DamageDivisionMap }
  | { ok: false; message: string };

export function validateDamageDivision(args: {
  readonly distribution: unknown;
  readonly targetIds: readonly string[];
  readonly total: number;
  readonly minPerTarget?: number;
}): DamageDivisionValidation {
  const targetIds = normalizeDamageDivisionTargetIds(args.targetIds);
  const total = Math.max(0, Math.floor(Number(args.total) || 0));
  const minPerTarget = Math.max(1, Math.floor(Number(args.minPerTarget ?? 1) || 1));
  const raw = normalizeDamageDivisionMap(args.distribution);
  if (!raw) {
    return { ok: false, message: 'Invalid damage division format' };
  }
  const allowed = new Set(targetIds);
  const division: DamageDivisionMap = {};
  let sum = 0;
  for (const [id, amount] of Object.entries(raw)) {
    if (amount <= 0) continue;
    if (!allowed.has(id)) {
      return { ok: false, message: 'Damage division includes an invalid target' };
    }
    if (amount < minPerTarget) {
      return { ok: false, message: `Each target must receive at least ${minPerTarget} damage` };
    }
    division[id] = amount;
    sum += amount;
  }
  for (const id of targetIds) {
    const amount = division[id] ?? 0;
    if (amount < minPerTarget) {
      return { ok: false, message: `Each target must receive at least ${minPerTarget} damage` };
    }
  }
  if (sum !== total) {
    return { ok: false, message: `Total damage distributed (${sum}) must equal ${total}` };
  }
  return { ok: true, division };
}

export function describeDamageDivisionTargets(
  gameOrState: any,
  targetIds: readonly string[],
): Array<{ id: string; label: string; type: 'player' | 'permanent' | 'spell' }> {
  const state = gameOrState?.state && typeof gameOrState.state === 'object' ? gameOrState.state : gameOrState;
  const battlefield = Array.isArray(state?.battlefield) ? state.battlefield : [];
  const players = Array.isArray(state?.players) ? state.players : [];
  const stack = Array.isArray(state?.stack) ? state.stack : [];
  return normalizeDamageDivisionTargetIds(targetIds).map((id) => {
    const player = players.find((entry: any) => String(entry?.id || '').trim() === id);
    if (player) {
      return { id, label: String(player.name || id).trim() || id, type: 'player' as const };
    }
    const permanent = battlefield.find((entry: any) => String(entry?.id || '').trim() === id);
    if (permanent) {
      const name = String(permanent?.card?.name || permanent?.name || id).trim() || id;
      return { id, label: name, type: 'permanent' as const };
    }
    const item = stack.find((entry: any) => String(entry?.id || '').trim() === id);
    if (item) {
      const name = String(item?.card?.name || item?.sourceName || item?.source?.cardName || id).trim() || id;
      return { id, label: name, type: 'spell' as const };
    }
    return { id, label: id, type: 'permanent' as const };
  });
}

export function shouldPromptDamageDivision(args: {
  readonly oracleText: unknown;
  readonly targetIds: readonly string[];
  readonly xValue?: unknown;
  readonly existingDivision?: unknown;
  readonly skipInteractivePrompts?: boolean;
  readonly gameOrState?: any;
  readonly sourceId?: unknown;
  readonly sourcePermanent?: any;
}): { prompt: boolean; total: number | null; autoDivision?: DamageDivisionMap } {
  const targetIds = normalizeDamageDivisionTargetIds(args.targetIds);
  const total = resolveDividedAsYouChooseTotal(args);
  if (total === null) {
    return { prompt: false, total: null };
  }
  if (targetIds.length === 0) {
    return { prompt: false, total };
  }
  const existing = args.existingDivision
    ? validateDamageDivision({ distribution: args.existingDivision, targetIds, total })
    : null;
  if (existing?.ok) {
    return { prompt: false, total, autoDivision: existing.division };
  }
  const autoDivision = buildEvenDamageDivision(targetIds, total);
  if (targetIds.length <= 1 || total <= targetIds.length || args.skipInteractivePrompts === true) {
    return { prompt: false, total, autoDivision };
  }
  return { prompt: true, total };
}

export function stampDamageDivisionOnHost(host: any, division: DamageDivisionMap | undefined): void {
  if (!host || typeof host !== 'object') return;
  const normalized = normalizeDamageDivisionMap(division);
  if (!normalized) return;
  host.damageDivisionByTargetId = { ...normalized };
  if (host.card && typeof host.card === 'object') {
    host.card.damageDivisionByTargetId = { ...normalized };
  }
}

export function stampDamageDivisionOnPendingCastAndZoneCards(game: any, pendingCast: any): void {
  if (!pendingCast || typeof pendingCast !== 'object') return;
  const division = normalizeDamageDivisionMap(
    pendingCast.damageDivisionByTargetId || pendingCast.card?.damageDivisionByTargetId,
  );
  if (!division) return;
  stampDamageDivisionOnHost(pendingCast, division);
  const cardId = String(pendingCast.cardId || pendingCast.card?.id || '').trim();
  if (!cardId) return;
  const zones = game?.state?.zones && typeof game.state.zones === 'object' ? game.state.zones : {};
  for (const zone of Object.values(zones) as any[]) {
    for (const listName of ['hand', 'exile', 'graveyard', 'library', 'command']) {
      const list = zone?.[listName];
      if (!Array.isArray(list)) continue;
      const card = list.find((entry: any) => String(entry?.id || '').trim() === cardId);
      if (card) stampDamageDivisionOnHost(card, division);
    }
  }
}
