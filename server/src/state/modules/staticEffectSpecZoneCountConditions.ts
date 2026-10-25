// server/src/state/modules/staticEffectSpecZoneCountConditions.ts
// Zone / resource "as long as" conditions for self and attached P/T statics (census round 15):
//   "you have no cards in hand" (Gathan Raiders), "you have N or more/fewer cards in hand",
//   "an opponent has N or more cards in their graveyard" (Blackbloom Rogue),
//   "there are N or more [permanent] cards in your graveyard" (descend N),
//   "you control no untapped lands" (Spur Grappler), "you've drawn N or more cards this turn" (Messenger Hawk).
// Public entry symbols: parseZoneCountCondition, evalZoneCountCondition.

import type { StaticEffectCondition } from './staticEffectSpecTypes.js';
import { resolveColorsWithSetting } from './colorSettingMarker.js';

const COLOR_SYM: Record<string, string> = { white: 'W', blue: 'U', black: 'B', red: 'R', green: 'G' };

const NUM: Record<string, number> = { a: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, no: 0 };
const num = (w: string): number | undefined => NUM[w] ?? (Number.isFinite(Number(w)) ? Number(w) : undefined);
const c = (o: Record<string, unknown>) => o as unknown as StaticEffectCondition;

export function parseZoneCountCondition(raw: string): StaticEffectCondition | null {
  const t = String(raw || '').toLowerCase().replace(/\u2019/g, "'").trim().replace(/[.,]+$/, '');
  if (/^you have no cards in (?:your )?hand$/.test(t)) return c({ kind: 'zone_count', zone: 'hand', who: 'you', cmp: 'max', count: 0 });
  let m = t.match(/^you have (\w+) or (more|fewer) cards in (?:your )?hand$/);
  if (m && num(m[1]) !== undefined) return c({ kind: 'zone_count', zone: 'hand', who: 'you', cmp: m[2] === 'more' ? 'min' : 'max', count: num(m[1]) });
  m = t.match(/^an opponent has (\w+) or more cards in (?:their|his or her) graveyard$/);
  if (m && num(m[1]) !== undefined) return c({ kind: 'zone_count', zone: 'graveyard', who: 'opponent', cmp: 'min', count: num(m[1]) });
  m = t.match(/^there are (\w+) or more (permanent )?cards in your graveyard$/);
  if (m && num(m[1]) !== undefined) return c({ kind: 'zone_count', zone: 'graveyard', who: 'you', cmp: 'min', count: num(m[1]), permanentOnly: !!m[2] });
  // "any player controls a black permanent" (Knight of Grace), "an opponent controls a green permanent".
  m = t.match(/^(any player|an opponent|you) controls? an? (white|blue|black|red|green) permanent$/);
  if (m) return c({ kind: 'player_controls_color_permanent', who: m[1] === 'any player' ? 'any' : m[1] === 'you' ? 'you' : 'opponent', option: COLOR_SYM[m[2]] });
  if (/^you control no untapped lands$/.test(t)) return c({ kind: 'controller_no_untapped_lands' });
  m = t.match(/^you've drawn (\w+) or more cards this turn$/);
  if (m && num(m[1]) !== undefined) return c({ kind: 'controller_drew_at_least_this_turn', count: num(m[1]) });
  return null;
}

const PERMANENT_RE = /\b(artifact|battle|creature|enchantment|land|planeswalker)\b/;

function zoneSize(state: any, pid: string, zone: string, permanentOnly: boolean): number {
  const z = state?.zones?.[pid];
  if (zone === 'hand' && typeof z?.handCount === 'number' && Number.isFinite(z.handCount)) return Math.max(0, z.handCount);
  const list = Array.isArray(z?.[zone]) ? z[zone] : [];
  if (!permanentOnly) {
    if (zone === 'graveyard' && list.length === 0 && typeof z?.graveyardCount === 'number') return z.graveyardCount;
    return list.length;
  }
  return list.filter((card: any) => PERMANENT_RE.test(String(card?.type_line || card?.card?.type_line || '').toLowerCase())).length;
}

function playerIds(state: any, battlefield: readonly any[]): string[] {
  const ids = new Set<string>();
  for (const p of Array.isArray(state?.players) ? state.players : []) if (p?.id) ids.add(String(p.id));
  for (const k of Object.keys(state?.zones || {})) ids.add(k);
  for (const perm of battlefield) if (perm?.controller) ids.add(String(perm.controller));
  return [...ids];
}

/** Undefined for kinds this module does not own. */
export function evalZoneCountCondition(condition: any, controller: string, battlefield: readonly any[], state: any): boolean | undefined {
  const count = Number(condition?.count || 0);
  switch (condition?.kind) {
    case 'zone_count': {
      const ok = (pid: string) => {
        const n = zoneSize(state, pid, String(condition.zone), condition.permanentOnly === true);
        return condition.cmp === 'max' ? n <= count : n >= count;
      };
      if (condition.who === 'host') {
        const host = battlefield.find((p) => p && String(p.id || '') === String(condition.option || ''));
        return !!host?.controller && ok(String(host.controller));
      }
      if (condition.who === 'opponent') return playerIds(state, battlefield).some((pid) => pid !== controller && ok(pid));
      return !!controller && ok(controller);
    }
    case 'player_controls_color_permanent': {
      const sym = String(condition.option || '');
      return battlefield.some((p) => {
        if (!p || p.phasedOut) return false;
        const pc = String(p.controller || '');
        if (condition.who === 'you' && pc !== controller) return false;
        if (condition.who === 'opponent' && (!pc || pc === controller)) return false;
        const printed = Array.isArray(p.card?.colors) ? p.card.colors : [];
        return resolveColorsWithSetting(printed, Array.isArray(p.colorAdditions) ? p.colorAdditions : []).includes(sym);
      });
    }
    case 'controller_no_untapped_lands':
      return !battlefield.some((p) => p && !p.phasedOut && String(p.controller || '') === controller && !p.tapped
        && /\bland\b/.test(String(p.card?.type_line || '').toLowerCase()));
    case 'controller_drew_at_least_this_turn': {
      const drawn = Number(state?.cardsDrawnThisTurn?.[controller] ?? 0);
      return drawn >= count;
    }
    case 'controller_named_equipment_attached': {
      const name = String(condition.option || '').toLowerCase();
      return battlefield.some((p) => p && !p.phasedOut && String(p.controller || '') === controller && p.attachedTo
        && String(p.card?.name || '').toLowerCase() === name
        && battlefield.some((h) => h && String(h.id || '') === String(p.attachedTo) && String(h.controller || '') === controller));
    }
    case 'attached_host_is_basic_subtype': {
      const land = battlefield.find((p) => p && String(p.id || '') === String(condition.option || ''));
      const tl = String(land?.card?.type_line || '').toLowerCase();
      return /\bbasic\b/.test(tl) && new RegExp('\\b' + String(condition.landType || '') + '\\b').test(tl);
    }
    default:
      return undefined;
  }
}
