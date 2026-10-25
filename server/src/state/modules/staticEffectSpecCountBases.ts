// server/src/state/modules/staticEffectSpecCountBases.ts
// Count bases for "gets +N/+N for each ..." statics (census P/T families):
//   controller_permanents_of_type      "for each artifact you control" (Nim Lasher), "creature you control" (Pennon Blade)
//   attachments_on_source              "for each Aura attached to it" (Kor Spiritdancer), "Aura and Equipment" (Strong Back)
//   controller_hand_size               "for each card in your hand" (Dread Slag)
//   controller_graveyard_cards_of_type "for each creature card in your graveyard" (Fiend Artisan)
// The spec's sourcePermanentId is the counted-around permanent (the creature itself, or an Aura/Equipment host).
// Public entry symbols: resolveExtendedCountMultiplier.

import { landAwareTypeLine } from './effectiveLandTypeLine.js';
import { readDerivedStaticEffectSpecs } from './staticEffectSpec.js';

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
  grant?: { countBasis?: string; countCardType?: string; countAttachmentKinds?: readonly string[]; countExcludeSource?: boolean;
    countCounterType?: string; countWho?: string; countKeyword?: string };
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
      return battlefield.filter((p) => String(p?.controller || '') === controller && (!wanted || new RegExp('\\b' + wanted + '\\b').test(typeLine(p)))
        && !(skip && String(p?.id || '') === skip)).length;
    }
    case 'attachments_on_source': {
      const hostId = String(spec.sourcePermanentId || '');
      const kinds = (grant.countAttachmentKinds || []).map((k) => String(k).toLowerCase());
      return battlefield.filter((p) => hostId && String(p?.attachedTo || '') === hostId && kinds.some((k) => typeLine(p).includes(k))).length;
    }
    case 'controller_hand_size': {
      const zone = controllerZone(spec, state);
      if (typeof zone?.handCount === 'number' && Number.isFinite(zone.handCount)) return Math.max(0, Math.floor(zone.handCount));
      return Array.isArray(zone?.hand) ? zone.hand.length : 0;
    }
    case 'controller_graveyard_cards_of_type': {
      const graveyard = controllerZone(spec, state)?.graveyard;
      const wanted = String(grant.countCardType || '').toLowerCase();
      return Array.isArray(graveyard) ? graveyard.filter((c: any) => !wanted || String(c?.type_line || c?.card?.type_line || '').toLowerCase().includes(wanted)).length : 0;
    }
    case 'controller_lands_of_subtype': {
      const re = new RegExp('\\b' + String(grant.countCardType || '').toLowerCase() + '\\b');
      return controlledLandTypeLines(controller, battlefield, state).filter((tl) => re.test(tl)).length;
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
      return battlefield.filter((p) => p && !p.phasedOut && /\bcreature\b/.test(typeLine(p))
        && !(skip && String(p?.id || '') === skip) && permanentHasKeyword(p, kw, state)).length;
    }
    default:
      return undefined;
  }
}
