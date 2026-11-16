// server/src/state/modules/staticEffectSpec-handlers/batch97LongTailStatics.ts
// B97 leftover statics: Ghostly Flame color-source, Diligent Farmhand
// name-as, Leonin Shikari instant-speed equip, Instill Energy as-though
// haste, Edgar first-flip (replacement is collected separately). Public:
// parseBatch97LongTailStaticKind, pushBatch97LongTailStaticSpecs,
// ghostlyFlameDamageSourceIsColorless, graveyardCardCountsAsName,
// countCardsNamedInGraveyards.

import type { StaticEffectSpec } from '../staticEffectSpecTypes.js';
import { buildSpec, type StaticEffectSpecSource } from './staticEffectSpecOracleParseHelpers.js';
import { normalizeOraclePatternText } from '../replacementEffectSpec-handlers/replacementEffectSpecOracleTextUtils.js';

const COLOR_WORDS: Record<string, string> = {
  white: 'W', blue: 'U', black: 'B', red: 'R', green: 'G',
};

const FLAME_RE = /((?:white|blue|black|red|green)(?: and\/or (?:white|blue|black|red|green))*) permanents and spells are (colorless|white|blue|black|red|green) sources of damage/i;
const FARMHAND_RE = /if this card is in a graveyard, effects from spells named (.+?) count it as a card named \1/i;
const INSTANT_EQUIP_RE = /you may activate equip abilities any time you could cast an instant/i;
const ATTACK_AS_THOUGH_HASTE_RE = /(?:enchanted|equipped) creature can attack as though it had haste/i;
const EDGAR_RE = /the first time you flip (?:one or more|\d+ or more|one|a coin|coins) coins? each turn, those coins come up heads and you win those flips/i;
const LEATHER_ONCE_RE = /^equip \{[^}]+\}\. activate only once each turn/i;
const WORTHY_EQUIP_RE = /^equip worthy \{[^}]+\}/i;

function norm(oracle: string): string {
  return normalizeOraclePatternText(String(oracle || '')).replace(/\u2019/g, "'");
}

export function parseBatch97LongTailStaticKind(oracle: string): string[] {
  const text = norm(oracle);
  const kinds: string[] = [];
  if (FLAME_RE.test(text)) kinds.push('color-permanents-are-color-damage-sources');
  if (FARMHAND_RE.test(text)) kinds.push('graveyard-counts-as-named-card');
  if (INSTANT_EQUIP_RE.test(text)) kinds.push('equip-at-instant-speed');
  if (ATTACK_AS_THOUGH_HASTE_RE.test(text)) kinds.push('attached-attack-as-though-haste');
  if (EDGAR_RE.test(text)) kinds.push('first-coin-flips-this-turn-heads-and-win');
  if (LEATHER_ONCE_RE.test(text.trim())) kinds.push('equip-activate-only-once-each-turn');
  if (WORTHY_EQUIP_RE.test(text.trim())) kinds.push('equip-worthy');
  return kinds;
}

export function pushBatch97LongTailStaticSpecs(
  specs: StaticEffectSpec[],
  source: StaticEffectSpecSource,
  _perm: unknown,
  oracle: string,
): void {
  for (const kind of parseBatch97LongTailStaticKind(oracle)) {
    const scope = kind === 'equip-worthy' || kind === 'equip-activate-only-once-each-turn' || kind === 'attached-attack-as-though-haste'
      ? { kind: 'self' as const }
      : { kind: 'player_you' as const };
    specs.push(buildSpec(source, kind, scope, { abilities: [kind.replace(/-/g, '_')] }));
  }
}

function sourceColors(source: any): string[] {
  const raw = source?.card?.colors || source?.colors || source?.card?.color_identity || [];
  if (Array.isArray(raw) && raw.length) return raw.map((c: any) => String(c).toUpperCase());
  const cost = String(source?.card?.mana_cost || source?.mana_cost || '').toUpperCase();
  return ['W', 'U', 'B', 'R', 'G'].filter((c) => cost.includes(`{${c}}`) || cost.includes(c));
}

export function parseGhostlyFlameColorSource(oracle: string): { from: string[]; into: string | 'colorless' } | null {
  const text = norm(oracle);
  const m = text.match(FLAME_RE);
  if (!m) return null;
  const from: string[] = [];
  for (const [word, code] of Object.entries(COLOR_WORDS)) {
    if (new RegExp(`\\b${word}\\b`, 'i').test(m[1])) from.push(code);
  }
  const intoWord = String(m[2] || 'colorless').toLowerCase();
  const into = intoWord === 'colorless' ? 'colorless' : (COLOR_WORDS[intoWord] || 'colorless');
  return { from, into };
}

/** True when Ghostly Flame (or a generic color-source static) makes this source colorless for damage. */
export function ghostlyFlameDamageSourceIsColorless(source: any, state: any): boolean {
  const colors = sourceColors(source);
  if (!colors.length) return false;
  const battlefield: any[] = Array.isArray(state?.battlefield) ? state.battlefield : [];
  for (const perm of battlefield) {
    if (!perm || perm.phasedOut === true) continue;
    const parsed = parseGhostlyFlameColorSource(String(perm.card?.oracle_text || perm.oracle_text || ''));
    if (!parsed || parsed.into !== 'colorless') continue;
    if (parsed.from.some((c) => colors.includes(c))) return true;
  }
  return false;
}

export function parseGraveyardCountsAsName(oracle: string): string | null {
  const m = norm(oracle).match(FARMHAND_RE);
  return m ? String(m[1] || '').trim() : null;
}

function cardNameOf(card: any): string {
  return String(card?.card?.name || card?.name || '').trim();
}

/** True when a graveyard card should be counted as `wantedName` (its own name, or a Farmhand-style alias). */
export function graveyardCardCountsAsName(card: any, wantedName: string): boolean {
  const wanted = String(wantedName || '').trim().toLowerCase();
  if (!wanted || !card) return false;
  if (cardNameOf(card).toLowerCase() === wanted) return true;
  const alias = parseGraveyardCountsAsName(String(card?.card?.oracle_text || card?.oracle_text || ''));
  return alias ? alias.toLowerCase() === wanted : false;
}

export function countCardsNamedInGraveyards(state: any, wantedName: string): number {
  let n = 0;
  const zones = state?.zones && typeof state.zones === 'object' ? state.zones : {};
  for (const key of Object.keys(zones)) {
    const gy = zones[key]?.graveyard;
    if (!Array.isArray(gy)) continue;
    for (const card of gy) if (graveyardCardCountsAsName(card, wantedName)) n += 1;
  }
  const players = Array.isArray(state?.players) ? state.players : [];
  for (const player of players) {
    const gy = player?.graveyard;
    if (!Array.isArray(gy)) continue;
    const already = zones[String(player.id || '')]?.graveyard;
    if (already === gy) continue;
    for (const card of gy) if (graveyardCardCountsAsName(card, wantedName)) n += 1;
  }
  return n;
}
