import type { BattlefieldPermanent, GameState, PlayerID } from '../../shared/src';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';
import type { ModifyPtRuntime } from './oracleIRExecutorModifyPtStepHandlers';
import {
  lastKnownSnapshotHasClass,
  type LastKnownPermanentSnapshot,
} from './oracleIRExecutorLastKnownInfo';
import {
  getCardsFromPlayerZone,
  getContextExcludedId,
  getContextSourceObject,
  getContextTargetObject,
} from './oracleIRExecutorContextRefUtils';
import {
  collectCommandZoneObjects as collectCommandZoneObjectsFromUtils,
  isCommanderObject as isCommanderObjectFromUtils,
} from './oracleIRExecutorCommanderUtils';
import { getProcessedBattlefield } from './oracleIRExecutorCreatureStepUtils';
import {
  countCardsByClasses as countCardsByClassesFromUtils,
  countNegatedClass as countNegatedClassFromUtils,
  countPermanentsByClasses as countPermanentsByClassesFromUtils,
  greatestManaValueAmongCards as greatestManaValueAmongCardsFromUtils,
  greatestPowerAmongCreatureCards as greatestPowerAmongCreatureCardsFromUtils,
  greatestSharedCreatureSubtypeCount as greatestSharedCreatureSubtypeCountFromUtils,
  greatestStatAmongCreatures as greatestStatAmongCreaturesFromUtils,
  highestManaValueAmongPermanents as highestManaValueAmongPermanentsFromUtils,
  leastStatAmongCreatures as leastStatAmongCreaturesFromUtils,
  lowestManaValueAmongPermanents as lowestManaValueAmongPermanentsFromUtils,
  parseCardClassList as parseCardClassListFromUtils,
  parseClassList as parseClassListFromUtils,
  parseColorQualifiedClassSpec as parseColorQualifiedClassSpecFromUtils,
} from './oracleIRExecutorModifyPtClassUtils';
import {
  findObjectByIdInState as findObjectByIdFromState,
  findObjectByNameInState as findObjectByNameFromState,
  getCounterCountOnObject as getCounterCountOnObjectFromState,
  getCreatureSubtypeKeys as getCreatureSubtypeKeysFromState,
  hasFlyingKeyword as hasFlyingKeywordFromState,
  isAttackingObject as isAttackingObjectFromState,
  normalizeModifyPtWhereRaw,
  resolveContextPlayerFromState as resolveContextPlayerFromStateHelper,
} from './oracleIRExecutorModifyPtWhereUtils';
import {
  countManaSymbolsInManaCost as countManaSymbolsInManaCostFromUtils,
  getAmountOfManaSpent as getAmountOfManaSpentFromUtils,
  getAmountOfSpecificManaSymbolSpent as getAmountOfSpecificManaSymbolSpentFromUtils,
  getColorsFromObject as getColorsFromObjectFromUtils,
  getColorsOfManaSpent as getColorsOfManaSpentFromUtils,
  normalizeManaColorCode as normalizeManaColorCodeFromUtils,
} from './oracleIRExecutorManaUtils';
import {
  getExecutorTypeLineLower,
  hasExecutorClass as hasExecutorClassFromPermanentUtils,
} from './oracleIRExecutorPermanentUtils';
import { getCardManaValue } from './oracleIRExecutorPlayerUtils';
import { findPlayerById as findPlayerByIdFromState } from './oracleIRExecutorStateUtils';

export type ModifyPtWhereSnapshotClass = 'creature' | 'artifact' | 'permanent' | 'card';

