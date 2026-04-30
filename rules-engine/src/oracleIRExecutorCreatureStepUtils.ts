import type { BattlefieldPermanent, GameState, PlayerID } from '../../shared/src';
import type { OracleObjectSelector } from './oracleIR';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';
import { normalizeOracleText } from './oracleIRExecutorPlayerUtils';
import { getExecutorTypeLineLower, hasExecutorClass, isExecutorCreature } from './oracleIRExecutorPermanentUtils';
import { applyStaticAbilitiesToBattlefield } from './staticAbilities';

function readPowerForComparison(permanent: BattlefieldPermanent | any): number | null {
  for (const candidate of [
    (permanent as any)?.effectivePower,
    (permanent as any)?.power,
    (permanent as any)?.basePower,
    (permanent as any)?.card?.power,
  ]) {
    const numeric = Number(candidate);
    if (Number.isFinite(numeric)) return numeric;
  }

  return null;
}

function readToughnessForComparison(permanent: BattlefieldPermanent | any): number | null {
  for (const candidate of [
    (permanent as any)?.effectiveToughness,
    (permanent as any)?.toughness,
    (permanent as any)?.baseToughness,
    (permanent as any)?.card?.toughness,
  ]) {
    const numeric = Number(candidate);
    if (Number.isFinite(numeric)) return numeric;
  }

  return null;
}

function readCreatureStatForComparison(
  permanent: BattlefieldPermanent | any,
  which: 'power' | 'toughness'
): number | null {
  return which === 'power'
    ? readPowerForComparison(permanent)
    : readToughnessForComparison(permanent);
}

function isAttackingPermanent(permanent: BattlefieldPermanent | any): boolean {
  return Boolean((permanent as any)?.attacking || (permanent as any)?.defendingPlayerId || (permanent as any)?.attackingPlayerId);
}

export function resolveMentorTargetCreatureIdFromBattlefield(
  battlefield: readonly BattlefieldPermanent[],
  target: OracleObjectSelector,
  ctx: OracleIRExecutionContext
): string | undefined {
  if (target.kind !== 'raw') return undefined;

  const targetText = normalizeOracleText(target.text);
  if (targetText !== "target attacking creature with power less than this creature's power") {
    return undefined;
  }

  const sourceId = String(ctx.sourceId || '').trim();
  if (!sourceId) return undefined;

  const processedBattlefield = applyStaticAbilitiesToBattlefield([...battlefield]) as BattlefieldPermanent[];
  const sourcePermanent = processedBattlefield.find(permanent => String((permanent as any)?.id || '').trim() === sourceId);
  const sourcePower = readPowerForComparison(sourcePermanent);
  if (!sourcePermanent || sourcePower === null || !isAttackingPermanent(sourcePermanent)) {
    return undefined;
  }

  const legalTargets = processedBattlefield.filter(permanent => {
    const permanentId = String((permanent as any)?.id || '').trim();
    if (!permanentId || permanentId === sourceId) return false;
    if (!isExecutorCreature(permanent)) return false;
    if (!isAttackingPermanent(permanent)) return false;

    const targetPower = readPowerForComparison(permanent);
    return targetPower !== null && targetPower < sourcePower;
  });

  const chosenIds = [
    String(ctx.targetCreatureId || '').trim(),
    String(ctx.targetPermanentId || '').trim(),
    ...(
      Array.isArray(ctx.selectorContext?.chosenObjectIds)
        ? ctx.selectorContext.chosenObjectIds.map(id => String(id || '').trim()).filter(Boolean)
        : []
    ),
  ].filter(Boolean);

  if (chosenIds.length > 0) {
    const legalIdSet = new Set(legalTargets.map(permanent => String((permanent as any)?.id || '').trim()));
    const matchedChosenIds = Array.from(new Set(chosenIds)).filter(id => legalIdSet.has(id));
    return matchedChosenIds.length === 1 ? matchedChosenIds[0] : undefined;
  }

  return legalTargets.length === 1 ? String((legalTargets[0] as any)?.id || '').trim() || undefined : undefined;
}

