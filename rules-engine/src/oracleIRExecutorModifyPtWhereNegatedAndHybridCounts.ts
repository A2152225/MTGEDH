import type { BattlefieldPermanent, GameState } from '../../shared/src';

type CountNegatedClass = (
  permanents: readonly BattlefieldPermanent[],
  base: string,
  excludedQualifier: string,
  excludedId?: string
) => number;
type GetExcludedId = () => string;
type ParseClassList = (value: string) => readonly string[] | null;
type ParseCardClassList = (value: string) => readonly string[] | null;
type CountByClasses = (permanents: readonly BattlefieldPermanent[], classes: readonly string[]) => number;
type CountCardsByClasses = (cards: readonly unknown[], classes: readonly string[]) => number;
type FindPlayerById = (id: string) => any;

export function tryEvaluateModifyPtWhereNegatedAndHybridCounts(args: {
  state: GameState;
  raw: string;
  battlefield: readonly BattlefieldPermanent[];
  controlled: readonly BattlefieldPermanent[];
  opponentsControlled: readonly BattlefieldPermanent[];
  controllerId: string;
  countNegatedClass: CountNegatedClass;
  getExcludedId: GetExcludedId;
  parseClassList: ParseClassList;
  parseCardClassList: ParseCardClassList;
  countByClasses: CountByClasses;
  countCardsByClasses: CountCardsByClasses;
  findPlayerById: FindPlayerById;
}): number | null {
  const {
    raw,
    battlefield,
    controlled,
    opponentsControlled,
    controllerId,
    countNegatedClass,
    getExcludedId,
    parseClassList,
    parseCardClassList,
    countByClasses,
    countCardsByClasses,
    findPlayerById,
  } = args;

  {
    const m = raw.match(/^x is the number of (other )?non[- ]?([a-z][a-z-]*) creatures you control$/i);
    if (m) {
      const isOther = Boolean(String(m[1] || '').trim());
      const excludedQualifier = String(m[2] || '').toLowerCase();
      const excludedId = isOther ? getExcludedId() : '';
      return countNegatedClass(controlled, 'creature', excludedQualifier, excludedId || undefined);
    }
  }

  {
    const m = raw.match(/^x is the number of (other )?non[- ]?([a-z][a-z-]*) creatures (?:your opponents control|an opponent controls|you don['â€™]?t control|you do not control)$/i);
    if (m) {
      const isOther = Boolean(String(m[1] || '').trim());
      const excludedQualifier = String(m[2] || '').toLowerCase();
      const excludedId = isOther ? getExcludedId() : '';
      return countNegatedClass(opponentsControlled, 'creature', excludedQualifier, excludedId || undefined);
    }
  }

  {
    const m = raw.match(/^x is the number of (other )?non[- ]?([a-z][a-z-]*) creatures on (?:the )?battlefield$/i);
    if (m) {
      const isOther = Boolean(String(m[1] || '').trim());
      const excludedQualifier = String(m[2] || '').toLowerCase();
      const excludedId = isOther ? getExcludedId() : '';
      return countNegatedClass(battlefield, 'creature', excludedQualifier, excludedId || undefined);
    }
  }

  {
    const m = raw.match(/^x is the number of (other )?non[- ]?([a-z][a-z-]*) permanents you control$/i);
    if (m) {
      const isOther = Boolean(String(m[1] || '').trim());
      const excludedQualifier = String(m[2] || '').toLowerCase();
      const excludedId = isOther ? getExcludedId() : '';
      return countNegatedClass(controlled, 'permanent', excludedQualifier, excludedId || undefined);
    }
  }

  {
    const m = raw.match(/^x is the number of (other )?non[- ]?([a-z][a-z-]*) permanents (?:your opponents control|an opponent controls|you don['â€™]?t control|you do not control)$/i);
    if (m) {
      const isOther = Boolean(String(m[1] || '').trim());
      const excludedQualifier = String(m[2] || '').toLowerCase();
      const excludedId = isOther ? getExcludedId() : '';
      return countNegatedClass(opponentsControlled, 'permanent', excludedQualifier, excludedId || undefined);
    }
  }

  {
    const m = raw.match(/^x is the number of (other )?non[- ]?([a-z][a-z-]*) permanents on (?:the )?battlefield$/i);
    if (m) {
      const isOther = Boolean(String(m[1] || '').trim());
      const excludedQualifier = String(m[2] || '').toLowerCase();
      const excludedId = isOther ? getExcludedId() : '';
      return countNegatedClass(battlefield, 'permanent', excludedQualifier, excludedId || undefined);
    }
  }

  {
    const m = raw.match(/^x is the number of (.+) you control plus (?:the number of )?(.+) cards? in your graveyard$/i);
    if (m) {
      const controlledClasses = parseClassList(String(m[1] || ''));
      const graveyardClasses = parseCardClassList(String(m[2] || ''));
      if (!controlledClasses || !graveyardClasses) return null;

      const controller = findPlayerById(controllerId);
      if (!controller) return null;
      const gy = Array.isArray(controller.graveyard) ? controller.graveyard : [];

      return countByClasses(controlled, controlledClasses) + countCardsByClasses(gy, graveyardClasses);
    }
  }

  return null;
}
