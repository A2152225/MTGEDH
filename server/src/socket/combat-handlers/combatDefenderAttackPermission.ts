// Batch 15: "can attack as though it/they didn't have defender" (CR 702.3b) and "Cowards can't block Warriors".
// Replaces the old blanket substring check, which let a self-only or conditional grant (Bristlepack Sentry,
// Skyclave Sentinel) free every defender its controller had.
import { sanitizeOracleTextForStaticEffectScan } from "../../../../rules-engine/src/staticEffectOracleSanitize.js";
import { permanentHasCreatureType } from "../../../../shared/src/creatureTypes.js";
import { getEffectivePower } from "../util-handlers/getEffectivePowerToughness.js";

function escapeRe(v: string): string { return v.replace(/[.*+?^${}()|[\]\\]/g, (c) => '\\' + c); }

/** Lowercased sentences with the card's name, short name and "this creature" replaced by "~". */
export function defenderScanSentences(perm: any): string[] {
  const raw = String(perm?.card?.oracle_text || '');
  if (!raw) return [];
  let text = sanitizeOracleTextForStaticEffectScan(raw).toLowerCase().replace(/[\u2018\u2019]/g, "'");
  const name = String(perm?.card?.name || '').split('//')[0].trim().toLowerCase();
  for (const n of [name, name.split(',')[0].trim()]) {
    if (n.length >= 3) text = text.replace(new RegExp('\\b' + escapeRe(n) + '\\b', 'g'), '~');
  }
  text = text.replace(/\bthis (?:creature|permanent|artifact)\b/g, '~');
  return text.split(/\r?\n|(?<=\.)\s+/).map((s) => s.replace(/\.$/, '').trim()).filter(Boolean);
}

function countersOf(perm: any): Record<string, number> {
  return (perm?.counters && typeof perm.counters === 'object') ? perm.counters : {};
}

/** Evaluates the supported "as long as ..." conditions. Unknown conditions return false (conservative). */
export function evaluateDefenderCondition(cond: string, source: any, battlefield: any[], controllerId: string, gameState?: any): boolean {
  let m = cond.match(/^you control (?:a|another) creature with power (\d+) or greater$/);
  if (m) {
    const n = Number(m[1]);
    const other = cond.startsWith('you control another');
    return battlefield.some((p) => p && p.controller === controllerId
      && /creature/i.test(String(p.card?.type_line || ''))
      && (!other || p.id !== source?.id)
      && getEffectivePower(p, gameState) >= n);
  }
  if (cond === '~ has a counter on it') return Object.values(countersOf(source)).some((n) => Number(n) > 0);
  m = cond.match(/^you control an? ([a-z]+)$/);
  if (m) {
    const word = m[1];
    return battlefield.some((p) => p && p.controller === controllerId && p.id !== source?.id
      && String(p.card?.type_line || '').toLowerCase().split(/[^a-z]+/).includes(word));
  }
  m = cond.match(/^~ has an? ([+-]\d+\/[+-]\d+|[a-z]+) counter on it$/);
  if (m) return Number(countersOf(source)[m[1]] || 0) > 0;
  return false;
}

const SELF_RE = /^(?:as long as (.+?), )?(?:~|it) can attack as though it didn't have defender(?: as long as (.+))?$/;
const GLOBAL_RE = /^(?:as long as (.+?), )?(?:creatures you control|each creature you control) can attack as though (?:they|it) didn't have defender$/;

/**
 * True when some static ability lets `permanent` attack despite defender.
 * Activated abilities (text containing ':') keep the legacy behaviour (treated as always on) until their
 * resolution grants an until-end-of-turn permission.
 */
/** Batch 24: Weathered Sentinels - "~ can attack players who attacked you during their last turn as though it didn't have defender". */
const LAST_TURN_ATTACKERS_RE = /^~ can attack players who attacked you during their last turn as though it didn't have defender$/;

function hasLastTurnAttackersPermission(permanent: any): boolean {
  return defenderScanSentences(permanent).some((s) => LAST_TURN_ATTACKERS_RE.test(s));
}

