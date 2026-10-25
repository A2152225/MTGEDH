/**
 * Batch 23: damage caps from instant/sorcery sources.
 *  - Forethought Amulet: "If an instant or sorcery source would deal 3 or more damage to you, it deals 2 damage to
 *    you instead" -> cap 2 (equivalent: amounts below 3 are already at most 2).
 * Public entry symbols: collectBatch23DamageCapSpecs, damageSourceIsInstantOrSorcerySpell.
 * Leaf: must not import replacementEffectSpec.ts or replacementEffectSpec-handlers/index.ts.
 */
import type { ReplacementEffectSpec } from './replacementEffectSpec-handlers/replacementEffectSpecTypes.js';
import { getRecordedSpellSource, getResolvingSpellSource } from './replacementResolvingSpellSource.js';

const CAP_RE = /if an instant or sorcery source would deal (\d+) or more damage to you, it deals (\d+) damage to you instead/;

export function collectBatch23DamageCapSpecs(
  oracle: string,
  source: { sourcePermanentId: string; sourceController: string; sourceName: string },
): ReplacementEffectSpec[] {
  const m = oracle.match(CAP_RE);
  if (!m || Number(m[2]) !== Number(m[1]) - 1) return [];
  const cap = Number(m[2]);
  return [{
    sourcePermanentId: source.sourcePermanentId,
    sourceController: source.sourceController,
    sourceName: source.sourceName,
    id: `${source.sourcePermanentId}:instant-sorcery-damage-to-you-cap-${cap}`,
    event: 'damage',
    match: { receivingPlayerIsSourceController: true, receivingIsPlayerOnly: true, damageSourceIsInstantOrSorcerySpell: true },
    instead: { modify: 'cap', value: cap },
    effectId: `instant-sorcery-damage-to-you-cap-${cap}`,
    reason: `instant_sorcery_damage_to_you_cap_${cap}`,
  }];
}

function typeLineOf(card: unknown): string {
  if (!card || typeof card !== 'object') return '';
  const tl: unknown = Reflect.get(card, 'type_line');
  return typeof tl === 'string' ? tl.toLowerCase() : '';
}

/** True when the damage source id is a resolving or stacked instant/sorcery spell (not a permanent). */
export function damageSourceIsInstantOrSorcerySpell(state: unknown, damageSourceId: string): boolean {
  const id = String(damageSourceId || '').trim();
  if (!id || !state || typeof state !== 'object') return false;
  const resolving = getResolvingSpellSource(state, id) || getRecordedSpellSource(state, id);
  if (resolving) return /\b(?:instant|sorcery)\b/.test(typeLineOf(resolving.card));
  const stack: unknown = Reflect.get(state, 'stack');
  if (!Array.isArray(stack)) return false;
  for (const item of stack as unknown[]) {
    if (!item || typeof item !== 'object') continue;
    const card: unknown = Reflect.get(item, 'card');
    const cardId: unknown = card && typeof card === 'object' ? Reflect.get(card, 'id') : undefined;
    if (String(Reflect.get(item, 'id') || '') === id || String(cardId || '') === id) {
      return /\b(?:instant|sorcery)\b/.test(typeLineOf(card));
    }
  }
  return false;
}