function normalizeCreatureControllerScope(rawScope: string): 'you-control' | 'opponents-control' | undefined {
  const normalized = normalizeOracleText(rawScope);
  if (normalized === 'you control') return 'you-control';
  if (
    normalized === 'your opponents control' ||
    normalized === 'an opponent controls' ||
    normalized === "you don't control" ||
    normalized === 'you do not control'
  ) {
    return 'opponents-control';
  }
  return undefined;
}

function normalizeCreatureLegendQualifier(rawQualifier: string): 'legendary' | 'nonlegendary' | undefined {
  const normalized = normalizeOracleText(rawQualifier);
  if (normalized === 'legendary') return 'legendary';
  if (normalized === 'nonlegendary') return 'nonlegendary';
  return undefined;
}

function creatureMatchesLegendQualifier(
  permanent: BattlefieldPermanent | any,
  qualifier?: 'legendary' | 'nonlegendary'
): boolean {
  if (!qualifier) return true;
  const typeLine = String((permanent as any)?.card?.type_line || (permanent as any)?.type_line || '').toLowerCase();
  const isLegendary = typeLine.includes('legendary');
  return qualifier === 'legendary' ? isLegendary : !isLegendary;
}

export function resolveCreatureExtremaQualifiedTargetIdFromBattlefield(
  battlefield: readonly BattlefieldPermanent[],
  target: OracleObjectSelector,
  ctx: OracleIRExecutionContext
): string | undefined {
  if (target.kind !== 'raw') return undefined;

  const targetText = normalizeOracleText(target.text);
  const match = targetText.match(
    /^target (other )?(legendary |nonlegendary )?creature (you control|your opponents control|an opponent controls|you don['’]?t control|you do not control) with the (least|lowest|smallest|greatest|highest) (power|toughness) among (other )?(legendary |nonlegendary )?creatures (you control|your opponents control|an opponent controls|you don['’]?t control|you do not control)$/i
  );
  if (!match) {
    return undefined;
  }

  const controllerId = String(ctx.controllerId || '').trim();
  if (!controllerId) return undefined;

  const targetQualifier = normalizeCreatureLegendQualifier(String(match[2] || '').trim());
  const targetScope = normalizeCreatureControllerScope(String(match[3] || ''));
  const amongQualifier = normalizeCreatureLegendQualifier(String(match[7] || '').trim());
  const amongScope = normalizeCreatureControllerScope(String(match[8] || ''));
  if (!targetScope || !amongScope || targetScope !== amongScope) {
    return undefined;
  }

  const isLeast = /^(least|lowest|smallest)$/i.test(String(match[4] || ''));
  const which = String(match[5] || '').toLowerCase() as 'power' | 'toughness';
  const excludeSourceId = Boolean(String(match[1] || '').trim()) || Boolean(String(match[6] || '').trim());
  const sourceId = String(ctx.sourceId || '').trim();

  const processedBattlefield = applyStaticAbilitiesToBattlefield([...battlefield]) as BattlefieldPermanent[];
  const candidateCreatures = processedBattlefield.filter(permanent => {
    if (!isExecutorCreature(permanent)) return false;
    const permanentId = String((permanent as any)?.id || '').trim();
    if (excludeSourceId && sourceId && permanentId === sourceId) return false;

    const isControlledByYou = String((permanent as any)?.controller || '').trim() === controllerId;
    const matchesControllerScope = targetScope === 'you-control' ? isControlledByYou : !isControlledByYou;
    if (!matchesControllerScope) return false;

    if (!creatureMatchesLegendQualifier(permanent, amongQualifier)) return false;
    if (!creatureMatchesLegendQualifier(permanent, targetQualifier)) return false;

    return true;
  });
  if (candidateCreatures.length === 0) return undefined;

  const statValues = candidateCreatures
    .map(permanent => readCreatureStatForComparison(permanent, which))
    .filter((value): value is number => value !== null);
  if (statValues.length === 0) return undefined;

  const extremum = isLeast ? Math.min(...statValues) : Math.max(...statValues);
  const legalTargets = candidateCreatures.filter(permanent => readCreatureStatForComparison(permanent, which) === extremum);

  const chosenIds = [
    String(ctx.targetCreatureId || '').trim(),
    String(ctx.targetPermanentId || '').trim(),
    ...(
      Array.isArray(ctx.selectorContext?.chosenObjectIds)
        ? ctx.selectorContext.chosenObjectIds.map(id => String(id || '').trim()).filter(Boolean)
        : []
    ),
  ].filter(Boolean);

  if (chosenIds.length > 0) {
    const legalIdSet = new Set(legalTargets.map(permanent => String((permanent as any)?.id || '').trim()));
    const matchedChosenIds = Array.from(new Set(chosenIds)).filter(id => legalIdSet.has(id));
    return matchedChosenIds.length === 1 ? matchedChosenIds[0] : undefined;
  }

  return legalTargets.length === 1 ? String((legalTargets[0] as any)?.id || '').trim() || undefined : undefined;
}

