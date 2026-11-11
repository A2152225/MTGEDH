// server/src/state/modules/staticEffectSpecCountBases.ts
// Count bases for "gets +N/+N for each ..." statics (census P/T families):
//   controller_permanents_of_type      "for each artifact you control" (Nim Lasher), "creature you control" (Pennon Blade)
//   attachments_on_source              "for each Aura attached to it" (Kor Spiritdancer), "Aura and Equipment" (Strong Back)
//   controller_hand_size               "for each card in your hand" (Dread Slag)
//   controller_graveyard_cards_of_type "for each creature card in your graveyard" (Fiend Artisan)
// The spec's sourcePermanentId is the counted-around permanent (the creature itself, or an Aura/Equipment host).
// Public entry symbols: resolveExtendedCountMultiplier.

import { landAwareTypeLine } from './effectiveLandTypeLine.js';
import { getEffectiveColors } from './effectiveColors.js';
import { readDerivedStaticEffectSpecs } from './staticEffectSpec.js';
import { permanentMatchesScopeQualifier } from './staticEffectSpecScopeQualifier.js';

const BASIC_LAND_TYPES = ['plains', 'island', 'swamp', 'mountain', 'forest'];

function controlledLandTypeLines(controller: string, battlefield: readonly any[], state: unknown): string[] {
  return battlefield
    .filter((p) => p && !p.phasedOut && String(p.controller || '') === controller)
    .map((p) => landAwareTypeLine(state, p).toLowerCase())
    .filter((tl) => /\bland\b/.test(tl));
}

type SpecLike = {
  sourcePermanentId?: string;
  sourceController?: string;
  effectSourcePermanentId?: string;
  grant?: { countBasis?: string; countCardType?: string; countAttachmentKinds?: readonly string[]; countExcludeSource?: boolean;
    countCounterType?: string; countWho?: string; countKeyword?: string; countQualifier?: any; countName?: string;
    countColor?: string };
};

function playerCounterCount(state: any, players: any[], id: string, kind: string): number {
  const player = players.find((p) => String(p?.id || '') === id);
  const raw = state?.[kind + 'Counters']?.[id] ?? player?.counters?.[kind] ?? player?.[kind + 'Counters'] ?? state?.playerCounters?.[id]?.[kind];
  const n = Number(raw);
  return Number.isFinite(n) ? Math.max(0, n) : 0;
}

/** True when a derived static spec ("Equipped creature ... loses flying", "All creatures lose flying") strips kw from p. */
function derivedSpecRemovesKeyword(state: unknown, p: any, kw: string): boolean {
  let specs: any[] | null = null;
  try { specs = readDerivedStaticEffectSpecs(state) as any[] | null; } catch { specs = null; }
  const id = String(p?.id || '');
  const ctrl = String(p?.controller || '');
  return (specs || []).some((s) => {
    const removed = Array.isArray(s?.grant?.removeAbilities) ? s.grant.removeAbilities.map((k: any) => String(k).toLowerCase()) : [];
    if (!removed.includes(kw) && !removed.includes('all abilities')) return false;
    switch (s?.scope?.kind) {
      case 'self': return String(s.sourcePermanentId || '') === id;
      case 'all_creatures': return true;
      case 'creatures_you_control': return ctrl === String(s.sourceController || '');
      case 'opponent_creatures': return !!ctrl && ctrl !== String(s.sourceController || '');
      default: return false;
    }
  });
}

/** Printed keyword lines plus granted abilities; "loses <kw>" removals (own fields and derived specs) are honoured. */
function permanentHasKeyword(p: any, kw: string, state?: unknown): boolean {
  if (!kw) return false;
  if (derivedSpecRemovesKeyword(state, p, kw)) return false;
  const lists = [p?.grantedAbilities, p?.continuousAbilities, p?.card?.keywords, p?.keywords];
  const removed = [p?.removedAbilities, p?.continuousRemovedAbilities].flat().map((k: any) => String(k || '').toLowerCase());
  if (removed.includes(kw) || p?.losesAllAbilities === true) return false;
  if (lists.some((l) => Array.isArray(l) && l.some((k: any) => String(k || '').toLowerCase() === kw))) return true;
  const re = new RegExp('(?:^|\\n|, )' + kw + '(?:,|\\n|$| \\()');
  return re.test(String(p?.card?.oracle_text || '').toLowerCase());
}

function typeLine(perm: any): string {
  return String(perm?.card?.type_line || '').toLowerCase();
}

function controllerZone(spec: SpecLike, state: any): any {
  return state?.zones?.[String(spec.sourceController || '')];
}

