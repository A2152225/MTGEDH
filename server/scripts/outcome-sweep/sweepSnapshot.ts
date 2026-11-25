/**
 * Outcome sweep state snapshots and diffs. A snapshot is a flat, JSON-safe digest of what an
 * ability can observably change: life, zone membership, permanents (control, tap, counters,
 * current P/T, keywords, attachment), mana pools, player counters and remaining top-level keys.
 *
 * Diffs split into strong changes (board/zones/life/mana gains) and weak ones (other top-level
 * state keys and player fields), so flag-only effects can be reviewed separately from real noops.
 */
import { getCurrentPowerToughness } from '../../src/state/modules/currentPowerToughness.js';
import { permanentHasKeywordAbility } from '../../../rules-engine/src/permanentKeywordAbilities.js';
import { getCreatureTypesNow, isCreatureNow } from '../../src/state/creatureTypeNow.js';

const KEYWORDS = ['flying', 'hexproof', 'shroud', 'haste', 'trample', 'vigilance', 'first strike', 'double strike',
  'deathtouch', 'lifelink', 'reach', 'indestructible', 'menace', 'defender'];

const ZONES = ['hand', 'graveyard', 'exile', 'library', 'commandZone', 'sideboard'];

/** Top-level keys covered elsewhere or too noisy to mean "the effect did something". */
export const SNAPSHOT_IGNORED_TOP_KEYS = new Set<string>([
  'stack', 'priority', 'manaPool', 'battlefield', 'zones', 'life', 'players', 'log', 'logs', 'chat', 'events',
  'version', 'seq', 'updatedAt', 'lastUpdated', 'lastAction', 'lastActionAt', 'priorityPasses', 'passedPriority',
  'priorityPassedBy', 'passesInRow', 'priorityPassCount', 'actionLog', 'gameLog', 'eventLog', 'recentActions',
]);

/** Bookkeeping keys (per-turn trackers, IR ledgers, priority/autopass flags) that are never evidence. */
const IGNORED_TOP_KEY_RE = /ThisTurn|LastTurn|SinceLast|^_|priorityClaimed|eliminationNotifications|aiDeckProfiles|pendingSpellCasts|oracleIr(?:StepLedger|AppliedStepKinds)|lastOracleIr/;

/** Permanent fields covered by the signature or pure bookkeeping; anything else changing is a weak flag effect. */
const PERM_FIELD_SKIP_RE = /^(?:ptSources|continuous|batch\d+|derived|effective|computed|cached)/i;
const EMPTY_DIGESTS = new Set(['undefined', 'null', '[]', '{}', '0', 'false', '""']);

/** A key that went from absent to an empty default is initialization, not an effect. */
function changedMeaningfully(before: string | undefined, after: string | undefined): boolean {
  if (before === after) return false;
  const a = before ?? 'undefined';
  const b = after ?? 'undefined';
  return !(EMPTY_DIGESTS.has(a) && EMPTY_DIGESTS.has(b));
}

const PERM_FIELD_SKIP = new Set(['card', 'counters', 'tapped', 'controller', 'owner', 'id', 'attachedTo', 'damage', 'markedDamage',
  'isToken', 'faceDown', 'phasedOut', 'summoningSickness', 'enteredThisTurn', 'timestamp', 'zone']);

export type SweepSnapshot = {
  life: Record<string, number>;
  zones: Record<string, string[]>;
  perms: Record<string, { cardId: string; name: string; sig: string; fields: Record<string, string> }>;
  mana: Record<string, number>;
  players: Record<string, string>;
  misc: Record<string, string>;
};

/** `ignored` lists bookkeeping keys that changed (never evidence; kept for triage). */
export type SweepDiff = { strong: string[]; weak: string[]; ignored: string[]; manaGain: boolean };