export function resolveBolsterTargetCreatureIdFromBattlefield(
  battlefield: readonly BattlefieldPermanent[],
  target: OracleObjectSelector,
  ctx: OracleIRExecutionContext
): string | undefined {
  return resolveCreatureExtremaQualifiedTargetIdFromBattlefield(battlefield, target, ctx);
}

export function resolveTrepanationBoostTargetCreatureId(
  state: GameState,
  ctx: OracleIRExecutionContext
): string | undefined {
  const battlefield = getProcessedBattlefield(state);
  const sourceId = String(ctx.sourceId || '').trim();

  if (sourceId) {
    const sourcePerm = battlefield.find(permanent => permanent.id === sourceId) as any;
    const attachedTo = String(sourcePerm?.attachedTo || '').trim();
    if (attachedTo && battlefield.some(permanent => permanent.id === attachedTo)) return attachedTo;
  }

  const attackers = battlefield.filter(permanent => String((permanent as any)?.attacking || '').trim().length > 0);
  if (attackers.length === 1) return attackers[0].id;
  return undefined;
}

export function resolveSingleCreatureTargetId(
  state: GameState,
  target: OracleObjectSelector,
  ctx: OracleIRExecutionContext
): string | undefined {
  const directTargetCreatureId = String(ctx.targetCreatureId || '').trim();
  if (directTargetCreatureId) {
    const battlefield = (state.battlefield || []) as BattlefieldPermanent[];
    const matched = battlefield.find(permanent => String((permanent as any)?.id || '').trim() === directTargetCreatureId);
    if (matched) return directTargetCreatureId;
  }

  if (target.kind === 'equipped_creature') {
    return resolveTrepanationBoostTargetCreatureId(state, ctx);
  }

  const mentorTargetCreatureId = resolveMentorTargetCreatureIdFromBattlefield(
    (state.battlefield || []) as BattlefieldPermanent[],
    target,
    ctx
  );
  if (mentorTargetCreatureId) {
    return mentorTargetCreatureId;
  }

  const bolsterTargetCreatureId = resolveCreatureExtremaQualifiedTargetIdFromBattlefield(
    (state.battlefield || []) as BattlefieldPermanent[],
    target,
    ctx
  );
  if (bolsterTargetCreatureId) {
    return bolsterTargetCreatureId;
  }

  if (target.kind !== 'raw') return undefined;
  const battlefield = getProcessedBattlefield(state);
  const targetText = normalizeOracleText(target.text);
  const directTargetPermanentId = String(ctx.targetPermanentId || '').trim();
  if (
    directTargetPermanentId &&
    /^(?:that|the|this) creature$|^(?:that|this) permanent$|^it$/.test(targetText)
  ) {
    const matched = battlefield.find(permanent => String((permanent as any)?.id || '').trim() === directTargetPermanentId);
    if (matched && isExecutorCreature(matched)) {
      return directTargetPermanentId;
    }
  }

  const creatures = battlefield.filter(permanent => isExecutorCreature(permanent));
  const sourceId = String(ctx.sourceId || '').trim();

  const controllerId = String(ctx.controllerId || '').trim();
  const controlledCreatures = creatures.filter(
    permanent => String((permanent as any)?.controller || '').trim() === controllerId
  );
  const opponentsControlledCreatures = creatures.filter(
    permanent => String((permanent as any)?.controller || '').trim() !== controllerId
  );

  if (targetText.includes('target creature you control')) {
    return controlledCreatures.length === 1 ? controlledCreatures[0].id : undefined;
  }

  if (targetText.includes('target creature your opponents control') || targetText.includes('target creature an opponent controls')) {
    return opponentsControlledCreatures.length === 1 ? opponentsControlledCreatures[0].id : undefined;
  }

  if (targetText === 'target creature' || targetText === 'creature' || targetText.includes('target creature')) {
    return creatures.length === 1 ? creatures[0].id : undefined;
  }

  if (
    (targetText === 'this creature' || targetText === 'this permanent' || targetText === 'it') &&
    sourceId &&
    creatures.some(permanent => String((permanent as any)?.id || '').trim() === sourceId)
  ) {
    return sourceId;
  }

  if (targetText === 'enchanted creature' && sourceId) {
    const sourcePermanent = battlefield.find(permanent => String((permanent as any)?.id || '').trim() === sourceId) as any;
    const attachedToId = String(sourcePermanent?.attachedTo || '').trim();
    if (
      attachedToId &&
      creatures.some(permanent => String((permanent as any)?.id || '').trim() === attachedToId)
    ) {
      return attachedToId;
    }
  }

  return undefined;
}

