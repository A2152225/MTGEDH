import type { BattlefieldPermanent, GameState, PlayerID } from '../../shared/src';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';
import type { ModifyPtRuntime } from './oracleIRExecutorModifyPtStepHandlers';
import {
  getHighestCommanderTaxForController,
} from './oracleIRExecutorCommanderUtils';
import {
  countControlledByClass,
  normalizeControlledClassKey,
} from './oracleIRExecutorCreatureStepUtils';
import {
  isExecutorCreature,
} from './oracleIRExecutorPermanentUtils';
import {
  countCardsExiledWithSource,
  getCardTypeLineLower,
  getCardManaValue,
  getCardTypesFromTypeLine,
  normalizeOracleText,
  quantityToNumber,
  resolvePlayers,
} from './oracleIRExecutorPlayerUtils';
import { tryEvaluateModifyPtWhereControlledCounts } from './oracleIRExecutorModifyPtWhereControlledCounts';
import { createModifyPtWhereEvaluatorContext } from './oracleIRExecutorModifyPtWhereContext';
import { tryEvaluateModifyPtWhereArithmetic } from './oracleIRExecutorModifyPtWhereArithmetic';
import { tryEvaluateModifyPtWhereExileAndCardStats } from './oracleIRExecutorModifyPtWhereExileAndCardStats';
import { tryEvaluateModifyPtWhereExtrema } from './oracleIRExecutorModifyPtWhereExtremaHandlers';
import { tryEvaluateModifyPtWhereLateReferenceStats } from './oracleIRExecutorModifyPtWhereLateReferenceStats';
import { tryEvaluateModifyPtWherePlayerAndReferenceState } from './oracleIRExecutorModifyPtWherePlayerAndReferenceState';
import { tryEvaluateModifyPtWhereQualifiedCounts } from './oracleIRExecutorModifyPtWhereQualifiedCounts';
import { tryEvaluateModifyPtWhereReferenceStats } from './oracleIRExecutorModifyPtWhereReferenceStats';
import { tryEvaluateModifyPtWhereSpecializedExtrema } from './oracleIRExecutorModifyPtWhereSpecializedExtrema';
import { tryEvaluateModifyPtWhereTurnStats } from './oracleIRExecutorModifyPtWhereTurnStats';
import { tryEvaluateModifyPtWhereZoneCardCounts } from './oracleIRExecutorModifyPtWhereZoneCardCounts';