function stable(value: unknown, depth = 0): string {
  if (value === null || value === undefined) return String(value);
  if (typeof value !== 'object') return JSON.stringify(value);
  if (depth > 6) return '"<deep>"';
  if (value instanceof Map) return stable(Object.fromEntries(value as Map<unknown, unknown>), depth + 1);
  if (value instanceof Set) return stable([...(value as Set<unknown>)], depth + 1);
  if (Array.isArray(value)) return `[${value.map((entry) => stable(entry, depth + 1)).join(',')}]`;
  const keys = Object.keys(value as object).filter((key) => !/(?:timestamp|At)$/i.test(key)).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stable((value as any)[key], depth + 1)}`).join(',')}}`;
}

function digest(text: string): string {
  if (text.length <= 160) return text;
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `${text.length}:${(hash >>> 0).toString(16)}`;
}

function safe<T>(fn: () => T, fallback: T): T {
  try { return fn(); } catch { return fallback; }
}

function cardIdOf(card: any): string {
  return String(card?.id ?? card?.cardId ?? card?.name ?? '?');
}

function permSig(perm: any, state: any, battlefield: any[]): string {
  const pt = safe(() => getCurrentPowerToughness(perm, state), undefined);
  const keywords = KEYWORDS.filter((kw) => safe(() => permanentHasKeywordAbility(perm, kw, battlefield), false));
  return digest(stable([
    String(perm?.controller ?? ''), Boolean(perm?.tapped), perm?.counters || {}, pt ? [pt.power, pt.toughness] : null,
    keywords, perm?.attachedTo ?? null, Boolean(perm?.isToken), Boolean(perm?.faceDown), Boolean(perm?.phasedOut),
    Number(perm?.damage ?? perm?.markedDamage ?? 0), String(perm?.card?.type_line ?? ''), String(perm?.card?.name ?? ''),
    Boolean(perm?.goaded || (Array.isArray(perm?.goadedBy) && perm.goadedBy.length)),
    safe(() => isCreatureNow(perm), null), safe(() => [...getCreatureTypesNow(perm)].sort(), null),
  ]));
}

function poolTotal(pool: any): number {
  if (!pool || typeof pool !== 'object') return 0;
  const long = ['white', 'blue', 'black', 'red', 'green', 'colorless'];
  const short = ['W', 'U', 'B', 'R', 'G', 'C'];
  const sum = (keys: string[]) => keys.reduce((acc, key) => acc + (Number(pool[key]) || 0), 0);
  return Math.max(sum(long), sum(short));
}

export function takeSweepSnapshot(game: any): SweepSnapshot {
  const state = game?.state || {};
  const battlefield: any[] = Array.isArray(state.battlefield) ? state.battlefield : [];
  const snap: SweepSnapshot = { life: {}, zones: {}, perms: {}, mana: {}, players: {}, misc: {} };
  const playerIds = (Array.isArray(state.players) ? state.players : []).map((p: any) => String(p?.id ?? ''));
  for (const pid of playerIds) {
    snap.life[pid] = Number(state.life?.[pid] ?? state.players.find((p: any) => p.id === pid)?.life ?? 0);
    const zones = state.zones?.[pid] || {};
    for (const zone of ZONES) {
      let cards = zones[zone];
      if (zone === 'library' && game?.libraries instanceof Map && Array.isArray(game.libraries.get(pid))) cards = game.libraries.get(pid);
      if (!Array.isArray(cards)) continue;
      snap.zones[`${pid}.${zone}`] = cards.map(cardIdOf);
    }
    snap.mana[pid] = poolTotal(state.manaPool?.[pid]);
    const player = state.players.find((p: any) => String(p?.id) === pid) || {};
    for (const [key, value] of Object.entries(player)) {
      if (key === 'life' || key === 'id' || key === 'name' || ZONES.includes(key) || /Count$|pass|priority|connected|socket|lastSeen/i.test(key)) continue;
      snap.players[`${pid}.${key}`] = digest(stable(value));
    }
  }
  for (const perm of battlefield) {
    const fields: Record<string, string> = {};
    for (const [key, value] of Object.entries(perm || {})) {
      if (PERM_FIELD_SKIP.has(key) || PERM_FIELD_SKIP_RE.test(key) || /ThisTurn|^_|At$/.test(key) || typeof value === 'function') continue;
      fields[key] = digest(stable(value));
    }
    snap.perms[String(perm?.id)] = { cardId: String(perm?.card?.id ?? ''), name: String(perm?.card?.name ?? ''), sig: permSig(perm, state, battlefield), fields };
  }
  for (const [key, value] of Object.entries(state)) {
    // Per-turn trackers (cards put into graveyards, spells cast, ...) move with the cast itself.
    if (SNAPSHOT_IGNORED_TOP_KEYS.has(key) || typeof value === 'function') continue;
    snap.misc[key] = digest(stable(value));
  }
  return snap;
}