export interface ModifyPtWhereEvaluatorContext {
  readonly raw: string;
  readonly battlefield: readonly BattlefieldPermanent[];
  readonly controlled: readonly BattlefieldPermanent[];
  readonly opponentsControlled: readonly BattlefieldPermanent[];
  readonly getCardsFromPlayerZone: typeof getCardsFromPlayerZone;
  typeLineLower(value: any): string;
  isAttackingObject(obj: any): boolean;
  hasFlyingKeyword(obj: any): boolean;
  getCreatureSubtypeKeys(obj: any): readonly string[];
  resolveContextPlayer(): any | null;
  findPlayerById(playerIdRaw: string): any | null;
  findObjectById(idRaw: string): any | null;
  findObjectByName(nameRaw: string): any | null;
  getExcludedId(): string;
  getSourceRef(): any | null;
  getTargetRef(): any | null;
  resolveLastSacrificedSnapshot(requiredClass: ModifyPtWhereSnapshotClass): LastKnownPermanentSnapshot | null;
  getCounterCountOnObject(obj: any, counterNameRaw: string): number | null;
  isCommanderObject(obj: any): boolean;
  collectCommandZoneObjects(): readonly any[];
  countCardsByClasses(cards: readonly any[], classes: readonly string[]): number;
  getColorsFromObject(obj: any): readonly string[];
  countManaSymbolsInManaCost(obj: any, colorSymbol: string): number;
  normalizeManaColorCode(value: unknown): string | null;
  getColorsOfManaSpent(obj: any): number | null;
  getAmountOfManaSpent(obj: any): number | null;
  getAmountOfSpecificManaSymbolSpent(obj: any, symbolRaw: string): number | null;
  parseCardClassList(text: string): readonly string[] | null;
  parseClassList(text: string): readonly string[] | null;
  parseColorQualifiedClassSpec(
    text: string
  ): { readonly classes: readonly string[]; readonly requiredColor?: string } | null;
  countByClasses(
    permanents: readonly BattlefieldPermanent[],
    classes: readonly string[],
    requiredColor?: string
  ): number;
  hasExecutorClass(permanent: BattlefieldPermanent | any, klass: string): boolean;
  countNegatedClass(
    permanents: readonly BattlefieldPermanent[],
    base: 'creature' | 'permanent',
    excludedQualifier: string,
    excludedId?: string
  ): number;
  leastStatAmongCreatures(
    permanents: readonly BattlefieldPermanent[],
    which: 'power' | 'toughness',
    opts?: { readonly excludedId?: string; readonly excludedSubtype?: string }
  ): number;
  greatestStatAmongCreatures(
    permanents: readonly BattlefieldPermanent[],
    which: 'power' | 'toughness',
    opts?: { readonly excludedId?: string; readonly excludedSubtype?: string }
  ): number;
  greatestPowerAmongCreatureCards(cards: readonly any[]): number;
  greatestManaValueAmongCards(cards: readonly any[]): number;
  greatestSharedCreatureSubtypeCount(permanents: readonly BattlefieldPermanent[]): number;
  lowestManaValueAmongPermanents(
    permanents: readonly BattlefieldPermanent[],
    opts?: { readonly excludedId?: string; readonly excludedQualifier?: string }
  ): number;
  highestManaValueAmongPermanents(
    permanents: readonly BattlefieldPermanent[],
    opts?: { readonly excludedId?: string; readonly excludedQualifier?: string }
  ): number;
}

