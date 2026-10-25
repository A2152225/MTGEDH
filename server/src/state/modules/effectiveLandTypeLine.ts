// server/src/state/modules/effectiveLandTypeLine.ts
// Layer 4 land-type view for type-line based counting/conditions: replaces printed basic land types with the
// effective ones from land-type modifiers ("Enchanted land is a Swamp", "Lands you control are every basic land
// type in addition to their other types", Blood Moon). Used by Nightmare-style counts and
// "an opponent controls an Island".
// Public entry symbols: landAwareTypeLine.

import { getEffectiveBasicLandTypes } from './mana-abilities-handlers/manaAbilityLandTypeModifiers.js';
import { permanentIsSnowNow } from './effectiveSnowSupertype.js';

const BASIC_TYPE_RE = /\b(?:plains|island|swamp|mountain|forest)\b/g;

/** Lower-case type line with effective basic land types; falls back to the given line when not a land. */
export function landAwareTypeLine(state: any, perm: any, typeLine?: string): string {
  const printed = String(typeLine ?? perm?.typeSetOverride?.typeLine ?? perm?.card?.type_line ?? '').toLowerCase();
  // Glittering Frost style supertype addition.
  const base = state && !/\bsnow\b/.test(printed) && permanentIsSnowNow(state, perm, printed) ? 'snow ' + printed : printed;
  if (!state) return base;
  let types: string[];
  try { types = getEffectiveBasicLandTypes(state, perm) as string[]; } catch { return base; }
  if (!base.includes('land')) {
    // Ashaya: "Nontoken creatures you control are Forest lands in addition to their other types."
    if (!types.length) return base;
    const [head, subs = ''] = base.split(/\s*\u2014\s*|\s+-\s+/);
    return (head + ' land \u2014 ' + [subs.trim(), ...types].filter(Boolean).join(' ')).trim();
  }
  const stripped = base.replace(BASIC_TYPE_RE, '').replace(/\s+/g, ' ').trim();
  if (!types.length) return stripped;
  return (/\u2014|-/.test(stripped) ? stripped : stripped + ' \u2014') + ' ' + types.join(' ');
}
