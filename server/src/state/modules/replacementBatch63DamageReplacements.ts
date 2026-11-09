// server/src/state/modules/replacementBatch63DamageReplacements.ts
// B63 damage replacements:
//   Thunderstaff ? as long as ~ is untapped, if a creature would deal combat damage to you, prevent N
//   Weeping Angel ? if ~ would deal combat damage to a creature, prevent and owner shuffles it into library
// Public: parseBatch63DamagePreventionSentence, applyBatch63DamageSideEffects,
//         collectBatch63DamageSideEffectSpecsFromState.

import type { ReplacementEffectSpec } from './replacementEffectSpec-handlers/replacementEffectSpecTypes.js';
import { readCardOracleText } from './replacementEffectSpec-handlers/replacementEffectSpecOracleTextUtils.js';
import { selfReferenceSentences } from './replacementEffectSpec-handlers/replacementEffectSpecDamagePreventionOracleTemplates.js';

const NUMBER_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
};
function readAmount(raw: string): number | null {
  const n = /^\d+$/.test(raw) ? Number(raw) : NUMBER_WORDS[raw];
  return Number.isFinite(n) ? n : null;
}

type SpecBody = Omit<ReplacementEffectSpec, 'id' | 'sourcePermanentId' | 'sourceController' | 'sourceName'>;

const THUNDERSTAFF_RE =
  /^(?:as long as (?:~|this artifact|this permanent) is untapped, )?if a creature would deal combat damage to you, prevent (\d+|[a-z]+) of that damage$/;
const WEEPING_RE =
  /^if ~ would deal combat damage to a creature, prevent that damage and that creature's owner shuffles it into their library$/;

/** Thunderstaff-family amount prevention (also used from damage-prevention oracle parser). */
export function parseBatch63DamagePreventionSentence(sentence: string): SpecBody[] {
  const s = String(sentence || '').toLowerCase().replace(/\u2019/g, "'").trim().replace(/\.$/, '');
  const m = s.match(THUNDERSTAFF_RE);
  if (!m) return [];
  const amount = readAmount(m[1]);
  if (amount == null) return [];
  const requiresUntapped = /^as long as (?:~|this artifact|this permanent) is untapped,/.test(s);
  return [{
    event: 'damage',
    match: {
      receivingIsPlayerOnly: true,
      receivingPlayerIsSourceController: true,
      combatDamageOnly: true,
      damageSourceIsCreature: true,
    },
    instead: { modify: 'add_flat', value: -amount },
    effectId: `prevent-${amount}-creature-combat-damage-to-you`,
    reason: 'prevent_n_creature_combat_damage_to_you',
    ...(requiresUntapped ? { metadata: { requiresSourceUntapped: true } } : {}),
  }];
}

export function collectBatch63DamageSideEffectSpecsFromState(state: unknown): ReplacementEffectSpec[] {
  const specs: ReplacementEffectSpec[] = [];
  const battlefield = Array.isArray((state as any)?.battlefield) ? (state as any).battlefield : [];
  for (const perm of battlefield) {
    if (!perm?.card || perm.phasedOut === true) continue;
    const sourcePermanentId = String(perm.id || '').trim();
    if (!sourcePermanentId) continue;
    const oracle = readCardOracleText(perm.card);
    const sourceName = String(perm.card?.name || 'Unknown').trim();
    const sourceController = String(perm.controller || '').trim();
    for (const sentence of selfReferenceSentences(oracle, sourceName)) {
      const s = sentence.toLowerCase().replace(/\u2019/g, "'").trim().replace(/\.$/, '');
      if (!WEEPING_RE.test(s)) continue;
      specs.push({
        id: `${sourcePermanentId}:combat-damage-prevent-shuffle-library`,
        sourcePermanentId,
        sourceController,
        sourceName,
        event: 'damage-prevention-cost',
        instead: {},
        effectId: 'combat-damage-prevent-shuffle-into-library',
        reason: 'combat_damage_prevent_shuffle_into_library',
        match: {
          damageSourceIsSource: true,
          combatDamageOnly: true,
        } as any,
        metadata: { shuffleDamagedCreatureIntoOwnerLibrary: true },
      });
    }
  }
  return specs;
}

/** Apply Weeping Angel-style prevent+shuffle. Returns null when nothing matches. */
export function applyBatch63DamageSideEffects(
  ctx: any,
  damageAmount: number,
  _damageDealer: string,
  _damageReceiver: string,
  damageSourcePermanentId?: string,
  targetPermanentId?: string,
  isCombatDamage?: boolean,
): { amount: number; modifiers: string[] } | null {
  if (!(Number(damageAmount) > 0) || isCombatDamage !== true) return null;
  const state = ctx?.state || ctx;
  const battlefield: any[] = Array.isArray(state?.battlefield) ? state.battlefield : [];
  const sourceId = String(damageSourcePermanentId || '').trim();
  const targetId = String(targetPermanentId || '').trim();
  if (!sourceId || !targetId) return null;
  const target = battlefield.find((p) => String(p?.id || '') === targetId);
  if (!target || !/\bcreature\b/i.test(String(target.card?.type_line || target.type_line || ''))) return null;

  for (const spec of collectBatch63DamageSideEffectSpecsFromState(state)) {
    if (String(spec.sourcePermanentId || '') !== sourceId) continue;
    const md = (spec.metadata || {}) as any;
    if (md.shuffleDamagedCreatureIntoOwnerLibrary !== true) continue;
    const owner = String(target.owner || target.controller || '').trim();
    if (!owner) continue;
    // Remove from battlefield and put into owner's library, then shuffle.
    const idx = battlefield.findIndex((p) => String(p?.id || '') === targetId);
    if (idx < 0) continue;
    const [removed] = battlefield.splice(idx, 1);
    const zones = state.zones?.[owner];
    if (zones) {
      const lib: any[] = Array.isArray(zones.library) ? zones.library : [];
      const card = removed?.card ? { ...removed.card } : removed;
      lib.push({ ...card, zone: 'library' });
      // Fisher-Yates shuffle
      for (let i = lib.length - 1; i > 0; i -= 1) {
        const j = Math.floor(Math.random() * (i + 1));
        const tmp = lib[i]; lib[i] = lib[j]; lib[j] = tmp;
      }
      zones.library = lib;
      zones.libraryCount = lib.length;
    }
    return {
      amount: 0,
      modifiers: [`${spec.sourceName}: prevented combat damage; ${String(removed?.card?.name || 'creature')} shuffled into library`],
    };
  }
  return null;
}
