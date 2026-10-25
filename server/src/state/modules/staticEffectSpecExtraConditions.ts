// server/src/state/modules/staticEffectSpecExtraConditions.ts
// Extra "as long as" condition phrases for self/attached P/T statics (census round 7):
//   "there are four or more card types among cards in your graveyard" (Grim Flayer) via the Phase 5 phrase table,
//   "green is the most common color among all permanents or is tied for most common" (Sulam Djinn),
//   "an opponent controls an Island" (Wu Admiral; any card type or subtype word),
//   "it's white" / its negation for "Otherwise, it gets -2/-1" (Serra's Boon).
// Public entry symbols: parseExtraSelfCondition, negateColorCondition, evalExtraStaticCondition.

import type { StaticEffectCondition } from './staticEffectSpecTypes.js';
import { parsePhase5LordCondition } from './staticEffectSpec-handlers/staticEffectSpecOracleParsingPhase5Conditions.js';
import { getEffectiveColors } from './effectiveColors.js';
import { parseCommanderCondition } from './staticEffectSpecCommanderCondition.js';
import { parseZoneCountCondition } from './staticEffectSpecZoneCountConditions.js';

const COLOR_SYMBOL: Record<string, string> = { white: 'W', blue: 'U', black: 'B', red: 'R', green: 'G' };

export function parseExtraSelfCondition(raw: string): StaticEffectCondition | null {
  const c = String(raw || '').toLowerCase().replace(/\u2019/g, "'").trim().replace(/[.,]+$/, '');
  let m = c.match(/^(white|blue|black|red|green) is the most common color among all permanents(?: or is tied for most common)?$/);
  if (m) return { kind: 'color_most_common_among_permanents', color: m[1] } as StaticEffectCondition;
  m = c.match(/^an opponent controls an? (?:(white|blue|black|red|green) )?([a-z]+)$/);
  if (m) return { kind: 'opponent_controls_matching', ...(m[1] ? { color: m[1] } : {}), cardType: m[2] } as StaticEffectCondition;
  m = c.match(/^(?:it|this creature|~)(?:'s| is) (white|blue|black|red|green)$/);
  if (m) return { kind: 'target_has_mana_color', color: m[1] } as StaticEffectCondition;
  const commander = parseCommanderCondition(c);
  if (commander) return commander as StaticEffectCondition;
  const zoneCount = parseZoneCountCondition(c);
  if (zoneCount) return zoneCount;
  return parsePhase5LordCondition(c, '');
}

/** "Otherwise" half of a colour condition; null when the condition has no supported negation. */
export function negateColorCondition(condition: StaticEffectCondition): StaticEffectCondition | null {
  const cond = condition as any;
  if (cond?.kind === 'target_has_mana_color' && cond.color) return { kind: 'target_lacks_mana_color', color: cond.color } as StaticEffectCondition;
  return null;
}

function colorCounts(battlefield: readonly any[], state: unknown): Record<string, number> {
  const counts: Record<string, number> = { W: 0, U: 0, B: 0, R: 0, G: 0 };
  for (const perm of battlefield) {
    if (!perm || perm.phasedOut) continue;
    for (const symbol of new Set(getEffectiveColors(perm, state).map((s) => String(s).toUpperCase()))) {
      if (symbol in counts) counts[symbol] += 1;
    }
  }
  return counts;
}

/** Returns undefined for kinds this module does not own. */
export function evalExtraStaticCondition(
  condition: { kind?: string; color?: string },
  permanent: any,
  battlefield: readonly any[],
  state?: unknown,
): boolean | undefined {
  switch (condition.kind) {
    case 'color_most_common_among_permanents': {
      const symbol = COLOR_SYMBOL[String(condition.color || '').toLowerCase()];
      if (!symbol) return false;
      const counts = colorCounts(battlefield, state);
      return counts[symbol] >= Math.max(...Object.values(counts));
    }
    case 'target_lacks_mana_color': {
      const symbol = COLOR_SYMBOL[String(condition.color || '').toLowerCase()];
      return !!symbol && !getEffectiveColors(permanent, state).map((s) => String(s).toUpperCase()).includes(symbol);
    }
    case 'target_is_enchanted': {
      const id = String(permanent?.id || '');
      return !!id && battlefield.some((p) => p && String(p.attachedTo || '') === id && /\baura\b/i.test(String(p.card?.type_line || '')));
    }
    default:
      return undefined;
  }
}
