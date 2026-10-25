// server/src/state/modules/viewPermanentRulesStatus.ts
// Read-only per-permanent UI hints for the client view: ability loss (Humility / Turn to Frog),
// Arrest-style activation locks, timestamped control changes (who controls a stolen permanent and
// until when) and layer 4 added types (Opalescence-style). Never mutates state.
// Public entry symbols: computePermanentRulesStatus, PermanentRulesStatus.

import { permanentLosesAllAbilities } from '../../../../rules-engine/src/permanentKeywordAbilities.js';
import { permanentActivatedAbilitiesLockedByAttachment } from './staticActivationLockFromAttachments.js';
import { permanentCannotActivateTapAbilities } from './staticEffectSpecActivationLocks.js';
import { opponentActivationProhibitionReason } from './opponentActivationLocks.js'; // UI33
import { LAYER4_ADDED_TYPES_FIELD } from './layer4TypeSetting.js';
import { pushConditionalAttachedPTSpecs } from './staticEffectSpec-handlers/staticEffectSpecOracleParsingConditionalAttachedPT.js';
import { specMatchesStaticCondition } from './staticEffectSpecConditionEval.js';
import { parseAttachedTypeSettingFromOracle } from './attachedTypeSettingStamp.js';
import { computePtBreakdown, type PtBreakdownLine } from './viewPermanentPtBreakdown.js';
import { computeGrantedCrew, type GrantedCrewInfo } from './viewPermanentCharacteristics.js';
import { computeCopyInfo, computeEffectiveLandTypeLine, computeConditionalStatics, type CopyInfo, type ConditionalStaticLine } from './viewPermanentCharacteristics.js';

export interface PermanentRulesStatus {
  abilitiesLost?: true;
  activationLocked?: { sourceName?: string; manaAbilitiesAllowed: boolean };
  tapAbilitiesLocked?: true;
  control?: { owner: string; controller: string; duration: 'end_of_turn' | 'indefinite' };
  addedTypes?: string[];
  /** Type-setting Aura override (Imprisoned in the Moon): replacement type line, colour, creature-ness. */
  typeOverride?: { typeLine: string; colorless: boolean; isCreature: boolean; sourceName?: string };
  /** Made a creature by an attached Aura (Ensoul Artifact). */
  animatedByAttachment?: true;
  /** Conditional attached P/T bonuses (Black Scarab, Twisted Embrace) and whether each currently applies. */
  conditionalPtBonuses?: Array<{ sourceName: string; power: number; toughness: number; active: boolean; condition?: string; otherwise?: true }>;
  /** P/T provenance: Otherwise halves, counter-scaled bonuses, devotion / graveyard CDA bases. */
  ptBreakdown?: PtBreakdownLine[];
  /** Copy effect: copied name / type line / P/T (with "except" additions). */
  copyOf?: CopyInfo;
  /** Effective type line when land-type effects changed its basic land types. */
  effectiveLandTypeLine?: string;
  /** Commander / life / entered-this-turn conditional statics from this permanent, on or off. */
  conditionalStatics?: ConditionalStaticLine[];
  /** Crew granted by another permanent ("Vehicles you control have crew N"). */
  grantedCrew?: GrantedCrewInfo;
}

function conditionalBonuses(perm: any, state: any, battlefield: any[]): PermanentRulesStatus['conditionalPtBonuses'] {
  const id = String(perm.id || '');
  if (!id) return undefined;
  const out: NonNullable<PermanentRulesStatus['conditionalPtBonuses']> = [];
  const o = perm.typeSetOverride;
  const baseLine = String(o?.typeLine || perm.card?.type_line || '');
  const typeLine = perm.notCreature !== true && perm.isCreature === true && !/creature/i.test(baseLine) ? baseLine + ' Creature' : baseLine;
  const host = { ...perm, card: { ...(perm.card || {}), type_line: typeLine } };
  for (const src of battlefield) {
    if (!src || String(src.attachedTo || '') !== id) continue;
    const sourceName = String(src.card?.name || 'Attachment');
    const specs: any[] = [];
    const oracleLines = String(src.card?.oracle_text || '').replace(/\u2019/g, "'").split(/\n+/);
    pushConditionalAttachedPTSpecs(specs, { sourcePermanentId: String(src.id || ''), sourceController: String(src.controller || ''), sourceName }, src, String(src.card?.oracle_text || ''));
    for (const spec of specs) {
      const power = Number(spec.grant?.power || 0);
      const toughness = Number(spec.grant?.toughness || 0);
      if (!power && !toughness) continue;
      let active = false;
      try { active = specMatchesStaticCondition(host, spec, state); } catch { active = false; }
      const idx = Number(String(spec.id || '').split(':').pop());
      const condMatch = /as long as ([^.,]+)/i.exec(oracleLines[idx] || '');
      const otherwise = /attached-conditional-pt-otherwise:/.test(String(spec.id || ''));
      out.push({ sourceName, power, toughness, active, ...(condMatch ? { condition: condMatch[1].trim() } : {}), ...(otherwise ? { otherwise: true as const } : {}) });
    }
  }
  return out.length ? out : undefined;
}