export function evaluateModifyPtWhereX(
  state: GameState,
  controllerId: PlayerID,
  whereRaw: string,
  targetCreatureId?: string,
  ctx?: OracleIRExecutionContext,
  runtime?: ModifyPtRuntime,
  depth = 0
): number | null {
  if (depth > 3) return null;

  const {
    raw,
    battlefield,
    controlled,
    opponentsControlled,
    getCardsFromPlayerZone,
    typeLineLower,
    isAttackingObject,
    hasFlyingKeyword,
    getCreatureSubtypeKeys,
    resolveContextPlayer,
    findPlayerById,
    findObjectById,
    findObjectByName,
    getExcludedId,
    getSourceRef,
    getTargetRef,
    resolveLastSacrificedSnapshot,
    getCounterCountOnObject,
    isCommanderObject,
    collectCommandZoneObjects,
    countCardsByClasses,
    getColorsFromObject,
    countManaSymbolsInManaCost,
    normalizeManaColorCode,
    getColorsOfManaSpent,
    getAmountOfManaSpent,
    getAmountOfSpecificManaSymbolSpent,
    parseCardClassList,
    parseClassList,
    parseColorQualifiedClassSpec,
    countByClasses,
    hasExecutorClass,
    countNegatedClass,
    leastStatAmongCreatures,
    greatestStatAmongCreatures,
    greatestPowerAmongCreatureCards,
    greatestManaValueAmongCards,
    greatestSharedCreatureSubtypeCount,
    lowestManaValueAmongPermanents,
    highestManaValueAmongPermanents,
  } = createModifyPtWhereEvaluatorContext(state, controllerId, whereRaw, targetCreatureId, ctx, runtime);

  const evaluateInner = (expr: string): number | null => {
    return evaluateModifyPtWhereX(state, controllerId, `x is ${expr}`, targetCreatureId, ctx, runtime, depth + 1);
  };

  {
    const arithmetic = tryEvaluateModifyPtWhereArithmetic({ state, controllerId, raw, evaluateInner });
    if (arithmetic !== null) return arithmetic;
  }

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

  {
    const controlledCounts = tryEvaluateModifyPtWhereControlledCounts({
      state,
      controllerId,
      raw,
      battlefield,
      controlled,
      opponentsControlled,
      ctx,
      resolveContextPlayer,
      parseColorQualifiedClassSpec,
      countByClasses,
    });
    if (controlledCounts !== null) return controlledCounts;
  }

  {
    const m = raw.match(/^x is the number of (tapped|untapped) (.+) you control$/i);
    if (m) {
      const which = String(m[1] || '').toLowerCase();
      const classes = parseClassList(String(m[2] || ''));
      if (!classes) return null;
      return controlled.filter((p: any) => {
        const tapped = Boolean((p as any)?.tapped);
        if (which === 'tapped' ? !tapped : tapped) return false;
        return classes.some((klass) => hasExecutorClass(p, klass));
      }).length;
    }
  }

  {
    const m = raw.match(/^x is the number of (tapped|untapped) creatures you control$/i);
    if (m) {
      const which = String(m[1] || '').toLowerCase();
      return controlled.filter((p: any) => {
        if (!hasExecutorClass(p, 'creature')) return false;
        const tapped = Boolean((p as any)?.tapped);
        return which === 'tapped' ? tapped : !tapped;
      }).length;
    }
  }

  {
    const m = raw.match(/^x is the number of other creatures you control$/i);
    if (m) {
      const excludedId = getExcludedId();
      return controlled.filter((p: any) => {
        if (excludedId && String((p as any)?.id || '').trim() === excludedId) return false;
        return hasExecutorClass(p, 'creature');
      }).length;
    }
  }

  {
    const m = raw.match(/^x is the number of legendary creatures you control$/i);
    if (m) {
      return controlled.filter((p: any) => {
        const tl = typeLineLower(p);
        return tl.includes('legendary') && hasExecutorClass(p, 'creature');
      }).length;
    }
  }

  {
    const m = raw.match(/^x is the number of creatures you control with defender$/i);
    if (m) {
      return controlled.filter((p: any) => {
        const tl = typeLineLower(p);
        const keywords = String((p as any)?.keywords || (p as any)?.card?.keywords || '').toLowerCase();
        return hasExecutorClass(p, 'creature') && (tl.includes('defender') || keywords.includes('defender'));
      }).length;
    }
  }

  {
    const m = raw.match(/^x is the number of permanents you control with oil counters on them$/i);
    if (m) {
      return controlled.filter((p: any) => {
        const counters = (p as any)?.counters;
        if (!counters || typeof counters !== 'object') return false;
        const entries = Object.entries(counters as Record<string, unknown>);
        for (const [key, value] of entries) {
          if (String(key || '').trim().toLowerCase() !== 'oil') continue;
          const n = Number(value);
          return Number.isFinite(n) && n > 0;
        }
        return false;
      }).length;
    }
  }

  {
    const m = raw.match(/^x is the total (power|toughness) of (other )?creatures you control$/i);
    if (m) {
      const which = String(m[1] || '').toLowerCase();
      const isOther = Boolean(String(m[2] || '').trim());
      const excludedId = isOther ? getExcludedId() : '';

      return controlled.reduce((sum: number, p: any) => {
        if (!hasExecutorClass(p, 'creature')) return sum;
        if (excludedId && String((p as any)?.id || '').trim() === excludedId) return sum;
        const n = Number(which === 'power' ? (p as any)?.power : (p as any)?.toughness);
        return sum + (Number.isFinite(n) ? n : 0);
      }, 0);
    }
  }

  {
    const m = raw.match(/^x is the number of creatures you control with power (\d+) or greater$/i);
    if (m) {
      const threshold = Math.max(0, parseInt(String(m[1] || '0'), 10) || 0);
      return controlled.filter((p: any) => {
        if (!hasExecutorClass(p, 'creature')) return false;
        const n = Number((p as any)?.power);
        return Number.isFinite(n) && n >= threshold;
      }).length;
    }
  }

  {
    const m = raw.match(/^x is the number of differently named lands you control$/i);
    if (m) {
      const seen = new Set<string>();
      for (const p of controlled as any[]) {
        if (!hasExecutorClass(p, 'land')) continue;
        const name = String((p as any)?.name || (p as any)?.card?.name || '').trim().toLowerCase();
        if (!name) continue;
        seen.add(name);
      }
      return seen.size;
    }
  }

  {
    const m = raw.match(/^x is the number of (.+)$/i);
    if (m) {
      const phrase = String(m[1] || '').toLowerCase();
      const mentionsAttackingCreatures = /\bcreatures?\b/.test(phrase) && /\battacking\b/.test(phrase);
      if (mentionsAttackingCreatures && !/\bwith\s+flying\b/.test(phrase) && !/\battacking\s+you\b/.test(phrase)) {
        const isOther = /\bother\b/.test(phrase);
        const excludedId = isOther ? getExcludedId() : '';
        const useOpponents = /\b(?:your opponents control|an opponent controls|you don['â€™]?t control|you do not control)\b/.test(phrase);
        const useControlled = /\byou control\b/.test(phrase);
        const pool = useOpponents ? opponentsControlled : useControlled ? controlled : battlefield;
        return pool.filter((p: any) => {
          if (excludedId && String((p as any)?.id || '').trim() === excludedId) return false;
          if (!hasExecutorClass(p, 'creature')) return false;
          return String((p as any)?.attacking || '').trim().length > 0;
        }).length;
      }
    }
  }

  {
    const m = raw.match(/^x is the number of creatures attacking you$/i);
    if (m) {
      return battlefield.filter((p: any) => {
        if (!hasExecutorClass(p, 'creature')) return false;
        if (!isAttackingObject(p)) return false;
        const attackedId = String((p as any)?.attacking || (p as any)?.attackingPlayerId || (p as any)?.defendingPlayerId || '').trim();
        return attackedId === controllerId;
      }).length;
    }
  }

  {
    const m = raw.match(/^x is the difference between the chosen creatures' powers$/i);
    if (m) {
      const chosenIds = Array.isArray(ctx?.selectorContext?.chosenObjectIds)
        ? ctx.selectorContext.chosenObjectIds.map(id => String(id || '').trim()).filter(Boolean)
        : [];
      if (chosenIds.length < 2) return null;

      const chosenCreatures = chosenIds
        .map(id => findObjectById(id))
        .filter((obj): obj is any => Boolean(obj) && hasExecutorClass(obj, 'creature'));
      if (chosenCreatures.length < 2) return null;

      const powerValues = chosenCreatures.slice(0, 2).map(obj => Number((obj as any)?.power ?? (obj as any)?.card?.power));
      if (powerValues.some(value => !Number.isFinite(value))) return null;
      return Math.abs(Number(powerValues[0]) - Number(powerValues[1]));
    }
  }

  {
    const m = raw.match(/^x is the total (power|toughness) of (other )?attacking creatures$/i);
    if (m) {
      const which = String(m[1] || '').toLowerCase();
      const isOther = Boolean(String(m[2] || '').trim());
      const excludedId = isOther ? getExcludedId() : '';

      return battlefield.reduce((sum: number, p: any) => {
        if (!hasExecutorClass(p, 'creature')) return sum;
        if (!isAttackingObject(p)) return sum;
        if (excludedId && String((p as any)?.id || '').trim() === excludedId) return sum;
        const n = Number(which === 'power' ? (p as any)?.power : (p as any)?.toughness);
        return sum + (Number.isFinite(n) ? n : 0);
      }, 0);
    }
  }

  {
    const m = raw.match(/^x is the number of attacking creatures with flying$/i);
    if (m) {
      return battlefield.filter((p: any) => {
        if (!hasExecutorClass(p, 'creature')) return false;
        if (!isAttackingObject(p)) return false;
        return hasFlyingKeyword(p);
      }).length;
    }
  }

  {
    const m = raw.match(/^x is the number of players being attacked$/i);
    if (m) {
      const playerIds = new Set((state.players || []).map((p: any) => String((p as any)?.id || '').trim()).filter(Boolean));
      const attacked = new Set<string>();
      for (const p of battlefield as any[]) {
        if (!isAttackingObject(p)) continue;
        const candidates = [
          (p as any)?.attacking,
          (p as any)?.attackingPlayerId,
          (p as any)?.defendingPlayerId,
        ];
        for (const value of candidates) {
          const id = String(value || '').trim();
          if (id && playerIds.has(id)) attacked.add(id);
        }
      }
      return attacked.size;
    }
  }

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
      const targetObj = getTargetRef();
      const sourceObj = getSourceRef();
      const obj = targetObj || sourceObj;
      if (!obj) return null;
      return getCounterCountOnObject(obj, counterName);
    }
  }

  {
    const m = raw.match(/^x is the number of (.+) counters? on ([a-z0-9 ,.'-]+)$/i);
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
        return (p as any)?.tapped !== true;
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
        return (p as any)?.tapped !== true;
      }).length;
    }
  }

  {
    const zoneCardCounts = tryEvaluateModifyPtWhereZoneCardCounts({
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
    });
    if (zoneCardCounts !== null) return zoneCardCounts;
  }

  {
    const turnStats = tryEvaluateModifyPtWhereTurnStats({ state, controllerId, raw, runtime });
    if (turnStats !== null) return turnStats;
  }

  {
    const playerAndReferenceState = tryEvaluateModifyPtWherePlayerAndReferenceState({
      state,
      raw,
      battlefield,
      controllerId,
      targetCreatureId,
      ctx,
      findPlayerById,
      findObjectById,
      resolveLastSacrificedSnapshot,
      typeLineLower,
      getCardManaValue,
      hasExecutorClass,
      isCommanderObject,
      collectCommandZoneObjects,
      greatestManaValueAmongCards,
      getHighestCommanderTaxForController,
    });
    if (playerAndReferenceState !== null) return playerAndReferenceState;
  }

  {
    const qualifiedCounts = tryEvaluateModifyPtWhereQualifiedCounts({
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
    });
    if (qualifiedCounts !== null) return qualifiedCounts;
  }

  {
    const referenceStats = tryEvaluateModifyPtWhereReferenceStats({
      raw,
      battlefield,
      controllerId,
      targetCreatureId,
      ctx,
      findPlayerById,
      findObjectById,
      findObjectByName,
      getSourceRef,
      resolveLastSacrificedSnapshot,
      getCardManaValue,
      typeLineLower,
      getColorsFromObject,
      getColorsOfManaSpent,
      getAmountOfManaSpent,
      getAmountOfSpecificManaSymbolSpent,
      normalizeOracleText,
      hasExecutorClass,
      getExcludedId,
    });
    if (referenceStats !== null) return referenceStats;
  }

  {
    const extrema = tryEvaluateModifyPtWhereExtrema(raw, {
      raw,
      battlefield,
      controlled,
      opponentsControlled,
      getCardsFromPlayerZone,
      typeLineLower,
      isAttackingObject,
      hasFlyingKeyword,
      getCreatureSubtypeKeys,
      resolveContextPlayer,
      findPlayerById,
      findObjectById,
      findObjectByName,
      getExcludedId,
      getSourceRef,
      getTargetRef,
      resolveLastSacrificedSnapshot,
      getCounterCountOnObject,
      isCommanderObject,
      collectCommandZoneObjects,
      countCardsByClasses,
      getColorsFromObject,
      countManaSymbolsInManaCost,
      normalizeManaColorCode,
      getColorsOfManaSpent,
      getAmountOfManaSpent,
      getAmountOfSpecificManaSymbolSpent,
      parseCardClassList,
      parseClassList,
      parseColorQualifiedClassSpec,
      countByClasses,
      hasExecutorClass,
      countNegatedClass,
      leastStatAmongCreatures,
      greatestStatAmongCreatures,
      greatestPowerAmongCreatureCards,
      greatestManaValueAmongCards,
      greatestSharedCreatureSubtypeCount,
      lowestManaValueAmongPermanents,
      highestManaValueAmongPermanents,
    });
    if (extrema !== null) return extrema;
  }

  {
    const exileAndCardStats = tryEvaluateModifyPtWhereExileAndCardStats({
      state,
      raw,
      battlefield,
      controllerId,
      ctx,
      runtime,
      countCardsExiledWithSource,
      normalizeOracleText,
      greatestPowerAmongCreatureCards,
      greatestManaValueAmongCards,
    });
    if (exileAndCardStats !== null) return exileAndCardStats;
  }

  {
    const specializedExtrema = tryEvaluateModifyPtWhereSpecializedExtrema({
      state,
      raw,
      controlled,
      opponentsControlled,
      controllerId,
      getCreatureSubtypeKeys,
      isAttackingObject,
      hasExecutorClass,
      getExcludedId,
      greatestStatAmongCreatures,
      highestManaValueAmongPermanents,
      isCommanderObject,
      collectCommandZoneObjects,
      greatestManaValueAmongCards,
      typeLineLower,
    });
    if (specializedExtrema !== null) return specializedExtrema;
  }


  {
    const lateReferenceStats = tryEvaluateModifyPtWhereLateReferenceStats({
      state,
      raw,
      battlefield,
      controllerId,
      ctx,
      findPlayerById,
      findObjectByName,
      getCounterCountOnObject,
      getExcludedId,
      hasExecutorClass,
    });
    if (lateReferenceStats !== null) return lateReferenceStats;
  }

  // â”€â”€ Safe-skips (non-deterministic or complex context) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // Random numbers
  if (/^x is a number chosen at random$/i.test(raw)) return null;
  // Noted numbers
  if (/^x is the (?:noted number|highest number you noted)/i.test(raw)) return null;
  // Chosen number (player choice)
  if (/^x is the chosen number$/i.test(raw)) return null;
  // First/second chosen result pair
  if (/^x is the first chosen result/i.test(raw)) return null;
  // Number in creature's text box
  if (/^x is a number in the sacrificed creature'?s text box$/i.test(raw)) return null;
  // Complex structural counts
  if (/^x is the greatest number of (?:consecutive|stored results)/i.test(raw)) return null;
  // Specific total-damage tracking (requires complex event log)
  if (/^x is the greatest amount of damage dealt by a source/i.test(raw)) return null;

  return null;
}
