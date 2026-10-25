// server/src/state/modules/viewPermanentCharacteristics.ts
// Read-only characteristic hints for the client view: copy effects (name / type line / P/T taken from the copied
// card plus "except" additions such as Phyrexian Metamorph's Artifact), effective basic land types (Evil Presence,
// Blood Moon, Leyline-style "every basic land type") and on/off status of commander / life / entered-this-turn
// conditional statics (Thrasta, Bhaal, Myrkul). Never mutates state.
// Public entry symbols: computeCopyInfo, computeEffectiveLandTypeLine, computeConditionalStatics.

import { landAwareTypeLine } from './effectiveLandTypeLine.js';
import { getGrantedVehicleCrewValue } from '../../socket/crewGrantedVehicleCrew.js';
import { specMatchesStaticCondition } from './staticEffectSpecConditionEval.js';
import { describeCondition } from './viewPermanentPtBreakdown.js';

export interface CopyInfo { name: string; typeLine: string; power?: string; toughness?: string; originalName?: string; additions?: string[] }
export interface ConditionalStaticLine { sourceName: string; text: string; active: boolean }

export function computeCopyInfo(perm: any): CopyInfo | undefined {
  if (!perm || (!perm.copiedFromPermanentId && !perm.copiedFromCardId)) return undefined;
  const card = perm.card || {};
  const name = String(card.name || perm.name || '').trim();
  if (!name) return undefined;
  const ex = perm.copyEntryExceptions;
  const additions: string[] = [];
  if (ex) {
    for (const t of [...(ex.addCardTypes || []), ...(ex.addSubtypes || [])]) additions.push(String(t));
    if (ex.notLegendary) additions.push('not legendary');
    if (ex.basePT) additions.push(ex.basePT.power + '/' + ex.basePT.toughness);
  }
  const originalName = String(perm.preCopyCardSnapshot?.name || '').trim();
  return {
    name,
    typeLine: String(card.type_line || perm.type_line || ''),
    ...(card.power !== undefined && card.power !== null ? { power: String(card.power) } : {}),
    ...(card.toughness !== undefined && card.toughness !== null ? { toughness: String(card.toughness) } : {}),
    ...(originalName && originalName !== name ? { originalName } : {}),
    ...(additions.length ? { additions } : {}),
  };
}

const BASICS = ['plains', 'island', 'swamp', 'mountain', 'forest'];
const basicsIn = (s: string) => BASICS.filter((b) => new RegExp('\\b' + b + '\\b', 'i').test(s));
const titleCase = (s: string) => s.replace(/\b([a-z])/g, (m) => m.toUpperCase());

/** Effective type line when land-type effects change a land's basic types; undefined when unchanged. */
export function computeEffectiveLandTypeLine(perm: any, state: any): string | undefined {
  const printed = String(perm?.typeSetOverride?.typeLine || perm?.card?.type_line || '');
  if (!/\bland\b/i.test(printed)) return undefined;
  const eff = landAwareTypeLine(state, perm, printed);
  const a = basicsIn(printed).sort().join(',');
  const b = basicsIn(eff).sort().join(',');
  if (a === b) return undefined;
  return titleCase(eff);
}

const WATCHED = new Set(['controls_your_commander', 'target_entered_this_turn', 'source_controller_life_at_most_half_starting']);

const SCOPE_TEXT: Record<string, string> = {
  self: 'it', creatures_you_control: 'creatures you control', other_creatures_you_control: 'other creatures you control',
  all_creatures: 'all creatures', opponent_creatures: "opponents' creatures", permanents_you_control: 'permanents you control',
  player_you: 'you',
};

function grantText(g: any): string {
  const bits: string[] = [];
  const p = Number(g?.power || 0), t = Number(g?.toughness || 0);
  if (p || t) bits.push((p >= 0 ? '+' : '') + p + '/' + (t >= 0 ? '+' : '') + t);
  if (Array.isArray(g?.abilities)) bits.push(...g.abilities.map(String));
  if (g?.playerHexproof) bits.push('hexproof');
  return bits.join(', ') || 'its effect';
}

/** Conditional statics this permanent is the source of (commander / life / entered-this-turn) with on/off status. */
export function computeConditionalStatics(perm: any, state: any): ConditionalStaticLine[] | undefined {
  const id = String(perm?.id || '');
  if (!id) return undefined;
  const specs: any[] = Array.isArray(state?._derivedStaticEffectSpecs) ? state._derivedStaticEffectSpecs : [];
  const out: ConditionalStaticLine[] = [];
  const seen = new Set<string>();
  for (const spec of specs) {
    if (String(spec?.sourcePermanentId || '') !== id) continue;
    const conds = [spec.condition, ...(Array.isArray(spec.conditions) ? spec.conditions : [])].filter(Boolean);
    if (!conds.some((c: any) => WATCHED.has(String(c?.kind || '')))) continue;
    let active = false;
    try { active = specMatchesStaticCondition(perm, spec, state); } catch { active = false; }
    const scope = SCOPE_TEXT[String(spec.scope?.kind || '')] || String(spec.scope?.kind || 'it').replace(/_/g, ' ');
    const cond = conds.map(describeCondition).join(' and ');
    const sourceName = String(spec.sourceName || perm.card?.name || 'Permanent');
    const text = `${grantText(spec.grant)} for ${scope} ${spec.conditionNegated ? 'unless' : 'while'} ${cond}`;
    if (seen.has(text)) continue;
    seen.add(text);
    out.push({ sourceName, text, active });
  }
  return out.length ? out : undefined;
}

export interface GrantedCrewInfo { value: number; sourceName: string }

/** "Vehicles you control have crew N" granted to this Vehicle: cheapest value and its source. */
export function computeGrantedCrew(perm: any, state: any): GrantedCrewInfo | undefined {
  const controller = String(perm?.controller || '');
  if (!controller || !/\bvehicle\b/i.test(String(perm?.card?.type_line || ''))) return undefined;
  let best: GrantedCrewInfo | undefined;
  for (const src of (state?.battlefield || []) as any[]) {
    const v = getGrantedVehicleCrewValue([src], controller, perm);
    if (v !== null && (!best || v < best.value)) best = { value: v, sourceName: String(src?.card?.name || 'a permanent') };
  }
  return best;
}
