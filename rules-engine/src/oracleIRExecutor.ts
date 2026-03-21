import type { GameState, PlayerID, BattlefieldPermanent } from '../../shared/src';
import { createTokens, createTokensByName, parseTokenCreationFromText, COMMON_TOKENS } from './tokenCreation';
import type { OracleEffectStep, OracleObjectSelector, OraclePlayerSelector, OracleQuantity } from './oracleIR';
import { parseManaSymbols } from './types/numbers';
import { addMana, createEmptyManaPool, ManaType } from './types/mana';
import { clearPlayableFromExileForCards, stripPlayableFromExileTags } from './playableFromExile';
import { applyStaticAbilitiesToBattlefield } from './staticAbilities';
import { isCurrentlyCreature } from './actions/combat';

export interface OracleIRExecutionOptions {
  /**
   * If false (default), skips "may" steps because they require a player choice.
   * If true, applies optional steps as if the player chose "yes".
   */
  readonly allowOptional?: boolean;
  /**
   * Explicit selected mode ids for a choose_mode step when already chosen by a player.
   */
  readonly selectedModeIds?: readonly string[];
}

export interface OracleIRSelectorContext {
  /** Bound target for selectors parsed as target player. */
  readonly targetPlayerId?: PlayerID;
  /** Bound target for selectors parsed as target opponent. */
  readonly targetOpponentId?: PlayerID;
  /** Bound antecedent set for selectors parsed as "each of those opponents". */
  readonly eachOfThoseOpponents?: readonly PlayerID[];
  /** Bound chosen objects for multi-selection antecedents such as "the chosen creatures". */
  readonly chosenObjectIds?: readonly string[];
}

export interface OracleIRExecutionEventHint {
  /** Best-effort single target player from trigger/ability resolution context. */
  readonly targetPlayerId?: PlayerID;
  /** Best-effort single target opponent from trigger/ability resolution context. */
  readonly targetOpponentId?: PlayerID;
  /** Best-effort single target permanent from trigger/ability resolution context. */
  readonly targetPermanentId?: string;
  /** Explicit choice for "tap or untap" style effects when known. */
  readonly tapOrUntapChoice?: 'tap' | 'untap';
  /** Generic affected players for this event (may include non-opponents). */
  readonly affectedPlayerIds?: readonly PlayerID[];
  /** Affected opponents for this event (preferred for relational opponent selectors). */
  readonly affectedOpponentIds?: readonly PlayerID[];
  /** Opponents dealt damage by the triggering event/source (Breeches-style antecedent). */
  readonly opponentsDealtDamageIds?: readonly PlayerID[];
  /** Spell type context used by some exile-until templates (for example, Possibility Storm). */
  readonly spellType?: string;
}

export interface OracleIRExecutionContext {
  readonly controllerId: PlayerID;
  readonly sourceId?: string;
  readonly sourceName?: string;
  /** Optional direct target creature binding used by modify_pt where-X evaluation and legacy tests/callers. */
  readonly targetCreatureId?: string;
  /** Optional direct target permanent binding used by targeted effects like Merrow Reejerey. */
  readonly targetPermanentId?: string;
  /** Choice for effects worded as "tap or untap target permanent." */
  readonly tapOrUntapChoice?: 'tap' | 'untap';
  /** Normalized reference spell types used by some deterministic unknown-amount loops. */
  readonly referenceSpellTypes?: readonly string[];
  /**
   * Optional selector bindings supplied by the caller from trigger/target resolution context.
   * This allows relational selectors such as "each of those opponents" to execute
   * deterministically in multiplayer when the antecedent set is known.
   */
  readonly selectorContext?: OracleIRSelectorContext;
}

/**
 * Build/augment an execution context from trigger/target event hints.
 *
 * This keeps selector binding logic in one place so callers can pass whichever
 * event fields they already have, and relational selectors like
 * "each of those opponents" can resolve with minimal glue code.
 */
export function buildOracleIRExecutionContext(
  base: OracleIRExecutionContext,
  hint?: OracleIRExecutionEventHint
): OracleIRExecutionContext {
  const normalizeId = (value: unknown): PlayerID | undefined => {
    if (typeof value !== 'string' && typeof value !== 'number') return undefined;
    const normalized = String(value).trim();
    return normalized ? (normalized as PlayerID) : undefined;
  };

  const normalizedControllerId = normalizeId(base.controllerId) ?? base.controllerId;
  const baseSel = base.selectorContext;

  const dedupe = (ids: readonly PlayerID[] | undefined): readonly PlayerID[] | undefined => {
    if (!Array.isArray(ids) || ids.length === 0) return undefined;
    const out: PlayerID[] = [];
    const seen = new Set<PlayerID>();
    for (const id of ids) {
      const normalized = normalizeId(id);
      if (!normalized || seen.has(normalized)) continue;
      seen.add(normalized);
      out.push(normalized);
    }
    return out.length > 0 ? out : undefined;
  };

  const normalizeSpellTypes = (value: unknown): readonly string[] | undefined => {
    if (typeof value !== 'string') return undefined;
    const lower = value.toLowerCase();
    const known = ['artifact', 'battle', 'creature', 'enchantment', 'instant', 'kindred', 'land', 'planeswalker', 'sorcery'];
    const out = known.filter(type => lower.includes(type));
    if (lower.includes('tribal') && !out.includes('kindred')) out.push('kindred');
    return out.length > 0 ? out : undefined;
  };

  const hintTargetOpponentId = normalizeId(hint?.targetOpponentId);
  const hintTargetPlayerId = normalizeId(hint?.targetPlayerId);
  const hintTargetPermanentId = normalizeId(hint?.targetPermanentId);
  const baseTargetOpponentId = normalizeId(baseSel?.targetOpponentId);
  const baseTargetPlayerId = normalizeId(baseSel?.targetPlayerId);

  const eachOfThoseOpponents =
    dedupe(hint?.affectedOpponentIds) ??
    dedupe(hint?.opponentsDealtDamageIds) ??
    dedupe(hint?.affectedPlayerIds) ??
    dedupe(hintTargetOpponentId ? [hintTargetOpponentId] : undefined) ??
    dedupe(hintTargetPlayerId ? [hintTargetPlayerId] : undefined) ??
    baseSel?.eachOfThoseOpponents;

  const sanitizedEachOfThoseOpponents = eachOfThoseOpponents
    ? dedupe(eachOfThoseOpponents.filter(id => id !== normalizedControllerId))
    : undefined;

  const singleton = (ids: readonly PlayerID[] | undefined): PlayerID | undefined =>
    Array.isArray(ids) && ids.length === 1 ? ids[0] : undefined;

  const dedupedAffectedPlayers = dedupe(hint?.affectedPlayerIds);
  const dedupedAffectedOpponents = dedupe(
    (hint?.affectedOpponentIds || []).filter(id => normalizeId(id) !== normalizedControllerId) as PlayerID[]
  );
  const dedupedOpponentsDealtDamage = dedupe(
    (hint?.opponentsDealtDamageIds || []).filter(id => normalizeId(id) !== normalizedControllerId) as PlayerID[]
  );
  const explicitTargetOpponentId =
    hintTargetOpponentId && hintTargetOpponentId !== normalizedControllerId
      ? hintTargetOpponentId
      : undefined;
  const inferredTargetOpponentId =
    singleton(sanitizedEachOfThoseOpponents) ??
    singleton(dedupedAffectedOpponents) ??
    singleton(dedupedOpponentsDealtDamage);
  const inferredTargetPlayerId =
    singleton(dedupedAffectedPlayers) ??
    inferredTargetOpponentId;
  const baseTargetFromOpponent = baseTargetOpponentId;
  const baseTargetFromPlayer =
    baseTargetPlayerId && baseTargetPlayerId !== normalizedControllerId
      ? baseTargetPlayerId
      : undefined;

  const selectorContext: OracleIRSelectorContext = {
    targetPlayerId:
      hintTargetPlayerId ??
      explicitTargetOpponentId ??
      inferredTargetPlayerId ??
      baseTargetPlayerId ??
      baseTargetFromOpponent,
    targetOpponentId:
      explicitTargetOpponentId ??
      inferredTargetOpponentId ??
      baseTargetOpponentId ??
      baseTargetFromPlayer,
    ...(sanitizedEachOfThoseOpponents ? { eachOfThoseOpponents: sanitizedEachOfThoseOpponents } : {}),
    ...(Array.isArray(baseSel?.chosenObjectIds) && baseSel.chosenObjectIds.length > 0
      ? {
          chosenObjectIds: baseSel.chosenObjectIds
            .map(id => String(id || '').trim())
            .filter(Boolean),
        }
      : {}),
  };

  const referenceSpellTypes =
    normalizeSpellTypes(hint?.spellType) ??
    (Array.isArray(base.referenceSpellTypes) && base.referenceSpellTypes.length > 0
      ? base.referenceSpellTypes
      : undefined);

  if (!selectorContext.targetPlayerId && !selectorContext.targetOpponentId && !selectorContext.eachOfThoseOpponents) {
    if (
      normalizedControllerId === base.controllerId &&
      !referenceSpellTypes &&
      !hintTargetPermanentId &&
      !hint?.tapOrUntapChoice
    ) {
      return base;
    }
    return {
      ...base,
      controllerId: normalizedControllerId,
      ...(hintTargetPermanentId ? { targetPermanentId: hintTargetPermanentId } : {}),
      ...(hint?.tapOrUntapChoice ? { tapOrUntapChoice: hint.tapOrUntapChoice } : {}),
      ...(referenceSpellTypes ? { referenceSpellTypes } : {}),
    };
  }

  return {
    ...base,
    controllerId: normalizedControllerId,
    selectorContext,
    ...(hintTargetPermanentId ? { targetPermanentId: hintTargetPermanentId } : {}),
    ...(hint?.tapOrUntapChoice ? { tapOrUntapChoice: hint.tapOrUntapChoice } : {}),
    ...(referenceSpellTypes ? { referenceSpellTypes } : {}),
  };
}

export interface OracleIRExecutionResult {
  readonly state: GameState;
  readonly log: readonly string[];
  readonly appliedSteps: readonly OracleEffectStep[];
  readonly skippedSteps: readonly OracleEffectStep[];
  /**
   * Steps that have `optional: true` ("you may") OR are `choose_mode` steps
   * that were NOT auto-applied because they require player interaction.
   * When `allowOptional` is false (the default), every such step is placed
   * here so callers can queue the appropriate player prompts.
   */
  readonly pendingOptionalSteps: readonly OracleEffectStep[];
}

function getPlayableUntilTurnForImpulseDuration(state: GameState, duration: any): number | null {
  const turnNumber = Number((state as any).turnNumber ?? 0) || 0;
  const d = String(duration || '').trim();
  if (!d) return null;

  if (d === 'this_turn' || d === 'during_resolution') return turnNumber;

  // Best-effort: treat all "next turn" / "until next <step>" windows as lasting through the next turn.
  if (
    d === 'during_next_turn' ||
    d === 'until_end_of_next_turn' ||
    d === 'until_end_of_combat_on_next_turn' ||
    d === 'until_next_turn' ||
    d === 'until_next_upkeep' ||
    d === 'until_next_end_step'
  ) {
    return turnNumber + 1;
  }

  // Longer / open-ended windows: keep the permission present without an expiry.
  if (d === 'as_long_as_remains_exiled' || d === 'as_long_as_control_source' || d === 'until_exile_another') {
    return Number.MAX_SAFE_INTEGER;
  }

  return null;
}

function applyImpulsePermissionMarkers(
  state: GameState,
  playerId: PlayerID,
  exiledCards: readonly any[],
  meta: {
    readonly permission: 'play' | 'cast';
    readonly playableUntilTurn: number | null;
    readonly condition?: any;
    readonly exiledBy?: string;
  }
): { state: GameState; granted: number } {
  const player = state.players.find(p => p.id === playerId) as any;
  if (!player) return { state, granted: 0 };

  const exileArr: any[] = Array.isArray(player.exile) ? [...player.exile] : [];
  if (exileArr.length === 0 || exiledCards.length === 0) return { state, granted: 0 };

  const stateAny: any = state as any;
  stateAny.playableFromExile = stateAny.playableFromExile || {};
  stateAny.playableFromExile[playerId] = stateAny.playableFromExile[playerId] || {};

  const playableUntilTurn = meta.playableUntilTurn;
  const condition = meta.condition as any;

  let granted = 0;

  const exiledIds = new Set(exiledCards.map(c => String((c as any)?.id ?? (c as any)?.cardId ?? '')));

  const shouldGrant = (card: any): boolean => {
    const typeLineLower = String(card?.type_line || '').toLowerCase();
    const isLand = typeLineLower.includes('land');
    const colors = Array.isArray(card?.colors) ? card.colors.map((x: any) => String(x || '').toUpperCase()) : [];

    const passesPermissionGate = meta.permission === 'play' ? true : !isLand;
    let passesConditionGate = true;
    if (condition) {
      if (condition.kind === 'type') {
        passesConditionGate = condition.type === 'land' ? isLand : !isLand;
      } else if (condition.kind === 'color') {
        passesConditionGate = colors.includes(condition.color);
      }
    }
    return passesPermissionGate && passesConditionGate;
  };

  for (let i = 0; i < exileArr.length; i++) {
    const card = exileArr[i];
    const id = String(card?.id ?? card?.cardId ?? '');
    if (!id || !exiledIds.has(id)) continue;

    const grant = shouldGrant(card);
    const next = {
      ...card,
      zone: 'exile',
      ...(meta.exiledBy ? { exiledBy: meta.exiledBy } : {}),
      ...(grant ? { canBePlayedBy: playerId, playableUntilTurn } : {}),
    };
    exileArr[i] = next;

    if (grant) {
      // Gate play/cast permissions (impulse draw) by turn number.
      stateAny.playableFromExile[playerId][id] = playableUntilTurn ?? Number.MAX_SAFE_INTEGER;
      granted++;
    }
  }

  const updatedPlayers = state.players.map(p => (p.id === playerId ? ({ ...(p as any), exile: exileArr } as any) : p));
  return { state: { ...(stateAny as any), players: updatedPlayers as any }, granted };
}

const stripImpulsePermissionMarkers = stripPlayableFromExileTags;

type SimpleBattlefieldSelector = {
  readonly kind: 'battlefield_selector';
  readonly types: readonly SimplePermanentType[];
  readonly controllerFilter: 'any' | 'you' | 'opponents';
};

type SimplePermanentType =
  | 'permanent'
  | 'nonland_permanent'
  | 'creature'
  | 'artifact'
  | 'enchantment'
  | 'land'
  | 'planeswalker'
  | 'battle';

function quantityToNumber(qty: OracleQuantity): number | null {
  if (qty.kind === 'number') return qty.value;
  return null;
}

function normalizeOracleText(value: string): string {
  return String(value || '')
    .replace(/\u2019/g, "'")
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[.;:,]+$/g, '')
    .trim();
}

function getCardTypeLineLower(card: any): string {
  return String(card?.cardType || card?.type_line || card?.card?.type_line || '')
    .toLowerCase()
    .trim();
}

function isPermanentTypeQualifier(typeQualifier: string): boolean {
  return typeQualifier === 'permanent' || typeQualifier === 'nonland permanent';
}

function matchesCardTypeQualifier(card: any, rawTypeQualifier?: string): boolean {
  const typeQualifier = normalizeOracleText(String(rawTypeQualifier || ''));
  if (!typeQualifier) return true;

  const typeLine = getCardTypeLineLower(card);
  if (!typeLine) return false;

  if (typeQualifier === 'permanent') {
    return !typeLine.includes('instant') && !typeLine.includes('sorcery');
  }

  if (typeQualifier === 'nonland permanent') {
    return !typeLine.includes('land') && !typeLine.includes('instant') && !typeLine.includes('sorcery');
  }

  return typeLine.includes(typeQualifier);
}

function isCardExiledWithSource(card: any, sourceId: string): boolean {
  if (!sourceId) return false;

  const linkedIds = [
    card?.exiledBy,
    card?.exiledWith,
    card?.exiledWithSourceId,
    card?.card?.exiledBy,
    card?.card?.exiledWith,
    card?.card?.exiledWithSourceId,
  ]
    .map(value => String(value || '').trim())
    .filter(Boolean);

  return linkedIds.includes(sourceId);
}

function countCardsExiledWithSource(
  state: GameState,
  sourceId: string,
  rawTypeQualifier?: string
): number {
  if (!sourceId) return 0;

  let count = 0;
  for (const player of state.players as any[]) {
    const exile = Array.isArray(player?.exile) ? player.exile : [];
    for (const card of exile) {
      if (!isCardExiledWithSource(card, sourceId)) continue;
      if (!matchesCardTypeQualifier(card, rawTypeQualifier)) continue;
      count++;
    }
  }

  return count;
}

function getCardTypesFromTypeLine(card: any): readonly string[] | null {
  const tl = getCardTypeLineLower(card);
  if (!tl) return null;
  const known = ['artifact', 'battle', 'creature', 'enchantment', 'instant', 'kindred', 'land', 'planeswalker', 'sorcery'];
  const out = known.filter(type => tl.includes(type));
  if (tl.includes('tribal') && !out.includes('kindred')) out.push('kindred');
  return out.length > 0 ? out : null;
}