export function createModifyPtWhereEvaluatorContext(
  state: GameState,
  controllerId: PlayerID,
  whereRaw: string,
  targetCreatureId?: string,
  ctx?: OracleIRExecutionContext,
  runtime?: ModifyPtRuntime
): ModifyPtWhereEvaluatorContext {
  const raw = normalizeModifyPtWhereRaw(whereRaw);
  const battlefield = getProcessedBattlefield(state);
  const controlled = battlefield.filter((p: any) => String((p as any)?.controller || '').trim() === controllerId);
  const opponentsControlled = battlefield.filter((p: any) => String((p as any)?.controller || '').trim() !== controllerId);

  const typeLineLower = (value: any): string => getExecutorTypeLineLower(value);
  const isAttackingObject = (obj: any): boolean => isAttackingObjectFromState(obj);
  const hasFlyingKeyword = (obj: any): boolean => hasFlyingKeywordFromState(obj);
  const getCreatureSubtypeKeys = (obj: any): readonly string[] => getCreatureSubtypeKeysFromState(obj, typeLineLower);
  const resolveContextPlayer = (): any | null => resolveContextPlayerFromStateHelper(state, ctx);
  const findPlayerById = (playerIdRaw: string): any | null => findPlayerByIdFromState(state, playerIdRaw);
  const findObjectById = (idRaw: string): any | null => findObjectByIdFromState(state, battlefield, idRaw);
  const findObjectByName = (nameRaw: string): any | null => findObjectByNameFromState(state, battlefield, nameRaw, ctx);
  const getExcludedId = (): string => getContextExcludedId(targetCreatureId, ctx);
  const getSourceRef = (): any | null => getContextSourceObject(ctx, findObjectById);
  const getTargetRef = (): any | null => getContextTargetObject(targetCreatureId, findObjectById);

  const resolveLastSacrificedSnapshot = (
    requiredClass: ModifyPtWhereSnapshotClass
  ): LastKnownPermanentSnapshot | null => {
    const snapshots = Array.isArray(runtime?.lastSacrificedPermanents) ? runtime.lastSacrificedPermanents : [];
    if (snapshots.length === 0) return null;

    const matches = (snapshot: LastKnownPermanentSnapshot): boolean => {
      if (requiredClass === 'card') return true;
      return lastKnownSnapshotHasClass(snapshot, requiredClass);
    };

    const sourceId = String(ctx?.sourceId || '').trim();
    if (sourceId) {
      const sourceMatch = snapshots.find(snapshot => snapshot.id === sourceId && matches(snapshot));
      if (sourceMatch) return sourceMatch;
    }

    const candidates = snapshots.filter(matches);
    return candidates.length === 1 ? candidates[0] : null;
  };

  const getCounterCountOnObject = (obj: any, counterNameRaw: string): number | null =>
    getCounterCountOnObjectFromState(obj, counterNameRaw);

  const isCommanderObject = (obj: any): boolean => isCommanderObjectFromUtils(obj);
  const collectCommandZoneObjects = (): readonly any[] =>
    collectCommandZoneObjectsFromUtils(state, controllerId, findObjectById);
  const countCardsByClasses = (cards: readonly any[], classes: readonly string[]): number =>
    countCardsByClassesFromUtils(cards, classes, typeLineLower);
  const getColorsFromObject = (obj: any): readonly string[] => getColorsFromObjectFromUtils(obj);
  const countManaSymbolsInManaCost = (obj: any, colorSymbol: string): number =>
    countManaSymbolsInManaCostFromUtils(obj, colorSymbol);
  const normalizeManaColorCode = (value: unknown): string | null => normalizeManaColorCodeFromUtils(value);
  const getColorsOfManaSpent = (obj: any): number | null => getColorsOfManaSpentFromUtils(obj);
  const getAmountOfManaSpent = (obj: any): number | null => getAmountOfManaSpentFromUtils(obj);
  const getAmountOfSpecificManaSymbolSpent = (obj: any, symbolRaw: string): number | null =>
    getAmountOfSpecificManaSymbolSpentFromUtils(obj, symbolRaw);
  const parseCardClassList = (text: string): readonly string[] | null => parseCardClassListFromUtils(text);
  const parseClassList = (text: string): readonly string[] | null => parseClassListFromUtils(text);
  const parseColorQualifiedClassSpec = (
    text: string
  ): { readonly classes: readonly string[]; readonly requiredColor?: string } | null =>
    parseColorQualifiedClassSpecFromUtils(text, normalizeManaColorCode);

  const getColorsFromPermanent = (perm: any): readonly string[] => getColorsFromObject(perm);
  const hasExecutorClass = (permanent: BattlefieldPermanent | any, klass: string): boolean =>
    hasExecutorClassFromPermanentUtils(permanent, klass);
  const countByClasses = (
    permanents: readonly BattlefieldPermanent[],
    classes: readonly string[],
    requiredColor?: string
  ): number =>
    countPermanentsByClassesFromUtils(
      permanents,
      classes,
      getColorsFromPermanent,
      hasExecutorClass,
      typeLineLower,
      requiredColor
    );
  const countNegatedClass = (
    permanents: readonly BattlefieldPermanent[],
    base: 'creature' | 'permanent',
    excludedQualifier: string,
    excludedId?: string
  ): number => countNegatedClassFromUtils(permanents, base, excludedQualifier, hasExecutorClass, typeLineLower, excludedId);
  const leastStatAmongCreatures = (
    permanents: readonly BattlefieldPermanent[],
    which: 'power' | 'toughness',
    opts?: { readonly excludedId?: string; readonly excludedSubtype?: string }
  ): number => leastStatAmongCreaturesFromUtils(permanents, which, hasExecutorClass, typeLineLower, opts);
  const greatestStatAmongCreatures = (
    permanents: readonly BattlefieldPermanent[],
    which: 'power' | 'toughness',
    opts?: { readonly excludedId?: string; readonly excludedSubtype?: string }
  ): number => greatestStatAmongCreaturesFromUtils(permanents, which, hasExecutorClass, typeLineLower, opts);
  const greatestPowerAmongCreatureCards = (cards: readonly any[]): number =>
    greatestPowerAmongCreatureCardsFromUtils(cards, typeLineLower);
  const greatestManaValueAmongCards = (cards: readonly any[]): number =>
    greatestManaValueAmongCardsFromUtils(cards, getCardManaValue);
  const greatestSharedCreatureSubtypeCount = (permanents: readonly BattlefieldPermanent[]): number =>
    greatestSharedCreatureSubtypeCountFromUtils(permanents, hasExecutorClass, getCreatureSubtypeKeys);
  const lowestManaValueAmongPermanents = (
    permanents: readonly BattlefieldPermanent[],
    opts?: { readonly excludedId?: string; readonly excludedQualifier?: string }
  ): number => lowestManaValueAmongPermanentsFromUtils(permanents, getCardManaValue, hasExecutorClass, typeLineLower, opts);
  const highestManaValueAmongPermanents = (
    permanents: readonly BattlefieldPermanent[],
    opts?: { readonly excludedId?: string; readonly excludedQualifier?: string }
  ): number => highestManaValueAmongPermanentsFromUtils(permanents, getCardManaValue, hasExecutorClass, typeLineLower, opts);

  return {
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
  };
}
