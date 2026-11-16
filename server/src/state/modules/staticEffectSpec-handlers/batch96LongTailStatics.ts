// server/src/state/modules/staticEffectSpec-handlers/batch96LongTailStatics.ts
// B96 long-tail statics: Gemcutter Buccaneer, Ashes of the Fallen, Diligent
// Zookeeper, The Muckslinger Gang, Meatsqueak, Yurlok, Spark Rupture.
// Public: parseBatch96LongTailStaticKind, pushBatch96LongTailStaticSpecs,
// diligentZookeeperPump, meatsqueakSquirrelPump, muckslingerOffBattlefieldPump,
// ashesAddedCreatureTypeForGraveyardCard, gemcutterTreasureIsEquipment,
// sparkRupturePlaneswalkerCreaturePT, BATCH96_LAYER4_SPECS.

import type { StaticEffectSpec } from '../staticEffectSpecTypes.js';
import { buildSpec, type StaticEffectSpecSource } from './staticEffectSpecOracleParseHelpers.js';
import { normalizeOraclePatternText } from '../replacementEffectSpec-handlers/replacementEffectSpecOracleTextUtils.js';

const GEMCUTTER_RE = /treasures you control are equipment in addition to their other types/i;
const ASHES_RE = /each creature card in your graveyard has the chosen creature type in addition to its other types/i;
const ZOOKEEPER_RE = /each non-?human creature you control gets ([+-]\d+)\/([+-]\d+) for each of its creature types(?:,? to a maximum of (\d+))?/i;
const MUCK_RE = /creature spells you control and creature cards you own in any zone other than the battlefield or the stack get ([+-]\d+)\/([+-]\d+)/i;
const WORD_NUM: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
const MEAT_RE = /for every (seven|eight|nine|ten|one|two|three|four|five|six|n|\d+) foods? you control, ([a-z]+)s? you control get ((?:[+-]\d+|\u00b1n))\/((?:[+-]\d+|\u00b1n))/i;
const YURLOK_RE = /a player losing unspent mana causes that player to lose that much life/i;
const SPARK_RE = /each planeswalker with (?:one or more|1 or more|\d+\+) loyalty counters? on it loses all abilities and is a creature with power and toughness each equal to the number of loyalty counters? on it/i;

export function parseBatch96LongTailStaticKind(oracle: string): string[] {
  const text = normalizeOraclePatternText(String(oracle || '')).replace(/\u2019/g, "'");
  const kinds: string[] = [];
  if (GEMCUTTER_RE.test(text)) kinds.push('treasures-are-equipment-with-equip');
  if (ASHES_RE.test(text)) kinds.push('graveyard-creatures-have-chosen-type');
  if (ZOOKEEPER_RE.test(text)) kinds.push('nonhuman-plus-per-creature-type-capped');
  if (MUCK_RE.test(text)) kinds.push('off-battlefield-creature-cards-pt');
  if (MEAT_RE.test(text)) kinds.push('for-every-n-foods-type-gets-pt');
  if (YURLOK_RE.test(text)) kinds.push('losing-unspent-mana-loses-that-much-life');
  if (SPARK_RE.test(text)) kinds.push('planeswalkers-with-loyalty-are-creatures');
  return kinds;
}

export function pushBatch96LongTailStaticSpecs(
  specs: StaticEffectSpec[],
  source: StaticEffectSpecSource,
  _perm: unknown,
  oracle: string,
): void {
  for (const kind of parseBatch96LongTailStaticKind(oracle)) {
    const scope = kind === 'losing-unspent-mana-loses-that-much-life'
      ? { kind: 'player_you' as const }
      : kind === 'graveyard-creatures-have-chosen-type'
        ? { kind: 'player_you' as const }
        : kind === 'off-battlefield-creature-cards-pt'
          ? { kind: 'player_you' as const }
          : kind === 'for-every-n-foods-type-gets-pt' || kind === 'nonhuman-plus-per-creature-type-capped'
            ? { kind: 'creatures_you_control' as const }
            : kind === 'treasures-are-equipment-with-equip'
              ? { kind: 'creatures_you_control' as const }
              : { kind: 'all_creatures' as const };
    specs.push(buildSpec(source, kind, scope, { abilities: [kind.replace(/-/g, '_')] }));
  }
}

function typeLineOf(obj: any): string {
  return String(obj?.card?.type_line || obj?.type_line || obj?.typeLine || '').toLowerCase();
}

function creatureTypesOf(typeLine: string): string[] {
  const line = String(typeLine || '');
  const dash = line.includes('\u2014') ? '\u2014' : (line.includes('—') ? '—' : (line.includes(' - ') ? ' - ' : (line.includes(' — ') ? ' — ' : null)));
  const subtypes = dash ? line.split(dash, 2)[1] || '' : '';
  if (!subtypes && /\bcreature\b/.test(line)) {
    return line.split(/\s+/).filter((w) => w && !['legendary', 'creature', 'artifact', 'enchantment', 'land', 'snow', 'token'].includes(w));
  }
  return subtypes.split(/[\s\/]+/).map((w) => w.trim().toLowerCase()).filter((w) => w && w !== 'creature');
}

