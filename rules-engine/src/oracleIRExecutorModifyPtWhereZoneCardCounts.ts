import type { GameState } from '../../shared/src';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';

type PlayerLike = {
  readonly graveyard?: readonly unknown[];
  readonly hand?: readonly unknown[];
  readonly library?: readonly unknown[];
  readonly exile?: readonly unknown[];
};

type ResolveContextPlayer = () => PlayerLike | null;
type FindPlayerById = (id: string) => PlayerLike | null;
type FindObjectById = (id: string) => unknown;
type ParseCardClassList = (value: string) => readonly string[] | null;
type CountCardsByClasses = (cards: readonly unknown[], classes: readonly string[]) => number;
type GetCardTypesFromTypeLine = (card: unknown) => readonly string[] | null;
type NormalizeOracleText = (value: string) => string;

function getZoneCount(player: PlayerLike | null, zone: string): number | null {
  if (!player) return null;
  if (zone === 'graveyard') return Array.isArray(player.graveyard) ? player.graveyard.length : 0;
  if (zone === 'hand') return Array.isArray(player.hand) ? player.hand.length : 0;
  if (zone === 'library') return Array.isArray(player.library) ? player.library.length : 0;
  if (zone === 'exile') return Array.isArray(player.exile) ? player.exile.length : 0;
  return null;
}

export function tryEvaluateModifyPtWhereZoneCardCounts(args: {
  state: GameState;
  controllerId: string;
  raw: string;
  ctx?: OracleIRExecutionContext;
  resolveContextPlayer: ResolveContextPlayer;
  findPlayerById: FindPlayerById;
  findObjectById: FindObjectById;
  parseCardClassList: ParseCardClassList;
  countCardsByClasses: CountCardsByClasses;
  getCardTypesFromTypeLine: GetCardTypesFromTypeLine;
  normalizeOracleText: NormalizeOracleText;
}): number | null {
  const {
    state,
    controllerId,
    raw,
    ctx,
    resolveContextPlayer,
    findPlayerById,
    findObjectById,
    parseCardClassList,
    countCardsByClasses,
    getCardTypesFromTypeLine,
    normalizeOracleText,
  } = args;

  {
    const m = raw.match(/^x is the number of cards? in your (graveyard|hand|library|exile)$/i);
    if (m) {
      return getZoneCount(findPlayerById(controllerId), String(m[1] || '').toLowerCase());
    }
  }

  {
    const m = raw.match(/^x is the number of cards? in (?:that player's|their) (graveyard|hand|library|exile)$/i);
    if (m) {
      return getZoneCount(resolveContextPlayer(), String(m[1] || '').toLowerCase());
    }
  }

  {
    const m = raw.match(/^x is the number of cards? in all graveyards$/i);
    if (m) {
      return (state.players || []).reduce((sum, p: any) => {
        const gy = Array.isArray(p?.graveyard) ? p.graveyard.length : 0;
        return sum + gy;
      }, 0);
    }
  }

  {
    const m = raw.match(/^x is the number of cards? in (?:(?:all\s+)?opponents?'?\s+graveyards|your\s+opponents?'?\s+graveyards)$/i);
    if (m) {
      return (state.players || []).reduce((sum, p: any) => {
        const id = String((p as any)?.id || '').trim();
        if (!id || id === controllerId) return sum;
        const gy = Array.isArray((p as any)?.graveyard) ? (p as any).graveyard.length : 0;
        return sum + gy;
      }, 0);
    }
  }

  {
    const m = raw.match(/^x is (?:the total number|the number) of cards? in all players'? hands?$/i);
    if (m) {
      return (state.players || []).reduce((sum, p: any) => {
        const hand = Array.isArray(p?.hand) ? p.hand.length : 0;
        return sum + hand;
      }, 0);
    }
  }

  {
    const m = raw.match(/^x is the number of cards? in (?:(?:all\s+)?opponents?'?\s+hands|your\s+opponents?'?\s+hands)$/i);
    if (m) {
      return (state.players || []).reduce((sum, p: any) => {
        const id = String((p as any)?.id || '').trim();
        if (!id || id === controllerId) return sum;
        const hand = Array.isArray((p as any)?.hand) ? (p as any).hand.length : 0;
        return sum + hand;
      }, 0);
    }
  }

  {
    const m = raw.match(/^x is the number of (.+) cards? in all graveyards$/i);
    if (m) {
      const classes = parseCardClassList(String(m[1] || ''));
      if (!classes) return null;
      return (state.players || []).reduce((sum, p: any) => {
        const gy = Array.isArray(p?.graveyard) ? p.graveyard : [];
        return sum + countCardsByClasses(gy, classes);
      }, 0);
    }
  }

  {
    const m = raw.match(/^x is the number of card types among cards? in your graveyard$/i);
    if (m) {
      const controller = findPlayerById(controllerId);
      if (!controller) return null;
      const gy = Array.isArray(controller.graveyard) ? controller.graveyard : [];
      const seen = new Set<string>();
      for (const card of gy as any[]) {
        const types = getCardTypesFromTypeLine(card);
        if (!types) continue;
        for (const type of types) seen.add(type);
      }
      return seen.size;
    }
  }

  {
    const m = raw.match(/^x is the number of cards? in all graveyards with the same name as that spell$/i);
    if (m) {
      const sourceId = String(ctx?.sourceId || '').trim();
      if (!sourceId) return null;
      const ref = findObjectById(sourceId);
      if (!ref) return null;
      const refName = normalizeOracleText(String(
        (ref as any)?.cardName ||
        (ref as any)?.name ||
        (ref as any)?.card?.name ||
        (ref as any)?.spell?.cardName ||
        (ref as any)?.spell?.name ||
        ''
      ));
      if (!refName) return null;
      return (state.players || []).reduce((sum, p: any) => {
        const gy = Array.isArray((p as any)?.graveyard) ? (p as any).graveyard : [];
        const count = gy.filter((card: any) => normalizeOracleText(String((card as any)?.name || '')) === refName).length;
        return sum + count;
      }, 0);
    }
  }

  {
    const m = raw.match(/^x is the number of cards? named ([a-z0-9 ,.'\u2019-]+) in all graveyards(?: as you cast this spell)?$/i);
    if (m) {
      const wantedName = normalizeOracleText(String(m[1] || ''));
      if (!wantedName) return null;
      return (state.players || []).reduce((sum, p: any) => {
        const gy = Array.isArray((p as any)?.graveyard) ? (p as any).graveyard : [];
        const count = gy.filter((card: any) => normalizeOracleText(String((card as any)?.name || '')) === wantedName).length;
        return sum + count;
      }, 0);
    }
  }

  {
    const m = raw.match(/^x is the number of cards? named ([a-z0-9 ,.'\u2019-]+) in your graveyard$/i);
    if (m) {
      const wantedName = normalizeOracleText(String(m[1] || ''));
      if (!wantedName) return null;
      const controller = findPlayerById(controllerId);
      if (!controller) return null;
      const gy = Array.isArray(controller.graveyard) ? controller.graveyard : [];
      return gy.filter((card: any) => normalizeOracleText(String((card as any)?.name || '')) === wantedName).length;
    }
  }

  return null;
}
