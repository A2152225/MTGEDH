// client/src/utils/combatBlockLimits.ts
// UI31: client mirrors of server Batch 30 block statics for the blocker picker.
// Server origins: combatBatch30BlockLimits.ts (getMaximumBlockers),
//   combatBatch30AttachedBlockRestrictions.ts (attachedBlockOnlyFlyingReason).
//   combatBatch31BlockRestrictions.ts (artifactOrColorBlockOnlyReason), combatBatch30AttackRestrictions.ts (graveyard gate).
// Public entry symbols: getMaximumBlockers, blockOnlyFlyingRestricted, artifactOrColorBlockOnlyReason, graveyardAttackGateReason.

import type { BattlefieldPermanent } from '../../../shared/src';

const WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5 };
const MAX_RE = /can't be blocked by more than (\d+|one|two|three|four|five) creatures?/;
const TEAM_RE = /(?:each creature|creatures) you control can't be blocked by more than (\d+|one|two|three|four|five) creatures?/;
const ATTACHED_ONLY_FLYING_RE = /(?:enchanted|equipped) creature can block only creatures with flying/;
const SELF_ONLY_FLYING_RE = /^(?:this creature|[^.]*?) can block only creatures with flying/;

function textOf(perm: any): string {
  return String(perm?.card?.oracle_text || perm?.oracle_text || '').replace(/\u2019/g, "'").toLowerCase();
}
function toNum(word: string): number {
  return /^\d+$/.test(word) ? Number(word) : (WORDS[word] ?? Infinity);
}

/** Smallest blocker cap on the attacker (Infinity = no cap). */
export function getMaximumBlockers(attacker: BattlefieldPermanent, battlefield: readonly BattlefieldPermanent[]): number {
  let max = Infinity;
  for (const line of textOf(attacker).split(/\n+/)) {
    if (TEAM_RE.test(line)) continue;
    const m = line.match(MAX_RE);
    if (m) max = Math.min(max, toNum(m[1]));
  }
  const controller = String((attacker as any)?.controller || '');
  for (const perm of battlefield || []) {
    if (!perm || String((perm as any).controller || '') !== controller) continue;
    for (const line of textOf(perm).split(/\n+/)) {
      const m = line.match(TEAM_RE);
      if (m) max = Math.min(max, toNum(m[1]));
    }
  }
  return max;
}

/** Blocker can block only fliers (own text, or an attached Aura/Equipment such as Air Bladder). */
export function blockOnlyFlyingRestricted(blocker: BattlefieldPermanent, battlefield: readonly BattlefieldPermanent[]): boolean {
  if (textOf(blocker).split(/\n+/).some((line) => SELF_ONLY_FLYING_RE.test(line) && !ATTACHED_ONLY_FLYING_RE.test(line))) return true;
  const id = String((blocker as any)?.id || '');
  if (!id) return false;
  return (battlefield || []).some((perm: any) =>
    perm && perm !== blocker && String(perm.attachedTo || '') === id && ATTACHED_ONLY_FLYING_RE.test(textOf(perm)));
}

const COLOR_CODE: Record<string, string> = { white: 'W', blue: 'U', black: 'B', red: 'R', green: 'G' };
const ARTIFACT_OR_COLOR_RE = /can't be blocked except by artifact creatures and\/or (white|blue|black|red|green) creatures/;

function colorCodes(perm: any): string[] {
  const card = perm?.card || {};
  const raw = Array.isArray(card.colors) ? card.colors : Array.isArray(perm?.colors) ? perm.colors : null;
  if (raw) return raw.map((c: any) => { const k = String(c).toLowerCase(); return k.length === 1 ? k.toUpperCase() : (COLOR_CODE[k] || ''); });
  const cost = String(card.mana_cost || '').toUpperCase();
  return ['W', 'U', 'B', 'R', 'G'].filter((c) => cost.includes('{' + c) || cost.includes(c + '}'));
}

/** Amrou Seekers / Skirk Shaman: short reason when the blocker is neither an artifact nor the named color. */
export function artifactOrColorBlockOnlyReason(blocker: BattlefieldPermanent, attacker: BattlefieldPermanent): string | null {
  const m = textOf(attacker).match(ARTIFACT_OR_COLOR_RE);
  if (!m) return null;
  const typeLine = String((blocker as any)?.card?.type_line || (blocker as any)?.type_line || '').toLowerCase();
  if (typeLine.includes('artifact')) return null;
  if (colorCodes(blocker).includes(COLOR_CODE[m[1]])) return null;
  return 'Only artifact or ' + m[1] + ' creatures can block';
}

const NUM_WORDS: Record<string, number> = { ...WORDS, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
const GY_RE = /can't attack unless there are (\d+|[a-z]+) or more cards in your graveyard/;

/** Deep-Sea Terror / River Serpent: reason when the controller's graveyard is too small (null = may attack or unknown). */
export function graveyardAttackGateReason(creature: BattlefieldPermanent, zones: Record<string, any> | undefined): string | null {
  const m = textOf(creature).match(GY_RE);
  if (!m || !zones) return null;
  const need = /^\d+$/.test(m[1]) ? Number(m[1]) : NUM_WORDS[m[1]];
  const z = zones[String((creature as any)?.controller || '')];
  if (!Number.isFinite(need) || !z) return null;
  const have = Array.isArray(z.graveyard) ? z.graveyard.length : Number(z.graveyardCount || 0);
  return have >= need ? null : 'Needs ' + need + '+ cards in graveyard to attack';
}
