// server/src/state/modules/flagbearerTargeting.ts
// Batch 29: Flagbearer targeting requirement (Standard Bearer, Coalition Flag, Coalition Honor Guard):
//   "While an opponent is choosing targets as part of casting a spell they control or activating an ability they
//    control, that player chooses at least one Flagbearer on the battlefield if able."
//   "While choosing targets as part of casting a spell or activating an ability, your opponents must choose at
//    least one Flagbearer on the battlefield if able."
// A Flagbearer is a permanent with the subtype, or one enchanted by "enchanted creature is a flagbearer".
// Applies to TARGET_SELECTION steps for spell casts (spellCastContext) and activated abilities only.
// Origin parents: resolution-handlers/targetSelectionResponseHandlers.ts (human validation) and
// ai-handlers/aiResolutionTriggerAndChoiceSteps.ts (AI correction).
// Public entry symbols: flagbearerRequiredTargetIds, violatesFlagbearerRequirement, applyFlagbearerRequirement.

const SOURCE_RES = [
  /while an opponent is choosing targets as part of casting a spell they control or activating an ability they control, that player chooses at least one flagbearer/,
  /while choosing targets as part of casting a spell or activating an ability, your opponents must choose at least one flagbearer/,
];

function textOf(perm: any): string {
  return String(perm?.card?.oracle_text || perm?.oracle_text || '').replace(/\u2019/g, "'").toLowerCase();
}

function isFlagbearer(perm: any, battlefield: readonly any[]): boolean {
  if (/\bflagbearer\b/i.test(String(perm?.card?.type_line || perm?.type_line || ''))) return true;
  const id = String(perm?.id || '');
  return battlefield.some((p: any) => String(p?.attachedTo || '') === id && /enchanted creature is a flagbearer/.test(textOf(p)));
}

function isCastOrActivateStep(step: any): boolean {
  return Boolean(
    step?.spellCastContext ||
    step?.battlefieldAbilityTargetSelection === true ||
    step?.activatedAbilityId ||
    step?.abilityActivation === true ||
    step?.isActivatedAbility === true,
  );
}

/** Ids among the step's valid targets that satisfy an applicable Flagbearer requirement ([] = no requirement). */
export function flagbearerRequiredTargetIds(state: any, playerId: string, step: any): string[] {
  if (!isCastOrActivateStep(step)) return [];
  const battlefield: any[] = Array.isArray(state?.battlefield) ? state.battlefield : [];
  const applies = battlefield.some((p: any) =>
    p && String(p.controller || '') !== String(playerId) && SOURCE_RES.some((re) => re.test(textOf(p))));
  if (!applies) return [];
  const byId = new Map(battlefield.map((p: any) => [String(p?.id || ''), p]));
  const valid: any[] = Array.isArray(step?.validTargets) ? step.validTargets : [];
  return valid
    .map((t: any) => String(t?.id || t || ''))
    .filter((id) => byId.has(id) && isFlagbearer(byId.get(id), battlefield));
}

export function violatesFlagbearerRequirement(state: any, playerId: string, step: any, selections: readonly string[]): boolean {
  const required = flagbearerRequiredTargetIds(state, playerId, step);
  if (required.length === 0) return false;
  return !selections.some((id) => required.includes(String(id)));
}

/** AI: swap the last chosen target for a Flagbearer when the requirement is unmet. */
export function applyFlagbearerRequirement(state: any, playerId: string, step: any, selections: any[]): any[] {
  if (!Array.isArray(selections) || selections.length === 0) return selections;
  const ids = selections.map((s: any) => String(typeof s === 'string' ? s : s?.id || ''));
  if (!violatesFlagbearerRequirement(state, playerId, step, ids)) return selections;
  const required = flagbearerRequiredTargetIds(state, playerId, step);
  const out = [...ids];
  out[out.length - 1] = required[0];
  return out;
}