export function resolveCreatureTargetIds(
  state: GameState,
  target: OracleObjectSelector,
  ctx: OracleIRExecutionContext
): string[] {
  const singleTargetId = resolveSingleCreatureTargetId(state, target, ctx);
  if (singleTargetId) return [singleTargetId];

  if (target.kind !== 'raw') return [];

  const targetText = normalizeOracleText(target.text);
  const sourceId = String(ctx.sourceId || '').trim();
  const battlefield = getProcessedBattlefield(state).filter(permanent => isExecutorCreature(permanent));
  const controllerId = String(ctx.controllerId || '').trim();

  const controlledBy = (playerId: string): string[] =>
    battlefield
      .filter(permanent => String((permanent as any)?.controller || '').trim() === playerId)
      .map(permanent => String((permanent as any)?.id || '').trim())
      .filter(Boolean);

  if (targetText === 'each other attacking creature' || targetText === 'other attacking creatures') {
    return battlefield
      .filter(permanent => {
        const permanentId = String((permanent as any)?.id || '').trim();
        if (!permanentId || permanentId === sourceId) return false;
        return isAttackingPermanent(permanent);
      })
      .map(permanent => String((permanent as any)?.id || '').trim())
      .filter(Boolean);
  }

  if (targetText === 'creatures you control' || targetText === 'all creatures you control') {
    return controlledBy(controllerId);
  }

  if (targetText === 'creatures your opponents control' || targetText === 'all creatures your opponents control') {
    return battlefield
      .filter(permanent => String((permanent as any)?.controller || '').trim() !== controllerId)
      .map(permanent => String((permanent as any)?.id || '').trim())
      .filter(Boolean);
  }

  if (targetText === 'all creatures') {
    return battlefield
      .map(permanent => String((permanent as any)?.id || '').trim())
      .filter(Boolean);
  }

  return [];
}

