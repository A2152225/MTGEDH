// server/src/state/modules/layer4TypeSetting.ts
// Layer 4 type-setting payloads (CR 613.1d) with their paired layer 7b base P/T (CR 613.4b).
// Opalescence: "Each other non-Aura enchantment is a creature in addition to its other types and has base
// power and base toughness each equal to its mana value."
// Public entry symbols: Layer4TypePayload, collectLayer4TypePayloads, layer4AddedTypesFor,
//   layer4BasePowerToughnessFor, stampLayer4TypeSetting, LAYER4_ADDED_TYPES_FIELD.

import { staticSourceAbilitiesRemoved } from '../../../../rules-engine/src/permanentKeywordAbilities.js';
import { controllerHasLeftTheGame } from '../../../../rules-engine/src/playerInGameStatus.js';
import { LAYER4_ANIMATION_SPECS } from './layer4TypeSettingAnimation.js';

export const LAYER4_ADDED_TYPES_FIELD = 'layer4AddedTypes';

export interface Layer4TypePayload {
  sourceId: string;
  addTypes: string[];
  /** Layer 7b base P/T granted alongside the type change, when the spec sets one. */
  basePT?: (perm: any) => { power: number; toughness: number };
  appliesTo: (perm: any) => boolean;
}

interface Layer4Spec {
  re: RegExp;
  build: (source: any) => Omit<Layer4TypePayload, 'sourceId'>;
}

function typeLineOf(perm: any): string {
  return String(perm?.card?.type_line || perm?.type_line || '').toLowerCase();
}

function manaValueOf(perm: any): number {
  const card = perm?.card || {};
  const n = Number(card.cmc ?? card.mana_value ?? card.manaValue ?? perm?.cmc ?? 0);
  return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
}

const SPECS: Layer4Spec[] = [
  {
    // Opalescence
    re: /\beach other non-?aura enchantment is a creature in addition to its other types and has base power and base toughness each equal to its mana value\b/i,
    build: (source) => ({
      addTypes: ['Creature'],
      basePT: (perm) => ({ power: manaValueOf(perm), toughness: manaValueOf(perm) }),
      appliesTo: (perm) => {
        if (!perm || String(perm.id || '') === String(source?.id || '')) return false;
        const tl = typeLineOf(perm);
        return /\benchantment\b/.test(tl) && !/\baura\b/.test(tl);
      },
    }),
  },
  ...LAYER4_ANIMATION_SPECS,
];

const sourceScans = new WeakMap<object, { signature: string; hasSource: boolean }>();
/** Cached per battlefield array so boards without a type-setter stay O(1) per lookup. */
function boardHasLayer4Source(battlefield: any[]): boolean {
  if (battlefield.length === 0) return false;
  const signature = `${battlefield.length}|${String(battlefield[battlefield.length - 1]?.id || '')}`;
  const cached = sourceScans.get(battlefield);
  if (cached && cached.signature === signature) return cached.hasSource;
  const hasSource = battlefield.some((p: any) => {
    const text = String(p?.card?.oracle_text || p?.oracle_text || '');
    return !!text && SPECS.some((spec) => spec.re.test(text));
  });
  sourceScans.set(battlefield, { signature, hasSource });
  return hasSource;
}

/** Type-setting payloads from every functioning battlefield source. */
export function collectLayer4TypePayloads(state: any): Layer4TypePayload[] {
  const battlefield: any[] = Array.isArray(state?.battlefield) ? state.battlefield : [];
  const out: Layer4TypePayload[] = [];
  if (!boardHasLayer4Source(battlefield)) return out;
  for (const source of battlefield) {
    if (!source?.card || source.phasedOut) continue;
    const text = String(source.card.oracle_text || source.oracle_text || '');
    if (!text) continue;
    for (const spec of SPECS) {
      if (!spec.re.test(text)) continue;
      if (controllerHasLeftTheGame(state, String(source.controller || ''))) continue;
      if (staticSourceAbilitiesRemoved(source, battlefield)) continue;
      out.push({ sourceId: String(source.id || ''), ...spec.build(source) });
    }
  }
  return out;
}

export function layer4AddedTypesFor(perm: any, state: any): string[] {
  const added = new Set<string>();
  for (const payload of collectLayer4TypePayloads(state)) {
    if (payload.appliesTo(perm)) payload.addTypes.forEach((t) => added.add(t));
  }
  return [...added];
}

/** Latest-applying layer 4 spec's base P/T for `perm`, if any. */
export function layer4BasePowerToughnessFor(perm: any, state: any): { power: number; toughness: number } | undefined {
  let result: { power: number; toughness: number } | undefined;
  for (const payload of collectLayer4TypePayloads(state)) {
    if (payload.basePT && payload.appliesTo(perm)) result = payload.basePT(perm);
  }
  return result;
}

/** Every layer 4 spec's paired base P/T for `perm`, with the source id (timestamped among 7b setters). */
export function layer4BasePowerToughnessEntriesFor(perm: any, state: any): Array<{ power: number; toughness: number; sourceId: string }> {
  const out: Array<{ power: number; toughness: number; sourceId: string }> = [];
  for (const payload of collectLayer4TypePayloads(state)) {
    if (payload.basePT && payload.appliesTo(perm)) out.push({ ...payload.basePT(perm), sourceId: payload.sourceId });
  }
  return out;
}

/** Writes each permanent's layer 4 added types so type-only readers (isCreature, isCreatureNow) see them. */
export function stampLayer4TypeSetting(state: any): void {
  const battlefield: any[] = Array.isArray(state?.battlefield) ? state.battlefield : [];
  const payloads = collectLayer4TypePayloads(state);
  for (const perm of battlefield) {
    if (!perm) continue;
    const added = new Set<string>();
    for (const payload of payloads) if (payload.appliesTo(perm)) payload.addTypes.forEach((t) => added.add(t));
    if (added.size > 0) perm[LAYER4_ADDED_TYPES_FIELD] = [...added];
    else if (LAYER4_ADDED_TYPES_FIELD in perm) delete perm[LAYER4_ADDED_TYPES_FIELD];
  }
}
