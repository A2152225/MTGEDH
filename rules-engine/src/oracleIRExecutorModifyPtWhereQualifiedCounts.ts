import type { BattlefieldPermanent } from '../../shared/src';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';

type PlayerLike = {
  readonly graveyard?: readonly unknown[];
  readonly hand?: readonly unknown[];
  readonly library?: readonly unknown[];
  readonly exile?: readonly unknown[];
};

type GetCardsFromPlayerZone = (player: PlayerLike, zone: string) => readonly unknown[] | null;
type FindPlayerById = (id: string) => PlayerLike | null;
type ResolveContextPlayer = () => PlayerLike | null;
type GetSourceRef = () => unknown;
type ParseCardClassList = (value: string) => readonly string[] | null;
type ParseClassList = (value: string) => readonly string[] | null;
type CountCardsByClasses = (cards: readonly unknown[], classes: readonly string[]) => number;
type CountByClasses = (pool: readonly BattlefieldPermanent[], classes: readonly string[], requiredColor?: string) => number;
type HasExecutorClass = (obj: unknown, klass: string) => boolean;

export function tryEvaluateModifyPtWhereQualifiedCounts(args: {
  raw: string;
  battlefield: readonly BattlefieldPermanent[];
  controllerId: string;
  ctx?: OracleIRExecutionContext;
  getCardsFromPlayerZone: GetCardsFromPlayerZone;
  findPlayerById: FindPlayerById;
  resolveContextPlayer: ResolveContextPlayer;
  getSourceRef: GetSourceRef;
  parseCardClassList: ParseCardClassList;
  parseClassList: ParseClassList;
  countCardsByClasses: CountCardsByClasses;
  countByClasses: CountByClasses;
  hasExecutorClass: HasExecutorClass;
}): number | null {
  const {
    raw,
    battlefield,
    controllerId,
    ctx,
    getCardsFromPlayerZone,
    findPlayerById,
    resolveContextPlayer,
    getSourceRef,
    parseCardClassList,
    parseClassList,
    countCardsByClasses,
    countByClasses,
    hasExecutorClass,
  } = args;

  {
    const m = raw.match(/^x is the number of (.+) cards? in your (graveyard|hand|library|exile)$/i);
    if (m) {
      const classes = parseCardClassList(String(m[1] || ''));
      if (!classes) return null;
      const zone = String(m[2] || '').toLowerCase();
      const controller = findPlayerById(controllerId);
      if (!controller) return null;
      const cards = getCardsFromPlayerZone(controller, zone);
      if (!cards) return null;
      return countCardsByClasses(cards, classes);
    }
  }

  {
    const m = raw.match(/^x is the number of (.+) cards? in its controller['Ã¢â‚¬â„¢]?s graveyard$/i);
    if (m) {
      const classes = parseCardClassList(String(m[1] || ''));
      if (!classes) return null;
      const sourceObj = getSourceRef();
      if (!sourceObj) return null;
      const sourceControllerId = String((sourceObj as any)?.controller || (sourceObj as any)?.controllerId || '').trim();
      if (!sourceControllerId) return null;
      const player = findPlayerById(sourceControllerId);
      if (!player) return null;
      const gy = Array.isArray(player.graveyard) ? player.graveyard : [];
      return countCardsByClasses(gy, classes);
    }
  }

  {
    const m = raw.match(/^x is the number of (.+) cards? in target (?:opponent|player)['Ã¢â‚¬â„¢]?s (graveyard|hand|library|exile)$/i);
    if (m) {
      const classes = parseCardClassList(String(m[1] || ''));
      if (!classes) return null;
      const zone = String(m[2] || '').toLowerCase();
      const player = resolveContextPlayer();
      if (!player) return null;
      const cards = getCardsFromPlayerZone(player, zone);
      if (!cards) return null;
      return countCardsByClasses(cards, classes);
    }
  }

  {
    const m = raw.match(/^x is the number of (.+) cards? in (?:that player's|their) (graveyard|hand|library|exile)$/i);
    if (m) {
      const classes = parseCardClassList(String(m[1] || ''));
      if (!classes) return null;
      const zone = String(m[2] || '').toLowerCase();
      const player = resolveContextPlayer();
      if (!player) return null;
      const cards = getCardsFromPlayerZone(player, zone);
      if (!cards) return null;
      return countCardsByClasses(cards, classes);
    }
  }

  {
    const m = raw.match(/^x is the number of (.+) on the battlefield$/i);
    if (m) {
      const classes = parseClassList(String(m[1] || ''));
      if (classes) {
        return countByClasses(battlefield, classes);
      }
    }
  }

  {
    const m = raw.match(/^x is the number of other creatures on (?:the )?battlefield$/i);
    if (m) {
      const sourceId = String(ctx?.sourceId || '').trim();
      if (!sourceId) return null;
      return battlefield.filter((p: any) => {
        const id = String((p as any)?.id || '').trim();
        if (!id || id === sourceId) return false;
        return hasExecutorClass(p, 'creature');
      }).length;
    }
  }

  return null;
}