export function applyTemporaryPowerToughnessModifier(
  state: GameState,
  creatureId: string,
  ctx: OracleIRExecutionContext,
  powerBonus: number,
  toughnessBonus: number,
  markTrepanation: boolean
): GameState | null {
  const battlefield = [...((state.battlefield || []) as BattlefieldPermanent[])];
  const index = battlefield.findIndex(permanent => permanent.id === creatureId);
  if (index < 0) return null;

  const permanent: any = battlefield[index] as any;
  const modifiers = Array.isArray(permanent.modifiers) ? [...permanent.modifiers] : [];
  modifiers.push({
    type: 'powerToughness',
    power: powerBonus,
    toughness: toughnessBonus,
    sourceId: ctx.sourceId,
    duration: 'end_of_turn',
  } as any);

  const nextPermanent: any = {
    ...permanent,
    modifiers,
    effectivePower: undefined,
    effectiveToughness: undefined,
  };

  if (markTrepanation) {
    nextPermanent.trepanationBonus = powerBonus;
    nextPermanent.lastTrepanationBonus = powerBonus;
  }

  battlefield[index] = nextPermanent as any;
  const recalculatedBattlefield = getProcessedBattlefield({ ...(state as any), battlefield } as any);
  const recalculatedPermanent = recalculatedBattlefield.find(
    permanent => String((permanent as any)?.id || '').trim() === creatureId
  ) as any;
  if (recalculatedPermanent) {
    battlefield[index] = {
      ...nextPermanent,
      power:
        typeof recalculatedPermanent.effectivePower === 'number'
          ? recalculatedPermanent.effectivePower
          : nextPermanent.power,
      toughness:
        typeof recalculatedPermanent.effectiveToughness === 'number'
          ? recalculatedPermanent.effectiveToughness
          : nextPermanent.toughness,
      effectivePower: recalculatedPermanent.effectivePower,
      effectiveToughness: recalculatedPermanent.effectiveToughness,
      grantedAbilities: recalculatedPermanent.grantedAbilities,
    } as any;
  }

  return { ...(state as any), battlefield } as any;
}

export function applyTemporarySetBasePowerToughness(
  state: GameState,
  creatureId: string,
  ctx: OracleIRExecutionContext,
  power: number,
  toughness: number
): GameState | null {
  const battlefield = [...((state.battlefield || []) as BattlefieldPermanent[])];
  const index = battlefield.findIndex(permanent => permanent.id === creatureId);
  if (index < 0) return null;

  const permanent: any = battlefield[index] as any;
  const modifiers = Array.isArray(permanent.modifiers) ? [...permanent.modifiers] : [];
  modifiers.push({
    type: 'setPowerToughness',
    setPower: power,
    setToughness: toughness,
    sourceId: ctx.sourceId,
    duration: 'end_of_turn',
  } as any);

  battlefield[index] = {
    ...permanent,
    modifiers,
    effectivePower: undefined,
    effectiveToughness: undefined,
  } as any;
  const recalculatedBattlefield = getProcessedBattlefield({ ...(state as any), battlefield } as any);
  const recalculatedPermanent = recalculatedBattlefield.find(
    permanent => String((permanent as any)?.id || '').trim() === creatureId
  ) as any;
  if (recalculatedPermanent) {
    battlefield[index] = {
      ...(battlefield[index] as any),
      power:
        typeof recalculatedPermanent.effectivePower === 'number'
          ? recalculatedPermanent.effectivePower
          : (battlefield[index] as any)?.power,
      toughness:
        typeof recalculatedPermanent.effectiveToughness === 'number'
          ? recalculatedPermanent.effectiveToughness
          : (battlefield[index] as any)?.toughness,
      effectivePower: recalculatedPermanent.effectivePower,
      effectiveToughness: recalculatedPermanent.effectiveToughness,
      grantedAbilities: recalculatedPermanent.grantedAbilities,
    } as any;
  }

  return { ...(state as any), battlefield } as any;
}

