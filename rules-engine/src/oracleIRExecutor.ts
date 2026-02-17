import type { GameState, PlayerID, BattlefieldPermanent } from '../../shared/src';
import { createTokens, createTokensByName, parseTokenCreationFromText, COMMON_TOKENS } from './tokenCreation';
import type { OracleEffectStep, OraclePlayerSelector, OracleQuantity } from './oracleIR';
import { parseManaSymbols } from './types/numbers';
import { addMana, createEmptyManaPool, ManaType } from './types/mana';
import { clearPlayableFromExileForCards, stripPlayableFromExileTags } from './playableFromExile';

export interface OracleIRExecutionOptions {
  /**
   * If false (default), skips "may" steps because they require a player choice.
   * If true, applies optional steps as if the player chose "yes".
   */
  readonly allowOptional?: boolean;
}

export interface OracleIRSelectorContext {
  /** Bound target for selectors parsed as target player. */
  readonly targetPlayerId?: PlayerID;
  /** Bound target for selectors parsed as target opponent. */
  readonly targetOpponentId?: PlayerID;
  /** Bound antecedent set for selectors parsed as "each of those opponents". */
  readonly eachOfThoseOpponents?: readonly PlayerID[];
}

export interface OracleIRExecutionEventHint {
  /** Best-effort single target player from trigger/ability resolution context. */
  readonly targetPlayerId?: PlayerID;
  /** Best-effort single target opponent from trigger/ability resolution context. */
  readonly targetOpponentId?: PlayerID;
  /** Generic affected players for this event (may include non-opponents). */
  readonly affectedPlayerIds?: readonly PlayerID[];
  /** Affected opponents for this event (preferred for relational opponent selectors). */
  readonly affectedOpponentIds?: readonly PlayerID[];
  /** Opponents dealt damage by the triggering event/source (Breeches-style antecedent). */
  readonly opponentsDealtDamageIds?: readonly PlayerID[];
}

export interface OracleIRExecutionContext {
  readonly controllerId: PlayerID;
  readonly sourceId?: string;
  readonly sourceName?: string;
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

  const hintTargetOpponentId = normalizeId(hint?.targetOpponentId);
  const hintTargetPlayerId = normalizeId(hint?.targetPlayerId);
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
  };

  if (!selectorContext.targetPlayerId && !selectorContext.targetOpponentId && !selectorContext.eachOfThoseOpponents) {
    if (normalizedControllerId === base.controllerId) return base;
    return { ...base, controllerId: normalizedControllerId };
  }

  return { ...base, controllerId: normalizedControllerId, selectorContext };
}

