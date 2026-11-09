// server/src/state/modules/replacementBatch66DamageRedirect.ts
// B66: Harsh Judgment — if an instant or sorcery of the chosen color would deal damage to you,
//      it deals that damage to its controller instead.
// Public: collectBatch66DamageRedirectSpecs, applyBatch66DamageRedirect.
// Leaf: must not import replacementEffectSpec.ts.

import type { ReplacementEffectSpec } from './replacementEffectSpec-handlers/replacementEffectSpecTypes.js';
import { readCardOracleText } from './replacementEffectSpec-handlers/replacementEffectSpecOracleTextUtils.js';
import { selfReferenceSentences } from './replacementEffectSpec-handlers/replacementEffectSpecDamagePreventionOracleTemplates.js';
import { damageSourceIsInstantOrSorcerySpell } from './replacementBatch23DamageCap.js';
import { getRecordedSpellSource, getResolvingSpellSource } from './replacementResolvingSpellSource.js';

const HARSH_RE =
  /^if an instant or sorcery spell of the chosen color would deal damage to you, it deals that damage to its controller instead$/;

const COLOR_LETTER: Record<string, string> = {
  white: 'W', blue: 'U', black: 'B', red: 'R', green: 'G',
  w: 'W', u: 'U', b: 'B', r: 'R', g: 'G',
};

function chosenColorLetter(perm: any): string | null {
  const raw = String(
    perm?.chosenColor || perm?.card?.chosenColor || perm?.chosenColors?.[0] || '',
  ).trim().toLowerCase();
  return COLOR_LETTER[raw] || null;
}

function spellColors(state: unknown, damageSourceId: string): string[] {
  const id = String(damageSourceId || '').trim();
  if (!id || !state || typeof state !== 'object') return [];
  const resolving = getResolvingSpellSource(state, id) || getRecordedSpellSource(state, id);
  if (resolving?.card?.colors && Array.isArray(resolving.card.colors)) {
    return resolving.card.colors.map((c) => String(c).toUpperCase());
  }
  const stack: unknown = Reflect.get(state, 'stack');
  if (!Array.isArray(stack)) return [];
  for (const item of stack as unknown[]) {
    if (!item || typeof item !== 'object') continue;
    const card: unknown = Reflect.get(item, 'card');
    const cardId: unknown = card && typeof card === 'object' ? Reflect.get(card, 'id') : undefined;
    if (String(Reflect.get(item, 'id') || '') === id || String(cardId || '') === id) {
      if (card && typeof card === 'object') {
        const colors: unknown = Reflect.get(card, 'colors');
        if (Array.isArray(colors)) return colors.map((c) => String(c).toUpperCase());
      }
    }
  }
  return [];
}

function spellController(state: unknown, damageSourceId: string, damageDealer: string): string {
  const id = String(damageSourceId || '').trim();
  if (id && state && typeof state === 'object') {
    const resolving = getResolvingSpellSource(state, id) || getRecordedSpellSource(state, id);
    // ResolvingSpellSource has no controller field historically; fall back to dealer / stack.
    const stack: unknown = Reflect.get(state, 'stack');
    if (Array.isArray(stack)) {
      for (const item of stack as unknown[]) {
        if (!item || typeof item !== 'object') continue;
        const card: unknown = Reflect.get(item, 'card');
        const cardId: unknown = card && typeof card === 'object' ? Reflect.get(card, 'id') : undefined;
        if (String(Reflect.get(item, 'id') || '') === id || String(cardId || '') === id) {
          const ctrl = String(Reflect.get(item, 'controller') || Reflect.get(item, 'owner') || '').trim();
          if (ctrl) return ctrl;
        }
      }
    }
    void resolving;
  }
  return String(damageDealer || '').trim();
}

export function collectBatch66DamageRedirectSpecs(state: unknown): ReplacementEffectSpec[] {
  const specs: ReplacementEffectSpec[] = [];
  const battlefield = Array.isArray((state as any)?.battlefield) ? (state as any).battlefield : [];
  for (const perm of battlefield) {
    if (!perm?.card || perm.phasedOut === true) continue;
    const sourcePermanentId = String(perm.id || '').trim();
    if (!sourcePermanentId) continue;
    const letter = chosenColorLetter(perm);
    if (!letter) continue;
    const oracle = readCardOracleText(perm.card);
    const sourceName = String(perm.card?.name || 'Unknown').trim();
    for (const sentence of selfReferenceSentences(oracle, sourceName)) {
      const s = sentence.toLowerCase().replace(/\u2019/g, "'").trim().replace(/\.$/, '');
      if (!HARSH_RE.test(s)) continue;
      specs.push({
        id: `${sourcePermanentId}:chosen-color-is-damage-redirect-to-controller`,
        sourcePermanentId,
        sourceController: String(perm.controller || '').trim(),
        sourceName,
        event: 'damage-redirect',
        instead: {},
        effectId: 'chosen-color-is-damage-redirect-to-controller',
        reason: 'chosen_color_is_damage_redirect_to_controller',
        match: {
          receivingIsPlayerOnly: true,
          receivingPlayerIsSourceController: true,
          damageSourceIsInstantOrSorcerySpell: true,
          damageSourceColorIncludes: letter,
        },
        metadata: { redirectTo: 'damage_source_controller', chosenColor: letter },
      });
    }
  }
  return specs;
}

export function applyBatch66DamageRedirect(
  state: any,
  damageAmount: number,
  damageDealer: string,
  damageReceiver: string,
  damageSourcePermanentId?: string,
  targetPermanentId?: string,
): { amount: number; modifiers: string[] } | null {
  if (!(Number(damageAmount) > 0)) return null;
  if (String(targetPermanentId || '').trim()) return null; // player damage only
  const specs = collectBatch66DamageRedirectSpecs(state);
  if (!specs.length) return null;
  const sourceId = String(damageSourcePermanentId || '').trim();
  for (const spec of specs) {
    const controller = String(spec.sourceController || '');
    if (!controller || String(damageReceiver || '') !== controller) continue;
    if (!damageSourceIsInstantOrSorcerySpell(state, sourceId)) continue;
    const wanted = String((spec.metadata as any)?.chosenColor || spec.match?.damageSourceColorIncludes || '').toUpperCase();
    if (!wanted || !spellColors(state, sourceId).includes(wanted)) continue;
    const redirectTo = spellController(state, sourceId, damageDealer);
    if (!redirectTo || redirectTo === controller) continue;
    const player = Array.isArray(state?.players) ? state.players.find((p: any) => String(p?.id) === redirectTo) : undefined;
    if (!player && state?.life?.[redirectTo] == null) continue;
    state.life = state.life || {};
    const current = Number(state.life[redirectTo] ?? player?.life ?? 40);
    state.life[redirectTo] = current - damageAmount;
    if (player) player.life = state.life[redirectTo];
    return {
      amount: 0,
      modifiers: [`${spec.sourceName}: ${damageAmount} damage dealt to ${redirectTo} instead`],
    };
  }
  return null;
}