export function applyTemporarySwitchPowerToughness(
  state: GameState,
  creatureId: string,
  ctx: OracleIRExecutionContext
): GameState | null {
  const battlefield = [...((state.battlefield || []) as BattlefieldPermanent[])];
  const index = battlefield.findIndex(permanent => permanent.id === creatureId);
  if (index < 0) return null;

  const permanent: any = battlefield[index] as any;
  const modifiers = Array.isArray(permanent.modifiers) ? [...permanent.modifiers] : [];
  modifiers.push({
    type: 'switchPowerToughness',
    sourceId: ctx.sourceId,
    duration: 'end_of_turn',
  } as any);

  battlefield[index] = {
    ...permanent,
    modifiers,
    effectivePower: undefined,
    effectiveToughness: undefined,
  } as any;

  const recalculatedBattlefield = getProcessedBattlefield({ ...(state as any), battlefield } as any);
  const recalculatedPermanent = recalculatedBattlefield.find(
    permanent => String((permanent as any)?.id || '').trim() === creatureId
  ) as any;
  if (recalculatedPermanent) {
    battlefield[index] = {
      ...(battlefield[index] as any),
      power:
        typeof recalculatedPermanent.effectivePower === 'number'
          ? recalculatedPermanent.effectivePower
          : (battlefield[index] as any)?.power,
      toughness:
        typeof recalculatedPermanent.effectiveToughness === 'number'
          ? recalculatedPermanent.effectiveToughness
          : (battlefield[index] as any)?.toughness,
      effectivePower: recalculatedPermanent.effectivePower,
      effectiveToughness: recalculatedPermanent.effectiveToughness,
      grantedAbilities: recalculatedPermanent.grantedAbilities,
    } as any;
  }

  return { ...(state as any), battlefield } as any;
}

export function resolveGoadTargetCreatureIds(
  state: GameState,
  target: OracleObjectSelector,
  ctx: OracleIRExecutionContext
): string[] {
  const battlefield = getProcessedBattlefield(state).filter(permanent => isExecutorCreature(permanent));

  const chosenIds = Array.isArray(ctx.selectorContext?.chosenObjectIds)
    ? ctx.selectorContext.chosenObjectIds.map(id => String(id || '').trim()).filter(Boolean)
    : [];
  if (chosenIds.length > 0) {
    const chosenSet = new Set(chosenIds);
    return battlefield
      .filter(permanent => chosenSet.has(String((permanent as any)?.id || '').trim()))
      .map(permanent => String((permanent as any)?.id || '').trim())
      .filter(Boolean);
  }

  const targetCreatureId = String(ctx.targetCreatureId || '').trim();
  if (targetCreatureId) {
    const matched = battlefield.find(permanent => String((permanent as any)?.id || '').trim() === targetCreatureId);
    if (matched) return [targetCreatureId];
  }

  if (target.kind !== 'raw') return [];

  const raw = normalizeOracleText(target.text);
  if (!raw) return [];

  const controllerId = String(ctx.controllerId || '').trim();
  const targetPlayerId = String(ctx.selectorContext?.targetPlayerId || '').trim();
  const targetOpponentId = String(ctx.selectorContext?.targetOpponentId || '').trim();

  const controlledBy = (playerId: string): string[] =>
    battlefield
      .filter(permanent => String((permanent as any)?.controller || '').trim() === playerId)
      .map(permanent => String((permanent as any)?.id || '').trim())
      .filter(Boolean);

  const opponentsControlled = battlefield.filter(
    permanent => String((permanent as any)?.controller || '').trim() !== controllerId
  );

  if (raw === 'all creatures your opponents control' || raw === "all creatures you don't control") {
    return opponentsControlled.map(permanent => String((permanent as any)?.id || '').trim()).filter(Boolean);
  }

  if (
    raw === 'target creature' ||
    raw === 'creature' ||
    raw === "target creature you don't control" ||
    raw === 'target creature an opponent controls' ||
    raw === 'target creature your opponents control'
  ) {
    const pool = raw === 'target creature' || raw === 'creature' ? battlefield : opponentsControlled;
    return pool.length === 1 ? [String((pool[0] as any)?.id || '').trim()] : [];
  }

  if (
    (raw === 'target creature that player controls' ||
      raw === 'each creature that player controls' ||
      raw === 'each creature target player controls') &&
    targetPlayerId
  ) {
    const pool = controlledBy(targetPlayerId);
    if (raw.startsWith('each ')) return pool;
    return pool.length === 1 ? pool : [];
  }

  if (
    (raw === 'target creature that opponent controls' ||
      raw === 'each creature that opponent controls' ||
      raw === 'each creature target opponent controls' ||
      raw === 'target creature defending player controls') &&
    (targetOpponentId || targetPlayerId)
  ) {
    const pool = controlledBy(targetOpponentId || targetPlayerId);
    if (raw.startsWith('each ')) return pool;
    return pool.length === 1 ? pool : [];
  }

  return [];
}

