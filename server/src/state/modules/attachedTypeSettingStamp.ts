// server/src/state/modules/attachedTypeSettingStamp.ts
// Layer 4/5 type-SETTING Auras (CR 205.1a, 613.1d): "Enchanted permanent is a colorless land with ... and
// loses all other card types and abilities" (Imprisoned in the Moon), "Enchanted permanent is a
// colorless Forest land" (Song of the Dryads). The host's card types and subtypes are replaced (supertypes
// are kept, CR 205.1a) and it becomes colorless; a host that stops being a creature has no P/T.
// Layer 4 ordering (CR 613.7): several type-setters on one host apply in timestamp order (latest wins); an
// additive "is a creature ... in addition to its other types" Aura (Ensoul Artifact) with a LATER
// timestamp re-adds Creature on top of the set types, an earlier one is overwritten.
// Layer 6 ability loss ("loses all other card types and abilities") lives in permanentKeywordAbilities.ts.
// Public: parseAttachedTypeSettingFromOracle, attachedMakesHostCreature, stampAttachedTypeSettingOverrides,
//   typeSetOverrideIsCreature, typeSetOverrideIsColorless, typeSetOverrideSubtypes.

import { readAttachmentTimestamp, readPermanentTimestamp } from '../../../../rules-engine/src/permanentTimestamps.js';

const CARD_TYPES = new Set(['artifact', 'creature', 'enchantment', 'land', 'planeswalker', 'battle']);
const SUPERTYPES = new Set(['legendary', 'basic', 'snow', 'world']);
const LINE_RE =
  /^enchanted (?:permanent|creature|land|artifact|planeswalker) is an? (colorless )?([a-z ]+?)(?: with "[^"]*")?(?: and loses all other card types(?: and abilities)?)?\.?$/;
const STAMPED = 'typeSetStampedFields';

export interface AttachedTypeSetting {
  cardTypes: string[];
  subtypes: string[];
  colorless: boolean;
  typeLine: string;
}

function cap(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

function buildTypeLine(supertypes: string[], cardTypes: string[], subtypes: string[]): string {
  return [...supertypes, ...cardTypes].map(cap).join(' ') + (subtypes.length ? ' \u2014 ' + subtypes.join(' ') : '');
}

export function parseAttachedTypeSettingFromOracle(oracle: unknown): AttachedTypeSetting | null {
  const lines = String(oracle || '').toLowerCase().split(/\n+/);
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || /in addition to|as long as|until end of turn/.test(line)) continue;
    const m = LINE_RE.exec(line);
    if (!m) continue;
    const words = m[2].trim().split(/\s+/).filter(Boolean);
    const cardTypes = words.filter((w) => CARD_TYPES.has(w));
    if (cardTypes.length === 0 || cardTypes[cardTypes.length - 1] !== words[words.length - 1]) continue;
    const subtypes = words.filter((w) => !CARD_TYPES.has(w)).map(cap);
    return { cardTypes, subtypes, colorless: !!m[1], typeLine: buildTypeLine([], cardTypes, subtypes) };
  }
  return null;
}