const TEMPORARY = new Set(['eot', 'turn', 'until_end_of_turn', 'this_turn']);

function newestControlEntry(state: any, permId: string): any {
  let best: any;
  for (const field of ['controlChangeEffects', 'permanentControlEffects']) {
    const list = Array.isArray(state?.[field]) ? state[field] : [];
    for (const e of list) {
      if (!e || String(e.permanentId || '') !== permId) continue;
      if (!best || Number(e.ceTimestamp || 0) >= Number(best.ceTimestamp || 0)) best = e;
    }
  }
  return best;
}

export function computePermanentRulesStatus(perm: any, state: any): PermanentRulesStatus | undefined {
  if (!perm) return undefined;
  const out: PermanentRulesStatus = {};
  const battlefield = Array.isArray(state?.battlefield) ? state.battlefield : [];
  try { if (permanentLosesAllAbilities(perm, battlefield)) out.abilitiesLost = true; } catch { /* best-effort */ }
  try {
    const nonMana = permanentActivatedAbilitiesLockedByAttachment(perm, state, false);
    if (nonMana.locked) {
      const mana = permanentActivatedAbilitiesLockedByAttachment(perm, state, true);
      out.activationLocked = { sourceName: nonMana.sourceName, manaAbilitiesAllowed: !mana.locked };
    }
  } catch { /* best-effort */ }
  // UI33: opponent activation lock (Grand Abolisher, Myrel) greys the ability badges via activationLocked.
  try {
    if (!out.activationLocked && perm.controller) {
      const reason = opponentActivationProhibitionReason(state, String(perm.controller), perm, false);
      if (reason) {
        const manaReason = opponentActivationProhibitionReason(state, String(perm.controller), perm, true);
        out.activationLocked = { sourceName: reason.split(' prevents activating')[0], manaAbilitiesAllowed: !manaReason };
      }
    }
  } catch { /* best-effort */ }
  try { if (permanentCannotActivateTapAbilities(perm, state)) out.tapAbilitiesLocked = true; } catch { /* best-effort */ }
  const owner = String(perm.owner || '');
  const controller = String(perm.controller || '');
  if (owner && controller && owner !== controller) {
    const entry = newestControlEntry(state, String(perm.id || ''));
    const temporary = entry ? TEMPORARY.has(String(entry.duration || '').toLowerCase()) : false;
    out.control = { owner, controller, duration: temporary ? 'end_of_turn' : 'indefinite' };
  }
  const added = (perm as any)[LAYER4_ADDED_TYPES_FIELD];
  if (Array.isArray(added) && added.length > 0) out.addedTypes = added.map(String);
  const o = perm.typeSetOverride;
  if (o && typeof o.typeLine === 'string' && o.typeLine) {
    const hostId = String(perm.id || '');
    const src = battlefield.find((p: any) => p && String(p.id || '') === String(o.sourceId || ''))
      || battlefield.find((p: any) => p && String(p.attachedTo || '') === hostId && !!parseAttachedTypeSettingFromOracle(p.card?.oracle_text));
    out.typeOverride = { typeLine: o.typeLine, colorless: o.colorless === true, isCreature: Array.isArray(o.cardTypes) && o.cardTypes.includes('creature'), ...(src?.card?.name ? { sourceName: String(src.card.name) } : {}) };
  }
  if (perm.isCreatureFromAttachment === true) out.animatedByAttachment = true;
  try { const b = conditionalBonuses(perm, state, battlefield); if (b) out.conditionalPtBonuses = b; } catch { /* best-effort */ }
  try { const b = computePtBreakdown(perm, state); if (b) out.ptBreakdown = b; } catch { /* best-effort */ }
  try { const c = computeCopyInfo(perm); if (c) out.copyOf = c; } catch { /* best-effort */ }
  try { const l = computeEffectiveLandTypeLine(perm, state); if (l) out.effectiveLandTypeLine = l; } catch { /* best-effort */ }
  try { const s = computeConditionalStatics(perm, state); if (s) out.conditionalStatics = s; } catch { /* best-effort */ }
  try { const g = computeGrantedCrew(perm, state); if (g) out.grantedCrew = g; } catch { /* best-effort */ }
  return Object.keys(out).length > 0 ? out : undefined;
}