export function applyGoadToCreatures(
  state: GameState,
  creatureIds: readonly string[],
  goaderId: PlayerID
): GameState | null {
  if (!Array.isArray(creatureIds) || creatureIds.length === 0) return null;

  const battlefield = [...((state.battlefield || []) as BattlefieldPermanent[])];
  const turnNumber = Number((state as any)?.turnNumber ?? 0) || 0;
  const expiryTurn = turnNumber + 1;
  const idSet = new Set(creatureIds.map(id => String(id || '').trim()).filter(Boolean));
  let changed = false;

  for (let index = 0; index < battlefield.length; index += 1) {
    const permanent: any = battlefield[index] as any;
    const permanentId = String((permanent as any)?.id || '').trim();
    if (!idSet.has(permanentId)) continue;
    if (!isExecutorCreature(permanent)) continue;

    const goadedBy = Array.isArray(permanent.goadedBy)
      ? permanent.goadedBy.map((value: unknown) => String(value || '').trim()).filter(Boolean)
      : [];
    const nextGoadedBy = goadedBy.includes(goaderId) ? goadedBy : [...goadedBy, goaderId];
    const nextGoadedUntil = {
      ...((permanent as any)?.goadedUntil && typeof (permanent as any).goadedUntil === 'object'
        ? (permanent as any).goadedUntil
        : {}),
      [goaderId]: expiryTurn,
    };

    battlefield[index] = {
      ...permanent,
      goadedBy: nextGoadedBy,
      goadedUntil: nextGoadedUntil,
    } as any;
    changed = true;
  }

  return changed ? ({ ...(state as any), battlefield } as any) : null;
}

export function countControlledByClass(
  controlled: readonly BattlefieldPermanent[],
  klass: string,
  typeLineLower: (permanent: any) => string
): number {
  return controlled.filter(permanent => {
    if (klass === 'permanent' || klass === 'nonland permanent') {
      return hasExecutorClass(permanent, klass);
    }

    if (hasExecutorClass(permanent, klass)) {
      return true;
    }

    return typeLineLower(permanent).includes(klass);
  }).length;
}

export function normalizeControlledClassKey(text: string): string | null {
  const normalized = String(text || '').trim().toLowerCase().replace(/\s+/g, ' ');
  if (/^creatures?$/.test(normalized)) return 'creature';
  if (/^artifacts?$/.test(normalized)) return 'artifact';
  if (/^enchantments?$/.test(normalized)) return 'enchantment';
  if (/^lands?$/.test(normalized)) return 'land';
  if (/^planeswalkers?$/.test(normalized)) return 'planeswalker';
  if (/^snow permanents?$/.test(normalized)) return 'snow';
  if (/^nonland permanents?$/.test(normalized)) return 'nonland permanent';
  if (/^permanents?$/.test(normalized)) return 'permanent';

  const singularize = (word: string): string => {
    const irregular: Record<string, string> = {
      elves: 'elf',
      zombies: 'zombie',
    };
    if (irregular[word]) return irregular[word];
    if (word.endsWith('ies') && word.length > 3) return `${word.slice(0, -3)}y`;
    if (/(?:xes|zes|ches|shes|sses)$/.test(word) && word.length > 4) return word.slice(0, -2);
    if (word.endsWith('s') && word.length > 2) return word.slice(0, -1);
    return word;
  };

  if (/^[a-z][a-z-]*$/.test(normalized)) {
    const stopwords = new Set(['card', 'cards', 'spell', 'spells']);
    if (!stopwords.has(normalized)) return singularize(normalized);
  }

  return null;
}

export function getProcessedBattlefield(state: GameState): BattlefieldPermanent[] {
  return applyStaticAbilitiesToBattlefield((state.battlefield || []) as BattlefieldPermanent[]) as BattlefieldPermanent[];
}