export function diligentZookeeperPump(permanent: any, oracle?: string): { power: number; toughness: number } | null {
  const text = normalizeOraclePatternText(String(oracle || permanent?.card?.oracle_text || ''));
  const m = text.replace(/\u2019/g, "'").match(ZOOKEEPER_RE);
  // Applied to a non-Human creature, not to the zookeeper source itself unless it is non-Human.
  const tl = typeLineOf(permanent);
  if (!/\bcreature\b/.test(tl) || /\bhuman\b/.test(tl)) return null;
  const plus = m ? parseInt(m[1], 10) : 1;
  const cap = m && m[3] ? parseInt(m[3], 10) : 10;
  const count = Math.min(cap, creatureTypesOf(tl).length);
  const p = (Number.isFinite(plus) ? plus : 1) * count;
  return { power: p, toughness: p };
}

export function meatsqueakSquirrelPump(
  permanent: any,
  battlefield: any[],
  controllerId: string,
  oracle?: string,
): { power: number; toughness: number } | null {
  const text = normalizeOraclePatternText(String(oracle || '')).replace(/\u2019/g, "'");
  const m = text.match(MEAT_RE);
  if (!m) return null;
  const everyRaw = String(m[1] || '7').toLowerCase();
  const every = (WORD_NUM[everyRaw] ?? (everyRaw === 'n' ? 7 : parseInt(everyRaw, 10))) || 7;
  const type = String(m[2] || 'squirrel').toLowerCase().replace(/s$/, '');
  const plusRaw = String(m[3] || '3');
  const plus = parseInt(plusRaw, 10) || 3;
  const tl = typeLineOf(permanent);
  if (!new RegExp(`\\b${type}s?\\b`).test(tl)) return null;
  const foods = (battlefield || []).filter((p: any) => {
    if (!p || p.phasedOut === true || String(p.controller || '') !== String(controllerId)) return false;
    return /\bfood\b/.test(typeLineOf(p));
  }).length;
  const times = Math.floor(foods / every);
  return { power: plus * times, toughness: plus * times };
}

export function muckslingerOffBattlefieldPump(oracle?: string): { power: number; toughness: number } | null {
  const text = normalizeOraclePatternText(String(oracle || '')).replace(/\u2019/g, "'");
  const m = text.match(MUCK_RE);
  if (!m) return null;
  return { power: parseInt(m[1], 10) || 3, toughness: parseInt(m[2], 10) || 3 };
}

export function ashesAddedCreatureTypeForGraveyardCard(state: any, playerId: string, card: any): string | null {
  if (!card) return null;
  const tl = typeLineOf(card);
  if (!/\bcreature\b/.test(tl)) return null;
  const battlefield: any[] = Array.isArray(state?.battlefield) ? state.battlefield : [];
  for (const perm of battlefield) {
    if (!perm || perm.phasedOut === true || String(perm.controller || '') !== String(playerId)) continue;
    const oracle = String(perm.card?.oracle_text || perm.oracle_text || '');
    if (!ASHES_RE.test(normalizeOraclePatternText(oracle))) continue;
    const chosen = String(perm.chosenCreatureType || perm.card?.chosenCreatureType || '').trim();
    if (chosen) return chosen;
  }
  return null;
}

export function gemcutterTreasureIsEquipment(permanent: any, state: any): boolean {
  if (!/\btreasure\b/.test(typeLineOf(permanent))) return false;
  const controller = String(permanent?.controller || '');
  const battlefield: any[] = Array.isArray(state?.battlefield) ? state.battlefield : [];
  return battlefield.some((src: any) => {
    if (!src || src.phasedOut === true || String(src.controller || '') !== controller) return false;
    return GEMCUTTER_RE.test(normalizeOraclePatternText(String(src.card?.oracle_text || '')));
  });
}

export function sparkRupturePlaneswalkerCreaturePT(permanent: any, state: any): { power: number; toughness: number } | null {
  const tl = typeLineOf(permanent);
  if (!/\bplaneswalker\b/.test(tl)) return null;
  const loyalty = Number(permanent?.loyalty ?? permanent?.counters?.loyalty ?? permanent?.card?.loyalty ?? 0);
  if (!Number.isFinite(loyalty) || loyalty < 1) return null;
  const battlefield: any[] = Array.isArray(state?.battlefield) ? state.battlefield : [];
  const active = battlefield.some((src: any) => {
    if (!src || src.phasedOut === true) return false;
    return SPARK_RE.test(normalizeOraclePatternText(String(src.card?.oracle_text || '')));
  });
  if (!active) return null;
  return { power: loyalty, toughness: loyalty };
}

function loyaltyOf(perm: any): number {
  const n = Number(perm?.loyalty ?? perm?.counters?.loyalty ?? perm?.card?.loyalty ?? 0);
  return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
}

export const BATCH96_LAYER4_SPECS = [
  {
    re: SPARK_RE,
    build: (_source: any) => ({
      addTypes: ['Creature'],
      basePT: (perm: any) => {
        const n = loyaltyOf(perm);
        return { power: n, toughness: n };
      },
      appliesTo: (perm: any) => /\bplaneswalker\b/.test(typeLineOf(perm)) && loyaltyOf(perm) >= 1,
    }),
  },
  {
    re: GEMCUTTER_RE,
    build: (source: any) => ({
      addTypes: ['Equipment'],
      appliesTo: (perm: any) => {
        if (!perm || String(perm.controller || '') !== String(source?.controller || '')) return false;
        return /\btreasure\b/.test(typeLineOf(perm));
      },
    }),
  },
];