/** Players whose most recent turn included an attack on `controllerId` (attackedPlayersLastTurnByPlayer). */
export function playersWhoAttackedYouLastTurn(gameState: unknown, controllerId: string): string[] {
  const map: unknown = gameState && typeof gameState === 'object' ? Reflect.get(gameState, 'attackedPlayersLastTurnByPlayer') : undefined;
  if (!map || typeof map !== 'object') return [];
  return Object.entries(map)
    .filter(([pid, list]) => pid !== controllerId && Array.isArray(list) && list.map(String).includes(controllerId))
    .map(([pid]) => pid);
}

function hasDefenderKeyword(permanent: any): boolean {
  const kws = Array.isArray(permanent?.card?.keywords) ? permanent.card.keywords : [];
  if (kws.some((k: unknown) => String(k).toLowerCase() === 'defender')) return true;
  return /(?:^|\n|,\s*)defender\b/i.test(String(permanent?.card?.oracle_text || ''));
}

/**
 * Per-defending-player restriction for a defender whose only permission is the last-turn-attackers one.
 * Returns a reason when `defendingPlayerId` did not attack the controller during their last turn.
 */
export function defenderAttackTargetRestrictionReason(
  permanent: any,
  defendingPlayerId: string | undefined,
  battlefield: readonly any[],
  gameState?: unknown,
): string | null {
  if (!defendingPlayerId || !hasLastTurnAttackersPermission(permanent) || !hasDefenderKeyword(permanent)) return null;
  const controllerId = String(permanent?.controller || '');
  if (canAttackDespiteDefenderUnrestricted(permanent, [...battlefield], controllerId, gameState)) return null;
  if (playersWhoAttackedYouLastTurn(gameState, controllerId).includes(String(defendingPlayerId))) return null;
  return `${permanent?.card?.name || 'This creature'} can attack only players who attacked you during their last turn`;
}

export function canAttackDespiteDefender(permanent: any, battlefield: any[], controllerId: string, gameState?: any): boolean {
  if (canAttackDespiteDefenderUnrestricted(permanent, battlefield, controllerId, gameState)) return true;
  return hasLastTurnAttackersPermission(permanent) && playersWhoAttackedYouLastTurn(gameState, controllerId).length > 0;
}

function canAttackDespiteDefenderUnrestricted(permanent: any, battlefield: any[], controllerId: string, gameState?: any): boolean {
  const granted = Array.isArray(permanent?.grantedAbilities) ? permanent.grantedAbilities : [];
  if (granted.some((a: unknown) => String(a).toLowerCase().includes('can attack'))) return true;
  const temps = Array.isArray(permanent?.temporaryEffects) ? permanent.temporaryEffects : [];
  if (temps.some((e: any) => /didn['\u2019]t have defender/i.test(String(e?.description || e?.effect || '')))) return true;
  for (const perm of battlefield || []) {
    if (!perm?.card?.oracle_text || perm.controller !== controllerId) continue;
    for (const s of defenderScanSentences(perm)) {
      if (!s.includes("didn't have defender")) continue;
      // Batch 16: activated grants (Assault Formation, "{X}: ... can attack this turn as though ...") only
      // apply once they resolve, via the target's temporaryEffects (expiresAt end_of_turn).
      if (s.includes(':')) continue;
      let m = s.match(GLOBAL_RE);
      if (m && (!m[1] || evaluateDefenderCondition(m[1], perm, battlefield, controllerId, gameState))) return true;
      m = s.match(SELF_RE);
      const selfCond = m ? (m[1] || m[2]) : undefined;
      if (m && perm.id === permanent?.id
        && (!selfCond || evaluateDefenderCondition(selfCond, perm, battlefield, controllerId, gameState))) return true;
    }
  }
  return false;
}

/** "Cowards can't block Warriors." (Kargan Intimidator and friends): applies globally while the source is out. */
export function cowardsCantBlockWarriorsReason(blocker: any, attacker: any, battlefield: any[]): string | null {
  if (!permanentHasCreatureType(blocker, 'Coward') || !permanentHasCreatureType(attacker, 'Warrior')) return null;
  const src = (battlefield || []).find((p) => p && p.phasedOut !== true
    && /\bcowards can['\u2019]t block warriors\b/i.test(String(p.card?.oracle_text || '')));
  return src ? `Cowards can't block Warriors (${src.card?.name || 'effect'})` : null;
}