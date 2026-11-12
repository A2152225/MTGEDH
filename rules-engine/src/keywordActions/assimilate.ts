/**
 * Rule 701.72: Assimilate
 *
 * 701.72a To assimilate a permanent, gain control of it and put a +1/+1
 * counter on it. It becomes a Borg artifact creature.
 *
 * 701.72b To assimilate a permanent card that's in a zone other than the
 * battlefield, put it onto the battlefield under your control with a +1/+1
 * counter on it. It's a Borg artifact creature.
 *
 * 701.72c An object may have an ability that assimilates another object and
 * another ability that refers to permanents "assimilated with [this object]."
 * These abilities are linked (see rule 607).
 *
 * Reference: MagicCompRules 20261106.txt
 */

export interface AssimilateAction {
  readonly type: 'assimilate';
  readonly controllerId: string;
  readonly targetId: string;
  readonly fromZone: 'battlefield' | 'other';
  readonly sourceId?: string;
}

export interface AssimilateResult {
  readonly controllerId: string;
  readonly targetId: string;
  readonly gainedControl: boolean;
  readonly enteredBattlefield: boolean;
  readonly plusOnePlusOneCounters: number;
  readonly becomesBorgArtifactCreature: true;
  readonly assimilatedWithSourceId?: string;
}

export const ASSIMILATED_TYPE_LINE = 'Artifact Creature — Borg';

/**
 * Rule 701.72a/b: create an assimilate action from the battlefield or another zone.
 */
export function assimilate(
  controllerId: string,
  targetId: string,
  fromZone: 'battlefield' | 'other',
  sourceId?: string,
): AssimilateAction {
  return {
    type: 'assimilate',
    controllerId,
    targetId,
    fromZone,
    sourceId,
  };
}

export function createAssimilateResult(action: AssimilateAction): AssimilateResult {
  const fromBattlefield = action.fromZone === 'battlefield';
  return {
    controllerId: action.controllerId,
    targetId: action.targetId,
    gainedControl: fromBattlefield,
    enteredBattlefield: !fromBattlefield,
    plusOnePlusOneCounters: 1,
    becomesBorgArtifactCreature: true,
    assimilatedWithSourceId: action.sourceId,
  };
}

/**
 * Rule 701.72c: "assimilated with [this object]" refers only to permanents
 * assimilated by the linked assimilate ability of that source.
 */
export function isAssimilatedWithSource(
  permanent: { assimilatedBySourceId?: string; assimilated?: { sourceId?: string } },
  sourceId: string,
): boolean {
  const sid = String(sourceId || '').trim();
  if (!sid) return false;
  return permanent.assimilatedBySourceId === sid || permanent.assimilated?.sourceId === sid;
}
