// server/src/state/modules/attackBlockTapCost.ts
// B61: Hollow Warrior ? "~ can't attack or block unless you tap an untapped creature you control
// not declared as an attacking or blocking creature this combat."
// Detection + eligible-tap helpers. Payment UX (creature picker at declare attackers/blockers)
// is a follow-up UI task.
// Public entry symbols: oracleRequiresTapCreatureAttackBlockCost, permanentRequiresTapCreatureAttackBlockCost,
// eligibleTapCreaturesForAttackBlockCost.

const COST_RE =
  /(?:this creature|~) can(?:not|'t) attack or block unless you tap an untapped creature you control not declared as an attacking or blocking creature this combat/i;

function lowerOracle(text: unknown): string {
  return String(text || '').toLowerCase().replace(/[\u2018\u2019]/g, "'");
}

function selfRefOracle(permanent: any): string {
  const name = String(permanent?.card?.name || '').toLowerCase().trim();
  let text = lowerOracle(permanent?.card?.oracle_text || permanent?.oracle_text);
  if (name) {
    text = text.split(name).join('~');
    const short = name.split(' // ')[0].split(',')[0].trim();
    if (short && short !== name) text = text.split(short).join('~');
  }
  return text.replace(/this creature/g, '~');
}

export function oracleRequiresTapCreatureAttackBlockCost(oracle: string): boolean {
  return COST_RE.test(lowerOracle(oracle).replace(/this creature/g, '~'));
}

export function permanentRequiresTapCreatureAttackBlockCost(permanent: any): boolean {
  return !!permanent && COST_RE.test(selfRefOracle(permanent));
}

/** Untapped creatures you control that are not already attacking or blocking this combat. */
export function eligibleTapCreaturesForAttackBlockCost(
  battlefield: readonly any[],
  controllerId: string,
  excludeId?: string,
): any[] {
  const pid = String(controllerId || '');
  const skip = String(excludeId || '');
  return (Array.isArray(battlefield) ? battlefield : []).filter((p: any) => {
    if (!p || p.phasedOut) return false;
    if (String(p.controller || '') !== pid) return false;
    if (skip && String(p.id || '') === skip) return false;
    if (p.tapped === true) return false;
    if (p.attacking || p.blocking) return false;
    const tl = String(p.card?.type_line || p.type_line || '').toLowerCase();
    return /\bcreature\b/.test(tl);
  });
}
