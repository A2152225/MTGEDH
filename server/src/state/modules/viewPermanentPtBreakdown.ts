// server/src/state/modules/viewPermanentPtBreakdown.ts
// Read-only P/T provenance lines for the client tooltip: "Otherwise" halves of conditional statics
// (conditionNegated, any condition kind), counter-scaled bonuses ("+1/+0 \u00d7 3 charge counters on Sigil")
// and variable CDA bases (devotion, graveyard counts with their scope). Never mutates state.
// Public entry symbols: computePtBreakdown, PtBreakdownLine.

import { specMatchesStaticCondition } from './staticEffectSpecConditionEval.js';
import { resolvePhase5CountMultiplier } from './staticEffectSpecPhase5Eval.js';
import { permanentMatchesScopeQualifier } from './staticEffectSpecScopeQualifier.js';
import { calculateDevotionCDA, calculateGraveyardCardTypesCDA } from '../utils-handlers/variablePTControlledCountCDA.js';

export interface PtBreakdownLine {
  kind: 'otherwise' | 'counters' | 'devotion' | 'graveyard';
  text: string;
  active?: boolean;
  /** Spec source name, so the client can drop the duplicate per-source P/T line. */
  sourceName?: string;
}

function signed(n: number): string {
  return n >= 0 ? '+' + n : String(n);
}

const article = (w: string) => (/^[aeiou]/i.test(w) ? 'an ' : 'a ') + w;

/** Readable text for a static condition ("it isn't a creature", "an opponent controls a black permanent"). */
export function describeCondition(c: any): string {
  if (!c || typeof c !== 'object') return 'its condition';
  const what = [c.color, c.cardType || c.creatureType || c.landType].filter(Boolean).map(String).join(' ');
  const n = Number(c.amount ?? c.count ?? 0);
  switch (String(c.kind || '')) {
    case 'target_has_type': case 'target_has_creature_type': return `it is ${article(what || 'match')}`;
    case 'target_lacks_type': case 'target_lacks_creature_type': return `it isn't ${article(what || 'match')}`;
    case 'target_has_keyword': return `it has ${c.keyword}`;
    case 'target_lacks_keyword': return `it doesn't have ${c.keyword}`;
    case 'target_has_counter': return `it has ${article(String(c.counterType || ''))} counter on it`;
    case 'opponent_controls_matching': return `an opponent controls ${article(what || 'permanent')}`;
    case 'source_controller_controls_matching': return `you control ${n > 1 ? n + ' or more ' + what + 's' : article(what || 'permanent')}`;
    case 'source_counter_at_least': return `it has ${n} or more ${c.counterType} counters`;
    case 'source_controller_life_at_least': return `you have ${n} or more life`;
    case 'source_chose_option': return `"${c.option}" was chosen`;
    case 'source_controller_is_monarch': return 'you are the monarch';
    case 'source_controller_has_threshold': return 'you have threshold';
    case 'during_source_controller_turn': return "it's your turn";
    case 'controls_your_commander': return 'you control your commander';
    case 'target_entered_this_turn': return 'it entered this turn';
    case 'source_controller_life_at_most_half_starting': return 'your life is at most half your starting life';
    default: {
      const phrase = String(c.kind || 'condition').replace(/^target_/, 'it ').replace(/^source_controller_/, 'you ')
        .replace(/^source_/, 'the source ').replace(/^controller_/, 'you ').replace(/_/g, ' ').replace(/\bis not\b/, "isn't");
      const bits = [what, c.keyword, c.counterType, c.option, n ? String(n) : ''].filter(Boolean).join(' ');
      return bits ? phrase + ' (' + bits + ')' : phrase;
    }
  }
}

function specConditionText(spec: any): string {
  const list = [spec.condition, ...(Array.isArray(spec.conditions) ? spec.conditions : [])].filter(Boolean);
  return list.length ? list.map(describeCondition).join(' and ') : 'its condition';
}

function appliesToHost(spec: any, id: string): boolean {
  return String(spec?.sourcePermanentId || '') === id && (spec?.scope?.kind === 'self' || !!spec?.effectSourcePermanentId);
}

function typeLineOf(p: any): string {
  return String(p?.card?.type_line || p?.type_line || '').toLowerCase();
}