export type SweepDiffOptions = {
  /** Card ids whose own zone moves / battlefield entry or exit are expected (the swept card itself). */
  ignoreCardIds?: Iterable<string>;
  /** Ignore the tapped flag of this permanent (activation cost) by comparing without it. */
  ignoreSigOfPermId?: string;
};

export function diffSweepSnapshots(before: SweepSnapshot, after: SweepSnapshot, options: SweepDiffOptions = {}): SweepDiff {
  const ignore = new Set<string>(options.ignoreCardIds || []);
  const strong: string[] = [];
  const weak: string[] = [];
  const ignored: string[] = [];
  for (const pid of new Set([...Object.keys(before.life), ...Object.keys(after.life)])) {
    if (before.life[pid] !== after.life[pid]) strong.push(`life:${pid} ${before.life[pid]}->${after.life[pid]}`);
  }
  for (const zone of new Set([...Object.keys(before.zones), ...Object.keys(after.zones)])) {
    const a = (before.zones[zone] || []).filter((id) => !ignore.has(id));
    const b = (after.zones[zone] || []).filter((id) => !ignore.has(id));
    const setA = new Set(a);
    const setB = new Set(b);
    const added = b.filter((id) => !setA.has(id));
    const removed = a.filter((id) => !setB.has(id));
    if (added.length || removed.length) strong.push(`zone:${zone} +${added.length} -${removed.length}`);
    else if (a.join('|') !== b.join('|')) strong.push(`zone:${zone} reordered`);
  }
  for (const [id, perm] of Object.entries(after.perms)) {
    const prior = before.perms[id];
    if (!prior) {
      if (!ignore.has(perm.cardId)) strong.push(`perm:+${perm.name}`);
      continue;
    }
    if (prior.sig !== perm.sig && id !== options.ignoreSigOfPermId) strong.push(`perm:~${perm.name}`);
    if (id !== options.ignoreSigOfPermId) {
      for (const key of new Set([...Object.keys(prior.fields || {}), ...Object.keys(perm.fields || {})])) {
        if (changedMeaningfully((prior.fields || {})[key], (perm.fields || {})[key]) && !weak.includes(`permfield:${key}`)) weak.push(`permfield:${key}`);
      }
    }
  }
  for (const [id, perm] of Object.entries(before.perms)) {
    if (!after.perms[id] && !ignore.has(perm.cardId)) strong.push(`perm:-${perm.name}`);
  }
  let manaGain = false;
  for (const pid of Object.keys(after.mana)) {
    if ((after.mana[pid] ?? 0) > (before.mana[pid] ?? 0)) {
      manaGain = true;
      strong.push(`mana:${pid} +${after.mana[pid] - (before.mana[pid] ?? 0)}`);
    }
  }
  for (const key of new Set([...Object.keys(before.players), ...Object.keys(after.players)])) {
    if (changedMeaningfully(before.players[key], after.players[key])) weak.push(`player:${key}`);
  }
  for (const key of new Set([...Object.keys(before.misc), ...Object.keys(after.misc)])) {
    if (!changedMeaningfully(before.misc[key], after.misc[key])) continue;
    (IGNORED_TOP_KEY_RE.test(key) ? ignored : weak).push(`state:${key}`);
  }
  return { strong, weak, ignored, manaGain };
}