/** "Enchanted artifact is a creature with base power and toughness 5/5 in addition to its other types" (Ensoul Artifact). */
export function attachedMakesHostCreature(oracle: unknown): boolean {
  const text = String(oracle || '').toLowerCase();
  return /\benchanted (?:artifact|permanent|land|enchantment) is an? (?:[a-z ]+ )?creature with base power and toughness \d+\/\d+ in addition to its other types/.test(text)
    // Zendikons: "Enchanted land is a 5/3 green Elemental creature. It's still a land."
    || /\benchanted (?:artifact|land) is an? \d+\/\d+ [a-z ]*?creature\b[^.]*\.\s*it(?:'|\u2019)s still an? (?:artifact|land)\b/.test(text);
}

function hostSupertypes(perm: any): string[] {
  const head = String(perm?.card?.type_line || perm?.type_line || '').toLowerCase().split(/\u2014|\s-\s/)[0] || '';
  return head.split(/\s+/).filter((w) => SUPERTYPES.has(w));
}

function effectTimestamp(aura: any, index: number): number {
  return readAttachmentTimestamp(aura) ?? readPermanentTimestamp(aura) ?? index;
}

/** Set a derived field and remember that this stamp owns it (only owned fields are ever cleared). */
function own(perm: any, field: string, value: unknown): void {
  const owned: string[] = Array.isArray(perm[STAMPED]) ? perm[STAMPED] : [];
  if (!owned.includes(field)) {
    if (perm[field] !== undefined) return; // another system set it; never overwrite
    owned.push(field);
  }
  perm[field] = value;
  perm[STAMPED] = owned;
}

function releaseAll(perm: any, keep: Set<string>): void {
  const owned: string[] = Array.isArray(perm[STAMPED]) ? perm[STAMPED] : [];
  const left = owned.filter((field) => {
    if (keep.has(field)) return true;
    delete perm[field];
    return false;
  });
  if (left.length) perm[STAMPED] = left;
  else delete perm[STAMPED];
}

/** Stamp typeSetOverride (and notCreature / replaced subtypes) on hosts of type-setting Auras; clear stale stamps. */
export function stampAttachedTypeSettingOverrides(state: any): void {
  const battlefield: any[] = Array.isArray(state?.battlefield) ? state.battlefield : [];
  const setters = new Map<string, AttachedTypeSetting & { ts: number }>();
  const animators = new Map<string, number>();
  battlefield.forEach((perm, index) => {
    const host = String(perm?.attachedTo || '');
    if (!host || perm.phasedOut) return;
    const ts = effectTimestamp(perm, index);
    const setting = parseAttachedTypeSettingFromOracle(perm?.card?.oracle_text);
    if (setting && ts >= (setters.get(host)?.ts ?? -Infinity)) setters.set(host, { ...setting, ts });
    if (attachedMakesHostCreature(perm?.card?.oracle_text)) animators.set(host, Math.max(ts, animators.get(host) ?? -Infinity));
  });
  for (const perm of battlefield) {
    if (!perm) continue;
    const id = String(perm.id || '');
    const setter = setters.get(id);
    const animTs = animators.get(id);
    // An additive animation applies only if it is later than the type-setter (or there is no setter).
    const animated = animTs !== undefined && (!setter || animTs > setter.ts);
    const keep = new Set<string>();
    if (animated) {
      if (perm.isCreature !== true) own(perm, 'isCreature', true);
      if (perm.isCreature === true) perm.isCreatureFromAttachment = true;
      keep.add('isCreature');
    } else if (perm.isCreatureFromAttachment) {
      delete perm.isCreatureFromAttachment;
    }
    if (setter) {
      const cardTypes = animated && !setter.cardTypes.includes('creature') ? [...setter.cardTypes, 'creature'] : setter.cardTypes;
      const typeLine = buildTypeLine(hostSupertypes(perm), cardTypes, setter.subtypes);
      perm.typeSetOverride = { cardTypes, subtypes: setter.subtypes, colorless: setter.colorless, typeLine };
      own(perm, 'typesReplaced', true);
      own(perm, 'effectiveTypes', cardTypes.map(cap));
      ['typesReplaced', 'effectiveTypes'].forEach((f) => keep.add(f));
      if (!cardTypes.includes('creature')) {
        own(perm, 'notCreature', true);
        keep.add('notCreature');
      }
    } else if (perm.typeSetOverride) {
      delete perm.typeSetOverride;
    }
    // Legacy flag from earlier stamps.
    if (perm.notCreatureFromTypeSet && !keep.has('notCreature')) {
      delete perm.notCreature;
      delete perm.notCreatureFromTypeSet;
    }
    releaseAll(perm, keep);
  }
}

/** undefined when no override applies. */
export function typeSetOverrideIsCreature(perm: any): boolean | undefined {
  const o = perm?.typeSetOverride;
  if (!o || !Array.isArray(o.cardTypes)) return undefined;
  return o.cardTypes.includes('creature');
}

export function typeSetOverrideIsColorless(perm: any): boolean {
  return perm?.typeSetOverride?.colorless === true;
}

/** Lower-case subtypes the override set, or undefined when no override applies. */
export function typeSetOverrideSubtypes(perm: any): string[] | undefined {
  const o = perm?.typeSetOverride;
  return o && Array.isArray(o.subtypes) ? o.subtypes.map((s: string) => String(s).toLowerCase()) : undefined;
}