export interface OracleIRExecutionResult {
  readonly state: GameState;
  readonly log: readonly string[];
  readonly appliedSteps: readonly OracleEffectStep[];
  readonly skippedSteps: readonly OracleEffectStep[];
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
  if (t === 'that player' || t === 'he or she' || t === 'they' || t === 'its controller') return resolvePlayers(state, { kind: 'target_player' }, ctx);
  if (t === 'that opponent') return resolvePlayers(state, { kind: 'target_opponent' }, ctx);
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

function parseDeterministicMixedDamageTarget(
  rawText: string
): { readonly players: ReadonlySet<'you' | 'each_player' | 'each_opponent'>; readonly selectors: readonly SimpleBattlefieldSelector[] } | null {
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

  const players = new Set<'you' | 'each_player' | 'each_opponent'>();
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
): { state: GameState; log: string[]; applied: boolean; needsChoice: boolean } {
  const log: string[] = [];
  const player = state.players.find(p => p.id === playerId);
  if (!player) return { state, log: [`Player not found: ${playerId}`], applied: false, needsChoice: false };

  const hand = [...((player as any).hand || [])];
  const graveyard = [...((player as any).graveyard || [])];

  const n = Math.max(0, count | 0);
  if (n === 0) return { state, log, applied: true, needsChoice: false };

  // Deterministic only when the player has <= N cards, in which case all cards are discarded.
  if (hand.length > n) {
    return { state, log, applied: false, needsChoice: true };
  }

  const discarded = hand.splice(0, hand.length);
  graveyard.push(...discarded);

  const updatedPlayers = state.players.map(p => (p.id === playerId ? { ...p, hand, graveyard } : p));
  log.push(`${playerId} discards ${discarded.length} card(s)`);
  return { state: { ...state, players: updatedPlayers as any }, log, applied: true, needsChoice: false };
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

function permanentMatchesSelector(perm: BattlefieldPermanent, sel: SimpleBattlefieldSelector, ctx: OracleIRExecutionContext): boolean {
  const normalizedControllerId = (String(ctx.controllerId || '').trim() || ctx.controllerId) as PlayerID;
  if (sel.controllerFilter === 'you' && perm.controller !== normalizedControllerId) return false;
  if (sel.controllerFilter === 'opponents' && perm.controller === normalizedControllerId) return false;

  const typeLine = String((perm as any)?.card?.type_line || '').toLowerCase();
  if (sel.types.includes('permanent')) return true;
  if (sel.types.includes('nonland_permanent')) return !typeLine.includes('land');

  return sel.types.some(t => {
    switch (t) {
      case 'creature':
        return typeLine.includes('creature');
      case 'artifact':
        return typeLine.includes('artifact');
      case 'enchantment':
        return typeLine.includes('enchantment');
      case 'land':
        return typeLine.includes('land');
      case 'planeswalker':
        return typeLine.includes('planeswalker');
      case 'battle':
        return typeLine.includes('battle');
      default:
        return false;
    }
  });
}

function permanentMatchesType(perm: BattlefieldPermanent, type: SimplePermanentType): boolean {
  const typeLine = String((perm as any)?.card?.type_line || '').toLowerCase();
  switch (type) {
    case 'permanent':
      return true;
    case 'nonland_permanent':
      return !typeLine.includes('land');
    case 'creature':
      return typeLine.includes('creature');
    case 'artifact':
      return typeLine.includes('artifact');
    case 'enchantment':
      return typeLine.includes('enchantment');
    case 'land':
      return typeLine.includes('land');
    case 'planeswalker':
      return typeLine.includes('planeswalker');
    case 'battle':
      return typeLine.includes('battle');
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

  let nextState = state;

  for (const step of steps) {
    const isOptional = Boolean((step as any).optional);
    if (isOptional && !options.allowOptional) {
      skippedSteps.push(step);
      log.push(`Skipped optional step: ${step.raw}`);
      continue;
    }

    switch (step.kind) {
      case 'exile_top': {
        const amount = quantityToNumber(step.amount);
        if (amount === null) {
          skippedSteps.push(step);
          log.push(`Skipped exile top (unknown amount): ${step.raw}`);
          break;
        }

        const players = resolvePlayers(nextState, step.who, ctx);
        if (players.length === 0) {
          skippedSteps.push(step);
          log.push(`Skipped exile top (unsupported player selector): ${step.raw}`);
          break;
        }

        for (const playerId of players) {
          const r = exileTopCardsForPlayer(nextState, playerId, amount);
          nextState = r.state;
          log.push(...r.log);
        }

        appliedSteps.push(step);
        break;
      }

      case 'impulse_exile_top': {
        const amount = quantityToNumber(step.amount);
        if (amount === null) {
          skippedSteps.push(step);
          log.push(`Skipped impulse exile top (unknown amount): ${step.raw}`);
          break;
        }

        const players = resolvePlayers(nextState, step.who, ctx);
        if (players.length === 0) {
          skippedSteps.push(step);
          log.push(`Skipped impulse exile top (unsupported player selector): ${step.raw}`);
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

        for (const playerId of players) {
          const r = exileTopCardsForPlayer(nextState, playerId, amount);
          nextState = r.state;
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
        }

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
        const amount = quantityToNumber(step.amount);
        if (amount === null) {
          skippedSteps.push(step);
          log.push(`Skipped mill (unknown amount): ${step.raw}`);
          break;
        }

        const players = resolvePlayers(nextState, step.who, ctx);
        if (players.length === 0) {
          skippedSteps.push(step);
          log.push(`Skipped mill (unsupported player selector): ${step.raw}`);
          break;
        }

        for (const playerId of players) {
          const r = millCardsForPlayer(nextState, playerId, amount);
          nextState = r.state;
          log.push(...r.log);
        }

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

        for (const playerId of players) {
          const r = discardCardsForPlayer(nextState, playerId, amount);
          nextState = r.state;
          log.push(...r.log);
        }

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

        // Only supports dealing damage to players (no creatures/planeswalkers) and no targeting.
        const players = resolvePlayersFromDamageTarget(nextState, step.target as any, ctx);
        if (players.length > 0) {
          for (const playerId of players) {
            const r = adjustLife(nextState, playerId, -amount);
            nextState = r.state;
            // Override wording to avoid calling this "life loss" in the log.
            log.push(`${playerId} is dealt ${amount} damage`);
          }

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
                    : resolvePlayers(nextState, { kind: 'each_opponent' } as any, ctx);
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
                const tl = String((p as any)?.card?.type_line || '').toLowerCase();
                if (tl.includes('battle')) return removeDefenseCountersFromBattle(p as any, amount);
                if (tl.includes('creature')) return addDamageToPermanentLikeCreature(p as any, amount);
                if (tl.includes('planeswalker')) return removeLoyaltyFromPlaneswalker(p as any, amount);
                return p as any;
              });
            }

            nextState = { ...(nextState as any), battlefield: updatedBattlefield } as any;
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
              const tl = String((p as any)?.card?.type_line || '').toLowerCase();
              if (tl.includes('battle')) return removeDefenseCountersFromBattle(p as any, amount);
              if (tl.includes('creature')) return addDamageToPermanentLikeCreature(p as any, amount);
              if (tl.includes('planeswalker')) return removeLoyaltyFromPlaneswalker(p as any, amount);
              return p as any;
            }) as any;

            nextState = { ...(nextState as any), battlefield: updatedBattlefield } as any;
            log.push(`Dealt ${amount} damage to ${normalized}`);
            appliedSteps.push(step);
            break;
          }
        }

        skippedSteps.push(step);
        log.push(`Skipped deal damage (unsupported target): ${step.raw}`);
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

        const removedIds = new Set<string>(toRemove.map(p => p.id));
        const kept = battlefield.filter(p => !removedIds.has(p.id));
        const r = finalizeBattlefieldRemoval(nextState, toRemove, removedIds, kept, 'graveyard', 'sacrificed');
        nextState = r.state;
        log.push(...r.log);
        appliedSteps.push(step);
        break;
      }

      default:
        skippedSteps.push(step);
        log.push(`Skipped unsupported step: ${step.raw}`);
        break;
    }
  }

  return { state: nextState, log, appliedSteps, skippedSteps };
}
