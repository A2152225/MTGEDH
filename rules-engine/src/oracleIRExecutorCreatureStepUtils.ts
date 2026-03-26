import type { BattlefieldPermanent, GameState, PlayerID } from '../../shared/src';
import type { OracleObjectSelector } from './oracleIR';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';
import { normalizeOracleText } from './oracleIRExecutorPlayerUtils';
import { getExecutorTypeLineLower, isExecutorCreature } from './oracleIRExecutorPermanentUtils';
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

export function resolveBolsterTargetCreatureIdFromBattlefield(
  battlefield: readonly BattlefieldPermanent[],
  target: OracleObjectSelector,
  ctx: OracleIRExecutionContext
): string | undefined {
  if (target.kind !== 'raw') return undefined;

  const targetText = normalizeOracleText(target.text);
  if (targetText !== 'target creature you control with the least toughness among creatures you control') {
    return undefined;
  }

  const controllerId = String(ctx.controllerId || '').trim();
  if (!controllerId) return undefined;

  const processedBattlefield = applyStaticAbilitiesToBattlefield([...battlefield]) as BattlefieldPermanent[];
  const controlledCreatures = processedBattlefield.filter(permanent => {
    if (!isExecutorCreature(permanent)) return false;
    return String((permanent as any)?.controller || '').trim() === controllerId;
  });
  if (controlledCreatures.length === 0) return undefined;

  const toughnessValues = controlledCreatures
    .map(permanent => readToughnessForComparison(permanent))
    .filter((value): value is number => value !== null);
  if (toughnessValues.length === 0) return undefined;

  const leastToughness = Math.min(...toughnessValues);
  const legalTargets = controlledCreatures.filter(permanent => readToughnessForComparison(permanent) === leastToughness);

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

  const bolsterTargetCreatureId = resolveBolsterTargetCreatureIdFromBattlefield(
    (state.battlefield || []) as BattlefieldPermanent[],
    target,
    ctx
  );
  if (bolsterTargetCreatureId) {
    return bolsterTargetCreatureId;
  }

  if (target.kind !== 'raw') return undefined;
  const targetText = String(target.text || '').trim().toLowerCase();
  const battlefield = getProcessedBattlefield(state);
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
  if (targetText !== 'each other attacking creature' && targetText !== 'other attacking creatures') {
    return [];
  }

  const sourceId = String(ctx.sourceId || '').trim();
  const battlefield = getProcessedBattlefield(state);

  return battlefield
    .filter(permanent => {
      const permanentId = String((permanent as any)?.id || '').trim();
      if (!permanentId || permanentId === sourceId) return false;
      if (!isExecutorCreature(permanent)) return false;
      return isAttackingPermanent(permanent);
    })
    .map(permanent => String((permanent as any)?.id || '').trim())
    .filter(Boolean);
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
  };

  if (markTrepanation) {
    nextPermanent.trepanationBonus = powerBonus;
    nextPermanent.lastTrepanationBonus = powerBonus;
  }

  battlefield[index] = nextPermanent as any;
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
  if (klass === 'permanent') return controlled.length;
  if (klass === 'nonland permanent') {
    return controlled.filter(permanent => !typeLineLower(permanent).includes('land')).length;
  }
  return controlled.filter(permanent => typeLineLower(permanent).includes(klass)).length;
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