/** Cheap subset of the engine's scope match, for lords / anthems (counter-scaled lines only). */
function lordScopeMatches(spec: any, perm: any): boolean {
  const scope = spec?.scope || {};
  if (scope.qualifier && !permanentMatchesScopeQualifier(perm, scope.qualifier)) return false;
  const isCreature = perm?.notCreature !== true && (/\bcreature\b/.test(typeLineOf(perm)) || perm?.isCreature === true);
  const mine = String(perm?.controller || '') === String(spec?.sourceController || '');
  const self = String(perm?.id || '') === String(spec?.sourcePermanentId || '');
  const typed = !scope.creatureType || new RegExp('\\b' + String(scope.creatureType).toLowerCase() + '\\b').test(typeLineOf(perm));
  switch (String(scope.kind || '')) {
    case 'all_creatures': case 'all_creatures_of_type': return isCreature && typed;
    case 'other_all_creatures': case 'other_all_creatures_of_type': return isCreature && typed && !self;
    case 'creatures_you_control': return isCreature && mine && typed;
    case 'other_creatures_you_control': return isCreature && mine && !self && typed;
    case 'opponent_creatures': case 'opponent_creatures_of_type': return isCreature && !mine && typed;
    default: return false;
  }
}

function cdaLines(perm: any, state: any, battlefield: any[]): PtBreakdownLine[] {
  const oracle = String(perm?.card?.oracle_text || '');
  const lower = oracle.toLowerCase().replace(/\u2019/g, "'");
  const out: PtBreakdownLine[] = [];
  const dev = lower.match(/power (?:and toughness are each|is) equal to your devotion to (white|blue|black|red|green)(?: and (white|blue|black|red|green))?/);
  if (dev) {
    const r = calculateDevotionCDA(oracle, battlefield, perm.controller, perm.card?.toughness);
    if (r) out.push({ kind: 'devotion', text: `Power = devotion to ${[dev[1], dev[2]].filter(Boolean).join(' and ')} (${r.power})` });
  }
  const gy = lower.match(/equal to the number of ((?:card types among )?(?:[a-z ]+ )?cards) in (all graveyards|graveyards|your graveyard|your opponents' graveyards|opponents' graveyards)(?:[^.]*?plus (\d+))?/);
  if (gy) {
    const r = calculateGraveyardCardTypesCDA(oracle, state, perm.controller);
    if (r) {
      const n = r.power - (/power and toughness are each/.test(lower) ? Number(gy[3] || 0) : 0);
      out.push({ kind: 'graveyard', text: `Number of ${gy[1]} in ${gy[2]}: ${n}` + (gy[3] ? ` (toughness +${gy[3]})` : '') });
    }
  }
  return out;
}

export function computePtBreakdown(perm: any, state: any): PtBreakdownLine[] | undefined {
  const id = String(perm?.id || '');
  if (!id) return undefined;
  const battlefield: any[] = Array.isArray(state?.battlefield) ? state.battlefield : [];
  const out: PtBreakdownLine[] = [];
  try { out.push(...cdaLines(perm, state, battlefield)); } catch { /* best-effort */ }
  const specs: any[] = Array.isArray(state?._derivedStaticEffectSpecs) ? state._derivedStaticEffectSpecs : [];
  for (const spec of specs) {
    const onHost = appliesToHost(spec, id);
    const lord = !onHost && spec.grant?.countBasis === 'source_counters' && lordScopeMatches(spec, perm);
    if (!onHost && !lord) continue;
    // Attached conditional P/T is reported by conditionalPtBonuses already.
    if (/attached-conditional-pt/.test(String(spec.id || ''))) continue;
    const p = Number(spec.grant?.power || 0);
    const t = Number(spec.grant?.toughness || 0);
    if (!p && !t) continue;
    const name = String(spec.sourceName || 'Unknown');
    if (spec.conditionNegated) {
      let active = false;
      try { active = specMatchesStaticCondition(perm, spec, state); } catch { active = false; }
      out.push({ kind: 'otherwise', active, sourceName: name, text: `${name}: ${signed(p)}/${signed(t)} otherwise (unless ${specConditionText(spec)}) ${active ? '(active)' : '(inactive)'}` });
    } else if (spec.grant?.countBasis === 'source_counters') {
      let n = 0;
      try { n = resolvePhase5CountMultiplier(spec, battlefield, state); } catch { n = 0; }
      const holderId = spec.grant.countOnEffectSource && spec.effectSourcePermanentId ? spec.effectSourcePermanentId : spec.sourcePermanentId;
      const holder = battlefield.find((b) => String(b?.id || '') === String(holderId || ''));
      const ctype = String(spec.grant.countCounterType || '');
      out.push({ kind: 'counters', sourceName: name, text: `${name}: ${signed(p)}/${signed(t)} \u00d7 ${n} ${ctype} counter${n === 1 ? '' : 's'} on ${holder?.card?.name || name} = ${signed(p * n)}/${signed(t * n)}` });
    }
  }
  return out.length ? out : undefined;
}