function getCardManaValue(card: any): number | null {
  const raw =
    card?.manaValue ??
    card?.mana_value ??
    card?.cmc ??
    card?.card?.manaValue ??
    card?.card?.mana_value ??
    card?.card?.cmc;

  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

function resolveUnknownExileUntilAmountForPlayer(
  state: GameState,
  playerId: PlayerID,
  qty: OracleQuantity,
  ctx?: OracleIRExecutionContext
): number | null {
  if (qty.kind !== 'unknown') return null;

  const raw = normalizeOracleText(String((qty as any).raw || ''));
  if (!raw.startsWith('until ')) return null;

  const player = state.players.find(p => p.id === playerId) as any;
  if (!player) return null;
  const library: any[] = Array.isArray(player.library) ? player.library : [];

  if (raw === 'until they exile a nonland card' || raw === 'until you exile a nonland card') {
    for (let i = 0; i < library.length; i++) {
      const typeLine = getCardTypeLineLower(library[i]);
      if (!typeLine) return null;
      const isLand = typeLine.includes('land');
      if (!isLand) return i + 1;
    }
    return library.length;
  }

  if (
    raw === 'until they exile an instant or sorcery card' ||
    raw === 'until you exile an instant or sorcery card'
  ) {
    for (let i = 0; i < library.length; i++) {
      const typeLine = getCardTypeLineLower(library[i]);
      if (!typeLine) return null;
      const isInstantOrSorcery = typeLine.includes('instant') || typeLine.includes('sorcery');
      if (isInstantOrSorcery) return i + 1;
    }
    return library.length;
  }

  if (raw === 'until you exile a legendary card' || raw === 'until they exile a legendary card') {
    for (let i = 0; i < library.length; i++) {
      const typeLine = getCardTypeLineLower(library[i]);
      if (!typeLine) return null;
      if (typeLine.includes('legendary')) return i + 1;
    }
    return library.length;
  }

  const totalMvMatch = raw.match(
    /^until (?:they|you) have exiled cards with total mana value (\d+) or greater(?: this way)?$/
  );
  if (totalMvMatch) {
    const threshold = Number(totalMvMatch[1]);
    if (!Number.isFinite(threshold) || threshold <= 0) return null;

    let total = 0;
    for (let i = 0; i < library.length; i++) {
      const manaValue = getCardManaValue(library[i]);
      if (manaValue === null) return null;
      total += manaValue;
      if (total >= threshold) return i + 1;
    }
    return library.length;
  }

  if (
    raw === 'until they exile a card that shares a card type with it' ||
    raw === 'until you exile a card that shares a card type with it'
  ) {
    const refTypes = Array.isArray(ctx?.referenceSpellTypes)
      ? new Set(ctx!.referenceSpellTypes.map(t => String(t || '').toLowerCase()).filter(Boolean))
      : null;
    if (!refTypes || refTypes.size === 0) return null;

    for (let i = 0; i < library.length; i++) {
      const cardTypes = getCardTypesFromTypeLine(library[i]);
      if (!cardTypes) return null;
      const sharesType = cardTypes.some(type => refTypes.has(type));
      if (sharesType) return i + 1;
    }
    return library.length;
  }

  return null;
}

function resolveUnknownMillUntilAmountForPlayer(
  state: GameState,
  playerId: PlayerID,
  qty: OracleQuantity
): number | null {
  if (qty.kind !== 'unknown') return null;

  const raw = normalizeOracleText(String((qty as any).raw || ''));
  if (raw !== 'until they reveal a land card' && raw !== 'until you reveal a land card') {
    return null;
  }

  const player = state.players.find(p => p.id === playerId) as any;
  if (!player) return null;
  const library: any[] = Array.isArray(player.library) ? player.library : [];

  for (let i = 0; i < library.length; i++) {
    const typeLine = getCardTypeLineLower(library[i]);
    if (!typeLine) return null;
    if (typeLine.includes('land')) return i + 1;
  }

  return library.length;
}

function resolveTrepanationBoostTargetCreatureId(
  state: GameState,
  ctx: OracleIRExecutionContext
): string | undefined {
  const battlefield = getProcessedBattlefield(state);
  const sourceId = String(ctx.sourceId || '').trim();

  if (sourceId) {
    const sourcePerm = battlefield.find(p => p.id === sourceId) as any;
    const attachedTo = String(sourcePerm?.attachedTo || '').trim();
    if (attachedTo && battlefield.some(p => p.id === attachedTo)) return attachedTo;
  }

  const attackers = battlefield.filter(p => String((p as any)?.attacking || '').trim().length > 0);
  if (attackers.length === 1) return attackers[0].id;
  return undefined;
}

function resolveSingleCreatureTargetId(
  state: GameState,
  target: OracleObjectSelector,
  ctx: OracleIRExecutionContext
): string | undefined {
  const directTargetCreatureId = String(ctx.targetCreatureId || '').trim();
  if (directTargetCreatureId) {
    const battlefield = (state.battlefield || []) as BattlefieldPermanent[];
    const matched = battlefield.find((p: any) => String((p as any)?.id || '').trim() === directTargetCreatureId);
    if (matched) return directTargetCreatureId;
  }

  if (target.kind === 'equipped_creature') {
    return resolveTrepanationBoostTargetCreatureId(state, ctx);
  }

  if (target.kind !== 'raw') return undefined;
  const t = String(target.text || '').trim().toLowerCase();
  const battlefield = getProcessedBattlefield(state);
  const creatures = battlefield.filter((p: any) => isExecutorCreature(p));

  const controllerId = String(ctx.controllerId || '').trim();
  const controlledCreatures = creatures.filter(
    (p: any) => String((p as any)?.controller || '').trim() === controllerId
  );
  const opponentsControlledCreatures = creatures.filter(
    (p: any) => String((p as any)?.controller || '').trim() !== controllerId
  );

  if (t.includes('target creature you control')) {
    if (controlledCreatures.length === 1) return controlledCreatures[0].id;
    return undefined;
  }

  if (t.includes('target creature your opponents control') || t.includes('target creature an opponent controls')) {
    if (opponentsControlledCreatures.length === 1) return opponentsControlledCreatures[0].id;
    return undefined;
  }

  if (t === 'target creature' || t === 'creature' || t.includes('target creature')) {
    if (creatures.length === 1) return creatures[0].id;
    return undefined;
  }

  return undefined;
}

function applyTemporaryPowerToughnessModifier(
  state: GameState,
  creatureId: string,
  ctx: OracleIRExecutionContext,
  powerBonus: number,
  toughnessBonus: number,
  markTrepanation: boolean
): GameState | null {
  const battlefield = [...((state.battlefield || []) as BattlefieldPermanent[])];
  const idx = battlefield.findIndex(p => p.id === creatureId);
  if (idx < 0) return null;

  const perm: any = battlefield[idx] as any;
  const modifiers = Array.isArray(perm.modifiers) ? [...perm.modifiers] : [];
  modifiers.push({
    type: 'powerToughness',
    power: powerBonus,
    toughness: toughnessBonus,
    sourceId: ctx.sourceId,
    duration: 'end_of_turn',
  } as any);

  const nextPerm: any = {
    ...perm,
    modifiers,
  };

  if (markTrepanation) {
    nextPerm.trepanationBonus = powerBonus;
    nextPerm.lastTrepanationBonus = powerBonus;
  }

  battlefield[idx] = nextPerm as any;
  return { ...(state as any), battlefield } as any;
}

function resolveGoadTargetCreatureIds(
  state: GameState,
  target: OracleObjectSelector,
  ctx: OracleIRExecutionContext
): string[] {
  const battlefield = getProcessedBattlefield(state).filter((p: any) => isExecutorCreature(p));

  const chosenIds = Array.isArray(ctx.selectorContext?.chosenObjectIds)
    ? ctx.selectorContext.chosenObjectIds
        .map(id => String(id || '').trim())
        .filter(Boolean)
    : [];
  if (chosenIds.length > 0) {
    const chosenSet = new Set(chosenIds);
    return battlefield
      .filter((p: any) => chosenSet.has(String((p as any)?.id || '').trim()))
      .map((p: any) => String((p as any)?.id || '').trim())
      .filter(Boolean);
  }

  const targetCreatureId = String(ctx.targetCreatureId || '').trim();
  if (targetCreatureId) {
    const matched = battlefield.find((p: any) => String((p as any)?.id || '').trim() === targetCreatureId);
    if (matched) return [targetCreatureId];
  }

  if (target.kind !== 'raw') return [];

  const raw = normalizeOracleText(target.text);
  if (!raw) return [];

  const controllerId = String(ctx.controllerId || '').trim();
  const targetPlayerId = String(ctx.selectorContext?.targetPlayerId || '').trim();
  const targetOpponentId = String(ctx.selectorContext?.targetOpponentId || '').trim();

  const controlledBy = (playerId: string): string[] => battlefield
    .filter((p: any) => String((p as any)?.controller || '').trim() === playerId)
    .map((p: any) => String((p as any)?.id || '').trim())
    .filter(Boolean);

  const opponentsControlled = battlefield.filter(
    (p: any) => String((p as any)?.controller || '').trim() !== controllerId
  );

  if (raw === 'all creatures your opponents control' || raw === "all creatures you don't control") {
    return opponentsControlled.map((p: any) => String((p as any)?.id || '').trim()).filter(Boolean);
  }

  if (raw === 'target creature' || raw === 'creature' || raw === 'target creature you don\'t control' || raw === 'target creature an opponent controls' || raw === 'target creature your opponents control') {
    const pool = raw === 'target creature'
      || raw === 'creature'
      ? battlefield
      : opponentsControlled;
    return pool.length === 1 ? [String((pool[0] as any)?.id || '').trim()] : [];
  }

  if ((raw === 'target creature that player controls' || raw === 'each creature that player controls' || raw === 'each creature target player controls') && targetPlayerId) {
    const pool = controlledBy(targetPlayerId);
    if (raw.startsWith('each ')) return pool;
    return pool.length === 1 ? pool : [];
  }

  if ((raw === 'target creature that opponent controls' || raw === 'each creature that opponent controls' || raw === 'each creature target opponent controls' || raw === 'target creature defending player controls') && (targetOpponentId || targetPlayerId)) {
    const pool = controlledBy(targetOpponentId || targetPlayerId);
    if (raw.startsWith('each ')) return pool;
    return pool.length === 1 ? pool : [];
  }

  return [];
}

function applyGoadToCreatures(
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

  for (let idx = 0; idx < battlefield.length; idx++) {
    const perm: any = battlefield[idx] as any;
    const permanentId = String((perm as any)?.id || '').trim();
    if (!idSet.has(permanentId)) continue;

    if (!isExecutorCreature(perm)) continue;

    const goadedBy = Array.isArray(perm.goadedBy)
      ? perm.goadedBy.map((value: unknown) => String(value || '').trim()).filter(Boolean)
      : [];
    const nextGoadedBy = goadedBy.includes(goaderId) ? goadedBy : [...goadedBy, goaderId];
    const nextGoadedUntil = {
      ...((perm as any)?.goadedUntil && typeof (perm as any).goadedUntil === 'object' ? (perm as any).goadedUntil : {}),
      [goaderId]: expiryTurn,
    };

    battlefield[idx] = {
      ...perm,
      goadedBy: nextGoadedBy,
      goadedUntil: nextGoadedUntil,
    } as any;
    changed = true;
  }

  return changed ? ({ ...(state as any), battlefield } as any) : null;
}

function getProcessedBattlefield(state: GameState): BattlefieldPermanent[] {
  return applyStaticAbilitiesToBattlefield(
    (state.battlefield || []) as BattlefieldPermanent[]
  ) as BattlefieldPermanent[];
}

function isExecutorCreature(permanent: BattlefieldPermanent | any): boolean {
  if (isCurrentlyCreature(permanent)) {
    return true;
  }

  return getExecutorTypeLineLower(permanent).includes('creature');
}

function getExecutorTypeLineLower(permanent: BattlefieldPermanent | any): string {
  const rawParts = [
    (permanent as any)?.cardType,
    (permanent as any)?.type_line,
    (permanent as any)?.card?.type_line,
  ]
    .map(value => String(value || '').toLowerCase().trim())
    .filter(Boolean);

  for (const list of [(permanent as any)?.types, (permanent as any)?.effectiveTypes, (permanent as any)?.grantedTypes]) {
    if (!Array.isArray(list)) continue;
    for (const value of list) {
      const normalized = String(value || '').toLowerCase().trim();
      if (normalized) rawParts.push(normalized);
    }
  }

  if (rawParts.length === 0) return '';

  const uniqueParts: string[] = [];
  for (const part of rawParts) {
    if (!uniqueParts.includes(part)) uniqueParts.push(part);
  }
  return uniqueParts.join(' ').trim();
}

function hasExecutorClass(permanent: BattlefieldPermanent | any, klass: string): boolean {
  const tl = getExecutorTypeLineLower(permanent);
  if (!tl) return false;
  if (klass === 'creature') return isExecutorCreature(permanent);
  if (klass === 'permanent') {
    return (
      tl.includes('artifact') ||
      tl.includes('battle') ||
      tl.includes('creature') ||
      tl.includes('enchantment') ||
      tl.includes('land') ||
      tl.includes('planeswalker')
    );
  }
  if (klass === 'nonland permanent') return hasExecutorClass(permanent, 'permanent') && !tl.includes('land');
  return tl.includes(klass);
}

function evaluateModifyPtCondition(
  state: GameState,
  controllerId: PlayerID,
  conditionRaw: string
): boolean | null {
  const raw = normalizeOracleText(conditionRaw);
  if (!raw) return null;

  const battlefield = getProcessedBattlefield(state);
  const controlled = battlefield.filter((p: any) => String((p as any)?.controller || '').trim() === controllerId);

  const typeLineLower = (p: any): string => getExecutorTypeLineLower(p);

  const normalizeClass = (s: string): string | null => normalizeControlledClassKey(s);
  const countByClass = (klass: string): number => countControlledByClass(controlled, klass, typeLineLower);

  const mCount = raw.match(/^you control (\d+) or more (.+)$/i);
  if (mCount) {
    const threshold = parseInt(String(mCount[1] || '0'), 10) || 0;
    const klass = normalizeClass(String(mCount[2] || ''));
    if (!klass) return null;
    return countByClass(klass) >= threshold;
  }

  const mAny = raw.match(/^you control (?:(?:a|an)\s+)?(.+)$/i);
  if (mAny) {
    const klass = normalizeClass(String(mAny[1] || ''));
    if (!klass) return null;
    return countByClass(klass) > 0;
  }

  return null;
}

function normalizeControlledClassKey(s: string): string | null {
  const x = String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
  if (/^creatures?$/.test(x)) return 'creature';
  if (/^artifacts?$/.test(x)) return 'artifact';
  if (/^enchantments?$/.test(x)) return 'enchantment';
  if (/^lands?$/.test(x)) return 'land';
  if (/^planeswalkers?$/.test(x)) return 'planeswalker';
  if (/^snow permanents?$/.test(x)) return 'snow';
  if (/^nonland permanents?$/.test(x)) return 'nonland permanent';
  if (/^permanents?$/.test(x)) return 'permanent';

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

  if (/^[a-z][a-z-]*$/.test(x)) {
    const stopwords = new Set(['card', 'cards', 'spell', 'spells']);
    if (!stopwords.has(x)) {
      return singularize(x);
    }
  }

  return null;
}

function countControlledByClass(
  controlled: readonly BattlefieldPermanent[],
  klass: string,
  typeLineLower: (p: any) => string
): number {
  if (klass === 'permanent') return controlled.length;
  if (klass === 'nonland permanent') {
    return controlled.filter(p => !typeLineLower(p).includes('land')).length;
  }
  return controlled.filter(p => typeLineLower(p).includes(klass)).length;
}

function evaluateModifyPtWhereX(
  state: GameState,
  controllerId: PlayerID,
  whereRaw: string,
  targetCreatureId?: string,
  ctx?: OracleIRExecutionContext,
  runtime?: {
    readonly lastRevealedCardCount?: number;
    readonly lastDiscardedCardCount?: number;
    readonly lastExiledCardCount?: number;
    readonly lastExiledCards?: readonly any[];
    readonly lastGoadedCreatures?: readonly BattlefieldPermanent[];
    readonly lastSacrificedCreaturesPowerTotal?: number;
    readonly lastExcessDamageDealtThisWay?: number;
    readonly lastScryLookedAtCount?: number;
  },
  depth = 0
): number | null {
  if (depth > 3) return null;

  const whereAliases: Record<string, string> = {
    "x is the mana value of that spell": "x is that spell's mana value",
    "x is the spell's mana value": "x is that spell's mana value",
    "x is the mana value of this spell": "x is that spell's mana value",
    "x is this spell's mana value": "x is that spell's mana value",
    "x is the mana value of this card": "x is that card's mana value",
    "x is this card's mana value": "x is that card's mana value",
    "x is the mana value of that card": "x is that card's mana value",
    "x is the card's mana value": "x is that card's mana value",
    "x is the amount of excess damage": "x is the amount of excess damage dealt this way",
    "x is the excess damage": "x is the excess damage dealt this way",
    "x is that excess damage": "x is the excess damage dealt this way",
    "x is the amount of excess damage dealt": "x is the amount of excess damage dealt this way",
    "x is the excess damage dealt": "x is the excess damage dealt this way",
    "x is excess damage dealt": "x is the excess damage dealt this way",
    "x is the power of the exiled card": "x is that card's power",
    "x is the toughness of the exiled card": "x is that card's toughness",
    "x is the exiled card's power": "x is that card's power",
    "x is the exiled card's toughness": "x is that card's toughness",
    "x is the exiled card's mana value": "x is that card's mana value",
    "x is the power of the revealed card": "x is that card's power",
    "x is the toughness of the revealed card": "x is that card's toughness",
    "x is the revealed card's power": "x is that card's power",
    "x is the revealed card's toughness": "x is that card's toughness",
    "x is the revealed card's mana value": "x is that card's mana value",
    "x is the power of the discarded card": "x is that card's power",
    "x is the toughness of the discarded card": "x is that card's toughness",
    "x is the discarded card's mana value": "x is that card's mana value",
    "x is the tapped creature's power": "x is that creature's power",
    "x is the tapped creature’s power": "x is that creature's power",
    "x is the amount of life you have gained this turn": "x is the amount of life you gained this turn",
    "x is the amount of life you've gained this turn": "x is the amount of life you gained this turn",
    "x is the amount of life you have gained": "x is the amount of life you gained",
    "x is the amount of life you've gained": "x is the amount of life you gained",
    "x is the amount of life opponents have gained this turn": "x is the amount of life your opponents have gained this turn",
    "x is the amount of life opponents gained this turn": "x is the amount of life your opponents gained this turn",
    "x is the amount of life opponents have gained": "x is the amount of life your opponents have gained",
    "x is the amount of life opponents gained": "x is the amount of life your opponents gained",
    "x is the amount of life you have lost this turn": "x is the amount of life you lost this turn",
    "x is the amount of life you've lost this turn": "x is the amount of life you lost this turn",
    "x is the amount of life you have lost": "x is the amount of life you lost",
    "x is the amount of life you've lost": "x is the amount of life you lost",
    "x is the amount of life opponents have lost this turn": "x is the amount of life your opponents have lost this turn",
    "x is the amount of life opponents lost this turn": "x is the amount of life your opponents lost this turn",
    "x is the amount of life opponents have lost": "x is the amount of life your opponents have lost",
    "x is the amount of life opponents lost": "x is the amount of life your opponents lost",
    "x is the total amount of life your opponents have lost this turn": "x is the amount of life your opponents have lost this turn",
    "x is the total amount of life your opponents lost this turn": "x is the amount of life your opponents lost this turn",
    "x is the total amount of life your opponents have lost": "x is the amount of life your opponents have lost",
    "x is the total amount of life your opponents lost": "x is the amount of life your opponents lost",
    "x is the number of spells opponents have cast this turn": "x is the number of spells your opponents have cast this turn",
    "x is the number of spells opponents cast this turn": "x is the number of spells your opponents cast this turn",
    "x is the number of lands opponents have played this turn": "x is the number of lands your opponents have played this turn",
    "x is the number of lands opponents played this turn": "x is the number of lands your opponents played this turn",
    "x is the number of cards opponents have drawn this turn": "x is the number of cards your opponents have drawn this turn",
    "x is the number of cards opponents drew this turn": "x is the number of cards your opponents drew this turn",
    "x is the number of cards opponents have discarded this turn": "x is the number of cards your opponents have discarded this turn",
    "x is the number of cards opponents discarded this turn": "x is the number of cards your opponents discarded this turn",
    "x is the number of permanents opponents have sacrificed this turn": "x is the number of permanents your opponents have sacrificed this turn",
    "x is the number of permanents opponents sacrificed this turn": "x is the number of permanents your opponents sacrificed this turn",
    "x is the amount of mana spent to cast this creature": "x is the amount of mana spent to cast this spell",
    "x is the amount of mana spent to cast that creature": "x is the amount of mana spent to cast that spell",
    "x is the number of bobbleheads you control as you activate this ability": "x is the number of bobbleheads you control",
    "x is the number of cards in target opponent's hand": "x is the number of cards in their hand",
    "x is the number of cards in target opponent’s hand": "x is the number of cards in their hand",
    "x is the number of cards in target opponent's graveyard": "x is the number of cards in their graveyard",
    "x is the number of cards in target opponent’s graveyard": "x is the number of cards in their graveyard",
    "x is the number of cards in target opponent's library": "x is the number of cards in their library",
    "x is the number of cards in target opponent’s library": "x is the number of cards in their library",
    "x is the number of cards in target opponent's exile": "x is the number of cards in their exile",
    "x is the number of cards in target opponent’s exile": "x is the number of cards in their exile",
    "x is the number of cards in all graveyards with the same name as the spell": "x is the number of cards in all graveyards with the same name as that spell",
    "x is the number of cards in all graveyards with the same name as this spell": "x is the number of cards in all graveyards with the same name as that spell",
    "x is the mana value of the sacrificed artifact": "x is the sacrificed artifact's mana value",
    "x is the exiled creature's mana value": "x is that card's mana value",
    "x is the mana value of the exiled creature": "x is that card's mana value",
    "x is half the creature's power": "x is half that creature's power",
    // card-type mana value aliases
    "x is that artifact's mana value": "x is that card's mana value",
    "x is that enchantment's mana value": "x is that card's mana value",
    "x is that saga's mana value": "x is that card's mana value",
    "x is the mana value of that artifact": "x is that card's mana value",
    "x is the mana value of that enchantment": "x is that card's mana value",
    "x is the mana value of that creature": "x is that card's mana value",
    // context card mana value
    "x is the milled card's mana value": "x is that card's mana value",
    "x is the mana value of the milled card": "x is that card's mana value",
    "x is the mana value of the returned creature": "x is that card's mana value",
    "x is the returned creature's mana value": "x is that card's mana value",
    "x is the mana value of the permanent exiled this way": "x is that card's mana value",
    "x is the permanent exiled this way's mana value": "x is that card's mana value",
    "x is the mana value of your precious": "x is that card's mana value",
    // cast pronoun aliases
    "x is the amount of mana spent to cast her": "x is the amount of mana spent to cast this spell",
    "x is the amount of mana spent to cast it": "x is the amount of mana spent to cast this spell",
    "x is the amount of mana spent to cast jeleva": "x is the amount of mana spent to cast this spell",
    // pronoun normalizations
    "x is his power": "x is its power",
    // context-creature aliases
    "x is the devoured creature's power": "x is that creature's power",
    "x is the amassed army's power": "x is that creature's power",
    // generic noun aliases for inner evaluation (used by half-wrapper)
    "x is creature's power": "x is that creature's power",
    "x is creature's toughness": "x is that creature's toughness",
    "x is artifact's intensity": "x is this artifact's intensity",
    // that creature's toughness (explicit alias for coverage)
    "x is that creature's toughness": "x is that creature's toughness",
    // half-creature rounded forms
    "x is half the creature's power, rounded down": "x is half that creature's power",
    "x is half the creature's power, rounded up": "x is half that creature's power, rounded up",
    // greatest power among creatures you control — alias timing-qualified forms handled by strip below
    // greatest mana value trailing clause — strip handled by post-alias processing
  };

  let raw = normalizeOracleText(whereRaw);
  raw = whereAliases[raw] || raw;

  // Strip timing qualifiers: "as X resolves", "when X resolves", "as X begins to apply"
  raw = raw.replace(/[,\s]+(?:as|when)\s+.{3,80}?\b(?:resolves?|begins?\s+to\s+apply)\s*$/i, '');
  // Strip trailing "as you cast/activate this ..." qualifiers
  raw = raw.replace(/\s+as\s+you\s+(?:cast|activate)\s+(?:this\b.*|that\b.*)$/i, '');
  // Strip trailing "; and y is ..." or ", and y is ..." clauses (e.g. "x is P and y is T when ...")
  raw = raw.replace(/\s+and\s+y\s+is\b.*$/i, '');
  // Strip trailing ", then ..." clauses
  raw = raw.replace(/,\s+(?:then|and)\s+.+$/i, '');
  // Re-apply alias lookup after stripping (may have stripped to a known alias target)
  raw = whereAliases[raw] || raw;
  // Normalize word numbers for arithmetic matchers
  raw = raw.replace(/\bfive\b/g, '5');
  raw = raw.replace(/\bsix\b/g, '6');
  raw = raw.replace(/\bseven\b/g, '7');
  raw = raw.replace(/\beight\b/g, '8');
  raw = raw.replace(/\bnine\b/g, '9');
  raw = raw.replace(/\bten\b/g, '10');

  const battlefield = getProcessedBattlefield(state);
  const controlled = battlefield.filter((p: any) => String((p as any)?.controller || '').trim() === controllerId);
  const opponentsControlled = battlefield.filter((p: any) => String((p as any)?.controller || '').trim() !== controllerId);
  const typeLineLower = (p: any): string => getExecutorTypeLineLower(p);
  const isAttackingObject = (obj: any): boolean => {
    const attackingValue = String((obj as any)?.attacking || (obj as any)?.attackingPlayerId || (obj as any)?.defendingPlayerId || '').trim();
    if (attackingValue.length > 0) return true;
    if ((obj as any)?.isAttacking === true) return true;
    return false;
  };
  const hasFlyingKeyword = (obj: any): boolean => {
    const keywordValues: unknown[] = [
      ...(Array.isArray((obj as any)?.keywords) ? (obj as any).keywords : []),
      ...(Array.isArray((obj as any)?.card?.keywords) ? (obj as any).card.keywords : []),
    ];
    for (const value of keywordValues) {
      if (String(value || '').trim().toLowerCase() === 'flying') return true;
    }
    const textValues: unknown[] = [
      (obj as any)?.text,
      (obj as any)?.oracleText,
      (obj as any)?.card?.text,
      (obj as any)?.card?.oracleText,
      (obj as any)?.abilities,
      (obj as any)?.card?.abilities,
    ];
    for (const value of textValues) {
      if (typeof value === 'string' && /\bflying\b/i.test(value)) return true;
    }
    return false;
  };
  const getCreatureSubtypeKeys = (obj: any): readonly string[] => {
    const subtypeValues = (obj as any)?.subtypes || (obj as any)?.card?.subtypes;
    if (Array.isArray(subtypeValues) && subtypeValues.length > 0) {
      const normalized = subtypeValues
        .map(v => String(v || '').trim().toLowerCase())
        .filter(Boolean);
      if (normalized.length > 0) return normalized;
    }

    const tl = typeLineLower(obj);
    if (!tl.includes('creature')) return [];
    const emDashIdx = tl.search(/[—\ufffd]/); // U+2014 em-dash or U+FFFD from corrupt encodings
    const hyphenDashIdx = tl.indexOf(' - ');
    const splitIdx = emDashIdx >= 0 ? emDashIdx : hyphenDashIdx;
    if (splitIdx < 0) return [];
    const suffix = tl.slice(splitIdx + (emDashIdx >= 0 ? 1 : 3)).trim();
    if (!suffix) return [];
    return suffix
      .split(/\s+/)
      .map(part => part.replace(/^[^a-z0-9-]+|[^a-z0-9-]+$/g, '').trim())
      .filter(Boolean);
  };

  const resolveContextPlayer = (): any | null => {
    const id = String(ctx?.selectorContext?.targetPlayerId || ctx?.selectorContext?.targetOpponentId || '').trim();
    if (!id) return null;
    return (state.players || []).find((p: any) => String(p.id || '').trim() === id) || null;
  };

  const findObjectById = (idRaw: string): any | null => {
    const id = String(idRaw || '').trim();
    if (!id) return null;

    const inBattlefield = battlefield.find((p: any) => String((p as any)?.id || '').trim() === id) as any;
    if (inBattlefield) return inBattlefield;

    const stackRaw = (state as any)?.stack;
    const stackItems = Array.isArray(stackRaw)
      ? stackRaw
      : Array.isArray((stackRaw as any)?.objects)
        ? (stackRaw as any).objects
        : [];
    const inStack = stackItems.find((item: any) => String((item as any)?.id || '').trim() === id) as any;
    if (inStack) return inStack;

    const zones: readonly ('library' | 'hand' | 'graveyard' | 'exile')[] = ['library', 'hand', 'graveyard', 'exile'];
    for (const player of (state.players || []) as any[]) {
      for (const zone of zones) {
        const cards = Array.isArray((player as any)?.[zone]) ? (player as any)[zone] : [];
        const found = cards.find((card: any) => String((card as any)?.id || '').trim() === id) as any;
        if (found) return found;
      }
    }

    return null;
  };

  const findObjectByName = (nameRaw: string): any | null => {
    const wanted = normalizeOracleText(String(nameRaw || ''));
    if (!wanted) return null;

    const getName = (obj: any): string => normalizeOracleText(String((obj as any)?.name || (obj as any)?.card?.name || ''));
    const namesMatch = (nameValue: string): boolean => {
      if (!nameValue) return false;
      if (nameValue === wanted) return true;
      if (nameValue.startsWith(`${wanted},`)) return true;
      return false;
    };

    const sourceId = String(ctx?.sourceId || '').trim();
    if (sourceId) {
      const sourceObj = findObjectById(sourceId);
      if (sourceObj && namesMatch(getName(sourceObj))) return sourceObj;
    }

    for (const permanent of battlefield as any[]) {
      if (namesMatch(getName(permanent))) return permanent;
    }

    const stackRaw = (state as any)?.stack;
    const stackItems = Array.isArray(stackRaw)
      ? stackRaw
      : Array.isArray((stackRaw as any)?.objects)
        ? (stackRaw as any).objects
        : [];
    for (const stackObj of stackItems as any[]) {
      if (namesMatch(getName(stackObj))) return stackObj;
    }

    const zones: readonly ('library' | 'hand' | 'graveyard' | 'exile')[] = ['library', 'hand', 'graveyard', 'exile'];
    for (const player of (state.players || []) as any[]) {
      for (const zone of zones) {
        const cards = Array.isArray((player as any)?.[zone]) ? (player as any)[zone] : [];
        for (const card of cards as any[]) {
          if (namesMatch(getName(card))) return card;
        }
      }
    }

    return null;
  };


  {
    const m = raw.match(/^x is the damage dealt to your opponents this turn$/i);
    if (m) {
      const stateAny: any = state as any;
      const byPlayer = stateAny?.damageTakenThisTurnByPlayer;
      if (!byPlayer || typeof byPlayer !== 'object') return null;

      return (state.players || []).reduce((sum: number, p: any) => {
        const id = String((p as any)?.id || '').trim();
        if (!id || id === controllerId) return sum;
        const dealt = Number((byPlayer as Record<string, unknown>)[id]);
        if (!Number.isFinite(dealt)) return sum;
        return sum + Math.max(0, dealt);
      }, 0);
    }
  }
  const normalizeCounterName = (value: string): string => {
    return String(value || '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .replace(/\s+counters?$/, '')
      .trim();
  };

  const getCounterCountOnObject = (obj: any, counterNameRaw: string): number | null => {
    if (!obj) return null;
    const counterName = normalizeCounterName(counterNameRaw);
    if (!counterName) return null;

    const counters: unknown = (obj as any)?.counters;
    if (!counters) return 0;

    if (Array.isArray(counters)) {
      let total = 0;
      for (const entry of counters as any[]) {
        if (!entry) continue;
        if (typeof entry === 'string') {
          if (normalizeCounterName(entry) === counterName) total += 1;
          continue;
        }

        const keyCandidates = [entry.type, entry.kind, entry.name, entry.counter, entry.id];
        const key = keyCandidates
          .map(v => normalizeCounterName(String(v || '')))
          .find(Boolean);
        if (!key || key !== counterName) continue;

        const amount = Number(entry.count ?? entry.amount ?? entry.value ?? 1);
        total += Number.isFinite(amount) ? Math.max(0, amount) : 1;
      }
      return total;
    }

    if (typeof counters === 'object') {
      let total = 0;
      for (const [keyRaw, valueRaw] of Object.entries(counters as Record<string, unknown>)) {
        const key = normalizeCounterName(keyRaw);
        if (key !== counterName) continue;

        if (typeof valueRaw === 'number') {
          total += Number.isFinite(valueRaw) ? Math.max(0, valueRaw) : 0;
          continue;
        }

        if (valueRaw && typeof valueRaw === 'object') {
          const nested = valueRaw as Record<string, unknown>;
          const amount = Number(nested.count ?? nested.amount ?? nested.value ?? 0);
          if (Number.isFinite(amount)) total += Math.max(0, amount);
          continue;
        }

        const amount = Number(valueRaw);
        if (Number.isFinite(amount)) total += Math.max(0, amount);
      }
      return total;
    }

    return null;
  };

  const isCommanderObject = (obj: any): boolean => {
    return Boolean(
      (obj as any)?.isCommander === true ||
      (obj as any)?.commander === true ||
      (obj as any)?.card?.isCommander === true
    );
  };

  const collectCommandZoneObjects = (): readonly any[] => {
    const out: any[] = [];
    const pushResolved = (entry: any): void => {
      if (!entry) return;
      if (typeof entry === 'string' || typeof entry === 'number') {
        const resolved = findObjectById(String(entry));
        if (resolved) out.push(resolved);
        return;
      }
      out.push(entry);
    };

    const commandZoneAny = (state as any)?.commandZone ?? (state as any)?.commanderZone;
    if (!commandZoneAny) return out;

    if (Array.isArray(commandZoneAny)) {
      commandZoneAny.forEach(pushResolved);
      return out;
    }

    if (Array.isArray((commandZoneAny as any)?.objects)) {
      (commandZoneAny as any).objects.forEach(pushResolved);
      return out;
    }

    const byController = (commandZoneAny as any)?.[controllerId];
    if (Array.isArray(byController)) {
      byController.forEach(pushResolved);
    }

    return out;
  };

  const countCardsByClasses = (cards: readonly any[], classes: readonly string[]): number => {
    return cards.filter((card: any) => {
      const tl = typeLineLower(card);
      if (!tl) return false;
      return classes.some((klass) => {
        if (klass === 'permanent') {
          return (
            tl.includes('artifact') ||
            tl.includes('battle') ||
            tl.includes('creature') ||
            tl.includes('enchantment') ||
            tl.includes('land') ||
            tl.includes('planeswalker')
          );
        }
        if (klass === 'nonland permanent') {
          return (
            (tl.includes('artifact') ||
              tl.includes('battle') ||
              tl.includes('creature') ||
              tl.includes('enchantment') ||
              tl.includes('planeswalker')) &&
            !tl.includes('land')
          );
        }
        if (klass === 'instant' || klass === 'sorcery') return tl.includes(klass);
        return tl.includes(klass);
      });
    }).length;
  };

  const getColorsFromObject = (obj: any): readonly string[] => {
    const normalizeColor = (value: unknown): string | null => {
      const color = String(value || '').trim().toUpperCase();
      return ['W', 'U', 'B', 'R', 'G'].includes(color) ? color : null;
    };

    const fromArray = (value: unknown): readonly string[] => {
      if (!Array.isArray(value)) return [];
      const out: string[] = [];
      for (const item of value) {
        const normalized = normalizeColor(item);
        if (normalized && !out.includes(normalized)) out.push(normalized);
      }
      return out;
    };

    const direct = fromArray((obj as any)?.colors);
    if (direct.length > 0) return direct;
    const nested = fromArray((obj as any)?.card?.colors);
    if (nested.length > 0) return nested;
    const spellColors = fromArray((obj as any)?.spell?.colors);
    if (spellColors.length > 0) return spellColors;

    const colorIndicator = fromArray((obj as any)?.colorIndicator);
    if (colorIndicator.length > 0) return colorIndicator;
    const nestedColorIndicator = fromArray((obj as any)?.card?.colorIndicator);
    if (nestedColorIndicator.length > 0) return nestedColorIndicator;
    const spellColorIndicator = fromArray((obj as any)?.spell?.colorIndicator);
    if (spellColorIndicator.length > 0) return spellColorIndicator;

    const colorIdentity = fromArray((obj as any)?.colorIdentity);
    if (colorIdentity.length > 0) return colorIdentity;
    const nestedColorIdentity = fromArray((obj as any)?.card?.colorIdentity);
    if (nestedColorIdentity.length > 0) return nestedColorIdentity;
    const spellColorIdentity = fromArray((obj as any)?.spell?.colorIdentity);
    if (spellColorIdentity.length > 0) return spellColorIdentity;

    const manaCost = String(
      (obj as any)?.manaCost ||
      (obj as any)?.mana_cost ||
      (obj as any)?.card?.manaCost ||
      (obj as any)?.card?.mana_cost ||
      (obj as any)?.spell?.manaCost ||
      (obj as any)?.spell?.mana_cost ||
      ''
    ).toUpperCase();

    if (!manaCost) return [];
    const out: string[] = [];
    for (const symbol of ['W', 'U', 'B', 'R', 'G']) {
      if (manaCost.includes(symbol)) out.push(symbol);
    }
    return out;
  };

  const getColorsFromPermanent = (perm: any): readonly string[] => getColorsFromObject(perm);

  const countManaSymbolsInManaCost = (obj: any, colorSymbol: string): number => {
    const symbol = String(colorSymbol || '').trim().toUpperCase();
    if (!symbol) return 0;

    const manaCost = String(
      (obj as any)?.manaCost ||
      (obj as any)?.mana_cost ||
      (obj as any)?.card?.manaCost ||
      (obj as any)?.card?.mana_cost ||
      ''
    ).trim();
    if (!manaCost) return 0;

    let total = 0;
    const symbols = Array.from(manaCost.matchAll(/\{([^}]+)\}/g));
    for (const sym of symbols) {
      const inner = String(sym?.[1] || '').toUpperCase();
      if (inner.includes(symbol)) total += 1;
    }
    return total;
  };

  const normalizeManaColorCode = (value: unknown): string | null => {
    const rawCode = String(value || '').trim().toLowerCase();
    if (!rawCode) return null;
    if (rawCode === 'w' || rawCode === 'white') return 'W';
    if (rawCode === 'u' || rawCode === 'blue') return 'U';
    if (rawCode === 'b' || rawCode === 'black') return 'B';
    if (rawCode === 'r' || rawCode === 'red') return 'R';
    if (rawCode === 'g' || rawCode === 'green') return 'G';
    return null;
  };

  const getColorsOfManaSpent = (obj: any): number | null => {
    if (!obj) return null;

    const fromArray = (value: unknown): number | null => {
      if (!Array.isArray(value)) return null;
      const seen = new Set<string>();
      for (const item of value) {
        const normalized = normalizeManaColorCode(item);
        if (normalized) seen.add(normalized);
      }
      return seen.size;
    };

    const fromRecord = (value: unknown): number | null => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
      const rec = value as Record<string, unknown>;
      const colorKeys: readonly string[] = ['white', 'blue', 'black', 'red', 'green', 'w', 'u', 'b', 'r', 'g'];
      const seen = new Set<string>();
      for (const key of colorKeys) {
        const n = Number(rec[key]);
        if (!Number.isFinite(n) || n <= 0) continue;
        const normalized = normalizeManaColorCode(key);
        if (normalized) seen.add(normalized);
      }
      return seen.size > 0 ? seen.size : null;
    };

    const candidates: unknown[] = [
      obj?.manaColorsSpent,
      obj?.card?.manaColorsSpent,
      obj?.manaSpentColors,
      obj?.card?.manaSpentColors,
      obj?.manaPayment,
      obj?.card?.manaPayment,
      obj?.manaSpent,
      obj?.card?.manaSpent,
    ];

    for (const candidate of candidates) {
      const fromA = fromArray(candidate);
      if (fromA !== null) return fromA;
      const fromR = fromRecord(candidate);
      if (fromR !== null) return fromR;
    }

    return null;
  };

  const getAmountOfManaSpent = (obj: any): number | null => {
    if (!obj) return null;

    const directNumbers = [
      obj?.manaSpentTotal,
      obj?.card?.manaSpentTotal,
      obj?.totalManaSpent,
      obj?.card?.totalManaSpent,
    ];
    for (const value of directNumbers) {
      const n = Number(value);
      if (Number.isFinite(n)) return Math.max(0, n);
    }

    const sumFromRecord = (value: unknown): number | null => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
      const rec = value as Record<string, unknown>;
      const keys: readonly string[] = ['white', 'blue', 'black', 'red', 'green', 'colorless', 'generic', 'w', 'u', 'b', 'r', 'g', 'c'];
      let total = 0;
      let used = false;
      for (const key of keys) {
        const n = Number(rec[key]);
        if (!Number.isFinite(n) || n <= 0) continue;
        total += n;
        used = true;
      }
      return used ? total : null;
    };

    const recordCandidates: unknown[] = [
      obj?.manaPayment,
      obj?.card?.manaPayment,
      obj?.manaSpent,
      obj?.card?.manaSpent,
    ];
    for (const candidate of recordCandidates) {
      const summed = sumFromRecord(candidate);
      if (summed !== null) return summed;
    }

    const arrayCandidates: unknown[] = [
      obj?.manaColorsSpent,
      obj?.card?.manaColorsSpent,
      obj?.manaSpentColors,
      obj?.card?.manaSpentColors,
    ];
    for (const candidate of arrayCandidates) {
      if (Array.isArray(candidate)) return candidate.length;
    }

    return null;
  };

  const getAmountOfSpecificManaSymbolSpent = (obj: any, symbolRaw: string): number | null => {
    if (!obj) return null;

    const symbol = String(symbolRaw || '').trim().toUpperCase();
    if (!symbol) return null;

    const mapKey = (() => {
      if (symbol === 'W') return 'white';
      if (symbol === 'U') return 'blue';
      if (symbol === 'B') return 'black';
      if (symbol === 'R') return 'red';
      if (symbol === 'G') return 'green';
      if (symbol === 'C') return 'colorless';
      if (symbol === 'S') return 'snow';
      if (symbol === 'E') return 'energy';
      return null;
    })();
    if (!mapKey) return null;

    const fromRecord = (value: unknown): number | null => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
      const rec = value as Record<string, unknown>;

      const aliases = new Set<string>([
        mapKey,
        mapKey[0],
        symbol.toLowerCase(),
        symbol,
      ]);
      if (symbol === 'S') {
        aliases.add('snowmana');
      } else if (symbol === 'E') {
        aliases.add('energycounter');
        aliases.add('energycounters');
        aliases.add('energyspent');
        aliases.add('spentenergy');
      }

      for (const key of aliases) {
        const n = Number(rec[key]);
        if (Number.isFinite(n)) return Math.max(0, n);
      }

      return 0;
    };

    const fromArray = (value: unknown): number | null => {
      if (!Array.isArray(value)) return null;
      let count = 0;
      for (const item of value as any[]) {
        const color = String(item?.manaColor || item?.color || item || '').trim().toUpperCase();
        if (!color) continue;
        if (symbol === 'S') {
          if (color === 'S' || color === 'SNOW') count += 1;
          continue;
        }
        if (symbol === 'E') {
          if (color === 'E' || color === 'ENERGY') count += 1;
          continue;
        }
        if (color === symbol || color === mapKey.toUpperCase()) count += 1;
      }
      return count;
    };

    const candidates: unknown[] = [
      obj?.manaPayment,
      obj?.card?.manaPayment,
      obj?.manaSpent,
      obj?.card?.manaSpent,
      obj?.manaSpentSymbols,
      obj?.card?.manaSpentSymbols,
    ];

    for (const candidate of candidates) {
      const fromR = fromRecord(candidate);
      if (fromR !== null) return fromR;
      const fromA = fromArray(candidate);
      if (fromA !== null) return fromA;
    }

    return null;
  };

  const parseCardClassList = (text: string): readonly string[] | null => {
    const normalized = String(text || '')
      .trim()
      .toLowerCase()
      .replace(/\bcards?\b/g, '')
      .replace(/\band\/or\b/g, 'and')
      .replace(/\band\s+or\b/g, 'and')
      .replace(/\s+/g, ' ')
      .trim();
    if (!normalized) return null;

    const parts = normalized
      .split(/\s*,\s*|\s+and\s+|\s+or\s+/i)
      .map(s => s.trim())
      .filter(Boolean);
    if (parts.length === 0) return null;

    const classes: string[] = [];
    for (const part of parts) {
      const direct = normalizeControlledClassKey(part);
      const mapped = direct || (/^instants?$/.test(part) ? 'instant' : /^sorceries$|^sorcery$/.test(part) ? 'sorcery' : null);
      if (!mapped) return null;
      if (!classes.includes(mapped)) classes.push(mapped);
    }
    return classes;
  };

  const evaluateInner = (expr: string): number | null => {
    return evaluateModifyPtWhereX(state, controllerId, `x is ${expr}`, targetCreatureId, ctx, runtime, depth + 1);
  };

  {
    const m = raw.match(/^x is (one|\d+) plus (.+)$/i);
    if (m) {
      const addend = String(m[1] || '').toLowerCase() === 'one' ? 1 : parseInt(String(m[1] || '0'), 10) || 0;
      const inner = evaluateInner(String(m[2] || ''));
      if (inner === null) return null;
      return inner + addend;
    }
  }

  {
    const m = raw.match(/^x is (one|\d+) minus (.+)$/i);
    if (m) {
      const minuend = String(m[1] || '').toLowerCase() === 'one' ? 1 : parseInt(String(m[1] || '0'), 10) || 0;
      const inner = evaluateInner(String(m[2] || ''));
      if (inner === null) return null;
      return minuend - inner;
    }
  }

  {
    const m = raw.match(/^x is (.+) minus (.+)$/i);
    if (m) {
      const minuend = evaluateInner(String(m[1] || ''));
      if (minuend !== null) {
        const subtrahend = evaluateInner(String(m[2] || ''));
        if (subtrahend !== null) return minuend - subtrahend;
      }
    }
  }

  {
    const m = raw.match(/^x is twice (.+)$/i);
    if (m) {
      const inner = evaluateInner(String(m[1] || ''));
      if (inner === null) return null;
      return inner * 2;
    }
  }

  {
    const m = raw.match(/^x is half (?:the|this|that) (.+?)(?:, rounded (up|down))?$/i);
    if (m) {
      const expr = String(m[1] || '').trim();
      let inner = evaluateInner(expr);
      if (inner === null && !/^the\s+/i.test(expr)) {
        inner = evaluateInner(`the ${expr}`);
      }
      if (inner === null) return null;
      const mode = String(m[2] || '').toLowerCase();
      if (mode === 'up') return Math.ceil(inner / 2);
      return Math.floor(inner / 2);
    }
  }

  {
    const m = raw.match(/^x is (.+) minus (one|\d+)$/i);
    if (m) {
      const inner = evaluateInner(String(m[1] || ''));
      if (inner === null) return null;
      const subtrahend = String(m[2] || '').toLowerCase() === 'one' ? 1 : parseInt(String(m[2] || '0'), 10) || 0;
      return inner - subtrahend;
    }
  }

  const parseClassList = (text: string): readonly string[] | null => {
    const normalized = String(text || '')
      .trim()
      .toLowerCase()
      .replace(/\bcards?\b/g, '')
      .replace(/\band\/or\b/g, 'and')
      .replace(/\band\s+or\b/g, 'and')
      .replace(/\s+/g, ' ')
      .trim();
    if (!normalized) return null;
    const parts = normalized
      .split(/\s*,\s*|\s+and\s+|\s+or\s+/i)
      .map(s => s.trim())
      .filter(Boolean);
    if (parts.length === 0) return null;
    const classes: string[] = [];
    for (const part of parts) {
      const c = normalizeControlledClassKey(part);
      if (!c) return null;
      if (!classes.includes(c)) classes.push(c);
    }
    return classes;
  };

  const parseColorQualifiedClassSpec = (
    text: string
  ): { readonly classes: readonly string[]; readonly requiredColor?: string } | null => {
    const normalized = String(text || '').trim().toLowerCase().replace(/\s+/g, ' ');
    if (!normalized) return null;

    const colorMatch = normalized.match(/^(white|blue|black|red|green)\s+(.+)$/i);
    if (!colorMatch) {
      const classes = parseClassList(text);
      return classes ? { classes } : null;
    }

    const requiredColor = normalizeManaColorCode(colorMatch[1]);
    const classes = parseClassList(String(colorMatch[2] || ''));
    if (!requiredColor || !classes) return null;
    return { classes, requiredColor };
  };

  const countByClasses = (
    permanents: readonly BattlefieldPermanent[],
    classes: readonly string[],
    requiredColor?: string
  ): number => {
    return permanents.filter((p: any) => {
      if (requiredColor && !getColorsFromPermanent(p).includes(requiredColor)) return false;
      const tl = typeLineLower(p);
      return classes.some((klass) => {
        if (klass === 'permanent') return true;
        if (klass === 'nonland permanent') return !tl.includes('land');
        return tl.includes(klass);
      });
    }).length;
  };

  const hasExecutorClass = (permanent: BattlefieldPermanent | any, klass: string): boolean => {
    const tl = typeLineLower(permanent);
    if (!tl) return false;
    if (klass === 'creature') return isExecutorCreature(permanent);
    if (klass === 'permanent') {
      return (
        tl.includes('artifact') ||
        tl.includes('battle') ||
        tl.includes('creature') ||
        tl.includes('enchantment') ||
        tl.includes('land') ||
        tl.includes('planeswalker')
      );
    }
    if (klass === 'nonland permanent') return hasExecutorClass(permanent, 'permanent') && !tl.includes('land');
    return tl.includes(klass);
  };

  const countNegatedClass = (
    permanents: readonly BattlefieldPermanent[],
    base: 'creature' | 'permanent',
    excludedQualifier: string,
    excludedId?: string
  ): number => {
    return permanents.filter((p: any) => {
      const id = String((p as any)?.id || '').trim();
      if (excludedId && id === excludedId) return false;
      const tl = typeLineLower(p);
      if (!tl) return false;
      if (!hasExecutorClass(p, base)) return false;
      return excludedQualifier ? !tl.includes(excludedQualifier) : true;
    }).length;
  };

  const leastStatAmongCreatures = (
    permanents: readonly BattlefieldPermanent[],
    which: 'power' | 'toughness',
    opts?: { readonly excludedId?: string; readonly excludedSubtype?: string }
  ): number => {
    let least: number | null = null;
    for (const p of permanents as any[]) {
      const id = String((p as any)?.id || '').trim();
      if (opts?.excludedId && id === opts.excludedId) continue;
      const tl = typeLineLower(p);
      if (!hasExecutorClass(p, 'creature')) continue;
      if (opts?.excludedSubtype && tl.includes(opts.excludedSubtype)) continue;
      const n = Number(which === 'power' ? p?.power : p?.toughness);
      if (!Number.isFinite(n)) continue;
      least = least === null ? n : Math.min(least, n);
    }
    return least ?? 0;
  };

  const lowestManaValueAmongPermanents = (
    permanents: readonly BattlefieldPermanent[],
    opts?: { readonly excludedId?: string; readonly excludedQualifier?: string }
  ): number => {
    let least: number | null = null;
    for (const p of permanents as any[]) {
      const id = String((p as any)?.id || '').trim();
      if (opts?.excludedId && id === opts.excludedId) continue;
      const tl = typeLineLower(p);
      if (!hasExecutorClass(p, 'permanent')) continue;
      if (opts?.excludedQualifier && tl.includes(opts.excludedQualifier)) continue;
      const mv = getCardManaValue(p?.card || p);
      if (mv === null) continue;
      least = least === null ? mv : Math.min(least, mv);
    }
    return least ?? 0;
  };

  {
    const m = raw.match(/^x is the number of (other )?non[- ]?([a-z][a-z-]*) creatures you control$/i);
    if (m) {
      const isOther = Boolean(String(m[1] || '').trim());
      const excludedQualifier = String(m[2] || '').toLowerCase();
      const excludedId = isOther ? String(targetCreatureId || ctx?.sourceId || '').trim() : '';
      return countNegatedClass(controlled, 'creature', excludedQualifier, excludedId || undefined);
    }
  }

  {
    const m = raw.match(/^x is the number of (other )?non[- ]?([a-z][a-z-]*) creatures (?:your opponents control|an opponent controls|you don['’]?t control|you do not control)$/i);
    if (m) {
      const isOther = Boolean(String(m[1] || '').trim());
      const excludedQualifier = String(m[2] || '').toLowerCase();
      const excludedId = isOther ? String(targetCreatureId || ctx?.sourceId || '').trim() : '';
      return countNegatedClass(opponentsControlled, 'creature', excludedQualifier, excludedId || undefined);
    }
  }

  {
    const m = raw.match(/^x is the number of (other )?non[- ]?([a-z][a-z-]*) creatures on (?:the )?battlefield$/i);
    if (m) {
      const isOther = Boolean(String(m[1] || '').trim());
      const excludedQualifier = String(m[2] || '').toLowerCase();
      const excludedId = isOther ? String(targetCreatureId || ctx?.sourceId || '').trim() : '';
      return countNegatedClass(battlefield, 'creature', excludedQualifier, excludedId || undefined);
    }
  }

  {
    const m = raw.match(/^x is the number of (other )?non[- ]?([a-z][a-z-]*) permanents you control$/i);
    if (m) {
      const isOther = Boolean(String(m[1] || '').trim());
      const excludedQualifier = String(m[2] || '').toLowerCase();
      const excludedId = isOther ? String(targetCreatureId || ctx?.sourceId || '').trim() : '';
      return countNegatedClass(controlled, 'permanent', excludedQualifier, excludedId || undefined);
    }
  }

  {
    const m = raw.match(/^x is the number of (other )?non[- ]?([a-z][a-z-]*) permanents (?:your opponents control|an opponent controls|you don['’]?t control|you do not control)$/i);
    if (m) {
      const isOther = Boolean(String(m[1] || '').trim());
      const excludedQualifier = String(m[2] || '').toLowerCase();
      const excludedId = isOther ? String(targetCreatureId || ctx?.sourceId || '').trim() : '';
      return countNegatedClass(opponentsControlled, 'permanent', excludedQualifier, excludedId || undefined);
    }
  }

  {
    const m = raw.match(/^x is the number of (other )?non[- ]?([a-z][a-z-]*) permanents on (?:the )?battlefield$/i);
    if (m) {
      const isOther = Boolean(String(m[1] || '').trim());
      const excludedQualifier = String(m[2] || '').toLowerCase();
      const excludedId = isOther ? String(targetCreatureId || ctx?.sourceId || '').trim() : '';
      return countNegatedClass(battlefield, 'permanent', excludedQualifier, excludedId || undefined);
    }
  }

  {
    const m = raw.match(/^x is the number of (.+) you control plus (?:the number of )?(.+) cards? in your graveyard$/i);
    if (m) {
      const controlledClasses = parseClassList(String(m[1] || ''));
      const graveyardClasses = parseCardClassList(String(m[2] || ''));
      if (!controlledClasses || !graveyardClasses) return null;

      const controller = (state.players || []).find((p: any) => String(p.id || '').trim() === controllerId) as any;
      if (!controller) return null;
      const gy = Array.isArray(controller.graveyard) ? controller.graveyard : [];

      return countByClasses(controlled, controlledClasses) + countCardsByClasses(gy, graveyardClasses);
    }
  }

  {
    const m = raw.match(/^x is the number of mounts and vehicles(?: you control)?$/i);
    if (m) {
      return countByClasses(controlled, ['mount', 'vehicle']);
    }
  }

  {
    const m = raw.match(/^x is the number of opponents who control (?:(?:an?|the)\s+)?(.+)$/i);
    if (m) {
      const spec = parseColorQualifiedClassSpec(String(m[1] || ''));
      if (!spec) {
        // Fall through to more specific phrase handlers.
      } else {
        const opponentIds = (state.players || [])
          .map((p: any) => String((p as any)?.id || '').trim())
          .filter(pid => pid.length > 0 && pid !== controllerId);

        let opponentCount = 0;
        for (const opponentId of opponentIds) {
          const oppPermanents = battlefield.filter((p: any) => String((p as any)?.controller || '').trim() === opponentId);
          const hasMatchingPermanent = countByClasses(oppPermanents, spec.classes, spec.requiredColor) > 0;
          if (hasMatchingPermanent) opponentCount += 1;
        }

        return opponentCount;
      }
    }
  }

  {
    const m = raw.match(/^x is the number of (.+) you control$/i);
    if (m) {
      const spec = parseColorQualifiedClassSpec(String(m[1] || ''));
      if (spec) {
        return countByClasses(controlled, spec.classes, spec.requiredColor);
      }
    }
  }

  {
    const m = raw.match(/^x is the number of (.+) your opponents control$/i);
    if (m) {
      const spec = parseColorQualifiedClassSpec(String(m[1] || ''));
      if (spec) {
        return countByClasses(opponentsControlled, spec.classes, spec.requiredColor);
      }
    }
  }

  {
    const m = raw.match(/^x is the number of (.+) target opponent controls$/i);
    if (m) {
      const spec = parseColorQualifiedClassSpec(String(m[1] || ''));
      if (spec) {
        const targetOpponentId = String(ctx?.selectorContext?.targetOpponentId || '').trim();
        if (!targetOpponentId) return null;
        const targetControlled = battlefield.filter((p: any) => String((p as any)?.controller || '').trim() === targetOpponentId);
        return countByClasses(targetControlled, spec.classes, spec.requiredColor);
      }
    }
  }

  {
    const m = raw.match(/^x is the number of (.+) (?:the )?defending player controls$/i);
    if (m) {
      const spec = parseColorQualifiedClassSpec(String(m[1] || ''));
      if (spec) {
        const targetOpponentId = String(ctx?.selectorContext?.targetOpponentId || '').trim();
        if (!targetOpponentId) return null;
        const targetControlled = battlefield.filter((p: any) => String((p as any)?.controller || '').trim() === targetOpponentId);
        return countByClasses(targetControlled, spec.classes, spec.requiredColor);
      }
    }
  }

  {
    const m = raw.match(/^x is the number of (.+) (?:that player controls|they control)$/i);
    if (m) {
      const spec = parseColorQualifiedClassSpec(String(m[1] || ''));
      if (spec) {
        const player = resolveContextPlayer();
        if (!player) return null;
        const playerId = String((player as any)?.id || '').trim();
        if (!playerId) return null;
        const targetControlled = battlefield.filter((p: any) => String((p as any)?.controller || '').trim() === playerId);
        return countByClasses(targetControlled, spec.classes, spec.requiredColor);
      }
    }
  }

  {
    const m = raw.match(/^x is the number of (.+) (?:those opponents|all of those opponents|all those opponents|each of those opponents) control$/i);
    if (m) {
      const spec = parseColorQualifiedClassSpec(String(m[1] || ''));
      if (spec) {
        const ids = Array.isArray(ctx?.selectorContext?.eachOfThoseOpponents)
          ? (ctx?.selectorContext?.eachOfThoseOpponents || []).map(id => String(id || '').trim()).filter(Boolean)
          : [];
        if (ids.length === 0) return null;
        const idSet = new Set(ids);
        const pool = battlefield.filter((p: any) => idSet.has(String((p as any)?.controller || '').trim()));
        return countByClasses(pool, spec.classes, spec.requiredColor);
      }
    }
  }

  {
    const m = raw.match(/^x is the number of opponents you have$/i);
    if (m) {
      return Math.max(0, (state.players || []).filter(p => p.id !== controllerId).length);
    }
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
      const excludedId = String(targetCreatureId || ctx?.sourceId || '').trim();
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
      const excludedId = isOther ? String(targetCreatureId || ctx?.sourceId || '').trim() : '';

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
        const excludedId = isOther ? String(targetCreatureId || ctx?.sourceId || '').trim() : '';
        const useOpponents = /\b(?:your opponents control|an opponent controls|you don['’]?t control|you do not control)\b/.test(phrase);
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
      const excludedId = isOther ? String(targetCreatureId || ctx?.sourceId || '').trim() : '';

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
        for (const color of getColorsFromPermanent(p)) {
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
      const sourceId = String(ctx?.sourceId || '').trim();
      const sourceObj = sourceId ? findObjectById(sourceId) : null;
      const targetObj = targetCreatureId ? findObjectById(targetCreatureId) : null;

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
      const targetObj = targetCreatureId ? findObjectById(targetCreatureId) : null;
      const sourceObj = String(ctx?.sourceId || '').trim() ? findObjectById(String(ctx?.sourceId || '').trim()) : null;
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
    const m = raw.match(/^x is the number of cards? in your (graveyard|hand|library|exile)$/i);
    if (m) {
      const zone = String(m[1] || '').toLowerCase();
      const controller = (state.players || []).find((p: any) => String(p.id || '').trim() === controllerId) as any;
      if (!controller) return null;
      if (zone === 'graveyard') return Array.isArray(controller.graveyard) ? controller.graveyard.length : 0;
      if (zone === 'hand') return Array.isArray(controller.hand) ? controller.hand.length : 0;
      if (zone === 'library') return Array.isArray(controller.library) ? controller.library.length : 0;
      if (zone === 'exile') return Array.isArray(controller.exile) ? controller.exile.length : 0;
      return null;
    }
  }

  {
    const m = raw.match(/^x is the number of cards? in (?:that player's|their) (graveyard|hand|library|exile)$/i);
    if (m) {
      const zone = String(m[1] || '').toLowerCase();
      const player = resolveContextPlayer();
      if (!player) return null;
      if (zone === 'graveyard') return Array.isArray(player.graveyard) ? player.graveyard.length : 0;
      if (zone === 'hand') return Array.isArray(player.hand) ? player.hand.length : 0;
      if (zone === 'library') return Array.isArray(player.library) ? player.library.length : 0;
      if (zone === 'exile') return Array.isArray(player.exile) ? player.exile.length : 0;
      return null;
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
      const controller = (state.players || []).find((p: any) => String(p.id || '').trim() === controllerId) as any;
      if (!controller) return null;
      const gy = Array.isArray(controller.graveyard) ? controller.graveyard : [];
      const seen = new Set<string>();
      for (const card of gy as any[]) {
        const types = getCardTypesFromTypeLine(card);
        if (!types) continue;
        for (const type of types) {
          seen.add(type);
        }
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
      const refName = String(
        (ref as any)?.cardName ||
        (ref as any)?.name ||
        (ref as any)?.card?.name ||
        (ref as any)?.spell?.cardName ||
        (ref as any)?.spell?.name ||
        ''
      ).trim().toLowerCase();
      if (!refName) return null;
      return (state.players || []).reduce((sum, p: any) => {
        const gy = Array.isArray((p as any)?.graveyard) ? (p as any).graveyard : [];
        const count = gy.filter((card: any) => String((card as any)?.name || '').trim().toLowerCase() === refName).length;
        return sum + count;
      }, 0);
    }
  }

  {
    const m = raw.match(/^x is the number of cards? named ([a-z0-9 ,.'-]+) in all graveyards(?: as you cast this spell)?$/i);
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
    const m = raw.match(/^x is the number of cards? named ([a-z0-9 ,.'-]+) in your graveyard$/i);
    if (m) {
      const wantedName = normalizeOracleText(String(m[1] || ''));
      if (!wantedName) return null;
      const controller = (state.players || []).find((p: any) => String(p.id || '').trim() === controllerId) as any;
      if (!controller) return null;
      const gy = Array.isArray(controller.graveyard) ? controller.graveyard : [];
      return gy.filter((card: any) => normalizeOracleText(String((card as any)?.name || '')) === wantedName).length;
    }
  }

  {
    const m = raw.match(/^x is the amount of life your opponents(?:['’])?(?: have)? gained(?: this turn)?$/i);
    if (m) {
      const stateAny: any = state as any;

      const fromRecordSumOpponents = (value: any): number | null => {
        if (!value || typeof value !== 'object' || Array.isArray(value)) return null;

        const players = Array.isArray(state.players) ? state.players : [];
        if (players.length > 0) {
          return players.reduce((sum: number, player: any) => {
            const pid = String((player as any)?.id || '').trim();
            if (!pid || pid === controllerId) return sum;
            const n = Number((value as any)[pid]);
            return sum + (Number.isFinite(n) ? Math.max(0, n) : 0);
          }, 0);
        }

        return Object.entries(value as Record<string, unknown>).reduce((sum, [pid, amount]) => {
          if (String(pid).trim() === controllerId) return sum;
          const n = Number(amount);
          return sum + (Number.isFinite(n) ? Math.max(0, n) : 0);
        }, 0);
      };

      const candidates: Array<number | null> = [
        fromRecordSumOpponents(stateAny.lifeGainedThisTurn),
        fromRecordSumOpponents(stateAny.lifeGained),
        fromRecordSumOpponents(stateAny.turnStats?.lifeGained),
      ];

      for (const candidate of candidates) {
        if (candidate !== null) return candidate;
      }

      return null;
    }
  }

  {
    const m = raw.match(/^x is the amount of life you gained(?: this turn)?$/i);
    if (m) {
      const stateAny: any = state as any;

      const fromRecord = (value: any): number | null => {
        if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
        const n = Number(value[controllerId]);
        return Number.isFinite(n) ? n : null;
      };

      const candidates: Array<number | null> = [
        fromRecord(stateAny.lifeGainedThisTurn),
        fromRecord(stateAny.lifeGained),
        fromRecord(stateAny.turnStats?.lifeGained),
      ];

      for (const candidate of candidates) {
        if (candidate !== null) return Math.max(0, candidate);
      }

      return null;
    }
  }

  {
    const m = raw.match(/^x is the amount of life your opponents(?:['’])?(?: have)? lost(?: this turn)?$/i);
    if (m) {
      const stateAny: any = state as any;

      const fromRecordSumOpponents = (value: any): number | null => {
        if (!value || typeof value !== 'object' || Array.isArray(value)) return null;

        const players = Array.isArray(state.players) ? state.players : [];
        if (players.length > 0) {
          return players.reduce((sum: number, player: any) => {
            const pid = String((player as any)?.id || '').trim();
            if (!pid || pid === controllerId) return sum;
            const n = Number((value as any)[pid]);
            return sum + (Number.isFinite(n) ? Math.max(0, n) : 0);
          }, 0);
        }

        return Object.entries(value as Record<string, unknown>).reduce((sum, [pid, amount]) => {
          if (String(pid).trim() === controllerId) return sum;
          const n = Number(amount);
          return sum + (Number.isFinite(n) ? Math.max(0, n) : 0);
        }, 0);
      };

      const candidates: Array<number | null> = [
        fromRecordSumOpponents(stateAny.lifeLostThisTurn),
        fromRecordSumOpponents(stateAny.lifeLost),
        fromRecordSumOpponents(stateAny.turnStats?.lifeLost),
      ];

      for (const candidate of candidates) {
        if (candidate !== null) return candidate;
      }

      return null;
    }
  }

  {
    const m = raw.match(/^x is the amount of life (?:you(?:['’]ve| have)|you) lost(?: this turn)?$/i);
    if (m) {
      const stateAny: any = state as any;

      const fromRecord = (value: any): number | null => {
        if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
        const n = Number(value[controllerId]);
        return Number.isFinite(n) ? n : null;
      };

      const candidates: Array<number | null> = [
        fromRecord(stateAny.lifeLostThisTurn),
        fromRecord(stateAny.lifeLost),
        fromRecord(stateAny.turnStats?.lifeLost),
      ];

      for (const candidate of candidates) {
        if (candidate !== null) return Math.max(0, candidate);
      }

      return null;
    }
  }

  {
    const m = raw.match(/^x is the number of cards? (?:you(?:['’]ve| have)|you) discarded this turn$/i);
    if (m) {
      const stateAny: any = state as any;

      const fromRecord = (value: any): number | null => {
        if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
        const key = String(controllerId);
        if (Object.prototype.hasOwnProperty.call(value, key)) {
          const n = Number(value[key]);
          return Number.isFinite(n) ? Math.max(0, n) : 0;
        }
        return 0;
      };

      const candidates: Array<number | null> = [
        fromRecord(stateAny.cardsDiscardedThisTurn),
        fromRecord(stateAny.cardsDiscarded),
        fromRecord(stateAny.turnStats?.cardsDiscarded),
      ];

      for (const candidate of candidates) {
        if (candidate !== null) return candidate;
      }

      return null;
    }
  }

  {
    const m = raw.match(/^x is the number of cards? your opponents have discarded this turn$|^x is the number of cards? your opponents discarded this turn$/i);
    if (m) {
      const stateAny: any = state as any;

      const fromRecordSumOpponents = (value: any): number | null => {
        if (!value || typeof value !== 'object' || Array.isArray(value)) return null;

        const players = Array.isArray(state.players) ? state.players : [];
        if (players.length > 0) {
          return players.reduce((sum: number, player: any) => {
            const pid = String((player as any)?.id || '').trim();
            if (!pid || pid === controllerId) return sum;
            const n = Number((value as any)[pid]);
            return sum + (Number.isFinite(n) ? Math.max(0, n) : 0);
          }, 0);
        }

        return Object.entries(value as Record<string, unknown>).reduce((sum, [pid, amount]) => {
          if (String(pid).trim() === controllerId) return sum;
          const n = Number(amount);
          return sum + (Number.isFinite(n) ? Math.max(0, n) : 0);
        }, 0);
      };

      const candidates: Array<number | null> = [
        fromRecordSumOpponents(stateAny.cardsDiscardedThisTurn),
        fromRecordSumOpponents(stateAny.cardsDiscarded),
        fromRecordSumOpponents(stateAny.turnStats?.cardsDiscarded),
      ];

      for (const candidate of candidates) {
        if (candidate !== null) return candidate;
      }

      return null;
    }
  }

  {
    const m = raw.match(/^x is the number of cards? (?:you(?:['’]ve| have)|you) drawn this turn$|^x is the number of cards? you drew this turn$/i);
    if (m) {
      const stateAny: any = state as any;

      const fromRecord = (value: any): number | null => {
        if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
        const key = String(controllerId);
        if (Object.prototype.hasOwnProperty.call(value, key)) {
          const n = Number(value[key]);
          return Number.isFinite(n) ? Math.max(0, n) : 0;
        }
        return 0;
      };

      const candidates: Array<number | null> = [
        fromRecord(stateAny.cardsDrawnThisTurn),
        fromRecord(stateAny.cardsDrawn),
        fromRecord(stateAny.turnStats?.cardsDrawn),
      ];

      for (const candidate of candidates) {
        if (candidate !== null) return candidate;
      }

      return null;
    }
  }

  {
    const m = raw.match(/^x is the number of cards? your opponents have drawn this turn$|^x is the number of cards? your opponents drew this turn$/i);
    if (m) {
      const stateAny: any = state as any;

      const fromRecordSumOpponents = (value: any): number | null => {
        if (!value || typeof value !== 'object' || Array.isArray(value)) return null;

        const players = Array.isArray(state.players) ? state.players : [];
        if (players.length > 0) {
          return players.reduce((sum: number, player: any) => {
            const pid = String((player as any)?.id || '').trim();
            if (!pid || pid === controllerId) return sum;
            const n = Number((value as any)[pid]);
            return sum + (Number.isFinite(n) ? Math.max(0, n) : 0);
          }, 0);
        }

        return Object.entries(value as Record<string, unknown>).reduce((sum, [pid, amount]) => {
          if (String(pid).trim() === controllerId) return sum;
          const n = Number(amount);
          return sum + (Number.isFinite(n) ? Math.max(0, n) : 0);
        }, 0);
      };

      const candidates: Array<number | null> = [
        fromRecordSumOpponents(stateAny.cardsDrawnThisTurn),
        fromRecordSumOpponents(stateAny.cardsDrawn),
        fromRecordSumOpponents(stateAny.turnStats?.cardsDrawn),
      ];

      for (const candidate of candidates) {
        if (candidate !== null) return candidate;
      }

      return null;
    }
  }

  {
    const m = raw.match(/^x is the number of spells? (?:you(?:['’]ve| have)|you) cast this turn$|^x is the number of spells? you cast this turn$/i);
    if (m) {
      const stateAny: any = state as any;

      const fromRecord = (value: any): number | null => {
        if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
        const key = String(controllerId);
        if (Object.prototype.hasOwnProperty.call(value, key)) {
          const n = Number(value[key]);
          return Number.isFinite(n) ? Math.max(0, n) : 0;
        }
        return 0;
      };

      const candidates: Array<number | null> = [
        fromRecord(stateAny.spellsCastThisTurn),
        fromRecord(stateAny.spellsCast),
        fromRecord(stateAny.turnStats?.spellsCast),
      ];

      for (const candidate of candidates) {
        if (candidate !== null) return candidate;
      }

      return null;
    }
  }

  {
    const m = raw.match(/^x is the number of spells? your opponents have cast this turn$|^x is the number of spells? your opponents cast this turn$/i);
    if (m) {
      const stateAny: any = state as any;

      const fromRecordSumOpponents = (value: any): number | null => {
        if (!value || typeof value !== 'object' || Array.isArray(value)) return null;

        const players = Array.isArray(state.players) ? state.players : [];
        if (players.length > 0) {
          return players.reduce((sum: number, player: any) => {
            const pid = String((player as any)?.id || '').trim();
            if (!pid || pid === controllerId) return sum;
            const n = Number((value as any)[pid]);
            return sum + (Number.isFinite(n) ? Math.max(0, n) : 0);
          }, 0);
        }

        return Object.entries(value as Record<string, unknown>).reduce((sum, [pid, amount]) => {
          if (String(pid).trim() === controllerId) return sum;
          const n = Number(amount);
          return sum + (Number.isFinite(n) ? Math.max(0, n) : 0);
        }, 0);
      };

      const candidates: Array<number | null> = [
        fromRecordSumOpponents(stateAny.spellsCastThisTurn),
        fromRecordSumOpponents(stateAny.spellsCast),
        fromRecordSumOpponents(stateAny.turnStats?.spellsCast),
      ];

      for (const candidate of candidates) {
        if (candidate !== null) return candidate;
      }

      return null;
    }
  }

  // ── All-players spells cast this turn (no “you”/“opponents” qualifier) ───────────
  {
    const m = raw.match(/^x is the number of spells? cast this turn$/i);
    if (m) {
      const stateAny: any = state as any;

      const fromRecordSumAll = (value: any): number | null => {
        if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
        return Object.values(value as Record<string, unknown>).reduce<number>((sum, amount) => {
          const n = Number(amount);
          return sum + (Number.isFinite(n) ? Math.max(0, n) : 0);
        }, 0);
      };

      const candidates: Array<number | null> = [
        fromRecordSumAll(stateAny.spellsCastThisTurn),
        fromRecordSumAll(stateAny.spellsCast),
        fromRecordSumAll(stateAny.turnStats?.spellsCast),
      ];

      for (const candidate of candidates) {
        if (candidate !== null) return candidate;
      }

      return null;
    }
  }

  {
    const m = raw.match(/^x is the number of lands? (?:you(?:['’]ve| have)|you) played this turn$|^x is the number of lands? you played this turn$/i);
    if (m) {
      const stateAny: any = state as any;

      const fromRecord = (value: any): number | null => {
        if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
        const key = String(controllerId);
        if (Object.prototype.hasOwnProperty.call(value, key)) {
          const n = Number(value[key]);
          return Number.isFinite(n) ? Math.max(0, n) : 0;
        }
        return 0;
      };

      const candidates: Array<number | null> = [
        fromRecord(stateAny.landsPlayedThisTurn),
        fromRecord(stateAny.landsPlayed),
        fromRecord(stateAny.turnStats?.landsPlayed),
      ];

      for (const candidate of candidates) {
        if (candidate !== null) return candidate;
      }

      return null;
    }
  }

  {
    const m = raw.match(/^x is the number of lands? your opponents have played this turn$|^x is the number of lands? your opponents played this turn$/i);
    if (m) {
      const stateAny: any = state as any;

      const fromRecordSumOpponents = (value: any): number | null => {
        if (!value || typeof value !== 'object' || Array.isArray(value)) return null;

        const players = Array.isArray(state.players) ? state.players : [];
        if (players.length > 0) {
          return players.reduce((sum: number, player: any) => {
            const pid = String((player as any)?.id || '').trim();
            if (!pid || pid === controllerId) return sum;
            const n = Number((value as any)[pid]);
            return sum + (Number.isFinite(n) ? Math.max(0, n) : 0);
          }, 0);
        }

        return Object.entries(value as Record<string, unknown>).reduce((sum, [pid, amount]) => {
          if (String(pid).trim() === controllerId) return sum;
          const n = Number(amount);
          return sum + (Number.isFinite(n) ? Math.max(0, n) : 0);
        }, 0);
      };

      const candidates: Array<number | null> = [
        fromRecordSumOpponents(stateAny.landsPlayedThisTurn),
        fromRecordSumOpponents(stateAny.landsPlayed),
        fromRecordSumOpponents(stateAny.turnStats?.landsPlayed),
      ];

      for (const candidate of candidates) {
        if (candidate !== null) return candidate;
      }

      return null;
    }
  }

  {
    const m = raw.match(/^x is the number of cards? revealed this way$/i);
    if (m) {
      const revealed = Number(runtime?.lastRevealedCardCount ?? 0);
      return Number.isFinite(revealed) ? Math.max(0, revealed) : 0;
    }
  }

  {
    const m = raw.match(/^x is the number of cards? discarded this way$/i);
    if (m) {
      const discarded = Number(runtime?.lastDiscardedCardCount ?? 0);
      return Number.isFinite(discarded) ? Math.max(0, discarded) : 0;
    }
  }

  {
    const m = raw.match(/^x is the number of cards? exiled this way$/i);
    if (m) {
      const exiled = Number(runtime?.lastExiledCardCount ?? 0);
      return Number.isFinite(exiled) ? Math.max(0, exiled) : 0;
    }
  }

  {
    const m = raw.match(/^x is the total power of (?:the )?cards? exiled this way$/i);
    if (m) {
      const exiledCards = Array.isArray(runtime?.lastExiledCards) ? runtime.lastExiledCards : [];
      return exiledCards.reduce((sum: number, card: any) => {
        const n = Number((card as any)?.power ?? (card as any)?.card?.power);
        return sum + (Number.isFinite(n) ? n : 0);
      }, 0);
    }
  }

  {
    const m = raw.match(/^x is the total power of (?:the )?creatures? goaded this way$/i);
    if (m) {
      const goadedCreatures = Array.isArray(runtime?.lastGoadedCreatures) ? runtime.lastGoadedCreatures : [];
      return goadedCreatures.reduce((sum: number, creature: any) => {
        const n = Number((creature as any)?.power ?? (creature as any)?.card?.power);
        return sum + (Number.isFinite(n) ? n : 0);
      }, 0);
    }
  }

  {
    const m = raw.match(/^x is the total power of (?:the )?creatures? sacrificed this way$/i);
    if (m) {
      const totalPower = Number(runtime?.lastSacrificedCreaturesPowerTotal ?? 0);
      return Number.isFinite(totalPower) ? Math.max(0, totalPower) : 0;
    }
  }

  {
    const m = raw.match(/^x is (?:the )?amount of excess damage dealt this way$|^x is the excess damage dealt this way$/i);
    if (m) {
      const excess = Number(runtime?.lastExcessDamageDealtThisWay ?? 0);
      return Number.isFinite(excess) ? Math.max(0, excess) : 0;
    }
  }

  {
    const m = raw.match(/^x is the number of cards? looked at while scrying this way$/i);
    if (m) {
      const looked = Number(runtime?.lastScryLookedAtCount ?? 0);
      return Number.isFinite(looked) ? Math.max(0, looked) : 0;
    }
  }

  {
    const m = raw.match(/^x is the number of creatures that died this turn$/i);
    if (m) {
      const stateAny: any = state as any;
      const byController = stateAny.creaturesDiedThisTurnByController;
      if (byController && typeof byController === 'object' && !Array.isArray(byController)) {
        const values = Object.values(byController as Record<string, unknown>) as unknown[];
        return values.reduce<number>((sum, value) => {
          const n = Number(value);
          return sum + (Number.isFinite(n) ? Math.max(0, n) : 0);
        }, 0);
      }

      const boolFallback = Boolean(stateAny.creatureDiedThisTurn);
      return boolFallback ? 1 : 0;
    }
  }

  {
    const m = raw.match(/^x is the number of creatures that died under your control(?: this turn)?$/i);
    if (m) {
      const stateAny: any = state as any;
      const byController = stateAny.creaturesDiedThisTurnByController;
      if (!byController || typeof byController !== 'object' || Array.isArray(byController)) return null;
      const n = Number((byController as Record<string, unknown>)[controllerId]);
      return Number.isFinite(n) ? Math.max(0, n) : 0;
    }
  }

  {
    const m = raw.match(/^x is the number of creatures that died under (?:(?:your )?opponents(?:['’])?|an opponent(?:['’]s)?) control(?: this turn)?$/i);
    if (m) {
      const stateAny: any = state as any;
      const byController = stateAny.creaturesDiedThisTurnByController;
      if (!byController || typeof byController !== 'object' || Array.isArray(byController)) return null;

      const players = Array.isArray(state.players) ? state.players : [];
      if (players.length > 0) {
        return players.reduce((sum: number, player: any) => {
          const pid = String((player as any)?.id || '').trim();
          if (!pid || pid === controllerId) return sum;
          const n = Number((byController as Record<string, unknown>)[pid]);
          return sum + (Number.isFinite(n) ? Math.max(0, n) : 0);
        }, 0);
      }

      return Object.entries(byController as Record<string, unknown>).reduce((sum, [pid, amount]) => {
        if (String(pid).trim() === controllerId) return sum;
        const n = Number(amount);
        return sum + (Number.isFinite(n) ? Math.max(0, n) : 0);
      }, 0);
    }
  }

  {
    const m = raw.match(/^x is the number of creatures you control that died(?: this turn)?$/i);
    if (m) {
      const stateAny: any = state as any;
      const byController = stateAny.creaturesDiedThisTurnByController;
      if (!byController || typeof byController !== 'object' || Array.isArray(byController)) return null;
      const n = Number((byController as Record<string, unknown>)[controllerId]);
      return Number.isFinite(n) ? Math.max(0, n) : 0;
    }
  }

  {
    const m = raw.match(/^x is the number of creatures your opponents control that died(?: this turn)?$/i);
    if (m) {
      const stateAny: any = state as any;
      const byController = stateAny.creaturesDiedThisTurnByController;
      if (!byController || typeof byController !== 'object' || Array.isArray(byController)) return null;

      const players = Array.isArray(state.players) ? state.players : [];
      if (players.length > 0) {
        return players.reduce((sum: number, player: any) => {
          const pid = String((player as any)?.id || '').trim();
          if (!pid || pid === controllerId) return sum;
          const n = Number((byController as Record<string, unknown>)[pid]);
          return sum + (Number.isFinite(n) ? Math.max(0, n) : 0);
        }, 0);
      }

      return Object.entries(byController as Record<string, unknown>).reduce((sum, [pid, amount]) => {
        if (String(pid).trim() === controllerId) return sum;
        const n = Number(amount);
        return sum + (Number.isFinite(n) ? Math.max(0, n) : 0);
      }, 0);
    }
  }

  {
    const m = raw.match(/^x is the number of permanents (?:you(?:['’]ve| have)|you) sacrificed(?: this turn)?$/i);
    if (m) {
      const stateAny: any = state as any;
      const byController = stateAny.permanentsSacrificedThisTurn;
      if (!byController || typeof byController !== 'object' || Array.isArray(byController)) return null;
      const n = Number((byController as Record<string, unknown>)[controllerId]);
      return Number.isFinite(n) ? Math.max(0, n) : 0;
    }
  }

  {
    const m = raw.match(/^x is the number of permanents your opponents have sacrificed(?: this turn)?$|^x is the number of permanents your opponents sacrificed(?: this turn)?$/i);
    if (m) {
      const stateAny: any = state as any;
      const byController = stateAny.permanentsSacrificedThisTurn;
      if (!byController || typeof byController !== 'object' || Array.isArray(byController)) return null;

      const players = Array.isArray(state.players) ? state.players : [];
      if (players.length > 0) {
        return players.reduce((sum: number, player: any) => {
          const pid = String((player as any)?.id || '').trim();
          if (!pid || pid === controllerId) return sum;
          const n = Number((byController as Record<string, unknown>)[pid]);
          return sum + (Number.isFinite(n) ? Math.max(0, n) : 0);
        }, 0);
      }

      return Object.entries(byController as Record<string, unknown>).reduce((sum, [pid, amount]) => {
        if (String(pid).trim() === controllerId) return sum;
        const n = Number(amount);
        return sum + (Number.isFinite(n) ? Math.max(0, n) : 0);
      }, 0);
    }
  }

  {
    const m = raw.match(/^x is the sacrificed creature'?s (power|toughness|mana value)$/i);
    if (m) {
      const sourceId = String(ctx?.sourceId || '').trim();
      if (!sourceId) return null;
      const ref = findObjectById(sourceId);
      if (!ref) return null;

      const refCard = (ref as any)?.card || ref;
      const tl = typeLineLower(refCard);
      if (!tl.includes('creature')) return null;

      const which = String(m[1] || '').toLowerCase();
      if (which === 'mana value') {
        const mv = getCardManaValue(refCard);
        return mv === null ? null : mv;
      }

      const rawValue = which === 'power'
        ? ((refCard as any)?.power ?? (ref as any)?.power)
        : ((refCard as any)?.toughness ?? (ref as any)?.toughness);
      const n = Number(rawValue);
      return Number.isFinite(n) ? n : null;
    }
  }

  {
    const m = raw.match(/^x is the sacrificed artifact'?s mana value$/i);
    if (m) {
      const sourceId = String(ctx?.sourceId || '').trim();
      if (!sourceId) return null;
      const ref = findObjectById(sourceId);
      if (!ref) return null;

      const refCard = (ref as any)?.card || ref;
      const tl = typeLineLower(refCard);
      if (!tl.includes('artifact')) return null;

      const mv = getCardManaValue(refCard);
      return mv === null ? null : mv;
    }
  }

  {
    const m = raw.match(/^x is the greatest mana value of a commander you own on the battlefield or in the command zone$/i);
    if (m) {
      let greatest = 0;

      for (const p of battlefield as any[]) {
        const ownerId = String((p as any)?.ownerId || (p as any)?.owner || '').trim();
        if (ownerId && ownerId !== controllerId) continue;
        if (!isCommanderObject(p)) continue;
        const mv = getCardManaValue((p as any)?.card || p);
        if (mv !== null) greatest = Math.max(greatest, mv);
      }

      for (const obj of collectCommandZoneObjects()) {
        const ownerId = String((obj as any)?.ownerId || (obj as any)?.owner || '').trim();
        if (ownerId && ownerId !== controllerId) continue;
        if (!isCommanderObject(obj)) continue;
        const mv = getCardManaValue((obj as any)?.card || obj);
        if (mv !== null) greatest = Math.max(greatest, mv);
      }

      return greatest;
    }
  }

  {
    const m = raw.match(/^x is your highest commander tax among your commanders$/i);
    if (m) {
      const commandZoneAny = (state as any)?.commandZone ?? (state as any)?.commanderZone;
      if (!commandZoneAny) return null;

      const infoCandidates: any[] = [];
      const byController = (commandZoneAny as any)?.[controllerId];
      if (byController && typeof byController === 'object') infoCandidates.push(byController);
      if ((commandZoneAny as any)?.commanderIds || (commandZoneAny as any)?.taxById) infoCandidates.push(commandZoneAny as any);

      const maxTaxFromInfo = (info: any): number | null => {
        if (!info || typeof info !== 'object') return null;

        const taxById = info.taxById;
        if (taxById && typeof taxById === 'object' && !Array.isArray(taxById)) {
          let highest = 0;
          let seen = false;
          for (const value of Object.values(taxById as Record<string, unknown>)) {
            const n = Number(value);
            if (!Number.isFinite(n)) continue;
            highest = Math.max(highest, Math.max(0, n));
            seen = true;
          }
          return seen ? highest : 0;
        }

        const commanderIds = Array.isArray(info.commanderIds) ? info.commanderIds : [];
        const totalTax = Number(info.tax);
        if (commanderIds.length <= 1 && Number.isFinite(totalTax)) {
          return Math.max(0, totalTax);
        }

        return null;
      };

      for (const info of infoCandidates) {
        const highest = maxTaxFromInfo(info);
        if (highest !== null) return highest;
      }

      return null;
    }
  }

  {
    const m = raw.match(/^x is your life total$/i);
    if (m) {
      const controller = (state.players || []).find((p: any) => String(p.id || '').trim() === controllerId) as any;
      if (!controller) return null;
      const life = Number(controller.life);
      return Number.isFinite(life) ? life : null;
    }
  }

  {
    const m = raw.match(/^x is your speed$/i);
    if (m) {
      const stateAny: any = state as any;
      const controller = (state.players || []).find((p: any) => String(p.id || '').trim() === controllerId) as any;

      const candidates: unknown[] = [
        controller?.speed,
        controller?.playerSpeed,
        stateAny?.speed?.[controllerId],
        stateAny?.playerSpeed?.[controllerId],
        stateAny?.speedByPlayer?.[controllerId],
      ];

      for (const value of candidates) {
        const n = Number(value);
        if (Number.isFinite(n)) return Math.max(0, n);
      }

      return null;
    }
  }

  {
    const m = raw.match(/^x is the number of times this creature has mutated$/i);
    if (m) {
      const sourceId = String(ctx?.sourceId || '').trim();
      const sourceObj = sourceId ? findObjectById(sourceId) : null;
      const targetObj = targetCreatureId ? findObjectById(targetCreatureId) : null;

      const isCreature = (obj: any): boolean => {
        return Boolean(obj) && hasExecutorClass(obj, 'creature');
      };

      const host =
        (isCreature(targetObj) ? targetObj : null) ||
        (isCreature(sourceObj) ? sourceObj : null);

      if (!host) return null;

      const candidates: unknown[] = [
        (host as any)?.mutationCount,
        (host as any)?.timesMutated,
        (host as any)?.mutateCount,
      ];

      for (const value of candidates) {
        const n = Number(value);
        if (Number.isFinite(n)) return Math.max(0, n);
      }

      const stack = (host as any)?.mutatedStack;
      if (Array.isArray(stack)) {
        return Math.max(0, stack.length - 1);
      }

      return null;
    }
  }

  {
    const m = raw.match(/^x is the number of experience counters you have$/i);
    if (m) {
      const stateAny: any = state as any;
      const controller = (state.players || []).find((p: any) => String(p.id || '').trim() === controllerId) as any;

      const candidates: unknown[] = [
        controller?.experienceCounters,
        controller?.counters?.experience,
        stateAny?.experienceCounters?.[controllerId],
        stateAny?.experience?.[controllerId],
        stateAny?.playerCounters?.experience?.[controllerId],
      ];

      for (const value of candidates) {
        const n = Number(value);
        if (Number.isFinite(n)) return Math.max(0, n);
      }

      return null;
    }
  }

  {
    const m = raw.match(/^x is the result$/i);
    if (m) {
      const stateAny: any = state as any;

      const toFinite = (value: unknown): number | null => {
        const n = Number(value);
        return Number.isFinite(n) ? n : null;
      };

      const perPlayer = stateAny?.lastDieRollByPlayer?.[controllerId];
      const perPlayerResult = toFinite(perPlayer?.result);
      if (perPlayerResult !== null) return Math.max(0, perPlayerResult);

      const globalLast = toFinite(stateAny?.lastDieRoll?.result);
      if (globalLast !== null) return Math.max(0, globalLast);

      const turnRollsRaw = stateAny?.dieRollsThisTurn?.[controllerId];
      const turnRolls = Array.isArray(turnRollsRaw) ? turnRollsRaw : [];
      for (let i = turnRolls.length - 1; i >= 0; i -= 1) {
        const result = toFinite((turnRolls[i] as any)?.result);
        if (result !== null) return Math.max(0, result);
      }

      return null;
    }
  }

  {
    const m = raw.match(/^x is the number of (.+) cards? in your (graveyard|hand|library|exile)$/i);
    if (m) {
      const classes = parseCardClassList(String(m[1] || ''));
      if (!classes) return null;
      const zone = String(m[2] || '').toLowerCase();
      const controller = (state.players || []).find((p: any) => String(p.id || '').trim() === controllerId) as any;
      if (!controller) return null;

      const cards =
        zone === 'graveyard'
          ? (Array.isArray(controller.graveyard) ? controller.graveyard : [])
          : zone === 'hand'
            ? (Array.isArray(controller.hand) ? controller.hand : [])
            : zone === 'library'
              ? (Array.isArray(controller.library) ? controller.library : [])
              : zone === 'exile'
                ? (Array.isArray(controller.exile) ? controller.exile : [])
                : null;
      if (!cards) return null;

      return countCardsByClasses(cards, classes);
    }
  }

  {
    const m = raw.match(/^x is the number of (.+) cards? in its controller['’]?s graveyard$/i);
    if (m) {
      const classes = parseCardClassList(String(m[1] || ''));
      if (!classes) return null;
      const sourceId = String(ctx?.sourceId || '').trim();
      if (!sourceId) return null;
      const sourceObj = findObjectById(sourceId);
      if (!sourceObj) return null;
      const sourceControllerId = String((sourceObj as any)?.controller || (sourceObj as any)?.controllerId || '').trim();
      if (!sourceControllerId) return null;
      const player = (state.players || []).find((p: any) => String(p.id || '').trim() === sourceControllerId) as any;
      if (!player) return null;
      const gy = Array.isArray(player.graveyard) ? player.graveyard : [];
      return countCardsByClasses(gy, classes);
    }
  }

  {
    const m = raw.match(/^x is the number of (.+) cards? in target (?:opponent|player)['’]?s (graveyard|hand|library|exile)$/i);
    if (m) {
      const classes = parseCardClassList(String(m[1] || ''));
      if (!classes) return null;
      const zone = String(m[2] || '').toLowerCase();
      const player = resolveContextPlayer();
      if (!player) return null;

      const cards =
        zone === 'graveyard'
          ? (Array.isArray(player.graveyard) ? player.graveyard : [])
          : zone === 'hand'
            ? (Array.isArray(player.hand) ? player.hand : [])
            : zone === 'library'
              ? (Array.isArray(player.library) ? player.library : [])
              : zone === 'exile'
                ? (Array.isArray(player.exile) ? player.exile : [])
                : null;
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

      const cards =
        zone === 'graveyard'
          ? (Array.isArray(player.graveyard) ? player.graveyard : [])
          : zone === 'hand'
            ? (Array.isArray(player.hand) ? player.hand : [])
            : zone === 'library'
              ? (Array.isArray(player.library) ? player.library : [])
              : zone === 'exile'
                ? (Array.isArray(player.exile) ? player.exile : [])
                : null;
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

  {
    const m = raw.match(/^x is half your life total(?:, rounded (up|down))?$/i);
    if (m) {
      const controller = (state.players || []).find((p: any) => String(p.id || '').trim() === controllerId) as any;
      if (!controller) return null;
      const life = Number(controller.life);
      if (!Number.isFinite(life)) return null;
      const mode = String(m[1] || '').toLowerCase();
      if (mode === 'down') return Math.floor(life / 2);
      return Math.ceil(life / 2);
    }
  }

  {
    const m = raw.match(/^x is (?:that|this|its) creature'?s (power|toughness)$/i);
    if (m) {
      if (!targetCreatureId) return null;
      const target = battlefield.find((p: any) => p.id === targetCreatureId) as any;
      if (!target) return null;
      const which = String(m[1] || '').toLowerCase();
      const rawValue = which === 'power' ? target.power : target.toughness;
      const val = Number(rawValue);
      return Number.isFinite(val) ? val : null;
    }
  }

  {
    const m = raw.match(/^x is its mana value$/i);
    if (m) {
      const sourceId = String(ctx?.sourceId || '').trim();
      const targetId = String(targetCreatureId || '').trim();
      const refId = sourceId || targetId;
      if (!refId) return null;
      const ref = findObjectById(refId);
      if (!ref) return null;
      const mv = getCardManaValue(ref);
      return Number.isFinite(mv as number) ? (mv as number) : null;
    }
  }

  {
    const m = raw.match(/^x is that spell'?s mana value$/i);
    if (m) {
      const sourceId = String(ctx?.sourceId || '').trim();
      if (!sourceId) return null;
      const ref = findObjectById(sourceId);
      if (!ref) return null;
      const mv = getCardManaValue((ref as any)?.spell || (ref as any)?.card || ref);
      return Number.isFinite(mv as number) ? (mv as number) : null;
    }
  }

  {
    const m = raw.match(/^x is the number of colors that spell is$/i);
    if (m) {
      const sourceId = String(ctx?.sourceId || '').trim();
      if (!sourceId) return null;
      const ref = findObjectById(sourceId);
      if (!ref) return null;
      return getColorsFromObject((ref as any)?.spell || (ref as any)?.card || ref).length;
    }
  }

  {
    const m = raw.match(/^x is the number of colors that (creature|card|permanent) was$/i);
    if (m) {
      const sourceId = String(ctx?.sourceId || '').trim();
      if (!sourceId) return null;
      const ref = findObjectById(sourceId);
      if (!ref) return null;

      const subject = String(m[1] || '').toLowerCase();
      const refCard = (ref as any)?.card || ref;
      const tl = typeLineLower(refCard);
      if (subject === 'creature' && !hasExecutorClass(ref, 'creature')) return null;
      if (subject === 'permanent') {
        const isPermanent = hasExecutorClass(ref, 'permanent');
        if (!isPermanent) return null;
      }

      return getColorsFromObject(refCard).length;
    }
  }

  {
    const m = raw.match(/^x is this spell'?s intensity$/i);
    if (m) {
      const sourceId = String(ctx?.sourceId || '').trim();
      if (!sourceId) return null;
      const ref = findObjectById(sourceId);
      if (!ref) return null;
      const n = Number((ref as any)?.intensity ?? (ref as any)?.intensityValue ?? (ref as any)?.card?.intensity ?? (ref as any)?.card?.intensityValue);
      return Number.isFinite(n) ? Math.max(0, n) : null;
    }
  }

  {
    const m = raw.match(/^x is the number of colors of mana spent to cast (?:this|that) spell$/i);
    if (m) {
      const sourceId = String(ctx?.sourceId || '').trim();
      if (!sourceId) return null;
      const ref = findObjectById(sourceId);
      if (!ref) return null;
      return getColorsOfManaSpent(ref);
    }
  }

  {
    const m = raw.match(/^x is the amount of mana spent to cast (?:this|that) spell$/i);
    if (m) {
      const sourceId = String(ctx?.sourceId || '').trim();
      if (!sourceId) return null;
      const ref = findObjectById(sourceId);
      if (!ref) return null;
      return getAmountOfManaSpent(ref);
    }
  }

  {
    const m = raw.match(/^x is the amount of \{([wubrgcs])\} spent to cast (?:this|that) spell$/i);
    if (m) {
      const sourceId = String(ctx?.sourceId || '').trim();
      if (!sourceId) return null;
      const ref = findObjectById(sourceId);
      if (!ref) return null;
      return getAmountOfSpecificManaSymbolSpent(ref, String(m[1] || ''));
    }
  }

  {
    const m = raw.match(
      /^x is the (?:(?:total )?amount of mana paid this way|(?:total )?amount of mana that player paid this way)$/i
    );
    if (m) {
      const sourceId = String(ctx?.sourceId || '').trim();
      if (!sourceId) return null;
      const ref = findObjectById(sourceId);
      if (!ref) return null;
      return getAmountOfManaSpent(ref);
    }
  }

  {
    const m = raw.match(/^x is the amount of \{([wubrgcse])\} paid this way$/i);
    if (m) {
      const sourceId = String(ctx?.sourceId || '').trim();
      if (!sourceId) return null;
      const ref = findObjectById(sourceId);
      if (!ref) return null;
      return getAmountOfSpecificManaSymbolSpent(ref, String(m[1] || ''));
    }
  }

  // ── Generic (colorless numeric) mana in that spell’s mana cost ────────────────────
  {
    const m = raw.match(/^x is the amount of generic mana in (?:that|this) spell['\u2019]?s mana cost$/i);
    if (m) {
      const sourceId = String(ctx?.sourceId || '').trim();
      if (!sourceId) return null;
      const ref = findObjectById(sourceId);
      if (!ref) return null;
      const manaCostStr = String(
        (ref as any)?.manaCost ||
        (ref as any)?.mana_cost ||
        (ref as any)?.card?.manaCost ||
        (ref as any)?.card?.mana_cost ||
        ''
      );
      if (!manaCostStr) return 0;
      let generic = 0;
      for (const mt of manaCostStr.matchAll(/\{(\d+)\}/g)) {
        generic += Number(mt[1]);
      }
      return generic;
    }
  }

  {
    const m = raw.match(/^x is that card'?s mana value$/i);
    if (m) {
      const sourceId = String(ctx?.sourceId || '').trim();
      if (!sourceId) return null;
      const ref = findObjectById(sourceId);
      if (!ref) return null;
      const mv = getCardManaValue((ref as any)?.card || ref);
      return Number.isFinite(mv as number) ? (mv as number) : null;
    }
  }

  {
    const m = raw.match(/^x is (?:the )?(?:mana value of the exiled card|exiled card'?s mana value|revealed card'?s mana value|discarded card'?s mana value)$/i);
    if (m) {
      const sourceId = String(ctx?.sourceId || '').trim();
      if (!sourceId) return null;
      const ref = findObjectById(sourceId);
      if (!ref) return null;
      const mv = getCardManaValue((ref as any)?.card || ref);
      return Number.isFinite(mv as number) ? (mv as number) : null;
    }
  }

  {
    const m = raw.match(/^x is ([a-z0-9 ,.'-]+)'s (power|toughness|mana value|intensity)$/i);
    if (m) {
      const ownerName = String(m[1] || '').trim();
      const which = String(m[2] || '').toLowerCase();
      if (!ownerName) return null;
      const normalizedOwner = normalizeOracleText(ownerName);
      if (
        normalizedOwner === 'this' ||
        normalizedOwner === 'that' ||
        normalizedOwner === 'its' ||
        normalizedOwner === 'it' ||
        /^(?:this|that|its)\s+\w+/.test(normalizedOwner)
      ) {
        // Let dedicated pronoun/antecedent matchers handle these forms.
      } else {
        const ref = findObjectByName(ownerName);
        if (!ref) return null;
        const refCard = (ref as any)?.card || ref;

        if (which === 'intensity') {
          const intensity = Number((ref as any)?.intensity ?? (ref as any)?.intensityValue ?? (refCard as any)?.intensity ?? (refCard as any)?.intensityValue);
          return Number.isFinite(intensity) ? intensity : null;
        }

        if (which === 'mana value') {
          const mv = getCardManaValue(refCard);
          return Number.isFinite(mv as number) ? (mv as number) : null;
        }

        const rawValue = which === 'power'
          ? ((refCard as any)?.power ?? (ref as any)?.power)
          : ((refCard as any)?.toughness ?? (ref as any)?.toughness);
        const n = Number(rawValue);
        return Number.isFinite(n) ? n : null;
      }
    }
  }

  {
    const m = raw.match(/^x is (that|this|its) (creature|permanent|artifact|enchantment|planeswalker|card)'?s (power|toughness|mana value|intensity)$/i);
    if (m) {
      const refWord = String(m[1] || '').toLowerCase();
      const objectWord = String(m[2] || '').toLowerCase();
      const statWord = String(m[3] || '').toLowerCase();

      let refId = '';
      if (refWord === 'that' && objectWord === 'creature' && targetCreatureId) {
        refId = String(targetCreatureId);
      } else if ((refWord === 'this' || refWord === 'its') && String(ctx?.sourceId || '').trim()) {
        refId = String(ctx?.sourceId || '').trim();
      } else if (targetCreatureId) {
        refId = String(targetCreatureId);
      }

      if (!refId) return null;
      const target = battlefield.find((p: any) => String(p?.id || '').trim() === refId) as any;
      if (!target) return null;

      if (statWord === 'mana value') {
        return getCardManaValue(target?.card || target);
      }

      if (statWord === 'intensity') {
        const intensity = Number(target?.intensity ?? target?.intensityValue ?? target?.card?.intensity ?? target?.card?.intensityValue);
        return Number.isFinite(intensity) ? intensity : null;
      }

      const rawValue = statWord === 'power' ? target.power : target.toughness;
      const val = Number(rawValue);
      return Number.isFinite(val) ? val : null;
    }
  }

  {
    const m = raw.match(/^x is its (power|toughness)$/i);
    if (m) {
      if (!targetCreatureId) return null;
      const target = battlefield.find((p: any) => p.id === targetCreatureId) as any;
      if (!target) return null;
      const which = String(m[1] || '').toLowerCase();
      const rawValue = which === 'power' ? target.power : target.toughness;
      const val = Number(rawValue);
      return Number.isFinite(val) ? val : null;
    }
  }

  {
    const m = raw.match(/^x is the number of ([+\-\d/]+|[a-z][a-z0-9+\-/ ]*) counters on (?:this|that|it)(?: (creature|artifact|enchantment|planeswalker|permanent|card))?$/i);
    if (m) {
      const counterType = String(m[1] || '').toLowerCase().trim();
      const objectWord = String(m[2] || '').toLowerCase().trim();
      const sourceId = String(ctx?.sourceId || '').trim();
      let targetId: string | undefined;
      if (objectWord === 'creature') {
        targetId = targetCreatureId || sourceId || undefined;
      } else if (objectWord) {
        targetId = sourceId || targetCreatureId || undefined;
      } else {
        targetId = targetCreatureId || sourceId || undefined;
      }
      if (!targetId || !counterType) return null;
      const target = battlefield.find((p: any) => String(p?.id || '').trim() === targetId) as any;
      if (!target) return null;
      const counters = (target as any)?.counters;
      if (!counters || typeof counters !== 'object') return 0;
      const value = Number((counters as any)[counterType]);
      return Number.isFinite(value) ? Math.max(0, value) : 0;
    }
  }

  {
    const m = raw.match(/^x is the number of counters on (?:this|that) creature$/i);
    if (m) {
      const targetId = targetCreatureId || String(ctx?.sourceId || '').trim() || undefined;
      if (!targetId) return null;
      const target = battlefield.find((p: any) => p.id === targetId) as any;
      if (!target) return null;
      const counters = (target as any).counters;
      if (!counters || typeof counters !== 'object') return 0;
      return (Object.values(counters) as any[]).reduce((sum: number, v: any) => {
        const n = Number(v);
        return sum + (Number.isFinite(n) ? Math.max(0, n) : 0);
      }, 0);
    }
  }

  {
    const m = raw.match(/^x is the (?:greatest|highest) (power|toughness) among creatures on (?:the )?battlefield$/i);
    if (m) {
      const which = String(m[1] || '').toLowerCase();
      let greatest = 0;
      for (const p of battlefield as any[]) {
        if (!hasExecutorClass(p, 'creature')) continue;
        const n = Number(which === 'power' ? p?.power : p?.toughness);
        if (Number.isFinite(n)) greatest = Math.max(greatest, n);
      }
      return greatest;
    }
  }

  {
    const m = raw.match(/^x is the (?:greatest|highest) (power|toughness) among other creatures on (?:the )?battlefield$/i);
    if (m) {
      const which = String(m[1] || '').toLowerCase();
      const excludedId = String(targetCreatureId || ctx?.sourceId || '').trim();
      let greatest = 0;
      for (const p of battlefield as any[]) {
        const id = String((p as any)?.id || '').trim();
        if (excludedId && id === excludedId) continue;
        if (!hasExecutorClass(p, 'creature')) continue;
        const n = Number(which === 'power' ? p?.power : p?.toughness);
        if (Number.isFinite(n)) greatest = Math.max(greatest, n);
      }
      return greatest;
    }
  }

  {
    const m = raw.match(/^x is the (?:greatest|highest) (?:mana value|converted mana cost) among (other )?non[- ]?([a-z][a-z-]*) permanents you control$/i);
    if (m) {
      const isOther = Boolean(String(m[1] || '').trim());
      const excludedQualifier = String(m[2] || '').toLowerCase();
      const excludedId = isOther ? String(targetCreatureId || ctx?.sourceId || '').trim() : '';
      let greatest = 0;
      for (const p of controlled as any[]) {
        const id = String((p as any)?.id || '').trim();
        if (excludedId && id === excludedId) continue;
        const tl = typeLineLower(p);
        if (excludedQualifier && tl.includes(excludedQualifier)) continue;
        const mv = getCardManaValue(p?.card || p);
        if (mv !== null) greatest = Math.max(greatest, mv);
      }
      return greatest;
    }
  }

  {
    const m = raw.match(/^x is the (?:greatest|highest) (?:mana value|converted mana cost) among (other )?non[- ]?([a-z][a-z-]*) permanents (?:your opponents control|an opponent controls|you don['’]?t control|you do not control)$/i);
    if (m) {
      const isOther = Boolean(String(m[1] || '').trim());
      const excludedQualifier = String(m[2] || '').toLowerCase();
      const excludedId = isOther ? String(targetCreatureId || ctx?.sourceId || '').trim() : '';
      let greatest = 0;
      for (const p of opponentsControlled as any[]) {
        const id = String((p as any)?.id || '').trim();
        if (excludedId && id === excludedId) continue;
        const tl = typeLineLower(p);
        if (excludedQualifier && tl.includes(excludedQualifier)) continue;
        const mv = getCardManaValue(p?.card || p);
        if (mv !== null) greatest = Math.max(greatest, mv);
      }
      return greatest;
    }
  }

  {
    const m = raw.match(/^x is the (?:greatest|highest) (?:mana value|converted mana cost) among (other )?non[- ]?([a-z][a-z-]*) permanents on (?:the )?battlefield$/i);
    if (m) {
      const isOther = Boolean(String(m[1] || '').trim());
      const excludedQualifier = String(m[2] || '').toLowerCase();
      const excludedId = isOther ? String(targetCreatureId || ctx?.sourceId || '').trim() : '';
      let greatest = 0;
      for (const p of battlefield as any[]) {
        const id = String((p as any)?.id || '').trim();
        if (excludedId && id === excludedId) continue;
        const tl = typeLineLower(p);
        if (excludedQualifier && tl.includes(excludedQualifier)) continue;
        const mv = getCardManaValue(p?.card || p);
        if (mv !== null) greatest = Math.max(greatest, mv);
      }
      return greatest;
    }
  }

  {
    const m = raw.match(/^x is the (?:greatest|highest) (?:mana value|converted mana cost) among permanents on (?:the )?battlefield$/i);
    if (m) {
      let greatest = 0;
      for (const p of battlefield as any[]) {
        const mv = getCardManaValue(p?.card || p);
        if (mv !== null) greatest = Math.max(greatest, mv);
      }
      return greatest;
    }
  }

  {
    const m = raw.match(/^x is the (?:greatest|highest) (?:mana value|converted mana cost) among other permanents on (?:the )?battlefield$/i);
    if (m) {
      const excludedId = String(targetCreatureId || ctx?.sourceId || '').trim();
      let greatest = 0;
      for (const p of battlefield as any[]) {
        const id = String((p as any)?.id || '').trim();
        if (excludedId && id === excludedId) continue;
        const mv = getCardManaValue(p?.card || p);
        if (mv !== null) greatest = Math.max(greatest, mv);
      }
      return greatest;
    }
  }

  {
    const m = raw.match(/^x is the (?:greatest|highest) (?:mana value|converted mana cost) among other permanents you control$/i);
    if (m) {
      const excludedId = String(targetCreatureId || ctx?.sourceId || '').trim();
      let greatest = 0;
      for (const p of controlled as any[]) {
        const id = String((p as any)?.id || '').trim();
        if (excludedId && id === excludedId) continue;
        const mv = getCardManaValue(p?.card || p);
        if (mv !== null) greatest = Math.max(greatest, mv);
      }
      return greatest;
    }
  }

  {
    const m = raw.match(/^x is the (?:greatest|highest) (?:mana value|converted mana cost) among other permanents (?:your opponents control|an opponent controls|you don['’]?t control|you do not control)$/i);
    if (m) {
      const excludedId = String(targetCreatureId || ctx?.sourceId || '').trim();
      let greatest = 0;
      for (const p of opponentsControlled as any[]) {
        const id = String((p as any)?.id || '').trim();
        if (excludedId && id === excludedId) continue;
        const mv = getCardManaValue(p?.card || p);
        if (mv !== null) greatest = Math.max(greatest, mv);
      }
      return greatest;
    }
  }

  {
    const m = raw.match(/^x is the (?:greatest|highest) (?:mana value|converted mana cost) among artifacts you control$/i);
    if (m) {
      let greatest = 0;
      for (const p of controlled as any[]) {
        if (!hasExecutorClass(p, 'artifact')) continue;
        const mv = getCardManaValue((p as any)?.card || p);
        if (mv !== null) greatest = Math.max(greatest, mv);
      }
      return greatest;
    }
  }

  {
    const m = raw.match(/^x is the greatest number of creatures you control that have a creature type in common$/i);
    if (m) {
      const subtypeCounts = new Map<string, number>();
      for (const p of controlled as any[]) {
        if (!hasExecutorClass(p, 'creature')) continue;
        const subtypeSet = new Set(getCreatureSubtypeKeys(p));
        for (const subtype of subtypeSet) {
          subtypeCounts.set(subtype, (subtypeCounts.get(subtype) || 0) + 1);
        }
      }
      let greatest = 0;
      for (const count of subtypeCounts.values()) {
        if (count > greatest) greatest = count;
      }
      return greatest;
    }
  }

  {
    const m = raw.match(/^x is the (?:greatest|highest) (?:mana value|converted mana cost) among permanents you control$/i);
    if (m) {
      let greatest = 0;
      for (const p of controlled as any[]) {
        const mv = getCardManaValue(p?.card || p);
        if (mv !== null) greatest = Math.max(greatest, mv);
      }
      return greatest;
    }
  }

  {
    const m = raw.match(/^x is the (?:greatest|highest) (?:mana value|converted mana cost) among permanents (?:your opponents control|an opponent controls|you don['’]?t control|you do not control)$/i);
    if (m) {
      let greatest = 0;
      for (const p of opponentsControlled as any[]) {
        const mv = getCardManaValue(p?.card || p);
        if (mv !== null) greatest = Math.max(greatest, mv);
      }
      return greatest;
    }
  }

  {
    const m = raw.match(/^x is the (?:least|lowest|smallest) (power|toughness) among creatures you control$/i);
    if (m) {
      const which = String(m[1] || '').toLowerCase() as 'power' | 'toughness';
      return leastStatAmongCreatures(controlled, which);
    }
  }

  {
    const m = raw.match(/^x is the (?:least|lowest|smallest) (power|toughness) among creatures (?:your opponents control|an opponent controls|you don['’]?t control|you do not control)$/i);
    if (m) {
      const which = String(m[1] || '').toLowerCase() as 'power' | 'toughness';
      return leastStatAmongCreatures(opponentsControlled, which);
    }
  }

  {
    const m = raw.match(/^x is the (?:least|lowest|smallest) (power|toughness) among creatures on (?:the )?battlefield$/i);
    if (m) {
      const which = String(m[1] || '').toLowerCase() as 'power' | 'toughness';
      return leastStatAmongCreatures(battlefield, which);
    }
  }

  {
    const m = raw.match(/^x is the (?:least|lowest|smallest) (power|toughness) among other creatures you control$/i);
    if (m) {
      const which = String(m[1] || '').toLowerCase() as 'power' | 'toughness';
      const excludedId = String(targetCreatureId || ctx?.sourceId || '').trim();
      return leastStatAmongCreatures(controlled, which, { excludedId: excludedId || undefined });
    }
  }

  {
    const m = raw.match(/^x is the (?:least|lowest|smallest) (power|toughness) among other creatures (?:your opponents control|an opponent controls|you don['’]?t control|you do not control)$/i);
    if (m) {
      const which = String(m[1] || '').toLowerCase() as 'power' | 'toughness';
      const excludedId = String(targetCreatureId || ctx?.sourceId || '').trim();
      return leastStatAmongCreatures(opponentsControlled, which, { excludedId: excludedId || undefined });
    }
  }

  {
    const m = raw.match(/^x is the (?:least|lowest|smallest) (power|toughness) among other creatures on (?:the )?battlefield$/i);
    if (m) {
      const which = String(m[1] || '').toLowerCase() as 'power' | 'toughness';
      const excludedId = String(targetCreatureId || ctx?.sourceId || '').trim();
      return leastStatAmongCreatures(battlefield, which, { excludedId: excludedId || undefined });
    }
  }

  {
    const m = raw.match(/^x is the (?:least|lowest|smallest) (power|toughness) among (other )?non[- ]?([a-z][a-z-]*) creatures you control$/i);
    if (m) {
      const which = String(m[1] || '').toLowerCase() as 'power' | 'toughness';
      const isOther = Boolean(String(m[2] || '').trim());
      const excludedSubtype = String(m[3] || '').toLowerCase();
      const excludedId = isOther ? String(targetCreatureId || ctx?.sourceId || '').trim() : '';
      return leastStatAmongCreatures(controlled, which, { excludedId: excludedId || undefined, excludedSubtype });
    }
  }

  {
    const m = raw.match(/^x is the (?:least|lowest|smallest) (power|toughness) among (other )?non[- ]?([a-z][a-z-]*) creatures (?:your opponents control|an opponent controls|you don['’]?t control|you do not control)$/i);
    if (m) {
      const which = String(m[1] || '').toLowerCase() as 'power' | 'toughness';
      const isOther = Boolean(String(m[2] || '').trim());
      const excludedSubtype = String(m[3] || '').toLowerCase();
      const excludedId = isOther ? String(targetCreatureId || ctx?.sourceId || '').trim() : '';
      return leastStatAmongCreatures(opponentsControlled, which, { excludedId: excludedId || undefined, excludedSubtype });
    }
  }

  {
    const m = raw.match(/^x is the (?:least|lowest|smallest) (power|toughness) among (other )?non[- ]?([a-z][a-z-]*) creatures on (?:the )?battlefield$/i);
    if (m) {
      const which = String(m[1] || '').toLowerCase() as 'power' | 'toughness';
      const isOther = Boolean(String(m[2] || '').trim());
      const excludedSubtype = String(m[3] || '').toLowerCase();
      const excludedId = isOther ? String(targetCreatureId || ctx?.sourceId || '').trim() : '';
      return leastStatAmongCreatures(battlefield, which, { excludedId: excludedId || undefined, excludedSubtype });
    }
  }

  {
    const m = raw.match(/^x is the (?:least|lowest|smallest) (?:mana value|converted mana cost) among other permanents you control$/i);
    if (m) {
      const excludedId = String(targetCreatureId || ctx?.sourceId || '').trim();
      return lowestManaValueAmongPermanents(controlled, { excludedId: excludedId || undefined });
    }
  }

  {
    const m = raw.match(/^x is the (?:least|lowest|smallest) (?:mana value|converted mana cost) among other permanents (?:your opponents control|an opponent controls|you don['’]?t control|you do not control)$/i);
    if (m) {
      const excludedId = String(targetCreatureId || ctx?.sourceId || '').trim();
      return lowestManaValueAmongPermanents(opponentsControlled, { excludedId: excludedId || undefined });
    }
  }

  {
    const m = raw.match(/^x is the (?:least|lowest|smallest) (?:mana value|converted mana cost) among other permanents on (?:the )?battlefield$/i);
    if (m) {
      const excludedId = String(targetCreatureId || ctx?.sourceId || '').trim();
      return lowestManaValueAmongPermanents(battlefield, { excludedId: excludedId || undefined });
    }
  }

  {
    const m = raw.match(/^x is the (?:least|lowest|smallest) (?:mana value|converted mana cost) among (other )?non[- ]?([a-z][a-z-]*) permanents you control$/i);
    if (m) {
      const isOther = Boolean(String(m[1] || '').trim());
      const excludedQualifier = String(m[2] || '').toLowerCase();
      const excludedId = isOther ? String(targetCreatureId || ctx?.sourceId || '').trim() : '';
      return lowestManaValueAmongPermanents(controlled, {
        excludedId: excludedId || undefined,
        excludedQualifier,
      });
    }
  }

  {
    const m = raw.match(/^x is the (?:least|lowest|smallest) (?:mana value|converted mana cost) among (other )?non[- ]?([a-z][a-z-]*) permanents (?:your opponents control|an opponent controls|you don['’]?t control|you do not control)$/i);
    if (m) {
      const isOther = Boolean(String(m[1] || '').trim());
      const excludedQualifier = String(m[2] || '').toLowerCase();
      const excludedId = isOther ? String(targetCreatureId || ctx?.sourceId || '').trim() : '';
      return lowestManaValueAmongPermanents(opponentsControlled, {
        excludedId: excludedId || undefined,
        excludedQualifier,
      });
    }
  }

  {
    const m = raw.match(/^x is the (?:least|lowest|smallest) (?:mana value|converted mana cost) among (other )?non[- ]?([a-z][a-z-]*) permanents on (?:the )?battlefield$/i);
    if (m) {
      const isOther = Boolean(String(m[1] || '').trim());
      const excludedQualifier = String(m[2] || '').toLowerCase();
      const excludedId = isOther ? String(targetCreatureId || ctx?.sourceId || '').trim() : '';
      return lowestManaValueAmongPermanents(battlefield, {
        excludedId: excludedId || undefined,
        excludedQualifier,
      });
    }
  }

  {
    const m = raw.match(/^x is the (?:least|lowest|smallest) (?:mana value|converted mana cost) among permanents you control$/i);
    if (m) {
      return lowestManaValueAmongPermanents(controlled);
    }
  }

  {
    const m = raw.match(/^x is the (?:least|lowest|smallest) (?:mana value|converted mana cost) among permanents (?:your opponents control|an opponent controls|you don['’]?t control|you do not control)$/i);
    if (m) {
      return lowestManaValueAmongPermanents(opponentsControlled);
    }
  }

  {
    const m = raw.match(/^x is the (?:least|lowest|smallest) (?:mana value|converted mana cost) among permanents on (?:the )?battlefield$/i);
    if (m) {
      return lowestManaValueAmongPermanents(battlefield);
    }
  }

  {
    const m = raw.match(/^x is the (?:greatest|highest) (power|toughness) among (other )?non[- ]?([a-z][a-z-]*) creatures you control$/i);
    if (m) {
      const which = String(m[1] || '').toLowerCase();
      const isOther = Boolean(String(m[2] || '').trim());
      const excludedSubtype = String(m[3] || '').toLowerCase();
      const excludedId = isOther ? String(targetCreatureId || ctx?.sourceId || '').trim() : '';
      let greatest = 0;
      for (const p of controlled as any[]) {
        const id = String((p as any)?.id || '').trim();
        if (excludedId && id === excludedId) continue;
        const tl = typeLineLower(p);
        if (!hasExecutorClass(p, 'creature')) continue;
        if (excludedSubtype && tl.includes(excludedSubtype)) continue;
        const n = Number(which === 'power' ? p?.power : p?.toughness);
        if (Number.isFinite(n)) greatest = Math.max(greatest, n);
      }
      return greatest;
    }
  }

  {
    const m = raw.match(/^x is the (?:greatest|highest) (power|toughness) among (other )?non[- ]?([a-z][a-z-]*) creatures (?:your opponents control|an opponent controls|you don['’]?t control|you do not control)$/i);
    if (m) {
      const which = String(m[1] || '').toLowerCase();
      const isOther = Boolean(String(m[2] || '').trim());
      const excludedSubtype = String(m[3] || '').toLowerCase();
      const excludedId = isOther ? String(targetCreatureId || ctx?.sourceId || '').trim() : '';
      let greatest = 0;
      for (const p of opponentsControlled as any[]) {
        const id = String((p as any)?.id || '').trim();
        if (excludedId && id === excludedId) continue;
        const tl = typeLineLower(p);
        if (!hasExecutorClass(p, 'creature')) continue;
        if (excludedSubtype && tl.includes(excludedSubtype)) continue;
        const n = Number(which === 'power' ? p?.power : p?.toughness);
        if (Number.isFinite(n)) greatest = Math.max(greatest, n);
      }
      return greatest;
    }
  }

  {
    const m = raw.match(/^x is the (?:greatest|highest) (power|toughness) among (other )?non[- ]?([a-z][a-z-]*) creatures on (?:the )?battlefield$/i);
    if (m) {
      const which = String(m[1] || '').toLowerCase();
      const isOther = Boolean(String(m[2] || '').trim());
      const excludedSubtype = String(m[3] || '').toLowerCase();
      const excludedId = isOther ? String(targetCreatureId || ctx?.sourceId || '').trim() : '';
      let greatest = 0;
      for (const p of battlefield as any[]) {
        const id = String((p as any)?.id || '').trim();
        if (excludedId && id === excludedId) continue;
        const tl = typeLineLower(p);
        if (!hasExecutorClass(p, 'creature')) continue;
        if (excludedSubtype && tl.includes(excludedSubtype)) continue;
        const n = Number(which === 'power' ? p?.power : p?.toughness);
        if (Number.isFinite(n)) greatest = Math.max(greatest, n);
      }
      return greatest;
    }
  }

  {
    const m = raw.match(/^x is the (?:greatest|highest) (power|toughness) among other creatures you control$/i);
    if (m) {
      const which = String(m[1] || '').toLowerCase();
      const excludedId = String(targetCreatureId || ctx?.sourceId || '').trim();
      let greatest = 0;
      for (const p of controlled as any[]) {
        const id = String((p as any)?.id || '').trim();
        if (excludedId && id === excludedId) continue;
        if (!hasExecutorClass(p, 'creature')) continue;
        const n = Number(which === 'power' ? p?.power : p?.toughness);
        if (Number.isFinite(n)) greatest = Math.max(greatest, n);
      }
      return greatest;
    }
  }

  {
    const m = raw.match(/^x is the (?:greatest|highest) (power|toughness) among other creatures (?:your opponents control|an opponent controls|you don['’]?t control|you do not control)$/i);
    if (m) {
      const which = String(m[1] || '').toLowerCase();
      const excludedId = String(targetCreatureId || ctx?.sourceId || '').trim();
      let greatest = 0;
      for (const p of opponentsControlled as any[]) {
        const id = String((p as any)?.id || '').trim();
        if (excludedId && id === excludedId) continue;
        if (!hasExecutorClass(p, 'creature')) continue;
        const n = Number(which === 'power' ? p?.power : p?.toughness);
        if (Number.isFinite(n)) greatest = Math.max(greatest, n);
      }
      return greatest;
    }
  }

  {
    const m = raw.match(/^x is the (?:greatest|highest) (power|toughness) among creatures you control$/i);
    if (m) {
      const which = String(m[1] || '').toLowerCase();
      let greatest = 0;
      for (const p of controlled as any[]) {
        if (!hasExecutorClass(p, 'creature')) continue;
        const n = Number(which === 'power' ? p?.power : p?.toughness);
        if (Number.isFinite(n)) greatest = Math.max(greatest, n);
      }
      return greatest;
    }
  }

  {
    const m = raw.match(/^x is the (?:greatest|highest) (power|toughness) among creatures (?:your opponents control|an opponent controls|you don['’]?t control|you do not control)$/i);
    if (m) {
      const which = String(m[1] || '').toLowerCase();
      let greatest = 0;
      for (const p of opponentsControlled as any[]) {
        if (!hasExecutorClass(p, 'creature')) continue;
        const n = Number(which === 'power' ? p?.power : p?.toughness);
        if (Number.isFinite(n)) greatest = Math.max(greatest, n);
      }
      return greatest;
    }
  }

  {
    const m = raw.match(/^x is the number of (?:(nonland permanent|permanent|artifact|battle|creature|enchantment|instant|land|planeswalker|sorcery) )?cards? exiled with this (?:permanent|creature|artifact|enchantment|planeswalker|card)?$/i);
    if (m) {
      const sourceId = String(ctx?.sourceId || '').trim();
      if (!sourceId) return null;
      return countCardsExiledWithSource(state, sourceId, m[1]);
    }
  }

  // ── Cards exiled by a named permanent ────────────────────────────────────────
  {
    const m = raw.match(/^x is the number of (?:(nonland permanent|permanent|artifact|battle|creature|enchantment|instant|land|planeswalker|sorcery) )?cards? exiled with (?!this\b)([a-z][a-z0-9 ,.'\u2019-]*)$/i);
    if (m) {
      const wantedName = normalizeOracleText(String(m[2] || ''));
      if (!wantedName) return null;
      const namedPermanent = (battlefield as any[]).find((p: any) => {
        const name = normalizeOracleText(String((p as any)?.name || (p as any)?.card?.name || ''));
        return Boolean(name && name === wantedName);
      });
      const namedId = String((namedPermanent as any)?.id || '').trim();
      if (!namedId) return null;

      return countCardsExiledWithSource(state, namedId, m[1]);
    }
  }

  // ── Greatest power/toughness among [subtype] you/they control ─────────────
  {
    const m = raw.match(/^x is the (?:greatest|highest) (power|toughness) among ([\w]+(?:\s+[\w]+)*?)\s+(?:you control|they control|your opponents control|an opponent controls)$/i);
    if (m) {
      const which = String(m[1] || '').toLowerCase() as 'power' | 'toughness';
      const subtypeRaw = String(m[2] || '').trim().toLowerCase();
      const controllerClause = String(m[0] || '').toLowerCase();
      const pool = /they control|your opponents control|an opponent controls/.test(controllerClause)
        ? opponentsControlled
        : controlled;
      let greatest = 0;
      for (const p of pool as any[]) {
        const tl = typeLineLower(p);
        if (!hasExecutorClass(p, 'creature')) continue;
        const subtypes = getCreatureSubtypeKeys(p);
        if (!subtypes.some(s => s === subtypeRaw || subtypeRaw.startsWith(s) || s.startsWith(subtypeRaw.replace(/s$/, '')))) continue;
        const n = Number(which === 'power' ? p?.power : p?.toughness);
        if (Number.isFinite(n)) greatest = Math.max(greatest, n);
      }
      return greatest;
    }
  }

  // ── Greatest power among other attacking creatures ─────────────────────────
  {
    const m = raw.match(/^x is the (?:greatest|highest) (power|toughness) among other attacking creatures$/i);
    if (m) {
      const which = String(m[1] || '').toLowerCase();
      const excludedId = String(targetCreatureId || ctx?.sourceId || '').trim();
      let greatest = 0;
      for (const p of controlled as any[]) {
        const id = String((p as any)?.id || '').trim();
        if (excludedId && id === excludedId) continue;
        if (!hasExecutorClass(p, 'creature')) continue;
        if (!isAttackingObject(p)) continue;
        const n = Number(which === 'power' ? (p as any)?.power : (p as any)?.toughness);
        if (Number.isFinite(n)) greatest = Math.max(greatest, n);
      }
      return greatest;
    }
  }

  // ── Greatest power among tapped creatures opponents control ────────────────
  {
    const m = raw.match(/^x is the (?:greatest|highest) (power|toughness) among tapped creatures (?:your opponents control|an opponent controls|you don['']?t control|you do not control)$/i);
    if (m) {
      const which = String(m[1] || '').toLowerCase();
      let greatest = 0;
      for (const p of opponentsControlled as any[]) {
        if (!hasExecutorClass(p, 'creature')) continue;
        if (!(p as any)?.tapped && !(p as any)?.isTapped) continue;
        const n = Number(which === 'power' ? (p as any)?.power : (p as any)?.toughness);
        if (Number.isFinite(n)) greatest = Math.max(greatest, n);
      }
      return greatest;
    }
  }

  // ── Greatest power among creature cards in graveyard ──────────────────────
  {
    const m = raw.match(/^x is the (?:greatest|highest) power among creature cards? in (?:your graveyard|all graveyards|(?:your opponents?|their) graveyard)$/i);
    if (m) {
      const clause = String(m[0] || '').toLowerCase();
      const allGy = /all graveyards/.test(clause);
      let greatest = 0;
      for (const player of (state.players || []) as any[]) {
        const pid = String((player as any)?.id || '').trim();
        if (!allGy && pid !== controllerId) continue;
        const gy = Array.isArray((player as any)?.graveyard) ? (player as any).graveyard : [];
        for (const card of gy as any[]) {
          const tl = typeLineLower(card);
          if (!tl.includes('creature')) continue;
          const n = Number((card as any)?.power ?? (card as any)?.card?.power);
          if (Number.isFinite(n)) greatest = Math.max(greatest, n);
        }
      }
      return greatest;
    }
  }

  // ── Greatest power among creature cards exiled this way ───────────────────
  {
    const m = raw.match(/^x is the (?:greatest|highest) power among creature cards? exiled this way$/i);
    if (m) {
      const runtimeCards = Array.isArray(runtime?.lastExiledCards) ? runtime.lastExiledCards : null;
      if (runtimeCards) {
        let greatest = 0;
        for (const card of runtimeCards as any[]) {
          const tl = typeLineLower(card);
          if (!tl.includes('creature')) continue;
          const n = Number((card as any)?.power ?? (card as any)?.card?.power);
          if (Number.isFinite(n)) greatest = Math.max(greatest, n);
        }
        return greatest;
      }

      const sourceId = String(ctx?.sourceId || '').trim();
      let greatest = 0;
      for (const player of (state.players || []) as any[]) {
        const exile = Array.isArray((player as any)?.exile) ? (player as any).exile : [];
        for (const card of exile as any[]) {
          if (sourceId && String((card as any)?.exiledBy || '').trim() !== sourceId) continue;
          const tl = typeLineLower(card);
          if (!tl.includes('creature')) continue;
          const n = Number((card as any)?.power ?? (card as any)?.card?.power);
          if (Number.isFinite(n)) greatest = Math.max(greatest, n);
        }
      }
      return greatest;
    }
  }

  // ── Greatest MV among cards in graveyard / discarded this way / exiled this way ──
  {
    const m = raw.match(/^x is the (?:greatest|highest) mana value among cards? (?:in your graveyard|discarded this way|exiled this way)$/i);
    if (m) {
      const clause = String(m[0] || '').toLowerCase();
      if (/exiled this way/.test(clause) && Array.isArray(runtime?.lastExiledCards)) {
        let greatest = 0;
        for (const card of runtime.lastExiledCards as any[]) {
          const mv = getCardManaValue((card as any)?.card || card);
          if (mv !== null) greatest = Math.max(greatest, mv);
        }
        return greatest;
      }

      const sourceId = String(ctx?.sourceId || '').trim();
      let greatest = 0;
      for (const player of (state.players || []) as any[]) {
        const pid = String((player as any)?.id || '').trim();
        if (pid !== controllerId) continue;
        const isExile = /exiled this way/.test(clause);
        const zone: readonly any[] = isExile
          ? (Array.isArray((player as any)?.exile) ? (player as any).exile : [])
          : (Array.isArray((player as any)?.graveyard) ? (player as any).graveyard : []);
        for (const card of zone as any[]) {
          if (isExile && sourceId && String((card as any)?.exiledBy || '').trim() !== sourceId) continue;
          const mv = getCardManaValue((card as any)?.card || card);
          if (mv !== null) greatest = Math.max(greatest, mv);
        }
      }
      return greatest;
    }
  }

  // ── Greatest MV among elementals you control ──────────────────────────────
  {
    const m = raw.match(/^x is the (?:greatest|highest) mana value among elementals? you control$/i);
    if (m) {
      let greatest = 0;
      for (const p of controlled as any[]) {
        const subtypes = getCreatureSubtypeKeys(p);
        if (!subtypes.includes('elemental')) continue;
        const mv = getCardManaValue((p as any)?.card || p);
        if (mv !== null) greatest = Math.max(greatest, mv);
      }
      return greatest;
    }
  }

  // ── Greatest MV among other artifacts you control ────────────────────────
  {
    const m = raw.match(/^x is the (?:greatest|highest) mana value among other artifacts? you control$/i);
    if (m) {
      const excludedId = String(targetCreatureId || ctx?.sourceId || '').trim();
      let greatest = 0;
      for (const p of controlled as any[]) {
        const id = String((p as any)?.id || '').trim();
        if (excludedId && id === excludedId) continue;
        if (!hasExecutorClass(p, 'artifact')) continue;
        const mv = getCardManaValue((p as any)?.card || p);
        if (mv !== null) greatest = Math.max(greatest, mv);
      }
      return greatest;
    }
  }

  // ── Greatest MV among your commanders ────────────────────────────────────
  {
    const m = raw.match(/^x is the (?:greatest|highest) mana value among (?:your |the )?commanders?$/i);
    if (m) {
      let greatest = 0;
      for (const p of controlled as any[]) {
        if (!isCommanderObject(p)) continue;
        const mv = getCardManaValue((p as any)?.card || p);
        if (mv !== null) greatest = Math.max(greatest, mv);
      }
      for (const obj of collectCommandZoneObjects()) {
        const ownerId = String((obj as any)?.ownerId || (obj as any)?.owner || (obj as any)?.controllerId || '').trim();
        if (ownerId && ownerId !== controllerId) continue;
        if (!isCommanderObject(obj)) continue;
        const mv = getCardManaValue((obj as any)?.card || obj);
        if (mv !== null) greatest = Math.max(greatest, mv);
      }
      return greatest;
    }
  }

  // ── Greatest MV among instant and sorcery spells you've cast this turn ────
  {
    const m = raw.match(/^x is the (?:greatest|highest) mana value among instant(?:\s+and\s+sorcery)?\s+(?:and sorcery\s+)?spells? (?:you(?:'ve)? cast|cast) (?:from\s+.+\s+)?this turn$/i);
    if (m) {
      const spells: readonly any[] = Array.isArray((state as any)?.spellsCastThisTurn)
        ? (state as any).spellsCastThisTurn
        : [];
      let greatest = 0;
      for (const spell of spells as any[]) {
        const spellControllerId = String((spell as any)?.controllerId || (spell as any)?.controller || '').trim();
        if (spellControllerId && spellControllerId !== controllerId) continue;
        const tl = typeLineLower(spell);
        if (!tl.includes('instant') && !tl.includes('sorcery')) continue;
        const mv = getCardManaValue((spell as any)?.card || spell);
        if (mv !== null) greatest = Math.max(greatest, mv);
      }
      return greatest;
    }
  }

  // ── Greatest number of artifacts an opponent controls ─────────────────────
  {
    const m = raw.match(/^x is the greatest number of artifacts? (?:an? )?opponent(?:s?) controls?$/i);
    if (m) {
      const opponentIds = (state.players || [])
        .map((p: any) => String((p as any)?.id || '').trim())
        .filter(pid => pid.length > 0 && pid !== controllerId);
      let greatest = 0;
      for (const opponentId of opponentIds) {
        const oppArts = battlefield.filter((p: any) =>
          String((p as any)?.controller || '').trim() === opponentId &&
          hasExecutorClass(p, 'artifact')
        );
        if (oppArts.length > greatest) greatest = oppArts.length;
      }
      return greatest;
    }
  }

  // ── Number of [type] counters on [named card] ────────────────────────────
  {
    const m = raw.match(/^x is (?:the number of|the amount of) (.+?) counters? on ([a-z0-9][a-z0-9 ,'.-]{2,60})$/i);
    if (m) {
      const counterType = String(m[1] || '').trim();
      const cardName = String(m[2] || '').trim();
      const ref = findObjectByName(cardName);
      if (!ref) return null;
      return getCounterCountOnObject(ref, counterType);
    }
  }

  // ── Difference between power and toughness ────────────────────────────────
  {
    const m = raw.match(/^x is the difference between (?:its|that creature'?s|this creature'?s) power and toughness$/i);
    if (m) {
      const refId = String(targetCreatureId || ctx?.sourceId || '').trim();
      if (!refId) return null;
      const target = battlefield.find((p: any) => String((p as any)?.id || '').trim() === refId) as any;
      if (!target) return null;
      const pw = Number(target?.power);
      const tg = Number(target?.toughness);
      if (!Number.isFinite(pw) || !Number.isFinite(tg)) return null;
      return Math.abs(pw - tg);
    }
  }

  // ── Loyalty stat of a named planeswalker ─────────────────────────────────
  {
    const m = raw.match(/^x is ([a-z0-9 ,.'-]+)'s loyalty$/i);
    if (m) {
      const walkerName = String(m[1] || '').trim();
      const ref = findObjectByName(walkerName) as any;
      if (!ref) return null;
      const loyalty = Number(ref?.loyalty ?? ref?.card?.loyalty ?? ref?.loyaltyCounters ?? ref?.counters?.loyalty);
      return Number.isFinite(loyalty) ? loyalty : null;
    }
  }

  // ── Difference between those players’ life totals ───────────────────────────────────
  {
    const m = raw.match(/^x is the difference between those players['’] life totals?$/i);
    if (m) {
      const ids: readonly string[] = Array.isArray(ctx?.selectorContext?.eachOfThoseOpponents)
        ? (ctx?.selectorContext?.eachOfThoseOpponents || []).map(id => String(id || '').trim()).filter(Boolean)
        : [];
      if (ids.length < 2) return null;

      const lifes: number[] = [];
      for (const pid of ids.slice(0, 2)) {
        const player = (state.players || []).find((p: any) => String((p as any)?.id || '').trim() === pid) as any;
        if (!player) return null;
        const life = Number(player?.life ?? player?.lifeTotal ?? 0);
        if (!Number.isFinite(life)) return null;
        lifes.push(life);
      }
      if (lifes.length < 2) return null;
      return Math.abs(lifes[0] - lifes[1]);
    }
  }

  // ── Amount of {E} energy you have ────────────────────────────────────────
  {
    const m = raw.match(/^x is the amount of \{e\} you have$/i);
    if (m) {
      const player = (state.players || []).find((p: any) => String((p as any)?.id || '').trim() === controllerId) as any;
      if (!player) return null;
      const energy = Number(player?.energyCounters ?? player?.energy ?? player?.counters?.energy ?? 0);
      return Number.isFinite(energy) ? energy : 0;
    }
  }

  // ── Damage dealt to this creature / it this turn ─────────────────────────
  {
    const m = raw.match(/^x is the amount of damage dealt to (it|this creature) this turn$/i);
    if (m) {
      const refId = String(targetCreatureId || ctx?.sourceId || '').trim();
      if (!refId) return null;
      const ref = battlefield.find((p: any) => String((p as any)?.id || '').trim() === refId) as any;
      if (!ref) return null;
      const damage = Number(ref?.damage ?? ref?.markedDamage ?? 0);
      return Number.isFinite(damage) ? Math.max(0, damage) : null;
    }
  }

  // ── Damage this creature / it dealt to that player ───────────────────────
  {
    const m = raw.match(/^x is the amount of damage (?:this creature|that creature|it) dealt to that player$/i);
    if (m) {
      const creatureId = String(targetCreatureId || ctx?.sourceId || '').trim();
      if (!creatureId) return null;

      const playerId = String(
        ctx?.selectorContext?.targetPlayerId ||
        ctx?.selectorContext?.targetOpponentId ||
        ''
      ).trim();
      if (!playerId) return null;

      const stateAny: any = state as any;
      const byPlayer = stateAny?.creaturesThatDealtDamageToPlayer;
      if (!byPlayer || typeof byPlayer !== 'object' || Array.isArray(byPlayer)) return null;

      const perPlayer = (byPlayer as Record<string, any>)[playerId];
      if (!perPlayer || typeof perPlayer !== 'object' || Array.isArray(perPlayer)) return 0;

      const totalDamage = Number(perPlayer?.[creatureId]?.totalDamage ?? 0);
      return Number.isFinite(totalDamage) ? Math.max(0, totalDamage) : null;
    }
  }

  // ── How far below 0 its power is (negative power) ────────────────────────
  {
    const m = raw.match(/^x is how (?:far below 0|much less than 0) its power is$/i);
    if (m) {
      const refId = String(targetCreatureId || ctx?.sourceId || '').trim();
      if (!refId) return null;
      const target = battlefield.find((p: any) => String((p as any)?.id || '').trim() === refId) as any;
      if (!target) return null;
      const pw = Number(target?.power);
      if (!Number.isFinite(pw)) return null;
      return pw < 0 ? Math.abs(pw) : 0;
    }
  }

  // ── Random number from a range ───────────────────────────────────────────
  {
    const m =
      raw.match(/^x is a number from (\d+) to (\d+) chosen at random(?: each time)?$/i) ||
      raw.match(/^x is a number chosen at random from (\d+) to (\d+)(?: each time)?$/i);
    if (m) {
      const sourceId = String(ctx?.sourceId || '').trim();
      if (!sourceId) return null;
      const a = parseInt(String(m[1] || '0'), 10);
      const b = parseInt(String(m[2] || '0'), 10);
      if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
      const min = Math.min(a, b);
      const max = Math.max(a, b);
      return Math.floor(Math.random() * (max - min + 1)) + min;
    }
  }

  // ── Safe-skips (non-deterministic or complex context) ────────────────────
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

function resolvePlayers(
  state: GameState,
  selector: OraclePlayerSelector,
  ctx: OracleIRExecutionContext
): readonly PlayerID[] {
  const normalizeId = (value: unknown): PlayerID | undefined => {
    if (typeof value !== 'string' && typeof value !== 'number') return undefined;
    const normalized = String(value).trim();
    return normalized ? (normalized as PlayerID) : undefined;
  };

  const controllerId = (String(ctx.controllerId || '').trim() || ctx.controllerId) as PlayerID;
  const allPlayerIds = new Set(state.players.map(p => p.id));
  const hasValidController = allPlayerIds.has(controllerId);
  const opponents = hasValidController
    ? state.players.filter(p => p.id !== controllerId).map(p => p.id)
    : [];
  const opponentIdSet = new Set(opponents);

  const dedupe = (ids: readonly PlayerID[]): readonly PlayerID[] => {
    const out: PlayerID[] = [];
    const seen = new Set<PlayerID>();
    for (const id of ids) {
      const normalized = normalizeId(id);
      if (!normalized || !allPlayerIds.has(normalized)) continue;
      if (seen.has(normalized)) continue;
      seen.add(normalized);
      out.push(normalized);
    }
    return out;
  };

  const dedupeOpponents = (ids: readonly PlayerID[]): readonly PlayerID[] =>
    dedupe(ids).filter(id => opponentIdSet.has(id));

  switch (selector.kind) {
    case 'you':
      return hasValidController ? [controllerId] : [];
    case 'each_player':
      return state.players.map(p => p.id);
    case 'each_opponent':
      return opponents;
    // Contextual subset ("each of those opponents").
    // Without trigger-context threading this is ambiguous in multiplayer,
    // but in 1v1 the subset can only be that opponent when present.
    case 'each_of_those_opponents': {
      const contextual = ctx.selectorContext?.eachOfThoseOpponents;
      if (Array.isArray(contextual) && contextual.length > 0) {
        return dedupeOpponents(contextual as PlayerID[]);
      }
      return opponents.length === 1 ? [opponents[0]] : [];
    }
    // Deterministic target support:
    // - target_opponent resolves from selector context when available,
    //   otherwise only when there is a single legal opponent.
    // - target_player resolves from selector context when available,
    //   otherwise remains unresolved because it can include multiple legal choices.
    case 'target_opponent': {
      const bound = normalizeId(ctx.selectorContext?.targetOpponentId);
      if (bound && opponentIdSet.has(bound)) return [bound];
      return opponents.length === 1 ? [opponents[0]] : [];
    }
    case 'target_player': {
      const bound = normalizeId(ctx.selectorContext?.targetPlayerId);
      if (bound && allPlayerIds.has(bound)) return [bound];
      return [];
    }
    case 'unknown':
    default:
      return [];
  }
}

function resolvePlayersFromDamageTarget(
  state: GameState,
  target: { readonly kind: 'raw'; readonly text: string } | { readonly kind: 'unknown'; readonly raw: string },
  ctx: OracleIRExecutionContext
): readonly PlayerID[] {
  if (target.kind !== 'raw') return [];

  const t = String(target.text || '')
    .replace(/\u2019/g, "'")
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[\.!]$/, '');
  if (!t) return [];

  // Only support exact, non-targeting player group targets.
  if (t === 'you') return resolvePlayers(state, { kind: 'you' }, ctx);
  if (
    t === 'that player' ||
    t === 'he or she' ||
    t === 'him or her' ||
    t === 'they' ||
    t === 'its controller' ||
    t === 'its owner' ||
    isThatOwnerOrControllerSelector(t)
  ) return resolvePlayers(state, { kind: 'target_player' }, ctx);
  if (t === 'defending player' || t === 'the defending player') {
    return resolvePlayers(state, { kind: 'target_opponent' }, ctx);
  }
  if (t === 'that opponent') return resolvePlayers(state, { kind: 'target_opponent' }, ctx);
  if (isThoseOpponentsSelector(t)) {
    return resolvePlayers(state, { kind: 'each_of_those_opponents' }, ctx);
  }
  if (t === 'each player') return resolvePlayers(state, { kind: 'each_player' }, ctx);
  if (t === 'each of your opponents' || t === 'each of the opponents') return resolvePlayers(state, { kind: 'each_opponent' }, ctx);
  if (t === 'each opponent') return resolvePlayers(state, { kind: 'each_opponent' }, ctx);
  if (t === 'your opponents') return resolvePlayers(state, { kind: 'each_opponent' }, ctx);
  if (t === 'all opponents' || t === 'all of your opponents' || t === 'all of the opponents') {
    return resolvePlayers(state, { kind: 'each_opponent' }, ctx);
  }
  if (t === 'all your opponents') return resolvePlayers(state, { kind: 'each_opponent' }, ctx);

  return [];
}

function isThatOwnerOrControllerSelector(raw: string | undefined): boolean {
  const s = String(raw || '')
    .replace(/[’]/g, "'")
    .trim()
    .toLowerCase();
  return /^that [a-z0-9][a-z0-9 -]*'s (?:controller|owner)$/i.test(s);
}

function isThoseOpponentsSelector(raw: string | undefined): boolean {
  const s = String(raw || '')
    .replace(/[’]/g, "'")
    .trim()
    .toLowerCase();
  return s === 'each of those opponents' || s === 'those opponents' || s === 'all of those opponents' || s === 'all those opponents';
}

function parseDeterministicMixedDamageTarget(
  rawText: string
): { readonly players: ReadonlySet<'you' | 'each_player' | 'each_opponent' | 'each_of_those_opponents' | 'target_player' | 'target_opponent'>; readonly selectors: readonly SimpleBattlefieldSelector[] } | null {
  const lower = String(rawText || '')
    .replace(/\u2019/g, "'")
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[\.!]$/, '');

  if (!lower) return null;
  if (/\band\/or\b/i.test(lower)) return null;

  const parts = lower.split(/\s*(?:,|and)\s*/i).map(p => p.trim()).filter(Boolean);
  if (parts.length <= 1) return null;

  const players = new Set<'you' | 'each_player' | 'each_opponent' | 'each_of_those_opponents' | 'target_player' | 'target_opponent'>();
  const selectors: SimpleBattlefieldSelector[] = [];

  for (const part of parts) {
    if (part === 'you') {
      players.add('you');
      continue;
    }
    if (part === 'each player' || part === 'all players') {
      players.add('each_player');
      continue;
    }
    if (
      part === 'each opponent' ||
      part === 'all opponents' ||
      part === 'each of your opponents' ||
      part === 'all of your opponents' ||
      part === 'each of the opponents' ||
      part === 'all of the opponents' ||
      part === 'your opponents' ||
      part === 'all your opponents'
    ) {
      players.add('each_opponent');
      continue;
    }
    if (isThoseOpponentsSelector(part)) {
      players.add('each_of_those_opponents');
      continue;
    }
    if (
      part === 'that player' ||
      part === 'he or she' ||
      part === 'him or her' ||
      part === 'they' ||
      part === 'its controller' ||
      part === 'its owner' ||
      isThatOwnerOrControllerSelector(part)
    ) {
      players.add('target_player');
      continue;
    }
    if (
      part === 'that opponent' ||
      part === 'defending player' ||
      part === 'the defending player'
    ) {
      players.add('target_opponent');
      continue;
    }

    // Allow "or" inside battlefield selector unions (e.g. "each creature or planeswalker"),
    // but reject "or" in non-selector parts to avoid ambiguous/choice-y text.
    if (
      /\bor\b/i.test(part) &&
      !/^(?:each|all)\b/i.test(part) &&
      !/^(?:your\b|opponent\b|opponents\b)/i.test(part)
    ) {
      return null;
    }

    // Allow shorthand list elements like "planeswalker" after normalization.
    let candidate = part;
    if (!/^(?:each|all)\b/i.test(candidate) && /^(?:creature|creatures|planeswalker|planeswalkers|battle|battles)\b/i.test(candidate)) {
      candidate = `each ${candidate}`;
    }

    const selector = parseSimpleBattlefieldSelector({ kind: 'raw', text: candidate } as any);
    if (!selector) return null;

    const disallowed = selector.types.some(
      t => t === 'land' || t === 'artifact' || t === 'enchantment' || t === 'permanent' || t === 'nonland_permanent'
    );
    if (disallowed) return null;

    selectors.push(selector);
  }

  if (players.size === 0 || selectors.length === 0) return null;
  return { players, selectors };
}

function normalizeRepeatedEachAllInList(text: string): string {
  // Turns e.g. "each creature and each planeswalker" into "each creature and planeswalker"
  // so it can be parsed as a single battlefield selector list.
  return String(text || '')
    .replace(/\b(and|or)\s+(?:each|all)\s+/gi, '$1 ')
    .replace(/,\s*(?:each|all)\s+/gi, ', ')
    .replace(/\s+/g, ' ')
    .trim();
}

function addDamageToPermanentLikeCreature(perm: BattlefieldPermanent, amount: number): BattlefieldPermanent {
  const n = Math.max(0, amount | 0);
  if (n <= 0) return perm;

  const current =
    Number((perm as any).markedDamage ?? (perm as any).damageMarked ?? (perm as any).damage ?? (perm as any).counters?.damage ?? 0) || 0;
  const next = current + n;
  const counters = { ...(((perm as any).counters || {}) as any), damage: next };
  return { ...(perm as any), counters, markedDamage: next, damageMarked: next, damage: next } as any;
}

function getExcessDamageToPermanent(perm: BattlefieldPermanent, amount: number): number {
  const n = Math.max(0, amount | 0);
  if (n <= 0) return 0;

  if (hasExecutorClass(perm, 'creature')) {
    const toughness = Number((perm as any)?.toughness ?? (perm as any)?.card?.toughness);
    if (!Number.isFinite(toughness)) return 0;
    const marked =
      Number((perm as any).markedDamage ?? (perm as any).damageMarked ?? (perm as any).damage ?? (perm as any).counters?.damage ?? 0) || 0;
    const remaining = Math.max(0, toughness - marked);
    return Math.max(0, n - remaining);
  }

  if (hasExecutorClass(perm, 'planeswalker')) {
    const loyalty = Number((perm as any).loyalty ?? (perm as any).counters?.loyalty ?? 0);
    if (!Number.isFinite(loyalty)) return 0;
    return Math.max(0, n - Math.max(0, loyalty));
  }

  if (hasExecutorClass(perm, 'battle')) {
    const defense = Number((perm as any).counters?.defense ?? 0);
    if (!Number.isFinite(defense)) return 0;
    return Math.max(0, n - Math.max(0, defense));
  }

  return 0;
}

function removeLoyaltyFromPlaneswalker(perm: BattlefieldPermanent, amount: number): BattlefieldPermanent {
  const n = Math.max(0, amount | 0);
  if (n <= 0) return perm;

  const current = Number((perm as any).loyalty ?? (perm as any).counters?.loyalty ?? 0) || 0;
  const next = Math.max(0, current - n);
  const counters = { ...(((perm as any).counters || {}) as any), loyalty: next };
  return { ...(perm as any), counters, loyalty: next } as any;
}

function removeDefenseCountersFromBattle(perm: BattlefieldPermanent, amount: number): BattlefieldPermanent {
  const n = Math.max(0, amount | 0);
  if (n <= 0) return perm;

  const current = Number((perm as any).counters?.defense ?? 0);
  if (!Number.isFinite(current)) return perm;

  const next = Math.max(0, current - n);
  const counters = { ...(((perm as any).counters || {}) as any), defense: next };
  return { ...(perm as any), counters } as any;
}

function drawCardsForPlayer(state: GameState, playerId: PlayerID, count: number): { state: GameState; log: string[] } {
  const log: string[] = [];
  const player = state.players.find(p => p.id === playerId);
  if (!player) return { state, log: [`Player not found: ${playerId}`] };

  const library = [...((player as any).library || [])];
  const hand = [...((player as any).hand || [])];

  let drawn = 0;
  for (let i = 0; i < Math.max(0, count | 0); i++) {
    if (library.length === 0) {
      log.push(`${playerId} cannot draw (empty library)`);
      break;
    }
    const [card] = library.splice(0, 1);
    hand.push(card);
    drawn++;
  }

  const updatedPlayers = state.players.map(p => (p.id === playerId ? { ...p, library, hand } : p));
  return {
    state: { ...state, players: updatedPlayers as any },
    log: drawn > 0 ? [`${playerId} draws ${drawn} card(s)`] : log,
  };
}

function exileTopCardsForPlayer(
  state: GameState,
  playerId: PlayerID,
  count: number
): { state: GameState; log: string[]; exiled: any[] } {
  const log: string[] = [];
  const player = state.players.find(p => p.id === playerId);
  if (!player) return { state, log: [`Player not found: ${playerId}`], exiled: [] };

  const library = [...((player as any).library || [])];
  const exile = [...((player as any).exile || [])];

  const exiled: any[] = [];
  for (let i = 0; i < Math.max(0, count | 0); i++) {
    if (library.length === 0) {
      log.push(`${playerId} cannot exile from library (empty library)`);
      break;
    }
    const [card] = library.splice(0, 1);
    exile.push(card);
    exiled.push(card);
  }

  const updatedPlayers = state.players.map(p => (p.id === playerId ? ({ ...p, library, exile } as any) : p));
  return {
    state: { ...state, players: updatedPlayers as any },
    log: exiled.length > 0 ? [`${playerId} exiles ${exiled.length} card(s) from the top of their library`] : log,
    exiled,
  };
}

function shouldReturnUncastExiledToBottom(step: any): boolean {
  const t = normalizeOracleText(String(step?.raw || ''));
  if (
    (/\bput\s+the\s+exiled\s+cards\b/.test(t) && /\bon\s+the\s+bottom\s+of\s+that\s+library\b/.test(t)) ||
    (/\bput\s+all\s+cards\s+exiled\b/.test(t) && /\bon\s+the\s+bottom\s+of\s+their\s+library\b/.test(t))
  ) {
    return true;
  }

  // Parser can split trailing bottom-of-library rider into a separate sentence,
  // so infer known deterministic templates by their parsed impulse shape.
  const amountRaw = normalizeOracleText(String(step?.amount?.raw || ''));
  const who = String(step?.who?.kind || '');
  return (
    step?.kind === 'impulse_exile_top' &&
    step?.duration === 'during_resolution' &&
    step?.permission === 'cast' &&
    step?.amount?.kind === 'unknown' &&
    (who === 'target_opponent' || who === 'target_player') &&
    (amountRaw === 'until they exile an instant or sorcery card' ||
      amountRaw === 'until you exile an instant or sorcery card' ||
      amountRaw === 'until they exile a card that shares a card type with it' ||
      amountRaw === 'until you exile a card that shares a card type with it')
  );
}

function shouldShuffleRestIntoLibrary(step: any): boolean {
  const t = normalizeOracleText(String(step?.raw || ''));
  if (/\bthen\s+shuffles\s+the\s+rest\s+into\s+(?:their|his\s+or\s+her|your)\s+library\b/.test(t)) {
    return true;
  }

  const amountRaw = normalizeOracleText(String(step?.amount?.raw || ''));
  const who = String(step?.who?.kind || '');
  return (
    step?.kind === 'impulse_exile_top' &&
    step?.duration === 'during_resolution' &&
    step?.permission === 'cast' &&
    step?.amount?.kind === 'unknown' &&
    who === 'each_opponent' &&
    (amountRaw === 'until they exile an instant or sorcery card' ||
      amountRaw === 'until you exile an instant or sorcery card')
  );
}

function splitExiledForShuffleRest(step: any, exiled: readonly any[]): { keepExiled: readonly any[]; returnToLibrary: readonly any[] } {
  const all = Array.isArray(exiled) ? exiled : [];
  if (all.length === 0) return { keepExiled: [], returnToLibrary: [] };

  const amountRaw = normalizeOracleText(String(step?.amount?.raw || ''));

  if (
    amountRaw === 'until they exile an instant or sorcery card' ||
    amountRaw === 'until you exile an instant or sorcery card'
  ) {
    const last = all[all.length - 1];
    const typeLine = getCardTypeLineLower(last);
    const hit = typeLine.includes('instant') || typeLine.includes('sorcery');
    if (!hit) return { keepExiled: [], returnToLibrary: all };
    return { keepExiled: [last], returnToLibrary: all.slice(0, -1) };
  }

  // Unsupported shuffle-rest criteria remain conservative: do not mutate zones.
  return { keepExiled: all, returnToLibrary: [] };
}

function putSpecificExiledCardsOnLibraryBottom(
  state: GameState,
  playerId: PlayerID,
  cards: readonly any[]
): { state: GameState; moved: number; log: string[] } {
  if (!Array.isArray(cards) || cards.length === 0) return { state, moved: 0, log: [] };
  const player = state.players.find(p => p.id === playerId) as any;
  if (!player) return { state, moved: 0, log: [] };

  const exile = Array.isArray(player.exile) ? [...player.exile] : [];
  const library = Array.isArray(player.library) ? [...player.library] : [];

  const wantedIds = new Set(
    cards
      .map(c => String((c as any)?.id ?? (c as any)?.cardId ?? '').trim())
      .filter(Boolean)
  );
  if (wantedIds.size === 0) return { state, moved: 0, log: [] };

  const kept: any[] = [];
  const moved: any[] = [];
  for (const card of exile) {
    const id = String((card as any)?.id ?? (card as any)?.cardId ?? '').trim();
    if (id && wantedIds.has(id)) moved.push(card);
    else kept.push(card);
  }

  if (moved.length === 0) return { state, moved: 0, log: [] };

  const nextState = clearPlayableFromExileForCards(state, playerId, moved);
  const movedClean = moved.map(stripImpulsePermissionMarkers);
  const nextPlayer: any = { ...(player as any), exile: kept, library: [...library, ...movedClean] };
  const updatedPlayers = nextState.players.map(p => (p.id === playerId ? nextPlayer : p));
  return {
    state: { ...nextState, players: updatedPlayers as any } as any,
    moved: moved.length,
    log: [`${playerId} puts ${moved.length} exiled card(s) on the bottom of their library`],
  };
}

function adjustLife(state: GameState, playerId: PlayerID, delta: number): { state: GameState; log: string[] } {
  const log: string[] = [];
  const player = state.players.find(p => p.id === playerId);
  if (!player) return { state, log: [`Player not found: ${playerId}`] };

  const currentLife = typeof (player as any).life === 'number' ? (player as any).life : 0;
  const nextLife = currentLife + delta;
  const updatedPlayers = state.players.map(p => (p.id === playerId ? { ...p, life: nextLife } : p));

  const verb = delta >= 0 ? 'gains' : 'loses';
  log.push(`${playerId} ${verb} ${Math.abs(delta)} life`);

  return { state: { ...state, players: updatedPlayers as any }, log };
}

function discardCardsForPlayer(
  state: GameState,
  playerId: PlayerID,
  count: number
): { state: GameState; log: string[]; applied: boolean; needsChoice: boolean; discardedCount: number } {
  const log: string[] = [];
  const player = state.players.find(p => p.id === playerId);
  if (!player) return { state, log: [`Player not found: ${playerId}`], applied: false, needsChoice: false, discardedCount: 0 };

  const hand = [...((player as any).hand || [])];
  const graveyard = [...((player as any).graveyard || [])];

  const n = Math.max(0, count | 0);
  if (n === 0) return { state, log, applied: true, needsChoice: false, discardedCount: 0 };

  // Deterministic only when the player has <= N cards, in which case all cards are discarded.
  if (hand.length > n) {
    return { state, log, applied: false, needsChoice: true, discardedCount: 0 };
  }

  const discarded = hand.splice(0, hand.length);
  graveyard.push(...discarded);

  const updatedPlayers = state.players.map(p => (p.id === playerId ? { ...p, hand, graveyard } : p));
  log.push(`${playerId} discards ${discarded.length} card(s)`);
  return { state: { ...state, players: updatedPlayers as any }, log, applied: true, needsChoice: false, discardedCount: discarded.length };
}

function millCardsForPlayer(
  state: GameState,
  playerId: PlayerID,
  count: number
): { state: GameState; log: string[] } {
  const log: string[] = [];
  const player = state.players.find(p => p.id === playerId);
  if (!player) return { state, log: [`Player not found: ${playerId}`] };

  const library = [...((player as any).library || [])];
  const graveyard = [...((player as any).graveyard || [])];

  const n = Math.max(0, count | 0);
  if (n === 0) return { state, log };

  const actual = Math.min(n, library.length);
  const milled = library.splice(0, actual);
  graveyard.push(...milled);

  const updatedPlayers = state.players.map(p => (p.id === playerId ? { ...p, library, graveyard } : p));
  log.push(`${playerId} mills ${actual} card(s)`);
  return { state: { ...state, players: updatedPlayers as any }, log };
}

function addManaToPoolForPlayer(
  state: GameState,
  playerId: PlayerID,
  mana: string
): { state: GameState; log: string[]; applied: boolean } {
  const log: string[] = [];

  const playerExists = state.players.some(p => p.id === playerId);
  if (!playerExists) return { state, log: [`Player not found: ${playerId}`], applied: false };

  const symbols = parseManaSymbols(mana);
  if (symbols.length === 0) return { state, log: [`Skipped add mana (no symbols): ${mana}`], applied: false };

  // Deterministic only: basic + numeric + {C}. Anything else implies choice/unknown.
  for (const sym of symbols) {
    const upper = String(sym).toUpperCase();
    const isBasic = ['{W}', '{U}', '{B}', '{R}', '{G}', '{C}'].includes(upper);
    const isNumeric = /^\{\d+\}$/.test(upper);
    if (!isBasic && !isNumeric) {
      return { state, log: [`Skipped add mana (unsupported symbol ${sym}): ${mana}`], applied: false };
    }
  }

  const manaPoolRecord: Record<PlayerID, any> = { ...(((state as any).manaPool || {}) as any) };
  let pool = manaPoolRecord[playerId] || createEmptyManaPool();

  for (const sym of symbols) {
    const upper = String(sym).toUpperCase();
    switch (upper) {
      case '{W}':
        pool = addMana(pool, ManaType.WHITE, 1);
        break;
      case '{U}':
        pool = addMana(pool, ManaType.BLUE, 1);
        break;
      case '{B}':
        pool = addMana(pool, ManaType.BLACK, 1);
        break;
      case '{R}':
        pool = addMana(pool, ManaType.RED, 1);
        break;
      case '{G}':
        pool = addMana(pool, ManaType.GREEN, 1);
        break;
      case '{C}':
        pool = addMana(pool, ManaType.COLORLESS, 1);
        break;
      default: {
        // Treat numeric symbols like {2} as adding that much colorless mana.
        const m = upper.match(/^\{(\d+)\}$/);
        const n = m ? parseInt(m[1], 10) : 0;
        if (n > 0) pool = addMana(pool, ManaType.COLORLESS, n);
        break;
      }
    }
  }

  manaPoolRecord[playerId] = pool;
  log.push(`${playerId} adds ${mana.replace(/\s+/g, '')} to their mana pool`);
  return { state: { ...(state as any), manaPool: manaPoolRecord } as any, log, applied: true };
}

function parseSimpleBattlefieldSelector(
  target: { readonly kind: string; readonly text?: string; readonly raw?: string }
): SimpleBattlefieldSelector | null {
  if (target.kind !== 'raw') return null;
  const text = String((target as any).text || '').trim();
  if (!text) return null;

  const lower = text.replace(/\u2019/g, "'").toLowerCase().replace(/\s+/g, ' ').trim();

  // Very conservative: support
  // - "all/each <type(s)>" optionally followed by a controller filter
  // - shorthand possessives like "your creatures" / "your opponents' creatures" / "opponent's planeswalkers"
  const m = lower.match(/^(?:all|each)\s+(.+)$/i);

  let remainder = '';
  let controllerFilter: SimpleBattlefieldSelector['controllerFilter'] = 'any';

  if (m) {
    remainder = String(m[1] || '').trim();
    if (!remainder) return null;

    // Common Oracle phrasing: "each of your opponents' creatures", "each of the creatures you control".
    remainder = remainder.replace(/^of\s+/i, '').replace(/^the\s+/i, '').trim();
  } else {
    // Shorthand forms (no each/all)
    // - "your <types>"
    // - "your opponents' <types>" / "your opponents's <types>"
    // - "opponent's <types>"
    const oppPlural = remainder || lower;
    if (/^(?:your\s+)?opponents?'s\s+/i.test(oppPlural) || /^(?:your\s+)?opponents?'\s+/i.test(oppPlural)) {
      controllerFilter = 'opponents';
      remainder = oppPlural
        .replace(/^(?:your\s+)?opponents?'s\s+/i, '')
        .replace(/^(?:your\s+)?opponents?'\s+/i, '')
        .trim();
    } else if (/^opponent's\s+/i.test(oppPlural) || /^opponent'\s+/i.test(oppPlural)) {
      controllerFilter = 'opponents';
      remainder = oppPlural.replace(/^opponent's\s+/i, '').replace(/^opponent'\s+/i, '').trim();
    } else if (/^your\s+/i.test(oppPlural)) {
      controllerFilter = 'you';
      remainder = oppPlural.replace(/^your\s+/i, '').trim();
    } else {
      // Also accept controller-suffix forms like:
      // - "creatures you control"
      // - "creatures your opponents control"
      // - "creatures an opponent controls"
      // - "creatures you don't control"
      // Let the shared controller-filter stripping below handle these.
      if (
        /\byou control\b/i.test(oppPlural) ||
        /\b(?:your opponents|opponents)\s+control\b/i.test(oppPlural) ||
        /\b(?:each opponent|an opponent)\s+controls\b/i.test(oppPlural) ||
        /\byou\s+(?:don'?t|do not)\s+control\b/i.test(oppPlural)
      ) {
        remainder = oppPlural.trim();
      } else {
        return null;
      }
    }

    if (!remainder) return null;
  }

  // Possessive shorthand: "each opponent's creatures" / "each opponents' creatures" / "each opponents’s creatures"
  // Treat as opponents control.
  if (/^(?:your\s+)?opponents?'s\s+/i.test(remainder) || /^(?:your\s+)?opponents?'\s+/i.test(remainder)) {
    controllerFilter = 'opponents';
    remainder = remainder
      .replace(/^(?:your\s+)?opponents?'s\s+/i, '')
      .replace(/^(?:your\s+)?opponents?'\s+/i, '')
      .trim();
  }

  if (/^opponent's\s+/i.test(remainder) || /^opponent'\s+/i.test(remainder)) {
    controllerFilter = 'opponents';
    remainder = remainder.replace(/^opponent's\s+/i, '').replace(/^opponent'\s+/i, '').trim();
  }

  if (/\byou control\b/i.test(remainder)) controllerFilter = 'you';
  if (/\b(?:your opponents|opponents)\s+control\b/i.test(remainder)) controllerFilter = 'opponents';
  if (/\b(?:each opponent|an opponent)\s+controls\b/i.test(remainder)) controllerFilter = 'opponents';
  if (/\byou\s+(?:don'?t|do not)\s+control\b/i.test(remainder)) controllerFilter = 'opponents';

  remainder = remainder
    .replace(/\byou control\b/i, '')
    .replace(/\b(?:your opponents|opponents)\s+control\b/i, '')
    .replace(/\b(?:each opponent|an opponent)\s+controls\b/i, '')
    .replace(/\byou\s+(?:don'?t|do not)\s+control\b/i, '')
    .trim();

  if (!remainder) return null;

  if (/\bnonland\b/.test(remainder) && !/^nonland\s+permanents?\b/.test(remainder)) return null;

  if (/^nonland\s+permanents?\b/.test(remainder)) {
    return { kind: 'battlefield_selector', types: ['nonland_permanent'], controllerFilter };
  }

  if (/^permanents?\b/.test(remainder)) {
    return { kind: 'battlefield_selector', types: ['permanent'], controllerFilter };
  }

  const cleaned = remainder.replace(/\bpermanents?\b/g, '').trim();
  if (!cleaned) return null;

  const parts = cleaned.split(/\s*(?:,|and\/or|and|or)\s*/i).filter(Boolean);
  if (parts.length === 0) return null;

  const allowed = new Set<SimplePermanentType>([
    'creature',
    'artifact',
    'enchantment',
    'land',
    'planeswalker',
    'battle',
  ]);
  const types: SimplePermanentType[] = [];
  for (const part of parts) {
    let t = part.trim().toLowerCase();
    if (t.endsWith('s')) t = t.slice(0, -1);
    if (!allowed.has(t as SimplePermanentType)) return null;
    types.push(t as SimplePermanentType);
  }

  return { kind: 'battlefield_selector', types, controllerFilter };
}

function resolveTapOrUntapTargetIds(state: GameState, target: OracleObjectSelector | any, ctx: OracleIRExecutionContext): string[] {
  const battlefield = [...((state.battlefield || []) as BattlefieldPermanent[])];
  const explicitPermanentId = String(ctx.targetPermanentId || '').trim();
  if (explicitPermanentId) {
    const matched = battlefield.find((perm: any) => String((perm as any)?.id || '').trim() === explicitPermanentId);
    return matched ? [explicitPermanentId] : [];
  }

  const explicitCreatureId = String(ctx.targetCreatureId || '').trim();
  if (explicitCreatureId) {
    const matched = battlefield.find((perm: any) => String((perm as any)?.id || '').trim() === explicitCreatureId);
    return matched ? [explicitCreatureId] : [];
  }

  if (target?.kind !== 'raw') return [];
  const text = String(target?.text || '').trim().toLowerCase();
  if (!text) return [];

  if (text === 'target permanent' && battlefield.length === 1) {
    return [String((battlefield[0] as any)?.id || '').trim()].filter(Boolean);
  }

  if (text === 'target creature') {
    const creatures = battlefield.filter(perm => hasExecutorClass(perm, 'creature'));
    if (creatures.length === 1) {
      return [String((creatures[0] as any)?.id || '').trim()].filter(Boolean);
    }
  }

  return [];
}

function applyTapOrUntapToBattlefield(
  state: GameState,
  targetIds: readonly string[],
  choice: 'tap' | 'untap'
): GameState {
  const wanted = new Set(targetIds.map(id => String(id || '').trim()).filter(Boolean));
  const battlefield = [...((state.battlefield || []) as BattlefieldPermanent[])];

  for (let idx = 0; idx < battlefield.length; idx += 1) {
    const perm = battlefield[idx] as any;
    const permanentId = String(perm?.id || '').trim();
    if (!wanted.has(permanentId)) continue;
    battlefield[idx] = {
      ...perm,
      tapped: choice === 'tap',
    } as any;
  }

  return { ...(state as any), battlefield } as any;
}

function permanentMatchesSelector(perm: BattlefieldPermanent, sel: SimpleBattlefieldSelector, ctx: OracleIRExecutionContext): boolean {
  const normalizeId = (value: unknown): PlayerID | undefined => {
    if (typeof value !== 'string' && typeof value !== 'number') return undefined;
    const normalized = String(value).trim();
    return normalized ? (normalized as PlayerID) : undefined;
  };
  const normalizedControllerId = (String(ctx.controllerId || '').trim() || ctx.controllerId) as PlayerID;
  const permanentControllerId = normalizeId((perm as any)?.controller);

  if (sel.controllerFilter === 'you') {
    if (!permanentControllerId || permanentControllerId !== normalizedControllerId) return false;
  }

  if (sel.controllerFilter === 'opponents') {
    if (!permanentControllerId || permanentControllerId === normalizedControllerId) return false;
  }

  if (sel.types.includes('permanent')) return true;
  if (sel.types.includes('nonland_permanent')) return hasExecutorClass(perm, 'permanent') && !hasExecutorClass(perm, 'land');

  return sel.types.some(t => {
    switch (t) {
      case 'creature':
        return hasExecutorClass(perm, 'creature');
      case 'artifact':
        return hasExecutorClass(perm, 'artifact');
      case 'enchantment':
        return hasExecutorClass(perm, 'enchantment');
      case 'land':
        return hasExecutorClass(perm, 'land');
      case 'planeswalker':
        return hasExecutorClass(perm, 'planeswalker');
      case 'battle':
        return hasExecutorClass(perm, 'battle');
      default:
        return false;
    }
  });
}

function permanentMatchesType(perm: BattlefieldPermanent, type: SimplePermanentType): boolean {
  switch (type) {
    case 'permanent':
      return true;
    case 'nonland_permanent':
      return hasExecutorClass(perm, 'permanent') && !hasExecutorClass(perm, 'land');
    case 'creature':
      return hasExecutorClass(perm, 'creature');
    case 'artifact':
      return hasExecutorClass(perm, 'artifact');
    case 'enchantment':
      return hasExecutorClass(perm, 'enchantment');
    case 'land':
      return hasExecutorClass(perm, 'land');
    case 'planeswalker':
      return hasExecutorClass(perm, 'planeswalker');
    case 'battle':
      return hasExecutorClass(perm, 'battle');
    default:
      return false;
  }
}

function finalizeBattlefieldRemoval(
  state: GameState,
  removed: readonly BattlefieldPermanent[],
  removedIds: ReadonlySet<string>,
  kept: readonly BattlefieldPermanent[],
  destination: 'graveyard' | 'exile',
  verbPastTense: string
): { state: GameState; log: string[] } {
  // Clean up attachment references deterministically.
  const cleanedKept = kept.map(p => {
    const next: any = { ...p };
    if (typeof next.attachedTo === 'string' && removedIds.has(next.attachedTo)) next.attachedTo = undefined;
    if (Array.isArray(next.attachments)) next.attachments = next.attachments.filter((id: any) => !removedIds.has(String(id)));
    if (Array.isArray(next.attachedEquipment)) {
      next.attachedEquipment = next.attachedEquipment.filter((id: any) => !removedIds.has(String(id)));
      next.isEquipped = Boolean(next.attachedEquipment.length > 0);
    }
    if (Array.isArray(next.blocking)) next.blocking = next.blocking.filter((id: any) => !removedIds.has(String(id)));
    if (Array.isArray(next.blockedBy)) next.blockedBy = next.blockedBy.filter((id: any) => !removedIds.has(String(id)));
    return next;
  });

  // Move non-token cards to the destination zone.
  const players = state.players.map(p => ({ ...p } as any));
  for (const perm of removed) {
    if ((perm as any).isToken) continue;
    const ownerId = perm.owner;
    const player = players.find(pp => pp.id === ownerId);
    if (!player) continue;

    if (destination === 'graveyard') {
      const gy = Array.isArray(player.graveyard) ? [...player.graveyard] : [];
      gy.push((perm as any).card);
      player.graveyard = gy;
    } else {
      const ex = Array.isArray(player.exile) ? [...player.exile] : [];
      ex.push((perm as any).card);
      player.exile = ex;
    }
  }

  const log = removed.length > 0 ? [`${verbPastTense} ${removed.length} permanent(s) from battlefield`] : [];
  return { state: { ...state, battlefield: cleanedKept as any, players: players as any } as any, log };
}

function moveMatchingBattlefieldPermanents(
  state: GameState,
  selector: SimpleBattlefieldSelector,
  ctx: OracleIRExecutionContext,
  destination: 'graveyard' | 'exile'
): { state: GameState; log: string[] } {
  const battlefield = [...((state.battlefield || []) as BattlefieldPermanent[])];

  const removedIds = new Set<string>();
  const removed: BattlefieldPermanent[] = [];
  const kept: BattlefieldPermanent[] = [];

  for (const perm of battlefield) {
    if (permanentMatchesSelector(perm, selector, ctx)) {
      removed.push(perm);
      removedIds.add(perm.id);
    } else {
      kept.push(perm);
    }
  }

  const verb = destination === 'graveyard' ? 'destroyed' : 'exiled';
  return finalizeBattlefieldRemoval(state, removed, removedIds, kept, destination, verb);
}

function bounceMatchingBattlefieldPermanentsToOwnersHands(
  state: GameState,
  selector: SimpleBattlefieldSelector,
  ctx: OracleIRExecutionContext
): { state: GameState; log: string[] } {
  const battlefield = [...((state.battlefield || []) as BattlefieldPermanent[])];

  const removedIds = new Set<string>();
  const removed: BattlefieldPermanent[] = [];
  const kept: BattlefieldPermanent[] = [];

  for (const perm of battlefield) {
    if (permanentMatchesSelector(perm, selector, ctx)) {
      removed.push(perm);
      removedIds.add(perm.id);
    } else {
      kept.push(perm);
    }
  }

  if (removed.length === 0) return { state, log: [] };

  // Clean up attachment references deterministically.
  const cleanedKept = kept.map(p => {
    const next: any = { ...p };
    if (typeof next.attachedTo === 'string' && removedIds.has(next.attachedTo)) next.attachedTo = undefined;
    if (Array.isArray(next.attachments)) next.attachments = next.attachments.filter((id: any) => !removedIds.has(String(id)));
    if (Array.isArray(next.attachedEquipment)) {
      next.attachedEquipment = next.attachedEquipment.filter((id: any) => !removedIds.has(String(id)));
      next.isEquipped = Boolean(next.attachedEquipment.length > 0);
    }
    if (Array.isArray(next.blocking)) next.blocking = next.blocking.filter((id: any) => !removedIds.has(String(id)));
    if (Array.isArray(next.blockedBy)) next.blockedBy = next.blockedBy.filter((id: any) => !removedIds.has(String(id)));
    return next;
  });

  // Move non-token cards to their owners' hands. Tokens cease to exist.
  const players = state.players.map(p => ({ ...p } as any));
  for (const perm of removed) {
    if ((perm as any).isToken) continue;
    const ownerId = perm.owner;
    const player = players.find(pp => pp.id === ownerId);
    if (!player) continue;
    const hand = Array.isArray(player.hand) ? [...player.hand] : [];
    hand.push((perm as any).card);
    player.hand = hand;
  }

  const log = [`returned ${removed.length} permanent(s) to owners' hands`];
  return { state: { ...state, battlefield: cleanedKept as any, players: players as any } as any, log };
}

function parseSimplePermanentTypeFromText(text: string): SimplePermanentType | null {
  const lower = String(text || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[.\s]+$/g, '')
    .trim();

  if (!lower) return null;

  // Prefer specific -> generic.
  if (/\bnonland\s+permanent(s)?\b/i.test(lower)) return 'nonland_permanent';
  if (/\bcreature(s)?\b/i.test(lower)) return 'creature';
  if (/\bartifact(s)?\b/i.test(lower)) return 'artifact';
  if (/\benchantment(s)?\b/i.test(lower)) return 'enchantment';
  if (/\bland(s)?\b/i.test(lower)) return 'land';
  if (/\bpermanent(s)?\b/i.test(lower)) return 'permanent';
  return null;
}

type SimpleCardType = 'any' | 'creature' | 'artifact' | 'enchantment' | 'land' | 'instant' | 'sorcery' | 'planeswalker';

function parseSimpleCardTypeFromText(text: string): SimpleCardType | null {
  const lower = String(text || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[.\s]+$/g, '')
    .trim();

  if (!lower) return null;
  if (/\bcreature(s)?\b/i.test(lower)) return 'creature';
  if (/\bartifact(s)?\b/i.test(lower)) return 'artifact';
  if (/\benchantment(s)?\b/i.test(lower)) return 'enchantment';
  if (/\bland(s)?\b/i.test(lower)) return 'land';
  if (/\binstant(s)?\b/i.test(lower)) return 'instant';
  if (/\bsorcery|sorceries\b/i.test(lower)) return 'sorcery';
  if (/\bplaneswalker(s)?\b/i.test(lower)) return 'planeswalker';
  return null;
}

function cardMatchesType(card: any, type: SimpleCardType): boolean {
  if (type === 'any') return true;
  const typeLine = String(card?.type_line || '').toLowerCase();
  return typeLine.includes(type);
}

function parseMoveZoneAllFromYourGraveyard(what: { readonly kind: string; readonly text?: string; readonly raw?: string }):
  | { readonly cardType: SimpleCardType }
  | null {
  if (what.kind !== 'raw') return null;
  const raw = String((what as any).text || '').trim();
  if (!raw) return null;

  const cleaned = raw.replace(/[.\s]+$/g, '').trim();
  const lower = cleaned.toLowerCase().replace(/\s+/g, ' ');

  // Conservative: only support "all ... cards from your graveyard".
  // Do NOT attempt to interpret multi-type selectors ("artifact and creature cards"),
  // or arbitrary zones.
  if (!lower.startsWith('all ')) return null;
  if (!/\bfrom your graveyard\b/i.test(lower)) return null;
  if (/\b(and|or)\b/i.test(lower)) return null;

  // "all cards from your graveyard"
  if (/^all\s+cards?\s+from\s+your\s+graveyard$/i.test(lower)) {
    return { cardType: 'any' };
  }

  const m = cleaned.match(/^all\s+(.+?)\s+cards?\s+from\s+your\s+graveyard$/i);
  if (!m) return null;

  const typeText = String(m[1] || '').trim();
  if (!typeText) return null;

  const parsed = parseSimpleCardTypeFromText(typeText);
  if (!parsed) return null;
  return { cardType: parsed };
}

function parseMoveZoneAllFromYourHand(what: { readonly kind: string; readonly text?: string; readonly raw?: string }):
  | { readonly cardType: SimpleCardType }
  | null {
  if (what.kind !== 'raw') return null;
  const raw = String((what as any).text || '').trim();
  if (!raw) return null;

  const cleaned = raw.replace(/[.\s]+$/g, '').trim();
  const lower = cleaned.toLowerCase().replace(/\s+/g, ' ');

  // Conservative: only support "all ... cards from your hand".
  if (!lower.startsWith('all ')) return null;
  if (!/\bfrom your hand\b/i.test(lower)) return null;
  if (/\b(and|or)\b/i.test(lower)) return null;

  if (/^all\s+cards?\s+from\s+your\s+hand$/i.test(lower)) {
    return { cardType: 'any' };
  }

  const m = cleaned.match(/^all\s+(.+?)\s+cards?\s+from\s+your\s+hand$/i);
  if (!m) return null;

  const typeText = String(m[1] || '').trim();
  if (!typeText) return null;

  const parsed = parseSimpleCardTypeFromText(typeText);
  if (!parsed) return null;
  return { cardType: parsed };
}

function parseMoveZoneAllFromYourExile(what: { readonly kind: string; readonly text?: string; readonly raw?: string }):
  | { readonly cardType: SimpleCardType }
  | null {
  if (what.kind !== 'raw') return null;
  const raw = String((what as any).text || '').trim();
  if (!raw) return null;

  const cleaned = raw.replace(/[.\s]+$/g, '').trim();
  const lower = cleaned.toLowerCase().replace(/\s+/g, ' ');

  if (!lower.startsWith('all ')) return null;
  if (!/\bfrom your exile\b/i.test(lower)) return null;
  if (/\b(and|or)\b/i.test(lower)) return null;

  if (/^all\s+cards?\s+from\s+your\s+exile$/i.test(lower)) {
    return { cardType: 'any' };
  }

  const m = cleaned.match(/^all\s+(.+?)\s+cards?\s+from\s+your\s+exile$/i);
  if (!m) return null;
  const typeText = String(m[1] || '').trim();
  if (!typeText) return null;
  const parsed = parseSimpleCardTypeFromText(typeText);
  if (!parsed) return null;
  return { cardType: parsed };
}

function parseMoveZoneAllFromEachPlayersGraveyard(what: { readonly kind: string; readonly text?: string; readonly raw?: string }):
  | { readonly cardType: SimpleCardType }
  | null {
  if (what.kind !== 'raw') return null;
  const raw = String((what as any).text || '').trim();
  if (!raw) return null;

  const cleaned = raw.replace(/[.\s]+$/g, '').trim();
  const lower = cleaned.toLowerCase().replace(/\s+/g, ' ');

  if (!lower.startsWith('all ')) return null;
  if (/\b(and|or)\b/i.test(lower)) return null;

  const fromEachPlayersGy =
    /\bfrom each player's graveyard\b/i.test(lower) || /\bfrom each players' graveyard\b/i.test(lower);
  const fromAllGys = /\bfrom all graveyards\b/i.test(lower);
  if (!fromEachPlayersGy && !fromAllGys) return null;

  if (/^all\s+cards?\s+from\s+(?:each\s+player's\s+graveyard|each\s+players'\s+graveyard|all\s+graveyards)$/i.test(lower)) {
    return { cardType: 'any' };
  }

  const m = cleaned.match(
    /^all\s+(.+?)\s+cards?\s+from\s+(?:each\s+player's\s+graveyard|each\s+players'\s+graveyard|all\s+graveyards)$/i
  );
  if (!m) return null;
  const typeText = String(m[1] || '').trim();
  if (!typeText) return null;
  const parsed = parseSimpleCardTypeFromText(typeText);
  if (!parsed) return null;
  return { cardType: parsed };
}

function parseMoveZoneAllFromEachPlayersHand(what: { readonly kind: string; readonly text?: string; readonly raw?: string }):
  | { readonly cardType: SimpleCardType }
  | null {
  if (what.kind !== 'raw') return null;
  const raw = String((what as any).text || '').trim();
  if (!raw) return null;

  const cleaned = raw.replace(/[.\s]+$/g, '').trim();
  const lower = cleaned.toLowerCase().replace(/\s+/g, ' ');

  if (!lower.startsWith('all ')) return null;
  if (/\b(and|or)\b/i.test(lower)) return null;

  const fromEachPlayersHand =
    /\bfrom each player's hand\b/i.test(lower) || /\bfrom each players' hand\b/i.test(lower);
  if (!fromEachPlayersHand) return null;

  if (/^all\s+cards?\s+from\s+(?:each\s+player's\s+hand|each\s+players'\s+hand)$/i.test(lower)) {
    return { cardType: 'any' };
  }

  const m = cleaned.match(/^all\s+(.+?)\s+cards?\s+from\s+(?:each\s+player's\s+hand|each\s+players'\s+hand)$/i);
  if (!m) return null;
  const typeText = String(m[1] || '').trim();
  if (!typeText) return null;
  const parsed = parseSimpleCardTypeFromText(typeText);
  if (!parsed) return null;
  return { cardType: parsed };
}

function parseMoveZoneAllFromEachPlayersExile(what: { readonly kind: string; readonly text?: string; readonly raw?: string }):
  | { readonly cardType: SimpleCardType }
  | null {
  if (what.kind !== 'raw') return null;
  const raw = String((what as any).text || '').trim();
  if (!raw) return null;

  const cleaned = raw.replace(/[.\s]+$/g, '').trim();
  const lower = cleaned.toLowerCase().replace(/\s+/g, ' ');

  if (!lower.startsWith('all ')) return null;
  if (/\b(and|or)\b/i.test(lower)) return null;

  const fromEachPlayersExile = /\bfrom each player's exile\b/i.test(lower) || /\bfrom each players' exile\b/i.test(lower);
  const fromAllExiles = /\bfrom all exiles\b/i.test(lower);
  if (!fromEachPlayersExile && !fromAllExiles) return null;

  if (/^all\s+cards?\s+from\s+(?:each\s+player's\s+exile|each\s+players'\s+exile|all\s+exiles)$/i.test(lower)) {
    return { cardType: 'any' };
  }

  const m = cleaned.match(
    /^all\s+(.+?)\s+cards?\s+from\s+(?:each\s+player's\s+exile|each\s+players'\s+exile|all\s+exiles)$/i
  );
  if (!m) return null;
  const typeText = String(m[1] || '').trim();
  if (!typeText) return null;
  const parsed = parseSimpleCardTypeFromText(typeText);
  if (!parsed) return null;
  return { cardType: parsed };
}

function parseMoveZoneAllFromEachOpponentsGraveyard(what: { readonly kind: string; readonly text?: string; readonly raw?: string }):
  | { readonly cardType: SimpleCardType }
  | null {
  if (what.kind !== 'raw') return null;
  const raw = String((what as any).text || '').trim();
  if (!raw) return null;

  const cleaned = raw.replace(/[.\s]+$/g, '').trim();
  const lower = cleaned.toLowerCase().replace(/\s+/g, ' ');

  if (!lower.startsWith('all ')) return null;
  if (/\b(and|or)\b/i.test(lower)) return null;

  const fromEachOppGy =
    /\bfrom each opponent's graveyard\b/i.test(lower) || /\bfrom each opponents' graveyard\b/i.test(lower);
  if (!fromEachOppGy) return null;

  if (/^all\s+cards?\s+from\s+(?:each\s+opponent's\s+graveyard|each\s+opponents'\s+graveyard)$/i.test(lower)) {
    return { cardType: 'any' };
  }

  const m = cleaned.match(/^all\s+(.+?)\s+cards?\s+from\s+(?:each\s+opponent's\s+graveyard|each\s+opponents'\s+graveyard)$/i);
  if (!m) return null;

  const typeText = String(m[1] || '').trim();
  if (!typeText) return null;
  const parsed = parseSimpleCardTypeFromText(typeText);
  if (!parsed) return null;
  return { cardType: parsed };
}

function parseMoveZoneAllFromEachOpponentsHand(what: { readonly kind: string; readonly text?: string; readonly raw?: string }):
  | { readonly cardType: SimpleCardType }
  | null {
  if (what.kind !== 'raw') return null;
  const raw = String((what as any).text || '').trim();
  if (!raw) return null;

  const cleaned = raw.replace(/[.\s]+$/g, '').trim();
  const lower = cleaned.toLowerCase().replace(/\s+/g, ' ');

  if (!lower.startsWith('all ')) return null;
  if (/\b(and|or)\b/i.test(lower)) return null;

  const fromEachOppHand = /\bfrom each opponent's hand\b/i.test(lower) || /\bfrom each opponents' hand\b/i.test(lower);
  if (!fromEachOppHand) return null;

  if (/^all\s+cards?\s+from\s+(?:each\s+opponent's\s+hand|each\s+opponents'\s+hand)$/i.test(lower)) {
    return { cardType: 'any' };
  }

  const m = cleaned.match(/^all\s+(.+?)\s+cards?\s+from\s+(?:each\s+opponent's\s+hand|each\s+opponents'\s+hand)$/i);
  if (!m) return null;

  const typeText = String(m[1] || '').trim();
  if (!typeText) return null;
  const parsed = parseSimpleCardTypeFromText(typeText);
  if (!parsed) return null;
  return { cardType: parsed };
}

function parseMoveZoneAllFromEachOpponentsExile(what: { readonly kind: string; readonly text?: string; readonly raw?: string }):
  | { readonly cardType: SimpleCardType }
  | null {
  if (what.kind !== 'raw') return null;
  const raw = String((what as any).text || '').trim();
  if (!raw) return null;

  const cleaned = raw.replace(/[.\s]+$/g, '').trim();
  const lower = cleaned.toLowerCase().replace(/\s+/g, ' ');

  if (!lower.startsWith('all ')) return null;
  if (/\b(and|or)\b/i.test(lower)) return null;

  const fromEachOppExile = /\bfrom each opponent's exile\b/i.test(lower) || /\bfrom each opponents' exile\b/i.test(lower);
  if (!fromEachOppExile) return null;

  if (/^all\s+cards?\s+from\s+(?:each\s+opponent's\s+exile|each\s+opponents'\s+exile)$/i.test(lower)) {
    return { cardType: 'any' };
  }

  const m = cleaned.match(/^all\s+(.+?)\s+cards?\s+from\s+(?:each\s+opponent's\s+exile|each\s+opponents'\s+exile)$/i);
  if (!m) return null;
  const typeText = String(m[1] || '').trim();
  if (!typeText) return null;
  const parsed = parseSimpleCardTypeFromText(typeText);
  if (!parsed) return null;
  return { cardType: parsed };
}

function moveAllMatchingFromExile(
  state: GameState,
  playerId: PlayerID,
  cardType: SimpleCardType,
  destination: 'hand' | 'graveyard'
): { state: GameState; log: string[] } {
  const player = state.players.find(p => p.id === playerId) as any;
  if (!player) return { state, log: [] };

  const exile = Array.isArray(player.exile) ? [...player.exile] : [];
  const hand = Array.isArray(player.hand) ? [...player.hand] : [];
  const graveyard = Array.isArray(player.graveyard) ? [...player.graveyard] : [];

  const kept: any[] = [];
  const moved: any[] = [];
  for (const card of exile) {
    if (cardMatchesType(card, cardType)) moved.push(card);
    else kept.push(card);
  }
  if (moved.length === 0) return { state, log: [] };

  // If impulse permissions were tracked for these cards, clear them when leaving exile.
  const nextState = clearPlayableFromExileForCards(state, playerId, moved);
  const movedClean = moved.map(stripImpulsePermissionMarkers);

  const nextPlayer: any = { ...(player as any), exile: kept };
  if (destination === 'hand') nextPlayer.hand = [...hand, ...movedClean];
  else nextPlayer.graveyard = [...graveyard, ...movedClean];

  const updatedPlayers = nextState.players.map(p => (p.id === playerId ? nextPlayer : p));
  return {
    state: { ...nextState, players: updatedPlayers as any } as any,
    log: [`${playerId} moves ${moved.length} card(s) from exile to ${destination}`],
  };
}

function putAllMatchingFromExileOntoBattlefield(
  state: GameState,
  playerId: PlayerID,
  cardType: SimpleCardType,
  entersTapped?: boolean
): { state: GameState; log: string[] } {
  return putAllMatchingFromExileOntoBattlefieldWithController(state, playerId, playerId, cardType, entersTapped);
}

function putAllMatchingFromExileOntoBattlefieldWithController(
  state: GameState,
  sourcePlayerId: PlayerID,
  controllerId: PlayerID,
  cardType: SimpleCardType,
  entersTapped?: boolean
): { state: GameState; log: string[] } {
  const player = state.players.find(p => p.id === sourcePlayerId) as any;
  if (!player) return { state, log: [] };

  const exile = Array.isArray(player.exile) ? [...player.exile] : [];
  const kept: any[] = [];
  const moved: any[] = [];

  for (const card of exile) {
    if (cardMatchesType(card, cardType)) moved.push(card);
    else kept.push(card);
  }

  if (moved.length === 0) return { state, log: [] };

  // If impulse permissions were tracked for these cards, clear them when leaving exile.
  const nextState = clearPlayableFromExileForCards(state, sourcePlayerId, moved);
  const movedClean = moved.map(stripImpulsePermissionMarkers);

  const newPermanents: BattlefieldPermanent[] = movedClean.map((card: any, idx: number) => {
    const cardIdHint = String(card?.id || '').trim();
    const base = cardIdHint ? cardIdHint : `ex-${idx}`;
    return {
      id: `perm-${base}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      controller: controllerId,
      owner: sourcePlayerId,
      tapped: Boolean(entersTapped),
      summoningSickness: true,
      counters: {},
      attachments: [],
      modifiers: [],
      card,
    } as any;
  });

  const updatedPlayers = nextState.players.map(p => (p.id === sourcePlayerId ? ({ ...(p as any), exile: kept } as any) : p));
  return {
    state: { ...nextState, players: updatedPlayers as any, battlefield: [...(nextState.battlefield || []), ...newPermanents] } as any,
    log: [`${controllerId} puts ${moved.length} card(s) from ${sourcePlayerId}'s exile onto the battlefield`],
  };
}

function returnAllMatchingFromGraveyardToHand(
  state: GameState,
  playerId: PlayerID,
  cardType: SimpleCardType
): { state: GameState; log: string[] } {
  const player = state.players.find(p => p.id === playerId) as any;
  if (!player) return { state, log: [] };

  const graveyard = Array.isArray(player.graveyard) ? [...player.graveyard] : [];
  const hand = Array.isArray(player.hand) ? [...player.hand] : [];

  const kept: any[] = [];
  const moved: any[] = [];

  for (const card of graveyard) {
    if (cardMatchesType(card, cardType)) moved.push(card);
    else kept.push(card);
  }

  if (moved.length === 0) return { state, log: [] };

  const updatedPlayers = state.players.map(p =>
    p.id === playerId ? ({ ...(p as any), graveyard: kept, hand: [...hand, ...moved] } as any) : p
  );
  return {
    state: { ...state, players: updatedPlayers as any } as any,
    log: [`${playerId} returns ${moved.length} card(s) from graveyard to hand`],
  };
}

function exileAllMatchingFromGraveyard(
  state: GameState,
  playerId: PlayerID,
  cardType: SimpleCardType
): { state: GameState; log: string[] } {
  const player = state.players.find(p => p.id === playerId) as any;
  if (!player) return { state, log: [] };

  const graveyard = Array.isArray(player.graveyard) ? [...player.graveyard] : [];
  const exile = Array.isArray(player.exile) ? [...player.exile] : [];

  const kept: any[] = [];
  const moved: any[] = [];

  for (const card of graveyard) {
    if (cardMatchesType(card, cardType)) moved.push(card);
    else kept.push(card);
  }

  if (moved.length === 0) return { state, log: [] };

  const updatedPlayers = state.players.map(p =>
    p.id === playerId ? ({ ...(p as any), graveyard: kept, exile: [...exile, ...moved] } as any) : p
  );
  return {
    state: { ...state, players: updatedPlayers as any } as any,
    log: [`${playerId} exiles ${moved.length} card(s) from graveyard`],
  };
}

function putAllMatchingFromGraveyardOntoBattlefield(
  state: GameState,
  playerId: PlayerID,
  cardType: SimpleCardType,
  entersTapped?: boolean
): { state: GameState; log: string[] } {
  return putAllMatchingFromGraveyardOntoBattlefieldWithController(state, playerId, playerId, cardType, entersTapped);
}

function putAllMatchingFromGraveyardOntoBattlefieldWithController(
  state: GameState,
  sourcePlayerId: PlayerID,
  controllerId: PlayerID,
  cardType: SimpleCardType,
  entersTapped?: boolean
): { state: GameState; log: string[] } {
  const player = state.players.find(p => p.id === sourcePlayerId) as any;
  if (!player) return { state, log: [] };

  const graveyard = Array.isArray(player.graveyard) ? [...player.graveyard] : [];

  const kept: any[] = [];
  const moved: any[] = [];

  for (const card of graveyard) {
    if (cardMatchesType(card, cardType)) moved.push(card);
    else kept.push(card);
  }

  if (moved.length === 0) return { state, log: [] };

  const newPermanents: BattlefieldPermanent[] = moved.map((card: any, idx: number) => {
    const cardIdHint = String(card?.id || '').trim();
    const base = cardIdHint ? cardIdHint : `gy-${idx}`;
    return {
      id: `perm-${base}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      controller: controllerId,
      owner: sourcePlayerId,
      tapped: Boolean(entersTapped),
      summoningSickness: true,
      counters: {},
      attachments: [],
      modifiers: [],
      card,
    } as any;
  });

  const updatedPlayers = state.players.map(p => (p.id === sourcePlayerId ? ({ ...(p as any), graveyard: kept } as any) : p));
  return {
    state: { ...state, players: updatedPlayers as any, battlefield: [...(state.battlefield || []), ...newPermanents] } as any,
    log: [`${controllerId} puts ${moved.length} card(s) from ${sourcePlayerId}'s graveyard onto the battlefield`],
  };
}

function moveAllMatchingFromHand(
  state: GameState,
  playerId: PlayerID,
  cardType: SimpleCardType,
  destination: 'graveyard' | 'exile'
): { state: GameState; log: string[] } {
  const player = state.players.find(p => p.id === playerId) as any;
  if (!player) return { state, log: [] };

  const hand = Array.isArray(player.hand) ? [...player.hand] : [];
  const graveyard = Array.isArray(player.graveyard) ? [...player.graveyard] : [];
  const exile = Array.isArray(player.exile) ? [...player.exile] : [];

  const kept: any[] = [];
  const moved: any[] = [];

  for (const card of hand) {
    if (cardMatchesType(card, cardType)) moved.push(card);
    else kept.push(card);
  }

  if (moved.length === 0) return { state, log: [] };

  const nextPlayer: any = { ...(player as any), hand: kept };
  if (destination === 'graveyard') nextPlayer.graveyard = [...graveyard, ...moved];
  else nextPlayer.exile = [...exile, ...moved];

  const updatedPlayers = state.players.map(p => (p.id === playerId ? nextPlayer : p));
  const verb = destination === 'graveyard' ? 'puts' : 'exiles';
  const where = destination === 'graveyard' ? 'graveyard' : 'exile';
  return {
    state: { ...state, players: updatedPlayers as any } as any,
    log: [`${playerId} ${verb} ${moved.length} card(s) from hand to ${where}`],
  };
}

function putAllMatchingFromHandOntoBattlefield(
  state: GameState,
  playerId: PlayerID,
  cardType: SimpleCardType,
  entersTapped?: boolean
): { state: GameState; log: string[] } {
  return putAllMatchingFromHandOntoBattlefieldWithController(state, playerId, playerId, cardType, entersTapped);
}

function putAllMatchingFromHandOntoBattlefieldWithController(
  state: GameState,
  sourcePlayerId: PlayerID,
  controllerId: PlayerID,
  cardType: SimpleCardType,
  entersTapped?: boolean
): { state: GameState; log: string[] } {
  const player = state.players.find(p => p.id === sourcePlayerId) as any;
  if (!player) return { state, log: [] };

  const hand = Array.isArray(player.hand) ? [...player.hand] : [];

  const kept: any[] = [];
  const moved: any[] = [];

  for (const card of hand) {
    if (cardMatchesType(card, cardType)) moved.push(card);
    else kept.push(card);
  }

  if (moved.length === 0) return { state, log: [] };

  const newPermanents: BattlefieldPermanent[] = moved.map((card: any, idx: number) => {
    const cardIdHint = String(card?.id || '').trim();
    const base = cardIdHint ? cardIdHint : `hand-${idx}`;
    return {
      id: `perm-${base}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      controller: controllerId,
      owner: sourcePlayerId,
      tapped: Boolean(entersTapped),
      summoningSickness: true,
      counters: {},
      attachments: [],
      modifiers: [],
      card,
    } as any;
  });

  const updatedPlayers = state.players.map(p => (p.id === sourcePlayerId ? ({ ...(p as any), hand: kept } as any) : p));
  return {
    state: { ...state, players: updatedPlayers as any, battlefield: [...(state.battlefield || []), ...newPermanents] } as any,
    log: [`${controllerId} puts ${moved.length} card(s) from ${sourcePlayerId}'s hand onto the battlefield`],
  };
}

function parseSacrificeWhat(what: { readonly kind: string; readonly text?: string; readonly raw?: string }):
  | { readonly mode: 'all'; readonly type: SimplePermanentType }
  | { readonly mode: 'count'; readonly count: number; readonly type: SimplePermanentType }
  | null {
  if (what.kind !== 'raw') return null;
  const raw = String((what as any).text || '').trim();
  if (!raw) return null;

  const cleaned = raw.replace(/[.\s]+$/g, '').trim();
  const lower = cleaned.toLowerCase();

  // Shorthand deterministic forms (no explicit "all" / count) that still mean a fixed set:
  // - "your creatures" / "your artifacts" / ...
  // - "creatures you control" / "artifacts under your control" / ...
  // Note: By rules, a player can only sacrifice permanents they control; reject opponent-scoped text.
  {
    const normalized = cleaned.replace(/\u2019/g, "'");
    const normalizedLower = normalized.toLowerCase();

    const mentionsOpponentControl =
      /^(?:your\s+)?opponents?['’]s?\s+/i.test(normalized) ||
      /^opponent['’]s?\s+/i.test(normalized) ||
      /\b(?:your opponents|opponents)\s+control\b/i.test(normalized) ||
      /\b(?:an opponent|each opponent)\s+controls\b/i.test(normalized) ||
      /\byou\s+(?:don'?t|do not)\s+control\b/i.test(normalized);

    if (!mentionsOpponentControl && (/^your\s+/i.test(normalized) || /\b(?:you control|under your control)\b/i.test(normalized))) {
      const stripped = normalized
        .replace(/^your\s+/i, '')
        .replace(/\s+you\s+control\b/gi, '')
        .replace(/\s+under\s+your\s+control\b/gi, '')
        .trim();
      const type = parseSimplePermanentTypeFromText(stripped);
      if (type) return { mode: 'all', type };
    }
  }

  if (/^all\b/i.test(lower)) {
    const type = parseSimplePermanentTypeFromText(cleaned);
    return type ? { mode: 'all', type } : null;
  }

  // Deterministic-forced only when player controls <= N matching permanents.
  const mCount = cleaned.match(/^(a|an|\d+)\s+(.+)$/i);
  if (!mCount) return null;
  const countRaw = String(mCount[1] || '').toLowerCase();
  const rest = String(mCount[2] || '').trim();

  const count = countRaw === 'a' || countRaw === 'an' ? 1 : parseInt(countRaw, 10);
  if (!Number.isFinite(count) || count <= 0) return null;

  const type = parseSimplePermanentTypeFromText(rest);
  if (!type) return null;
  return { mode: 'count', count: Math.max(1, count | 0), type };
}

function addTokensToBattlefield(
  state: GameState,
  controllerId: PlayerID,
  amount: number,
  tokenHint: string,
  clauseRaw: string,
  ctx: OracleIRExecutionContext,
  entersTapped?: boolean,
  withCounters?: Record<string, number>
): { state: GameState; log: string[] } {
  const log: string[] = [];

  const hasOverrides = Boolean(entersTapped) || (withCounters && Object.keys(withCounters).length > 0);

  const resolveCommonTokenKey = (name: string): string | null => {
    const raw = String(name || '').trim();
    if (!raw) return null;
    if ((COMMON_TOKENS as any)[raw]) return raw;
    const lower = raw.toLowerCase();
    const key = Object.keys(COMMON_TOKENS).find(k => k.toLowerCase() === lower);
    return key || null;
  };

  const hintedName = tokenHint
    .replace(/\btoken(s)?\b/gi, '')
    .replace(/\b(creature|artifact|enchantment)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (hintedName) {
    const commonKey = resolveCommonTokenKey(hintedName);
    if (commonKey) {
      const count = Math.max(1, amount | 0);
      const result = hasOverrides
        ? createTokens(
            {
              characteristics: { ...COMMON_TOKENS[commonKey], entersTapped: entersTapped || undefined },
              count,
              controllerId,
              sourceId: ctx.sourceId,
              sourceName: ctx.sourceName,
              withCounters,
            },
            state.battlefield || []
          )
        : createTokensByName(commonKey, count, controllerId, state.battlefield || [], ctx.sourceId, ctx.sourceName);

      if (result) {
        const tokensToAdd = result.tokens.map(t => t.token);
        return {
          state: { ...state, battlefield: [...(state.battlefield || []), ...(tokensToAdd as BattlefieldPermanent[])] },
          log: [...result.log],
        };
      }
    }
  }

  const tokenParse = parseTokenCreationFromText(clauseRaw);
  if (!tokenParse) {
    log.push('Token creation not recognized');
    return { state, log };
  }

  const count = Math.max(1, amount | 0);

  // If token name maps to a common token and there are no overrides, use that path.
  if (!hasOverrides) {
    const commonKey = resolveCommonTokenKey(tokenParse.characteristics.name);
    if (commonKey) {
      const commonParsed = createTokensByName(
        commonKey,
        count,
        controllerId,
        state.battlefield || [],
        ctx.sourceId,
        ctx.sourceName
      );
      if (commonParsed) {
        const tokensToAdd = commonParsed.tokens.map(t => t.token);
        return {
          state: { ...state, battlefield: [...(state.battlefield || []), ...(tokensToAdd as BattlefieldPermanent[])] },
          log: [...commonParsed.log],
        };
      }
    }
  }

  // Otherwise, create from characteristics.
  const created = createTokens(
    {
      characteristics: {
        ...tokenParse.characteristics,
        entersTapped: entersTapped ?? tokenParse.characteristics.entersTapped,
      },
      count,
      controllerId,
      sourceId: ctx.sourceId,
      sourceName: ctx.sourceName,
      withCounters,
    },
    state.battlefield || []
  );

  const tokensToAdd = created.tokens.map(t => t.token);
  return {
    state: { ...state, battlefield: [...(state.battlefield || []), ...(tokensToAdd as BattlefieldPermanent[])] },
    log: [...created.log],
  };
}

/**
 * Best-effort executor for Oracle Effect IR.
 *
 * Purposefully conservative:
 * - Only applies steps that can be executed without player choices.
 * - Skips optional ("You may") steps unless allowOptional=true.
 * - Skips targeting-dependent steps for now.
 */
export function applyOracleIRStepsToGameState(
  state: GameState,
  steps: readonly OracleEffectStep[],
  ctx: OracleIRExecutionContext,
  options: OracleIRExecutionOptions = {}
): OracleIRExecutionResult {
  const log: string[] = [];
  const appliedSteps: OracleEffectStep[] = [];
  const skippedSteps: OracleEffectStep[] = [];
  const controllerId = (String(ctx.controllerId || '').trim() || ctx.controllerId) as PlayerID;
  let lastRevealedCardCount = 0;
  let lastDiscardedCardCount = 0;
  let lastExiledCardCount = 0;
  let lastExiledCards: any[] = [];
  let lastGoadedCreatures: BattlefieldPermanent[] = [];
  let lastSacrificedCreaturesPowerTotal = 0;
  let lastExcessDamageDealtThisWay = 0;
  let lastScryLookedAtCount = 0;

  let nextState = state;
  const pendingOptionalSteps: OracleEffectStep[] = [];

  for (const step of steps) {
    const isOptional = Boolean((step as any).optional);
    if (isOptional && !options.allowOptional) {
      skippedSteps.push(step);
      pendingOptionalSteps.push(step);
      log.push(`Skipped optional step (needs player choice): ${(step as any).raw ?? step.kind}`);
      continue;
    }

    switch (step.kind) {
      case 'exile_top': {
        const players = resolvePlayers(nextState, step.who, ctx);
        if (players.length === 0) {
          skippedSteps.push(step);
          log.push(`Skipped exile top (unsupported player selector): ${step.raw}`);
          break;
        }

        const exileCountByPlayer = new Map<PlayerID, number>();
        for (const playerId of players) {
          const resolvedCount =
            quantityToNumber(step.amount) ??
            resolveUnknownExileUntilAmountForPlayer(nextState, playerId, step.amount, ctx);
          if (resolvedCount === null) {
            skippedSteps.push(step);
            log.push(`Skipped exile top (unknown amount): ${step.raw}`);
            exileCountByPlayer.clear();
            break;
          }
          exileCountByPlayer.set(playerId, resolvedCount);
        }

        if (exileCountByPlayer.size === 0) {
          break;
        }

        let totalExiled = 0;
        const exiledCardsThisStep: any[] = [];
        for (const playerId of players) {
          const amount = exileCountByPlayer.get(playerId) ?? 0;
          const r = exileTopCardsForPlayer(nextState, playerId, amount);
          nextState = r.state;
          totalExiled += Math.max(0, r.exiled.length | 0);
          exiledCardsThisStep.push(...(r.exiled as any[]));
          log.push(...r.log);
        }

        lastExiledCardCount = totalExiled;
        lastExiledCards = exiledCardsThisStep;

        appliedSteps.push(step);
        break;
      }

      case 'impulse_exile_top': {
        const players = resolvePlayers(nextState, step.who, ctx);
        if (players.length === 0) {
          skippedSteps.push(step);
          log.push(`Skipped impulse exile top (unsupported player selector): ${step.raw}`);
          break;
        }

        const exileCountByPlayer = new Map<PlayerID, number>();
        for (const playerId of players) {
          const resolvedCount =
            quantityToNumber(step.amount) ??
            resolveUnknownExileUntilAmountForPlayer(nextState, playerId, step.amount, ctx);
          if (resolvedCount === null) {
            skippedSteps.push(step);
            log.push(`Skipped impulse exile top (unknown amount): ${step.raw}`);
            exileCountByPlayer.clear();
            break;
          }
          exileCountByPlayer.set(playerId, resolvedCount);
        }

        if (exileCountByPlayer.size === 0) {
          break;
        }

        const permission = (step as any).permission as 'play' | 'cast' | undefined;
        if (!permission) {
          skippedSteps.push(step);
          log.push(`Skipped impulse exile top (missing permission): ${step.raw}`);
          break;
        }

        const playableUntilTurn = getPlayableUntilTurnForImpulseDuration(nextState, (step as any).duration);
        const condition = (step as any).condition;
        const exiledBy = ctx.sourceName;
        const returnUncastToBottom = shouldReturnUncastExiledToBottom(step as any);
        const shuffleRestIntoLibrary = shouldShuffleRestIntoLibrary(step as any);

        let totalExiled = 0;
        const exiledCardsThisStep: any[] = [];
        for (const playerId of players) {
          const amount = exileCountByPlayer.get(playerId) ?? 0;
          const r = exileTopCardsForPlayer(nextState, playerId, amount);
          nextState = r.state;
          totalExiled += Math.max(0, r.exiled.length | 0);
          exiledCardsThisStep.push(...(r.exiled as any[]));
          log.push(...r.log);

          const markerResult = applyImpulsePermissionMarkers(nextState, playerId, r.exiled, {
            permission,
            playableUntilTurn,
            condition,
            exiledBy,
          });
          nextState = markerResult.state;
          if (markerResult.granted > 0) {
            log.push(`${playerId} may ${permission === 'play' ? 'play' : 'cast'} ${markerResult.granted} exiled card(s)`);
          }

          if (shuffleRestIntoLibrary && r.exiled.length > 0) {
            const split = splitExiledForShuffleRest(step as any, r.exiled);
            if (split.returnToLibrary.length > 0) {
              const shuffledRestResult = putSpecificExiledCardsOnLibraryBottom(nextState, playerId, split.returnToLibrary);
              nextState = shuffledRestResult.state;
              log.push(...shuffledRestResult.log);
            }
          }

          if (returnUncastToBottom && r.exiled.length > 0) {
            const bottomResult = putSpecificExiledCardsOnLibraryBottom(nextState, playerId, r.exiled);
            nextState = bottomResult.state;
            log.push(...bottomResult.log);
          }
        }

        lastExiledCardCount = totalExiled;
        lastExiledCards = exiledCardsThisStep;

        appliedSteps.push(step);
        break;
      }

      case 'goad': {
        const targetCreatureIds = resolveGoadTargetCreatureIds(nextState, step.target, ctx);
        if (targetCreatureIds.length === 0) {
          skippedSteps.push(step);
          log.push(`Skipped goad (no deterministic creature targets): ${step.raw}`);
          break;
        }

        const next = applyGoadToCreatures(nextState, targetCreatureIds, controllerId);
        if (!next) {
          skippedSteps.push(step);
          log.push(`Skipped goad (failed to apply): ${step.raw}`);
          break;
        }

        nextState = next;
        const goadedSet = new Set(targetCreatureIds);
        lastGoadedCreatures = (((nextState as any).battlefield || []) as BattlefieldPermanent[])
          .filter((perm: any) => goadedSet.has(String((perm as any)?.id || '').trim()));
        log.push(`Goaded ${targetCreatureIds.length} creature(s)`);
        appliedSteps.push(step);
        break;
      }

      case 'draw': {
        const amount = quantityToNumber(step.amount);
        if (amount === null) {
          skippedSteps.push(step);
          log.push(`Skipped draw (unknown amount): ${step.raw}`);
          break;
        }

        const players = resolvePlayers(nextState, step.who, ctx);
        if (players.length === 0) {
          skippedSteps.push(step);
          log.push(`Skipped draw (unsupported player selector): ${step.raw}`);
          break;
        }

        for (const playerId of players) {
          const r = drawCardsForPlayer(nextState, playerId, amount);
          nextState = r.state;
          log.push(...r.log);
        }

        appliedSteps.push(step);
        break;
      }

      case 'add_mana': {
        const players = resolvePlayers(nextState, step.who, ctx);
        if (players.length === 0) {
          skippedSteps.push(step);
          log.push(`Skipped add mana (unsupported player selector): ${step.raw}`);
          break;
        }

        // Be conservative: if we can't apply to any one player, skip the whole step.
        let tempState = nextState;
        const tempLog: string[] = [];
        let failed = false;
        for (const playerId of players) {
          const r = addManaToPoolForPlayer(tempState, playerId, step.mana);
          tempLog.push(...r.log);
          if (!r.applied) {
            failed = true;
            break;
          }
          tempState = r.state;
        }
        if (failed) {
          skippedSteps.push(step);
          log.push(...tempLog);
          break;
        }

        nextState = tempState;
        log.push(...tempLog);

        appliedSteps.push(step);
        break;
      }

      case 'scry': {
        lastScryLookedAtCount = 0;
        const amount = quantityToNumber(step.amount);
        if (amount === null) {
          skippedSteps.push(step);
          log.push(`Skipped scry (unknown amount): ${step.raw}`);
          break;
        }

        const players = resolvePlayers(nextState, step.who, ctx);
        if (players.length === 0) {
          skippedSteps.push(step);
          log.push(`Skipped scry (unsupported player selector): ${step.raw}`);
          break;
        }

        // Deterministic no-op cases only.
        if (amount <= 0) {
          lastScryLookedAtCount = 0;
          log.push(`Scry ${amount} (no-op): ${step.raw}`);
          appliedSteps.push(step);
          break;
        }

        const wouldNeedChoice = players.some(playerId => {
          const p = nextState.players.find(pp => pp.id === playerId) as any;
          const libLen = Array.isArray(p?.library) ? p.library.length : 0;
          return libLen > 0;
        });

        if (wouldNeedChoice) {
          skippedSteps.push(step);
          log.push(`Skipped scry (requires player choice): ${step.raw}`);
          break;
        }

        log.push(`Scry ${amount} (no cards in library): ${step.raw}`);
        lastScryLookedAtCount = 0;
        appliedSteps.push(step);
        break;
      }

      case 'surveil': {
        const amount = quantityToNumber(step.amount);
        if (amount === null) {
          skippedSteps.push(step);
          log.push(`Skipped surveil (unknown amount): ${step.raw}`);
          break;
        }

        const players = resolvePlayers(nextState, step.who, ctx);
        if (players.length === 0) {
          skippedSteps.push(step);
          log.push(`Skipped surveil (unsupported player selector): ${step.raw}`);
          break;
        }

        // Deterministic no-op cases only.
        if (amount <= 0) {
          log.push(`Surveil ${amount} (no-op): ${step.raw}`);
          appliedSteps.push(step);
          break;
        }

        const wouldNeedChoice = players.some(playerId => {
          const p = nextState.players.find(pp => pp.id === playerId) as any;
          const libLen = Array.isArray(p?.library) ? p.library.length : 0;
          return libLen > 0;
        });

        if (wouldNeedChoice) {
          skippedSteps.push(step);
          log.push(`Skipped surveil (requires player choice): ${step.raw}`);
          break;
        }

        log.push(`Surveil ${amount} (no cards in library): ${step.raw}`);
        appliedSteps.push(step);
        break;
      }

      case 'mill': {
        const players = resolvePlayers(nextState, step.who, ctx);
        if (players.length === 0) {
          skippedSteps.push(step);
          log.push(`Skipped mill (unsupported player selector): ${step.raw}`);
          break;
        }

        const millCountByPlayer = new Map<PlayerID, number>();
        for (const playerId of players) {
          const resolvedCount =
            quantityToNumber(step.amount) ??
            resolveUnknownMillUntilAmountForPlayer(nextState, playerId, step.amount);
          if (resolvedCount === null) {
            skippedSteps.push(step);
            log.push(`Skipped mill (unknown amount): ${step.raw}`);
            millCountByPlayer.clear();
            break;
          }
          millCountByPlayer.set(playerId, resolvedCount);
        }

        if (millCountByPlayer.size === 0) {
          break;
        }

        for (const playerId of players) {
          const amount = millCountByPlayer.get(playerId) ?? 0;
          const r = millCardsForPlayer(nextState, playerId, amount);
          nextState = r.state;
          log.push(...r.log);
        }

        const unknownRaw = String((step.amount as any)?.raw || '').toLowerCase();
        const isRevealThisWay = step.amount.kind === 'unknown' && unknownRaw.includes('reveal a land card');
        if (isRevealThisWay) {
          lastRevealedCardCount = Array.from(millCountByPlayer.values()).reduce((sum, n) => sum + (Number(n) || 0), 0);
        }

        appliedSteps.push(step);
        break;
      }

      case 'modify_pt': {
        const targetCreatureId = resolveSingleCreatureTargetId(nextState, step.target, ctx);
        if (!targetCreatureId) {
          skippedSteps.push(step);
          log.push(`Skipped P/T modifier (no deterministic creature target): ${step.raw}`);
          break;
        }

        let whereXValue: number | null = null;

        if (step.condition) {
          if (step.condition.kind === 'where') {
            whereXValue = evaluateModifyPtWhereX(
              nextState,
              controllerId,
              step.condition.raw,
              targetCreatureId,
              ctx,
              {
                lastRevealedCardCount,
                lastDiscardedCardCount,
                lastExiledCardCount,
                lastExiledCards,
                lastGoadedCreatures,
                lastSacrificedCreaturesPowerTotal,
                lastExcessDamageDealtThisWay,
                lastScryLookedAtCount,
              },
            );
            if (whereXValue === null) {
              skippedSteps.push(step);
              log.push(`Skipped P/T modifier (unsupported where-clause): ${step.raw}`);
              break;
            }
          } else {
            const cond = evaluateModifyPtCondition(nextState, controllerId, step.condition.raw);
            if (cond === null) {
              skippedSteps.push(step);
              log.push(`Skipped P/T modifier (unsupported condition clause): ${step.raw}`);
              break;
            }
            if (!cond) {
              skippedSteps.push(step);
              log.push(`Skipped P/T modifier (condition false): ${step.raw}`);
              break;
            }
          }
        }

        if (step.scaler?.kind === 'unknown') {
          skippedSteps.push(step);
          log.push(`Skipped P/T modifier (unsupported scaler): ${step.raw}`);
          break;
        }

        const scale = step.scaler?.kind === 'per_revealed_this_way'
          ? Math.max(0, lastRevealedCardCount | 0)
          : 1;

        if ((step.powerUsesX || step.toughnessUsesX) && whereXValue === null) {
          skippedSteps.push(step);
          log.push(`Skipped P/T modifier (X used without supported where-clause): ${step.raw}`);
          break;
        }

        const basePower = step.powerUsesX ? ((step.power | 0) * (whereXValue ?? 0)) : (step.power | 0);
        const baseToughness = step.toughnessUsesX ? ((step.toughness | 0) * (whereXValue ?? 0)) : (step.toughness | 0);
        const powerBonus = basePower * scale;
        const toughnessBonus = baseToughness * scale;
        const next = applyTemporaryPowerToughnessModifier(
          nextState,
          targetCreatureId,
          ctx,
          powerBonus,
          toughnessBonus,
          step.scaler?.kind === 'per_revealed_this_way'
        );

        if (!next) {
          skippedSteps.push(step);
          log.push(`Skipped P/T modifier (target not on battlefield): ${step.raw}`);
          break;
        }

        nextState = next;
        log.push(`${targetCreatureId} gets +${powerBonus}/+${toughnessBonus} until end of turn`);
        appliedSteps.push(step);
        break;
      }

      case 'modify_pt_per_revealed': {
        const targetCreatureId = resolveTrepanationBoostTargetCreatureId(nextState, ctx);
        if (!targetCreatureId) {
          skippedSteps.push(step);
          log.push(`Skipped P/T modifier (no deterministic creature target): ${step.raw}`);
          break;
        }

        const revealed = Math.max(0, lastRevealedCardCount | 0);
        const powerBonus = revealed * (step.powerPerCard | 0);
        const toughnessBonus = revealed * (step.toughnessPerCard | 0);

        const next = applyTemporaryPowerToughnessModifier(
          nextState,
          targetCreatureId,
          ctx,
          powerBonus,
          toughnessBonus,
          true
        );
        if (!next) {
          skippedSteps.push(step);
          log.push(`Skipped P/T modifier (target not on battlefield): ${step.raw}`);
          break;
        }

        nextState = next;
        log.push(`${targetCreatureId} gets +${powerBonus}/+${toughnessBonus} until end of turn`);
        appliedSteps.push(step);
        break;
      }

      case 'discard': {
        const amount = quantityToNumber(step.amount);
        if (amount === null) {
          skippedSteps.push(step);
          log.push(`Skipped discard (unknown amount): ${step.raw}`);
          break;
        }

        const players = resolvePlayers(nextState, step.who, ctx);
        if (players.length === 0) {
          skippedSteps.push(step);
          log.push(`Skipped discard (unsupported player selector): ${step.raw}`);
          break;
        }

        // Be conservative: if any targeted player would need to choose, skip the whole step.
        const wouldNeedChoice = players.some(playerId => {
          const p = nextState.players.find(pp => pp.id === playerId) as any;
          const handLen = Array.isArray(p?.hand) ? p.hand.length : 0;
          return handLen > Math.max(0, amount | 0);
        });

        if (wouldNeedChoice) {
          skippedSteps.push(step);
          log.push(`Skipped discard (requires player choice): ${step.raw}`);
          break;
        }

        let totalDiscarded = 0;
        for (const playerId of players) {
          const r = discardCardsForPlayer(nextState, playerId, amount);
          nextState = r.state;
          totalDiscarded += Math.max(0, Number(r.discardedCount) || 0);
          log.push(...r.log);
        }

        lastDiscardedCardCount = totalDiscarded;

        appliedSteps.push(step);
        break;
      }

      case 'gain_life': {
        const amount = quantityToNumber(step.amount);
        if (amount === null) {
          skippedSteps.push(step);
          log.push(`Skipped life gain (unknown amount): ${step.raw}`);
          break;
        }

        const players = resolvePlayers(nextState, step.who, ctx);
        if (players.length === 0) {
          skippedSteps.push(step);
          log.push(`Skipped life gain (unsupported player selector): ${step.raw}`);
          break;
        }

        for (const playerId of players) {
          const r = adjustLife(nextState, playerId, amount);
          nextState = r.state;
          log.push(...r.log);
        }

        appliedSteps.push(step);
        break;
      }

      case 'lose_life': {
        const amount = quantityToNumber(step.amount);
        if (amount === null) {
          skippedSteps.push(step);
          log.push(`Skipped life loss (unknown amount): ${step.raw}`);
          break;
        }

        const players = resolvePlayers(nextState, step.who, ctx);
        if (players.length === 0) {
          skippedSteps.push(step);
          log.push(`Skipped life loss (unsupported player selector): ${step.raw}`);
          break;
        }

        for (const playerId of players) {
          const r = adjustLife(nextState, playerId, -amount);
          nextState = r.state;
          log.push(...r.log);
        }

        appliedSteps.push(step);
        break;
      }

      case 'deal_damage': {
        const amount = quantityToNumber(step.amount);
        if (amount === null) {
          skippedSteps.push(step);
          log.push(`Skipped deal damage (unknown amount): ${step.raw}`);
          break;
        }

        let excessDamageThisStep = 0;

        // Only supports dealing damage to players (no creatures/planeswalkers) and no targeting.
        const players = resolvePlayersFromDamageTarget(nextState, step.target as any, ctx);
        if (players.length > 0) {
          for (const playerId of players) {
            const r = adjustLife(nextState, playerId, -amount);
            nextState = r.state;
            // Override wording to avoid calling this "life loss" in the log.
            log.push(`${playerId} is dealt ${amount} damage`);
          }

          lastExcessDamageDealtThisWay = 0;

          appliedSteps.push(step);
          break;
        }

        // Deterministic mixed targets (no targeting): e.g. "each creature and each opponent".
        if ((step.target as any)?.kind === 'raw') {
          const rawText = String(((step.target as any).text || '') as any).trim();
          const mixed = parseDeterministicMixedDamageTarget(rawText);
          if (mixed) {
            const playerIds = new Set<PlayerID>();
            for (const who of mixed.players) {
              const ids =
                who === 'you'
                  ? resolvePlayers(nextState, { kind: 'you' } as any, ctx)
                  : who === 'each_player'
                    ? resolvePlayers(nextState, { kind: 'each_player' } as any, ctx)
                    : who === 'each_opponent'
                      ? resolvePlayers(nextState, { kind: 'each_opponent' } as any, ctx)
                      : who === 'each_of_those_opponents'
                        ? resolvePlayers(nextState, { kind: 'each_of_those_opponents' } as any, ctx)
                        : who === 'target_player'
                          ? resolvePlayers(nextState, { kind: 'target_player' } as any, ctx)
                          : resolvePlayers(nextState, { kind: 'target_opponent' } as any, ctx);
              for (const id of ids) playerIds.add(id);
            }

            for (const playerId of playerIds) {
              const r = adjustLife(nextState, playerId, -amount);
              nextState = r.state;
              log.push(`${playerId} is dealt ${amount} damage`);
            }

            let updatedBattlefield = (nextState.battlefield || []) as any[];
            for (const selector of mixed.selectors) {
              updatedBattlefield = updatedBattlefield.map(p => {
                if (!permanentMatchesSelector(p as any, selector, ctx)) return p as any;
                excessDamageThisStep += getExcessDamageToPermanent(p as any, amount);
                if (hasExecutorClass(p as any, 'battle')) return removeDefenseCountersFromBattle(p as any, amount);
                if (hasExecutorClass(p as any, 'creature')) return addDamageToPermanentLikeCreature(p as any, amount);
                if (hasExecutorClass(p as any, 'planeswalker')) return removeLoyaltyFromPlaneswalker(p as any, amount);
                return p as any;
              });
            }

            nextState = { ...(nextState as any), battlefield: updatedBattlefield } as any;
            lastExcessDamageDealtThisWay = Math.max(0, excessDamageThisStep);
            log.push(`Dealt ${amount} damage to ${rawText}`);
            appliedSteps.push(step);
            break;
          }
        }

        // Deterministic battlefield-group damage (no targeting): "each/all creature(s)" / "... and each planeswalker".
        if ((step.target as any)?.kind === 'raw') {
          const rawText = String(((step.target as any).text || '') as any).trim();
          const normalized = normalizeRepeatedEachAllInList(rawText);
          const selector = parseSimpleBattlefieldSelector({ kind: 'raw', text: normalized } as any);

          if (selector) {
            const disallowed = selector.types.some(
              t => t === 'land' || t === 'artifact' || t === 'enchantment' || t === 'permanent' || t === 'nonland_permanent'
            );
            if (disallowed) {
              skippedSteps.push(step);
              log.push(`Skipped deal damage (unsupported permanent types): ${step.raw}`);
              break;
            }

            const updatedBattlefield = (nextState.battlefield || []).map(p => {
              if (!permanentMatchesSelector(p as any, selector, ctx)) return p as any;
              excessDamageThisStep += getExcessDamageToPermanent(p as any, amount);
              if (hasExecutorClass(p as any, 'battle')) return removeDefenseCountersFromBattle(p as any, amount);
              if (hasExecutorClass(p as any, 'creature')) return addDamageToPermanentLikeCreature(p as any, amount);
              if (hasExecutorClass(p as any, 'planeswalker')) return removeLoyaltyFromPlaneswalker(p as any, amount);
              return p as any;
            }) as any;

            nextState = { ...(nextState as any), battlefield: updatedBattlefield } as any;
            lastExcessDamageDealtThisWay = Math.max(0, excessDamageThisStep);
            log.push(`Dealt ${amount} damage to ${normalized}`);
            appliedSteps.push(step);
            break;
          }
        }

        skippedSteps.push(step);
        log.push(`Skipped deal damage (unsupported target): ${step.raw}`);
        break;
      }

      case 'tap_or_untap': {
        const targetIds = resolveTapOrUntapTargetIds(nextState, step.target as any, ctx);
        if (targetIds.length === 0) {
          skippedSteps.push(step);
          log.push(`Skipped tap/untap (no deterministic target): ${step.raw}`);
          break;
        }

        const currentTargets = ((nextState.battlefield || []) as any[]).filter((perm: any) =>
          targetIds.includes(String(perm?.id || '').trim())
        );
        const choice: 'tap' | 'untap' =
          ctx.tapOrUntapChoice ?? (currentTargets.some((perm: any) => Boolean(perm?.tapped)) ? 'untap' : 'tap');

        nextState = applyTapOrUntapToBattlefield(nextState, targetIds, choice);
        log.push(`${choice === 'tap' ? 'Tapped' : 'Untapped'} ${targetIds.length} permanent(s)`);
        appliedSteps.push(step);
        break;
      }

      case 'move_zone': {
        // Deterministic only for moving "all ... cards" from a known zone (hand/graveyard) for the controller.
        if (step.to !== 'hand' && step.to !== 'exile' && step.to !== 'graveyard' && step.to !== 'battlefield') {
          skippedSteps.push(step);
          log.push(`Skipped move zone (unsupported destination): ${step.raw}`);
          break;
        }

        // Battlefield -> owners' hands (bounce)
        if (step.to === 'hand' && (step.what as any)?.kind === 'raw') {
          const whatText = String((step.what as any).text || '').trim();
          // Avoid misclassifying "... cards from your graveyard" etc. as battlefield selectors.
          if (whatText && !/\b(from|card|cards)\b/i.test(whatText)) {
            const selector = parseSimpleBattlefieldSelector(step.what as any);
            if (selector) {
              const r = bounceMatchingBattlefieldPermanentsToOwnersHands(nextState, selector, ctx);
              nextState = r.state;
              log.push(...r.log);
              appliedSteps.push(step);
              break;
            }
          }
        }

        const parsedFromGraveyard = parseMoveZoneAllFromYourGraveyard(step.what as any);
        const parsedFromHand = parseMoveZoneAllFromYourHand(step.what as any);
        const parsedFromExile = parseMoveZoneAllFromYourExile(step.what as any);
        const parsedEachPlayersGy = parseMoveZoneAllFromEachPlayersGraveyard(step.what as any);
        const parsedEachPlayersHand = parseMoveZoneAllFromEachPlayersHand(step.what as any);
        const parsedEachPlayersExile = parseMoveZoneAllFromEachPlayersExile(step.what as any);
        const parsedEachOpponentsGy = parseMoveZoneAllFromEachOpponentsGraveyard(step.what as any);
        const parsedEachOpponentsHand = parseMoveZoneAllFromEachOpponentsHand(step.what as any);
        const parsedEachOpponentsExile = parseMoveZoneAllFromEachOpponentsExile(step.what as any);

        if (
          !parsedFromGraveyard &&
          !parsedFromHand &&
          !parsedFromExile &&
          !parsedEachPlayersGy &&
          !parsedEachPlayersHand &&
          !parsedEachPlayersExile &&
          !parsedEachOpponentsGy &&
          !parsedEachOpponentsHand &&
          !parsedEachOpponentsExile
        ) {
          skippedSteps.push(step);
          log.push(`Skipped move zone (unsupported selector): ${step.raw}`);
          break;
        }

        if (parsedEachOpponentsExile) {
          if (step.to !== 'hand' && step.to !== 'graveyard' && step.to !== 'battlefield') {
            skippedSteps.push(step);
            log.push(`Skipped move zone (unsupported destination): ${step.raw}`);
            break;
          }

          if (
            step.to === 'battlefield' &&
            (step as any).battlefieldController?.kind !== 'you' &&
            (step as any).battlefieldController?.kind !== 'owner_of_moved_cards'
          ) {
            skippedSteps.push(step);
            log.push(`Skipped move zone (battlefield requires explicit control override): ${step.raw}`);
            break;
          }

          const hasValidController = (nextState.players as any[]).some(p => p?.id === controllerId);
          const opponents = hasValidController
            ? (nextState.players as any[]).filter(p => p?.id && p.id !== controllerId)
            : [];
          for (const p of opponents) {
            const r =
              step.to === 'hand'
                ? moveAllMatchingFromExile(nextState, p.id, parsedEachOpponentsExile.cardType, 'hand')
                : step.to === 'graveyard'
                  ? moveAllMatchingFromExile(nextState, p.id, parsedEachOpponentsExile.cardType, 'graveyard')
                  : (step as any).battlefieldController?.kind === 'owner_of_moved_cards'
                    ? putAllMatchingFromExileOntoBattlefield(nextState, p.id, parsedEachOpponentsExile.cardType, (step as any).entersTapped)
                    : putAllMatchingFromExileOntoBattlefieldWithController(
                        nextState,
                        p.id,
                        controllerId,
                        parsedEachOpponentsExile.cardType,
                        (step as any).entersTapped
                      );
            nextState = r.state;
            log.push(...r.log);
          }
          appliedSteps.push(step);
          break;
        }

        if (parsedEachOpponentsGy) {
          if (step.to !== 'exile' && step.to !== 'hand' && step.to !== 'battlefield') {
            skippedSteps.push(step);
            log.push(`Skipped move zone (unsupported destination): ${step.raw}`);
            break;
          }

          if (
            step.to === 'battlefield' &&
            (step as any).battlefieldController?.kind !== 'you' &&
            (step as any).battlefieldController?.kind !== 'owner_of_moved_cards'
          ) {
            skippedSteps.push(step);
            log.push(`Skipped move zone (battlefield requires explicit control override): ${step.raw}`);
            break;
          }

          const hasValidController = (nextState.players as any[]).some(p => p?.id === controllerId);
          const opponents = hasValidController
            ? (nextState.players as any[]).filter(p => p?.id && p.id !== controllerId)
            : [];
          for (const p of opponents) {
            const r =
              step.to === 'hand'
                ? returnAllMatchingFromGraveyardToHand(nextState, p.id, parsedEachOpponentsGy.cardType)
                : step.to === 'battlefield'
                  ? (step as any).battlefieldController?.kind === 'owner_of_moved_cards'
                    ? putAllMatchingFromGraveyardOntoBattlefield(nextState, p.id, parsedEachOpponentsGy.cardType, (step as any).entersTapped)
                    : putAllMatchingFromGraveyardOntoBattlefieldWithController(
                        nextState,
                        p.id,
                        controllerId,
                        parsedEachOpponentsGy.cardType,
                        (step as any).entersTapped
                      )
                  : exileAllMatchingFromGraveyard(nextState, p.id, parsedEachOpponentsGy.cardType);
            nextState = r.state;
            log.push(...r.log);
          }
          appliedSteps.push(step);
          break;
        }

        if (parsedEachOpponentsHand) {
          if (step.to !== 'exile' && step.to !== 'graveyard' && step.to !== 'battlefield') {
            skippedSteps.push(step);
            log.push(`Skipped move zone (unsupported destination): ${step.raw}`);
            break;
          }

          if (
            step.to === 'battlefield' &&
            (step as any).battlefieldController?.kind !== 'you' &&
            (step as any).battlefieldController?.kind !== 'owner_of_moved_cards'
          ) {
            skippedSteps.push(step);
            log.push(`Skipped move zone (battlefield requires explicit control override): ${step.raw}`);
            break;
          }

          const hasValidController = (nextState.players as any[]).some(p => p?.id === controllerId);
          const opponents = hasValidController
            ? (nextState.players as any[]).filter(p => p?.id && p.id !== controllerId)
            : [];
          for (const p of opponents) {
            const r =
              step.to === 'battlefield'
                ? (step as any).battlefieldController?.kind === 'you'
                  ? putAllMatchingFromHandOntoBattlefieldWithController(
                      nextState,
                      p.id,
                      controllerId,
                      parsedEachOpponentsHand.cardType,
                      (step as any).entersTapped
                    )
                  : putAllMatchingFromHandOntoBattlefield(nextState, p.id, parsedEachOpponentsHand.cardType, (step as any).entersTapped)
                : moveAllMatchingFromHand(nextState, p.id, parsedEachOpponentsHand.cardType, step.to);
            nextState = r.state;
            log.push(...r.log);
          }
          appliedSteps.push(step);
          break;
        }

        if (parsedEachPlayersGy) {
          if (step.to !== 'exile' && step.to !== 'hand' && step.to !== 'battlefield') {
            skippedSteps.push(step);
            log.push(`Skipped move zone (unsupported destination): ${step.raw}`);
            break;
          }

          for (const p of nextState.players as any[]) {
            const r =
              step.to === 'hand'
                ? returnAllMatchingFromGraveyardToHand(nextState, p.id, parsedEachPlayersGy.cardType)
                : step.to === 'battlefield'
                  ? (step as any).battlefieldController?.kind === 'you'
                    ? putAllMatchingFromGraveyardOntoBattlefieldWithController(
                        nextState,
                        p.id,
                        controllerId,
                        parsedEachPlayersGy.cardType,
                        (step as any).entersTapped
                      )
                    : putAllMatchingFromGraveyardOntoBattlefield(nextState, p.id, parsedEachPlayersGy.cardType, (step as any).entersTapped)
                  : exileAllMatchingFromGraveyard(nextState, p.id, parsedEachPlayersGy.cardType);
            nextState = r.state;
            log.push(...r.log);
          }
          appliedSteps.push(step);
          break;
        }

        if (parsedEachPlayersExile) {
          if (step.to !== 'hand' && step.to !== 'graveyard' && step.to !== 'battlefield') {
            skippedSteps.push(step);
            log.push(`Skipped move zone (unsupported destination): ${step.raw}`);
            break;
          }

          for (const p of nextState.players as any[]) {
            const r =
              step.to === 'hand'
                ? moveAllMatchingFromExile(nextState, p.id, parsedEachPlayersExile.cardType, 'hand')
                : step.to === 'graveyard'
                  ? moveAllMatchingFromExile(nextState, p.id, parsedEachPlayersExile.cardType, 'graveyard')
                  : (step as any).battlefieldController?.kind === 'you'
                    ? putAllMatchingFromExileOntoBattlefieldWithController(
                        nextState,
                        p.id,
                        controllerId,
                        parsedEachPlayersExile.cardType,
                        (step as any).entersTapped
                      )
                    : putAllMatchingFromExileOntoBattlefield(nextState, p.id, parsedEachPlayersExile.cardType, (step as any).entersTapped);
            nextState = r.state;
            log.push(...r.log);
          }
          appliedSteps.push(step);
          break;
        }

        if (parsedEachPlayersHand) {
          if (step.to !== 'exile' && step.to !== 'graveyard' && step.to !== 'battlefield') {
            skippedSteps.push(step);
            log.push(`Skipped move zone (unsupported destination): ${step.raw}`);
            break;
          }

          for (const p of nextState.players as any[]) {
            const r =
              step.to === 'battlefield'
                ? (step as any).battlefieldController?.kind === 'you'
                  ? putAllMatchingFromHandOntoBattlefieldWithController(
                      nextState,
                      p.id,
                      controllerId,
                      parsedEachPlayersHand.cardType,
                      (step as any).entersTapped
                    )
                  : putAllMatchingFromHandOntoBattlefield(nextState, p.id, parsedEachPlayersHand.cardType, (step as any).entersTapped)
                : moveAllMatchingFromHand(nextState, p.id, parsedEachPlayersHand.cardType, step.to);
            nextState = r.state;
            log.push(...r.log);
          }
          appliedSteps.push(step);
          break;
        }

        if (parsedFromGraveyard) {
          if (step.to === 'hand') {
            const r = returnAllMatchingFromGraveyardToHand(nextState, controllerId, parsedFromGraveyard.cardType);
            nextState = r.state;
            log.push(...r.log);
            appliedSteps.push(step);
            break;
          }
          if (step.to === 'exile') {
            const r = exileAllMatchingFromGraveyard(nextState, controllerId, parsedFromGraveyard.cardType);
            nextState = r.state;
            log.push(...r.log);
            appliedSteps.push(step);
            break;
          }
          if (step.to === 'battlefield') {
            const r = putAllMatchingFromGraveyardOntoBattlefield(
              nextState,
              controllerId,
              parsedFromGraveyard.cardType,
              (step as any).entersTapped
            );
            nextState = r.state;
            log.push(...r.log);
            appliedSteps.push(step);
            break;
          }
          skippedSteps.push(step);
          log.push(`Skipped move zone (unsupported destination): ${step.raw}`);
          break;
        }

        if (parsedFromExile) {
          if (step.to === 'hand') {
            const r = moveAllMatchingFromExile(nextState, controllerId, parsedFromExile.cardType, 'hand');
            nextState = r.state;
            log.push(...r.log);
            appliedSteps.push(step);
            break;
          }
          if (step.to === 'graveyard') {
            const r = moveAllMatchingFromExile(nextState, controllerId, parsedFromExile.cardType, 'graveyard');
            nextState = r.state;
            log.push(...r.log);
            appliedSteps.push(step);
            break;
          }
          if (step.to === 'battlefield') {
            const battlefieldControllerKind = (step as any).battlefieldController?.kind;
            const r =
              battlefieldControllerKind === 'you'
                ? putAllMatchingFromExileOntoBattlefieldWithController(
                    nextState,
                    controllerId,
                    controllerId,
                    parsedFromExile.cardType,
                    (step as any).entersTapped
                  )
                : putAllMatchingFromExileOntoBattlefield(nextState, controllerId, parsedFromExile.cardType, (step as any).entersTapped);
            nextState = r.state;
            log.push(...r.log);
            appliedSteps.push(step);
            break;
          }

          skippedSteps.push(step);
          log.push(`Skipped move zone (unsupported destination): ${step.raw}`);
          break;
        }

        // From hand
        if (step.to !== 'graveyard' && step.to !== 'exile' && step.to !== 'battlefield') {
          skippedSteps.push(step);
          log.push(`Skipped move zone (unsupported destination): ${step.raw}`);
          break;
        }

        const r =
          step.to === 'battlefield'
            ? putAllMatchingFromHandOntoBattlefield(nextState, controllerId, parsedFromHand!.cardType, (step as any).entersTapped)
            : moveAllMatchingFromHand(nextState, controllerId, parsedFromHand!.cardType, step.to);
        nextState = r.state;
        log.push(...r.log);
        appliedSteps.push(step);
        break;
      }

      case 'create_token': {
        const amount = quantityToNumber(step.amount);
        if (amount === null) {
          skippedSteps.push(step);
          log.push(`Skipped token creation (unknown amount): ${step.raw}`);
          break;
        }

        const players = resolvePlayers(nextState, step.who, ctx);
        if (players.length === 0) {
          skippedSteps.push(step);
          log.push(`Skipped token creation (unsupported player selector): ${step.raw}`);
          break;
        }

        for (const playerId of players) {
          const r = addTokensToBattlefield(
            nextState,
            playerId,
            amount,
            step.token,
            step.raw,
            ctx,
            (step as any).entersTapped,
            (step as any).withCounters
          );
          nextState = r.state;
          log.push(...r.log);
        }
        appliedSteps.push(step);
        break;
      }

      case 'destroy': {
        const selector = parseSimpleBattlefieldSelector(step.target as any);
        if (!selector) {
          skippedSteps.push(step);
          log.push(`Skipped destroy (unsupported target): ${step.raw}`);
          break;
        }

        const r = moveMatchingBattlefieldPermanents(nextState, selector, ctx, 'graveyard');
        nextState = r.state;
        log.push(...r.log);
        appliedSteps.push(step);
        break;
      }

      case 'exile': {
        const selector = parseSimpleBattlefieldSelector(step.target as any);
        if (!selector) {
          skippedSteps.push(step);
          log.push(`Skipped exile (unsupported target): ${step.raw}`);
          break;
        }

        const r = moveMatchingBattlefieldPermanents(nextState, selector, ctx, 'exile');
        nextState = r.state;
        log.push(...r.log);
        appliedSteps.push(step);
        break;
      }

      case 'sacrifice': {
        const players = resolvePlayers(nextState, step.who, ctx);
        if (players.length === 0) {
          skippedSteps.push(step);
          log.push(`Skipped sacrifice (unsupported player selector): ${step.raw}`);
          break;
        }

        const parsed = parseSacrificeWhat(step.what as any);
        if (!parsed) {
          skippedSteps.push(step);
          log.push(`Skipped sacrifice (unsupported object selector): ${step.raw}`);
          break;
        }

        const battlefield = [...((nextState.battlefield || []) as BattlefieldPermanent[])];

        const toRemove: BattlefieldPermanent[] = [];
        let needsChoice = false;

        for (const playerId of players) {
          const candidates = battlefield.filter(p => p.controller === playerId && permanentMatchesType(p, parsed.type));

          if (parsed.mode === 'all') {
            toRemove.push(...candidates);
            continue;
          }

          // Deterministic only if they have <= N matching permanents.
          if (candidates.length > parsed.count) {
            needsChoice = true;
            break;
          }
          toRemove.push(...candidates);
        }

        if (needsChoice) {
          skippedSteps.push(step);
          log.push(`Skipped sacrifice (requires player choice): ${step.raw}`);
          break;
        }

        const getPermanentPower = (perm: any): number | null => {
          const rawPower = (perm as any)?.power ?? (perm as any)?.card?.power;
          const n = Number(rawPower);
          return Number.isFinite(n) ? n : null;
        };

        const isCreaturePermanent = (perm: any): boolean => {
          return hasExecutorClass(perm, 'creature');
        };

        const sacrificedCreaturesPowerTotal = toRemove.reduce((sum, permanent) => {
          if (!isCreaturePermanent(permanent)) return sum;
          const power = getPermanentPower(permanent);
          return sum + (power ?? 0);
        }, 0);

        const removedIds = new Set<string>(toRemove.map(p => p.id));
        const kept = battlefield.filter(p => !removedIds.has(p.id));
        const r = finalizeBattlefieldRemoval(nextState, toRemove, removedIds, kept, 'graveyard', 'sacrificed');
        nextState = r.state;
        lastSacrificedCreaturesPowerTotal = Math.max(0, sacrificedCreaturesPowerTotal);
        log.push(...r.log);
        appliedSteps.push(step);
        break;
      }

      case 'choose_mode':
        {
          const rawSelectedModeIds = Array.isArray(options.selectedModeIds)
            ? options.selectedModeIds
            : null;
          if (!rawSelectedModeIds) {
            skippedSteps.push(step);
            pendingOptionalSteps.push(step);
            log.push(`Skipped choose_mode step (needs player selection): ${(step as any).raw ?? step.kind}`);
            break;
          }

          const normalizedSelectedModeIds = rawSelectedModeIds
            .map(id => (typeof id === 'string' ? id.trim() : ''))
            .filter((id, index, ids) => Boolean(id) && ids.indexOf(id) === index);
          const modeById = new Map(
            ((step as any).modes || []).map((mode: any) => [String(mode?.label || '').trim(), mode] as const)
          );
          const selectedModes = normalizedSelectedModeIds
            .map(id => modeById.get(id))
            .filter((mode): mode is { label: string; steps: readonly OracleEffectStep[] } => Boolean(mode));
          const minModes = Math.max(0, Number((step as any).minModes ?? 0) || 0);
          const maxModesRaw = Number((step as any).maxModes ?? -1);
          const maxModes = Number.isFinite(maxModesRaw) && maxModesRaw >= 0 ? maxModesRaw : Infinity;

          if (
            selectedModes.length !== normalizedSelectedModeIds.length ||
            selectedModes.length < minModes ||
            selectedModes.length > maxModes
          ) {
            skippedSteps.push(step);
            pendingOptionalSteps.push(step);
            log.push(`Skipped choose_mode step (invalid mode selection): ${(step as any).raw ?? step.kind}`);
            break;
          }

          appliedSteps.push(step);
          log.push(
            `Resolved choose_mode step with ${selectedModes.length} selected mode(s): ${normalizedSelectedModeIds.join(', ') || 'none'}`
          );

          for (const mode of selectedModes) {
            const modeResult = applyOracleIRStepsToGameState(
              nextState,
              mode.steps,
              ctx,
              { ...options, selectedModeIds: undefined }
            );
            nextState = modeResult.state;
            log.push(`Resolved mode: ${mode.label}`);
            log.push(...modeResult.log);
            appliedSteps.push(...modeResult.appliedSteps);
            skippedSteps.push(...modeResult.skippedSteps);
            pendingOptionalSteps.push(...modeResult.pendingOptionalSteps);
          }
        }
        break;

      default:
        skippedSteps.push(step);
        log.push(`Skipped unsupported step: ${step.raw}`);
        break;
    }
  }

  return { state: nextState, log, appliedSteps, skippedSteps, pendingOptionalSteps };
}
