import type { BattlefieldPermanent, GameState } from '../../shared/src';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';

type TypeLineLower = (obj: unknown) => string;
type GetSourceRef = () => unknown;
type GetTargetRef = () => unknown;
type GetCounterCountOnObject = (obj: unknown, counterName: string) => number;
type HasExecutorClass = (obj: unknown, klass: string) => boolean;
type CountManaSymbolsInManaCost = (obj: unknown, colorSymbol: string) => number;
type GetColorsFromObject = (obj: unknown) => readonly string[];
type NormalizeOracleText = (value: string) => string;
type FindObjectByName = (name: string) => unknown | null;

export function tryEvaluateModifyPtWhereBoardStateCounts(args: {
  state: GameState;
  raw: string;
  battlefield: readonly BattlefieldPermanent[];
  controlled: readonly BattlefieldPermanent[];
  ctx?: OracleIRExecutionContext;
  typeLineLower: TypeLineLower;
  getSourceRef: GetSourceRef;
  getTargetRef: GetTargetRef;
  getCounterCountOnObject: GetCounterCountOnObject;
  hasExecutorClass: HasExecutorClass;
  countManaSymbolsInManaCost: CountManaSymbolsInManaCost;
  getColorsFromObject: GetColorsFromObject;
  normalizeOracleText: NormalizeOracleText;
  findObjectByName: FindObjectByName;
}): number | null {
  const {
    state,
    raw,
    battlefield,
    controlled,
    ctx,
    typeLineLower,
    getSourceRef,
    getTargetRef,
    getCounterCountOnObject,
    hasExecutorClass,
    countManaSymbolsInManaCost,
    getColorsFromObject,
    normalizeOracleText,
    findObjectByName,
  } = args;

  {
    const m = raw.match(/^x is the number of basic land types among lands you control$/i);
    if (m) {
      const basicLandTypes = ['plains', 'island', 'swamp', 'mountain', 'forest'];
      const seen = new Set<string>();
      for (const p of controlled as any[]) {
        const tl = typeLineLower(p);
        if (!hasExecutorClass(p, 'land')) continue;
        for (const basic of basicLandTypes) {
          if (tl.includes(basic)) seen.add(basic);
        }
      }
      return seen.size;
    }
  }

  {
    const m = raw.match(/^x is the number of nonbasic land types among lands (?:that player controls|they control)$/i);
    if (m) {
      const targetPlayerId = String(
        ctx?.selectorContext?.targetPlayerId ||
        ctx?.selectorContext?.targetOpponentId ||
        ''
      ).trim();
      if (!targetPlayerId) return null;

      const targetControlled = battlefield.filter((p: any) => String((p as any)?.controller || '').trim() === targetPlayerId);
      const basicLandTypes = ['plains', 'island', 'swamp', 'mountain', 'forest'];
      const seen = new Set<string>();
      for (const p of targetControlled as any[]) {
        const tl = typeLineLower(p);
        if (!hasExecutorClass(p, 'land')) continue;
        for (const basic of basicLandTypes) {
          if (tl.includes(basic)) seen.add(basic);
        }
      }
      return seen.size;
    }
  }

  {
    const m = raw.match(/^x is the number of creatures in your party$/i);
    if (m) {
      const partyRoles = ['cleric', 'rogue', 'warrior', 'wizard'];
      const filled = new Set<string>();
      for (const p of controlled as any[]) {
        const tl = typeLineLower(p);
        if (!hasExecutorClass(p, 'creature')) continue;
        for (const role of partyRoles) {
          if (tl.includes(role)) filled.add(role);
        }
      }
      return filled.size;
    }
  }

  {
    const m = raw.match(/^x is your devotion to (white|blue|black|red|green)$/i);
    if (m) {
      const colorName = String(m[1] || '').toLowerCase();
      const colorSymbolByName: Record<string, string> = {
        white: 'W',
        blue: 'U',
        black: 'B',
        red: 'R',
        green: 'G',
      };
      const colorSymbol = colorSymbolByName[colorName];
      if (!colorSymbol) return null;

      let devotion = 0;
      for (const p of controlled as any[]) {
        devotion += countManaSymbolsInManaCost(p, colorSymbol);
      }

      return devotion;
    }
  }

  {
    const m = raw.match(/^x is the number of (white|blue|black|red|green) mana symbols in the mana costs of permanents you control$/i);
    if (m) {
      const colorName = String(m[1] || '').toLowerCase();
      const colorSymbolByName: Record<string, string> = {
        white: 'W',
        blue: 'U',
        black: 'B',
        red: 'R',
        green: 'G',
      };
      const colorSymbol = colorSymbolByName[colorName];
      if (!colorSymbol) return null;

      return controlled.reduce((sum: number, permanent: any) => sum + countManaSymbolsInManaCost(permanent, colorSymbol), 0);
    }
  }

  {
    const m = raw.match(/^x is the number of colors among permanents you control$/i);
    if (m) {
      const seen = new Set<string>();
      for (const p of controlled as any[]) {
        for (const color of getColorsFromObject(p)) {
          seen.add(color);
        }
      }
      return seen.size;
    }
  }

  {
    const m = raw.match(/^x is the number of (.+) counters? on this (creature|artifact|enchantment|land|planeswalker|battle|permanent)$/i);
    if (m) {
      const counterName = String(m[1] || '');
      const expectedType = String(m[2] || '').toLowerCase();
      const sourceObj = getSourceRef();
      const targetObj = getTargetRef();

      const matchesExpectedType = (obj: any): boolean => {
        if (!obj) return false;
        if (expectedType === 'permanent') return true;
        return hasExecutorClass(obj, expectedType);
      };

      const objectToRead =
        (expectedType === 'creature' && matchesExpectedType(targetObj) ? targetObj : null) ||
        (matchesExpectedType(sourceObj) ? sourceObj : null) ||
        (matchesExpectedType(targetObj) ? targetObj : null);

      if (!objectToRead) return null;
      return getCounterCountOnObject(objectToRead, counterName);
    }
  }

  {
    const m = raw.match(/^x is the number of (.+) counters? on it$/i);
    if (m) {
      const counterName = String(m[1] || '');
      const sourceObj = getSourceRef();
      const targetObj = getTargetRef();
      const objectToRead = sourceObj || targetObj;
      if (!objectToRead) return null;
      return getCounterCountOnObject(objectToRead, counterName);
    }
  }

  {
    const m = raw.match(/^x is the number of quest counters on it$/i);
    if (m) {
      const sourceObj = getSourceRef();
      const targetObj = getTargetRef();
      const objectToRead = sourceObj || targetObj;
      if (!objectToRead) return null;
      return getCounterCountOnObject(objectToRead, 'quest');
    }
  }

  {
    const m = raw.match(/^x is the number of counters on this permanent$/i);
    if (m) {
      const sourceObj = getSourceRef();
      const targetObj = getTargetRef();
      const objectToRead = sourceObj || targetObj;
      if (!objectToRead) return null;
      const counters = (objectToRead as any)?.counters || {};
      return Object.values(counters).reduce<number>(
        (sum, value) => sum + Math.max(0, Number(value) || 0),
        0
      );
    }
  }

  {
    const m = raw.match(/^x is the number of (.+) counters? on it$/i);
    if (m) {
      const counterName = String(m[1] || '');
      const targetObj = getTargetRef();
      const sourceObj = getSourceRef();
      const obj = targetObj || sourceObj;
      if (!obj) return null;
      return getCounterCountOnObject(obj, counterName);
    }
  }

  {
    const m = raw.match(/^x is the number of (.+) counters? on ([a-z0-9 ,.'\u2019-]+)$/i);
    if (m) {
      const counterName = String(m[1] || '');
      const objectName = String(m[2] || '').trim();
      if (!objectName) return null;

      const normalizedObjectName = normalizeOracleText(objectName);
      if (
        normalizedObjectName === 'it' ||
        normalizedObjectName === 'this' ||
        normalizedObjectName === 'that' ||
        /^this\s+/.test(normalizedObjectName) ||
        /^that\s+/.test(normalizedObjectName)
      ) {
        // Let pronoun/antecedent-specific matchers resolve these forms.
      } else {
        const obj = findObjectByName(objectName);
        if (!obj) return null;
        return getCounterCountOnObject(obj, counterName);
      }
    }
  }

  {
    const m = raw.match(/^x is the number of untapped lands (?:that player controls|they control)$/i);
    if (m) {
      const targetPlayerId = String(
        ctx?.selectorContext?.targetPlayerId ||
        ctx?.selectorContext?.targetOpponentId ||
        ''
      ).trim();
      if (!targetPlayerId) return null;

      return battlefield.filter((p: any) => {
        if (String((p as any)?.controller || '').trim() !== targetPlayerId) return false;
        if (!hasExecutorClass(p, 'land')) return false;
        return (p as any)?.tapped !== true && (p as any)?.isTapped !== true;
      }).length;
    }
  }

  {
    const m = raw.match(/^x is the number of untapped lands (?:that player|they) controlled at the beginning of this turn$/i);
    if (m) {
      const targetPlayerId = String(
        ctx?.selectorContext?.targetPlayerId ||
        ctx?.selectorContext?.targetOpponentId ||
        ''
      ).trim();
      if (!targetPlayerId) return null;

      const stateAny: any = state as any;
      const snapshot = Array.isArray(stateAny.turnStartBattlefieldSnapshot)
        ? stateAny.turnStartBattlefieldSnapshot
        : Array.isArray(stateAny.beginningOfTurnBattlefieldSnapshot)
          ? stateAny.beginningOfTurnBattlefieldSnapshot
          : null;
      if (!snapshot) return null;

      return snapshot.filter((p: any) => {
        if (String((p as any)?.controller || '').trim() !== targetPlayerId) return false;
        if (!hasExecutorClass(p, 'land')) return false;
        return (p as any)?.tapped !== true && (p as any)?.isTapped !== true;
      }).length;
    }
  }

  {
    const m = raw.match(/^x is the number of counters it had on it$/i);
    if (m) {
      const source = getSourceRef() as any;
      if (!source || typeof source !== 'object') return 0;
      const counters = (source as any)?.counters;
      if (!counters || typeof counters !== 'object') return 0;
      return Object.values(counters as Record<string, unknown>).reduce<number>((sum, value) => {
        const n = Number(value);
        return sum + (Number.isFinite(n) ? Math.max(0, n) : 0);
      }, 0);
    }
  }

  {
    const m = raw.match(
      /^x is the number of abilities from among flying, first strike, double strike, deathtouch, haste, hexproof, indestructible, lifelink, menace, reach, trample, and vigilance found among creatures you control$/i
    );
    if (m) {
      const keywords = [
        'flying',
        'first strike',
        'double strike',
        'deathtouch',
        'haste',
        'hexproof',
        'indestructible',
        'lifelink',
        'menace',
        'reach',
        'trample',
        'vigilance',
      ];
      const found = new Set<string>();
      for (const permanent of controlled as any[]) {
        if (!hasExecutorClass(permanent, 'creature')) continue;
        const abilityText = normalizeOracleText(
          String(
            (permanent as any)?.oracle_text ||
              (permanent as any)?.card?.oracle_text ||
              (permanent as any)?.keywords ||
              ''
          )
        ).toLowerCase();
        for (const keyword of keywords) {
          if (abilityText.includes(keyword)) found.add(keyword);
        }
      }
      return found.size;
    }
  }

  {
    const m = raw.match(/^x is the power of the creature tapped this way$/i);
    if (m) {
      const readPower = (obj: any): number => {
        for (const value of [obj?.effectivePower, obj?.basePower, obj?.power, obj?.card?.power]) {
          const parsed = Number(value);
          if (Number.isFinite(parsed)) return parsed;
        }
        return 0;
      };
      const chosenIds = Array.isArray(ctx?.selectorContext?.chosenObjectIds)
        ? ctx.selectorContext.chosenObjectIds.map((id) => String(id || '').trim()).filter(Boolean)
        : [];
      for (const id of chosenIds) {
        const perm = (battlefield as any[]).find((entry) => String(entry?.id || '').trim() === id);
        if (perm && hasExecutorClass(perm, 'creature')) return readPower(perm);
      }
      return null;
    }
  }

  {
    const m = raw.match(/^x is the number of supertypes, card types, and subtypes it has$/i);
    if (m) {
      const source = getSourceRef() as any;
      const typeLine = String(source?.type_line || source?.card?.type_line || '').trim();
      if (!typeLine) return null;
      const [mainPart, subPart] = typeLine.split(/\s+[—–-]\s+/);
      const mainTokens = String(mainPart || '')
        .split(/\s+/)
        .map((token) => token.trim().toLowerCase())
        .filter(Boolean);
      const subTokens = String(subPart || '')
        .split(/\s+/)
        .map((token) => token.trim().toLowerCase())
        .filter(Boolean);
      return new Set([...mainTokens, ...subTokens]).size;
    }
  }

  {
    const m = raw.match(/^x is the number of colors among those creatures$/i);
    if (m) {
      const colors = new Set<string>();
      for (const perm of controlled as any[]) {
        if (!hasExecutorClass(perm, 'creature')) continue;
        for (const color of getColorsFromObject(perm)) colors.add(color);
      }
      return colors.size;
    }
  }

  {
    const m = raw.match(/^x is the number of time counters among permanents you control$/i);
    if (m) {
      let total = 0;
      for (const perm of controlled as any[]) {
        total += getCounterCountOnObject(perm, 'time');
      }
      return total;
    }
  }

  {
    const m = raw.match(/^x is the number of counters on permanents you control$/i);
    if (m) {
      let total = 0;
      for (const perm of controlled as any[]) {
        const counters = (perm as any)?.counters || {};
        for (const value of Object.values(counters)) {
          const count = Number(value);
          if (Number.isFinite(count) && count > 0) total += Math.floor(count);
        }
      }
      return total;
    }
  }

  {
    const m = raw.match(/^x is the number of other elves you control$/i);
    if (m) {
      const sourceId = String(ctx?.sourceId || '').trim();
      return controlled.filter((perm: any) => {
        const id = String(perm?.id || '').trim();
        if (sourceId && id === sourceId) return false;
        return typeLineLower(perm).includes('elf');
      }).length;
    }
  }

  return null;
}