/** Undefined for count bases this module does not own. */
export function resolveExtendedCountMultiplier(spec: SpecLike, battlefield: readonly any[], state?: unknown): number | undefined {
  const grant = spec.grant || {};
  const controller = String(spec.sourceController || '');
  switch (grant.countBasis) {
    case 'controller_permanents_of_type': {
      const wanted = String(grant.countCardType || '').toLowerCase();
      const skip = grant.countExcludeSource ? String(spec.sourcePermanentId || '') : '';
      const ownerOk = (p: any) => (grant.countWho === 'all' ? !!p && !p.phasedOut : grant.countWho === 'opponents' ? !!String(p?.controller || '') && String(p?.controller || '') !== controller : String(p?.controller || '') === controller);
      return battlefield.filter((p) => ownerOk(p) && (!wanted || new RegExp('\\b' + wanted + '\\b').test(typeLine(p)))
        && !(skip && String(p?.id || '') === skip) && (!grant.countQualifier || permanentMatchesScopeQualifier(p, grant.countQualifier))).length;
    }
    case 'attachments_on_source': {
      const hostId = String(spec.sourcePermanentId || '');
      const kinds = (grant.countAttachmentKinds || []).map((k) => String(k).toLowerCase());
      return battlefield.filter((p) => hostId && String(p?.attachedTo || '') === hostId && kinds.some((k) => typeLine(p).includes(k))).length;
    }
    case 'controller_hand_size': {
      // B81: countWho opponents sums every other player's hand (Enemy of Enlightenment).
      if (grant.countWho === 'opponents' || grant.countWho === 'all') {
        const zones: any = (state as any)?.zones || {};
        const players: any[] = Array.isArray((state as any)?.players) ? (state as any).players : [];
        const ids = grant.countWho === 'all'
          ? Object.keys(zones)
          : players.map((p) => String(p?.id || '')).filter((id) => id && id !== controller);
        return ids.reduce((sum, id) => {
          const zone = zones[id];
          if (typeof zone?.handCount === 'number' && Number.isFinite(zone.handCount)) return sum + Math.max(0, Math.floor(zone.handCount));
          return sum + (Array.isArray(zone?.hand) ? zone.hand.length : 0);
        }, 0);
      }
      const zone = controllerZone(spec, state);
      if (typeof zone?.handCount === 'number' && Number.isFinite(zone.handCount)) return Math.max(0, Math.floor(zone.handCount));
      return Array.isArray(zone?.hand) ? zone.hand.length : 0;
    }
    case 'controller_colors_among_permanents': {
      const colors = new Set<string>();
      for (const p of battlefield) {
        if (!p || p.phasedOut || String(p.controller || '') !== controller) continue;
        for (const c of getEffectiveColors(p, state)) {
          const s = String(c || '').toUpperCase();
          if ('WUBRG'.includes(s) && s) colors.add(s);
        }
      }
      return colors.size;
    }
    case 'counters_on_other_creatures_you_control': {
      const wanted = String(grant.countCounterType || '').toLowerCase();
      const skip = String(spec.sourcePermanentId || '');
      let total = 0;
      for (const p of battlefield) {
        if (!p || p.phasedOut || String(p.controller || '') !== controller) continue;
        if (!/\bcreature\b/.test(typeLine(p))) continue;
        if (skip && String(p.id || '') === skip) continue;
        const counters = (p.counters || {}) as Record<string, unknown>;
        if (!wanted) {
          total += Object.values(counters).reduce<number>((sum, v) => sum + Math.max(0, Number(v) || 0), 0);
          continue;
        }
        for (const [key, value] of Object.entries(counters)) {
          if (String(key).toLowerCase().replace(/_/g, ' ') === wanted) total += Math.max(0, Number(value) || 0);
        }
      }
      return total;
    }
    case 'controller_graveyard_cards_of_type': {
      // R36: countWho opponents / all reads the other players' graveyards.
      const zones: any = (state as any)?.zones || {};
      const graveyard = grant.countWho === 'opponents' || grant.countWho === 'all'
        ? Object.keys(zones).filter((id) => grant.countWho === 'all' || id !== controller).flatMap((id) => (Array.isArray(zones[id]?.graveyard) ? zones[id].graveyard : []))
        : controllerZone(spec, state)?.graveyard;
      const wanted = String(grant.countCardType || '').toLowerCase();
      return Array.isArray(graveyard) ? graveyard.filter((c: any) => {
        const tl = String(c?.type_line || c?.card?.type_line || '').toLowerCase();
        // B70: Xande — noncreature, nonland cards.
        if (wanted === 'noncreature_nonland') return !/\bcreature\b/.test(tl) && !/\bland\b/.test(tl);
        // B80: Rielle — instant and sorcery cards.
        if (wanted === 'instant_or_sorcery') return /\binstant\b/.test(tl) || /\bsorcery\b/.test(tl);
        // B82: Winter — creature and planeswalker cards.
        if (wanted === 'creature_or_planeswalker') return /\bcreature\b/.test(tl) || /\bplaneswalker\b/.test(tl);
        // B83: Song of Stupefaction — permanent cards (not instants/sorceries).
        if (wanted === 'permanent') {
          return /\b(artifact|creature|enchantment|land|planeswalker|battle|kindred|tribal)\b/.test(tl);
        }
        // B85: Runaway Trash-Bot.
        if (wanted === 'artifact_or_enchantment') {
          return /\bartifact\b/.test(tl) || /\benchantment\b/.test(tl);
        }
        return !wanted || tl.includes(wanted);
      }).length : 0;
    }
    case 'host_controller_graveyard_cards_of_type': {
      const host = battlefield.find((p) => String(p?.id || '') === String(spec.sourcePermanentId || ''));
      const hostCtrl = String(host?.controller || '');
      const gy = hostCtrl ? (state as any)?.zones?.[hostCtrl]?.graveyard : undefined;
      const wanted = String(grant.countCardType || '').toLowerCase();
      return Array.isArray(gy) ? gy.filter((c: any) => {
        const tl = String(c?.type_line || c?.card?.type_line || '').toLowerCase();
        return !wanted || tl.includes(wanted);
      }).length : 0;
    }
    case 'controller_creatures_with_base_power_or_toughness': {
      const n = Number(grant.countCardType);
      if (!Number.isFinite(n)) return 0;
      return battlefield.filter((p) => {
        if (!p || p.phasedOut || String(p.controller || '') !== controller) return false;
        if (!/\bcreature\b/.test(typeLine(p))) return false;
        const power = Number(p?.card?.power);
        const toughness = Number(p?.card?.toughness);
        return power === n || toughness === n;
      }).length;
    }
    case 'controller_lands_of_subtype': {
      const re = new RegExp('\\b' + String(grant.countCardType || '').toLowerCase() + '\\b');
      return controlledLandTypeLines(controller, battlefield, state).filter((tl) => re.test(tl)).length;
    }
    case 'opponents_below_half_starting_life': {
      const st: any = state; const start = Number(st?.startingLife ?? 40);
      return (st?.players || []).filter((p: any) => {
        const id = String(p?.id || ''); if (!id || id === controller || p?.hasLost) return false;
        const life = Number(st?.life?.[id] ?? p?.life);
        return Number.isFinite(life) && life < start / 2;
      }).length;
    }
    case 'controller_life_total': {
      const life = Number((state as any)?.life?.[controller] ?? (state as any)?.players?.find?.((p: any) => String(p?.id) === controller)?.life);
      return Number.isFinite(life) ? life : 0;
    }
    case 'controller_basic_land_types': {
      const lines = controlledLandTypeLines(controller, battlefield, state);
      return BASIC_LAND_TYPES.filter((b) => lines.some((tl) => new RegExp('\\b' + b + '\\b').test(tl))).length;
    }
    case 'player_counters': {
      const kind = String(grant.countCounterType || '').toLowerCase();
      const players: any[] = Array.isArray((state as any)?.players) ? (state as any).players : [];
      const ids = grant.countWho === 'opponents'
        ? players.map((p) => String(p?.id || '')).filter((id) => id && id !== controller)
        : [controller];
      return ids.reduce((sum, id) => sum + playerCounterCount(state, players, id, kind), 0);
    }
    case 'creatures_with_keyword': {
      const kw = String(grant.countKeyword || '').toLowerCase();
      const skip = grant.countExcludeSource ? String(spec.sourcePermanentId || '') : '';
      // B82: Skycat — countWho 'you' limits to the source controller.
      return battlefield.filter((p) => {
        if (!p || p.phasedOut || !/\bcreature\b/.test(typeLine(p))) return false;
        if (grant.countWho === 'you' && String(p.controller || '') !== controller) return false;
        if (skip && String(p?.id || '') === skip) return false;
        return permanentHasKeyword(p, kw, state);
      }).length;
    }
    case 'host_controller_hand_size': {
      const host = battlefield.find((p) => String(p?.id || '') === String(spec.sourcePermanentId || ''));
      const zone = (state as any)?.zones?.[String(host?.controller || '')];
      if (typeof zone?.handCount === 'number' && Number.isFinite(zone.handCount)) return Math.max(0, Math.floor(zone.handCount));
      return Array.isArray(zone?.hand) ? zone.hand.length : 0;
    }
    case 'host_color_count': {
      const host = battlefield.find((p) => String(p?.id || '') === String(spec.sourcePermanentId || ''));
      if (!host) return 0;
      return new Set(getEffectiveColors(host, state).map((c) => String(c).toUpperCase()).filter((c) => 'WUBRG'.includes(c) && c)).size;
    }
    case 'creatures_named': {
      const wanted = String(grant.countName || '').toLowerCase();
      const skip = grant.countExcludeSource ? String(spec.sourcePermanentId || '') : '';
      return battlefield.filter((p) => p && !p.phasedOut && String(p?.controller || '') === controller
        && /\bcreature\b/.test(typeLine(p)) && !(skip && String(p?.id || '') === skip)
        && String(p?.card?.name || p?.name || '').toLowerCase() === wanted).length;
    }
    case 'greatest_power_among_creature_cards_in_all_graveyards': {
      const zones: any = (state as any)?.zones || {};
      let best = 0;
      for (const id of Object.keys(zones)) {
        const gy = zones[id]?.graveyard;
        if (!Array.isArray(gy)) continue;
        for (const card of gy) {
          const tl = String(card?.type_line || card?.card?.type_line || '').toLowerCase();
          if (!/\bcreature\b/.test(tl)) continue;
          const p = Number(card?.power ?? card?.card?.power);
          if (Number.isFinite(p) && p > best) best = p;
        }
      }
      return best;
    }
    case 'controller_unspent_mana': {
      const pool = (state as any)?.manaPool?.[controller] || {};
      let total = 0;
      if (typeof pool === 'number') return Math.max(0, Math.floor(pool));
      if (pool && typeof pool === 'object') {
        // B88: Omnath — optional countColor filters to that letter (green → G).
        const COLOR: Record<string, string> = { white: 'W', blue: 'U', black: 'B', red: 'R', green: 'G' };
        const raw = String(grant.countColor || '').trim().toLowerCase();
        const sym = COLOR[raw] || (/^[wubrg]$/i.test(raw) ? raw.toUpperCase() : '');
        if (sym) {
          total = Number((pool as any)[sym] ?? (pool as any)[sym.toLowerCase()] ?? 0) || 0;
        } else {
          for (const v of Object.values(pool)) total += Number(v) || 0;
        }
      }
      return Math.max(0, Math.floor(total));
    }
    case 'controller_subtype_battlefield_and_graveyard': {
      // B88: Cid — each Artificer you control + each Artificer card in your graveyard.
      const wanted = String(grant.countCardType || '').toLowerCase();
      if (!wanted) return 0;
      const re = new RegExp('\\b' + wanted + 's?\\b');
      let n = battlefield.filter((p) =>
        p && !p.phasedOut && String(p.controller || '') === controller && re.test(typeLine(p)),
      ).length;
      const gy = controllerZone(spec, state as any)?.graveyard;
      if (Array.isArray(gy)) {
        for (const card of gy) {
          const tl = String(card?.type_line || card?.card?.type_line || '').toLowerCase();
          if (re.test(tl)) n += 1;
        }
      }
      return n;
    }
    case 'opponents_untapped_permanents': {
      // B88: Copperhoof Vorrac.
      return battlefield.filter((p) =>
        p && !p.phasedOut && String(p.controller || '') && String(p.controller || '') !== controller && !p.tapped,
      ).length;
    }
    case 'lands_matching_effect_source_exiled_name': {
      // B88: Strata Scythe — count lands whose name matches the equipment's exiled card.
      const effectId = String(spec.effectSourcePermanentId || spec.sourcePermanentId || '');
      const effectSrc = battlefield.find((p) => String(p?.id || '') === effectId)
        || ((state as any)?.battlefield || []).find((p: any) => String(p?.id || '') === effectId);
      const exiled = Array.isArray((effectSrc as any)?.exiledCards)
        ? (effectSrc as any).exiledCards
        : Array.isArray((effectSrc as any)?.card?.exiledCards)
          ? (effectSrc as any).card.exiledCards
          : [];
      const names = new Set(
        exiled.map((c: any) => String(c?.name || c?.card?.name || '').toLowerCase().trim()).filter(Boolean),
      );
      if (names.size === 0) return 0;
      return battlefield.filter((p) => {
        if (!p || p.phasedOut) return false;
        if (!/\bland\b/.test(typeLine(p))) return false;
        const name = String(p?.card?.name || p?.name || '').toLowerCase().trim();
        return names.has(name);
      }).length;
    }
    case 'greatest_mana_value_among_controller_permanents': {
      // B83: Emissary Escort — +X/+0 where X is greatest MV among other artifacts.
      const wanted = String(grant.countCardType || '').toLowerCase();
      const skip = grant.countExcludeSource ? String(spec.sourcePermanentId || '') : '';
      let best = 0;
      for (const p of battlefield) {
        if (!p || p.phasedOut || String(p.controller || '') !== controller) continue;
        if (skip && String(p.id || '') === skip) continue;
        if (wanted && !new RegExp('\\b' + wanted + '\\b').test(typeLine(p))) continue;
        const card = p.card || p;
        const cmc = Number(card?.cmc ?? card?.mana_value);
        let mv = Number.isFinite(cmc) ? cmc : 0;
        if (!Number.isFinite(cmc)) {
          for (const sym of String(card?.mana_cost || '').match(/\{[^}]+\}/g) || []) {
            const s = sym.slice(1, -1).toUpperCase();
            if (/^\d+$/.test(s)) mv += parseInt(s, 10);
            else if (s !== 'X') mv += 1;
          }
        }
        if (mv > best) best = mv;
      }
      return best;
    }
    case 'controller_cards_drawn_this_turn': {
      // B83: Knowledge Is Power.
      const drawn = Number((state as any)?.cardsDrawnThisTurn?.[controller] || 0);
      return Number.isFinite(drawn) ? Math.max(0, Math.floor(drawn)) : 0;
    }
    case 'controller_lands_of_subtype_half_down':
    case 'controller_lands_of_subtype_half_up': {
      // B84: Aspect of Wolf.
      const re = new RegExp('\\b' + String(grant.countCardType || '').toLowerCase() + '\\b');
      const n = controlledLandTypeLines(controller, battlefield, state).filter((tl) => re.test(tl)).length;
      return grant.countBasis === 'controller_lands_of_subtype_half_up'
        ? Math.ceil(n / 2)
        : Math.floor(n / 2);
    }
    case 'controller_colors_among_creature_type': {
      // B85: Earthen Ally — colors among Allies you control.
      const sub = String(grant.countCardType || '').toLowerCase();
      const colors = new Set<string>();
      for (const p of battlefield) {
        if (!p || p.phasedOut || String(p.controller || '') !== controller) continue;
        const tl = typeLine(p);
        if (sub && !new RegExp('\\b' + sub + 's?\\b').test(tl)) continue;
        for (const c of getEffectiveColors(p, state)) {
          const s = String(c || '').toUpperCase();
          if ('WUBRG'.includes(s) && s) colors.add(s);
        }
      }
      return colors.size;
    }
    case 'controller_modified_creatures': {
      // B87: Upriser Renegade — CR 700.9 modified (counters / Equipment / Aura you control).
      const skip = grant.countExcludeSource ? String(spec.sourcePermanentId || '') : '';
      return battlefield.filter((p) => {
        if (!p || p.phasedOut || String(p.controller || '') !== controller) return false;
        if (!/\bcreature\b/.test(typeLine(p))) return false;
        if (skip && String(p.id || '') === skip) return false;
        const counters = (p.counters || {}) as Record<string, unknown>;
        if (Object.values(counters).some((v) => Number(v) > 0)) return true;
        const id = String(p.id || '');
        return battlefield.some((a) => {
          if (String(a?.attachedTo || '') !== id) return false;
          const tl = typeLine(a);
          if (/\bequipment\b/.test(tl)) return true;
          if (/\baura\b/.test(tl) && String(a?.controller || '') === controller) return true;
          return false;
        });
      }).length;
    }
    case 'players_who_lost_the_game': {
      // B87: Rampant Frogantua.
      const players: any[] = Array.isArray((state as any)?.players) ? (state as any).players : [];
      return players.filter((p) => p && (p.hasLost === true || p.eliminated === true)).length;
    }
    case 'controller_permanents_matching_any_type': {
      // B87: Bearded Axe — "for each Dwarf, Equipment, and/or Vehicle you control".
      const wanted = String(grant.countCardType || '').toLowerCase().split('|').map((w) => w.trim()).filter(Boolean);
      if (!wanted.length) return 0;
      return battlefield.filter((p) => {
        if (!p || p.phasedOut || String(p.controller || '') !== controller) return false;
        const tl = typeLine(p);
        return wanted.some((w) => new RegExp('\\b' + w + 's?\\b').test(tl));
      }).length;
    }
    default:
      return undefined;
  }
}
