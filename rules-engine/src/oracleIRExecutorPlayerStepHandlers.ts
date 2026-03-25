import type { GameState, PlayerID } from '../../shared/src';
import type { OracleEffectStep } from './oracleIR';
import { createCustomEmblem } from './emblemSupport';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';
import type { ModifyPtRuntime } from './oracleIRExecutorModifyPtStepHandlers';
import { cardMatchesMoveZoneSingleTargetCriteria, parseSimpleCardTypeFromText, type MoveZoneSingleTargetCriteria } from './oracleIRExecutorZoneOps';
import { payManaCost } from './spellCasting';
import { createEmptyManaPool, type ManaCost } from './types/mana';
import { parseManaSymbols } from './types/numbers';
import {
  addManaToPoolForPlayer,
  applyExilePermissionMarkers,
  applyGraveyardPermissionMarkers,
  adjustLife,
  discardCardsForPlayer,
  drawCardsForPlayer,
  getCardManaValue,
  millCardsForPlayer,
  lookSelectTopCardsForPlayer,
  quantityToNumber,
  resolvePlayers,
  getPlayableUntilTurnForImpulseDuration,
  resolveUnknownMillUntilAmountForPlayer,
  isCardExiledWithSource,
} from './oracleIRExecutorPlayerUtils';

type StepApplyResult = {
  readonly applied: true;
  readonly state: GameState;
  readonly log: readonly string[];
  readonly lastScryLookedAtCount?: number;
  readonly lastDiscardedCardCount?: number;
  readonly lastRevealedCardCount?: number;
  readonly lastGrantedGraveyardCards?: readonly any[];
};

type StepSkipResult = {
  readonly applied: false;
  readonly message: string;
  readonly reason: 'unknown_amount' | 'unsupported_player_selector' | 'player_choice_required' | 'failed_to_apply';
  readonly options?: {
    readonly classification?: 'ambiguous' | 'player_choice' | 'invalid_input';
    readonly metadata?: Record<string, string | number | boolean | readonly string[]>;
    readonly persist?: boolean;
  };
};

type UnlessPaysLifeResult =
  | { readonly applied: true; readonly shouldApplyNestedSteps: boolean; readonly state?: GameState; readonly log: readonly string[] }
  | StepSkipResult;

export type PlayerStepHandlerResult = StepApplyResult | StepSkipResult;

function getChosenObjectIds(ctx: OracleIRExecutionContext): readonly string[] {
  const chosen = Array.isArray(ctx.selectorContext?.chosenObjectIds) ? ctx.selectorContext.chosenObjectIds : [];
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const candidate of chosen) {
    const normalized = String(candidate || '').trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    ids.push(normalized);
  }
  return ids;
}

function normalizePermissionSelectorText(value: string): string {
  return String(value || '')
    .replace(/\u2019/g, "'")
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[.]+$/g, '')
    .trim();
}

function buildGraveyardPermissionCriteria(text: string): MoveZoneSingleTargetCriteria | null {
  const normalized = normalizePermissionSelectorText(text)
    .replace(/^(?:up to one|one|a|an)\s+/i, '')
    .replace(/\s+from\s+(?:your|their|his or her|its owner's|its controller's)\s+graveyard$/i, '')
    .replace(/\s+(?:spells?|cards?)$/i, '')
    .replace(/\binstant and sorcery\b/g, 'instant or sorcery')
    .trim();
  if (!normalized) return null;

  const manaValueMatch = normalized.match(/^(.+?)\s+with mana value (\d+) or less$/i);
  if (manaValueMatch) {
    const cardType = parseSimpleCardTypeFromText(String(manaValueMatch[1] || '').trim());
    const manaValueLte = parseInt(String(manaValueMatch[2] || '0'), 10) || 0;
    if (!cardType || manaValueLte <= 0) return null;
    return { cardType, manaValueLte };
  }

  const baseType = parseSimpleCardTypeFromText(normalized);
  if (baseType) return { cardType: baseType };

  const creatureTypeMatch = normalized.match(/^([a-z][a-z' -]+)\s+creature$/i);
  if (creatureTypeMatch) {
    return {
      cardType: 'creature',
      creatureTypesAnyOf: [
        String(creatureTypeMatch[1] || '')
          .trim()
          .replace(/\b\w/g, c => c.toUpperCase()),
      ],
    };
  }

  if (normalized === 'land' || normalized === 'lands') return { cardType: 'land' };
  if (normalized === 'card' || normalized === 'cards') return { cardType: 'any' };
  if (normalized === 'permanent spell' || normalized === 'permanent') return { cardType: 'permanent' };

  return null;
}

function buildExilePermissionCriteria(text: string): {
  readonly criteria: MoveZoneSingleTargetCriteria | null;
  readonly ownOnly: boolean;
} {
  const normalized = normalizePermissionSelectorText(text)
    .replace(/\s+from\s+among\s+(?:the\s+)?cards?\s+/i, ' ')
    .replace(/\s+exiled with this (?:creature|artifact|enchantment|planeswalker|permanent|card|class|saga)$/i, '')
    .trim();

  const ownOnly = /\byou own\b/i.test(normalized);
  const selectorText = normalized
    .replace(/\byou own\b/i, '')
    .replace(/^(?:up to one|one|a|an)\s+/i, '')
    .replace(/\s+(?:spells?|cards?)$/i, '')
    .trim();

  if (!selectorText) return { criteria: { cardType: 'any' }, ownOnly };

  const direct = buildGraveyardPermissionCriteria(selectorText);
  if (direct) return { criteria: direct, ownOnly };

  const creatureTypeOnly = selectorText.match(/^([a-z][a-z' -]+)$/i);
  if (creatureTypeOnly) {
    return {
      criteria: {
        cardType: 'creature',
        creatureTypesAnyOf: [
          String(creatureTypeOnly[1] || '')
            .trim()
            .replace(/\b\w/g, c => c.toUpperCase()),
        ],
      },
      ownOnly,
    };
  }

  return { criteria: null, ownOnly };
}

function resolveGraveyardPermissionTargets(
  state: GameState,
  playerId: PlayerID,
  step: Extract<OracleEffectStep, { kind: 'grant_graveyard_permission' }>,
  ctx: OracleIRExecutionContext
): { cards: readonly any[]; reason?: 'unsupported_selector' | 'failed_to_apply' } {
  const player = state.players.find(p => p.id === playerId) as any;
  if (!player) return { cards: [], reason: 'failed_to_apply' };

  const graveyard = Array.isArray(player.graveyard) ? player.graveyard : [];
  const chosenIds = new Set(getChosenObjectIds(ctx));
  const sourceId = String(ctx.sourceId || '').trim();
  const selectorText =
    step.what.kind === 'raw'
      ? normalizePermissionSelectorText(step.what.text)
      : normalizePermissionSelectorText((step.what as any).raw || '');
  if (!selectorText) return { cards: [], reason: 'unsupported_selector' };

  const contextualReference =
    /^(?:it|that card|that spell|the discarded card|target .+?)$/.test(selectorText);
  if (contextualReference) {
    const cards = graveyard.filter((card: any) => {
      const cardId = String(card?.id || card?.cardId || '').trim();
      if (!cardId) return false;
      if (chosenIds.has(cardId)) return true;
      return selectorText === 'it' && sourceId && cardId === sourceId;
    });
    return cards.length > 0 ? { cards } : { cards: [], reason: 'failed_to_apply' };
  }

  const selfReference = /^(?:this card|this spell|this permanent|this creature)$/.test(selectorText);
  if (selfReference) {
    if (!sourceId) return { cards: [], reason: 'failed_to_apply' };
    const cards = graveyard.filter((card: any) => String(card?.id || card?.cardId || '').trim() === sourceId);
    return cards.length > 0 ? { cards } : { cards: [], reason: 'failed_to_apply' };
  }

  const criteria = buildGraveyardPermissionCriteria(selectorText);
  if (!criteria) return { cards: [], reason: 'unsupported_selector' };
  const currentTurn = Number((state as any).turnNumber ?? (state as any).turn ?? 0) || 0;
  return { cards: graveyard.filter((card: any) => cardMatchesMoveZoneSingleTargetCriteria(card, criteria, undefined, currentTurn)) };
}

function resolveExilePermissionTargets(
  state: GameState,
  playerId: PlayerID,
  step: Extract<OracleEffectStep, { kind: 'grant_exile_permission' }>,
  ctx: OracleIRExecutionContext
): { cards: readonly any[]; reason?: 'unsupported_selector' | 'failed_to_apply' } {
  const sourceId = String(ctx.sourceId || '').trim();
  if (!sourceId) return { cards: [], reason: 'failed_to_apply' };

  const selectorText =
    step.what.kind === 'raw'
      ? normalizePermissionSelectorText(step.what.text)
      : normalizePermissionSelectorText((step.what as any).raw || '');
  if (!selectorText) return { cards: [], reason: 'unsupported_selector' };

  const { criteria, ownOnly } = buildExilePermissionCriteria(selectorText);
  if (!criteria) return { cards: [], reason: 'unsupported_selector' };

  const matches: any[] = [];
  const currentTurn = Number((state as any).turnNumber ?? (state as any).turn ?? 0) || 0;
  for (const owner of state.players as any[]) {
    const exile = Array.isArray(owner?.exile) ? owner.exile : [];
    for (const card of exile) {
      if (!isCardExiledWithSource(card, sourceId)) continue;
      if (ownOnly && String(owner?.id || '').trim() !== playerId) continue;
      if (!cardMatchesMoveZoneSingleTargetCriteria(card, criteria, undefined, currentTurn)) continue;
      matches.push(card);
    }
  }

  return { cards: matches };
}

function parseSupportedManaCostString(rawMana: string): ManaCost | null {
  const symbols = parseManaSymbols(rawMana);
  if (symbols.length === 0) return null;

  let generic = 0;
  let white = 0;
  let blue = 0;
  let black = 0;
  let red = 0;
  let green = 0;
  let colorless = 0;

  for (const symbol of symbols) {
    const upper = String(symbol || '').trim().toUpperCase();
    if (!upper) return null;
    if (/^\{\d+\}$/.test(upper)) {
      generic += parseInt(upper.slice(1, -1), 10);
      continue;
    }

    switch (upper) {
      case '{W}':
        white += 1;
        break;
      case '{U}':
        blue += 1;
        break;
      case '{B}':
        black += 1;
        break;
      case '{R}':
        red += 1;
        break;
      case '{G}':
        green += 1;
        break;
      case '{C}':
        colorless += 1;
        break;
      default:
        return null;
    }
  }

  return { generic, white, blue, black, red, green, colorless };
}

export function applyCreateEmblemStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'create_emblem' }>,
  ctx: OracleIRExecutionContext
): PlayerStepHandlerResult {
  const controllerId = (String(ctx.controllerId || '').trim() || ctx.controllerId) as PlayerID;
  const player = (state.players || []).find(p => p?.id === controllerId) as any;
  if (!player) {
    return {
      applied: false,
      message: `Skipped create emblem (controller unavailable): ${step.raw}`,
      reason: 'failed_to_apply',
    };
  }

  const emblemName = String(step.name || ctx.sourceName || 'Emblem').trim() || 'Emblem';
  const result = createCustomEmblem(
    controllerId,
    emblemName,
    [...step.abilities],
    ctx.sourceName,
    ctx.sourceId
  );
  const currentEmblems = Array.isArray(player.emblems) ? [...player.emblems] : [];
  const updatedPlayers = state.players.map(p =>
    p.id === controllerId ? ({ ...(p as any), emblems: [...currentEmblems, result.emblem] } as any) : p
  );

  return {
    applied: true,
    state: { ...state, players: updatedPlayers as any } as any,
    log: result.log,
  };
}

export function applyGrantGraveyardPermissionStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'grant_graveyard_permission' }>,
  ctx: OracleIRExecutionContext
): PlayerStepHandlerResult {
  const players = resolvePlayers(state, step.who, ctx);
  if (players.length === 0) {
    return {
      applied: false,
      message: `Skipped graveyard permission (unsupported player selector): ${step.raw}`,
      reason: 'unsupported_player_selector',
    };
  }

  const playableUntilTurn = getPlayableUntilTurnForImpulseDuration(state, step.duration);
  let nextState = state;
  let granted = 0;
  const grantedCards: any[] = [];
  const log: string[] = [];

  for (const playerId of players) {
    const resolved = resolveGraveyardPermissionTargets(nextState, playerId, step, ctx);
    if (resolved.reason === 'unsupported_selector') {
      return {
        applied: false,
        message: `Skipped graveyard permission (unsupported selector): ${step.raw}`,
        reason: 'failed_to_apply',
        options: { classification: 'ambiguous' },
      };
    }
    if (resolved.reason === 'failed_to_apply') {
      return {
        applied: false,
        message: `Skipped graveyard permission (referenced card unavailable): ${step.raw}`,
        reason: 'failed_to_apply',
        options: { classification: 'invalid_input', persist: false },
      };
    }

    const markerResult = applyGraveyardPermissionMarkers(nextState, playerId, resolved.cards, {
      permission: step.permission,
      playableUntilTurn,
    });
    nextState = markerResult.state;
    granted += markerResult.granted;
    grantedCards.push(...resolved.cards);
    if (markerResult.granted > 0) {
      log.push(`${playerId} may ${step.permission === 'play' ? 'play' : 'cast'} ${markerResult.granted} graveyard card(s)`);
    }
  }

  return {
    applied: true,
    state: nextState,
    log: log.length > 0 ? log : [`Granted no graveyard permissions: ${step.raw}`],
    lastGrantedGraveyardCards: grantedCards,
  };
}

export function applyGrantExilePermissionStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'grant_exile_permission' }>,
  ctx: OracleIRExecutionContext
): PlayerStepHandlerResult {
  const players = resolvePlayers(state, step.who, ctx);
  if (players.length === 0) {
    return {
      applied: false,
      message: `Skipped exile permission (unsupported player selector): ${step.raw}`,
      reason: 'unsupported_player_selector',
    };
  }

  const playableUntilTurn = getPlayableUntilTurnForImpulseDuration(state, step.duration);
  let nextState = state;
  const log: string[] = [];

  for (const playerId of players) {
    const resolved = resolveExilePermissionTargets(nextState, playerId, step, ctx);
    if (resolved.reason === 'unsupported_selector') {
      return {
        applied: false,
        message: `Skipped exile permission (unsupported selector): ${step.raw}`,
        reason: 'failed_to_apply',
        options: { classification: 'ambiguous' },
      };
    }
    if (resolved.reason === 'failed_to_apply') {
      return {
        applied: false,
        message: `Skipped exile permission (linked exiled cards unavailable): ${step.raw}`,
        reason: 'failed_to_apply',
        options: { classification: 'invalid_input', persist: false },
      };
    }

    const markerResult = applyExilePermissionMarkers(nextState, playerId, resolved.cards, {
      permission: step.permission,
      playableUntilTurn,
      castedPermanentEntersWithCounters: step.castedPermanentEntersWithCounters,
    });
    nextState = markerResult.state;
    if (markerResult.granted > 0) {
      log.push(`${playerId} may ${step.permission === 'play' ? 'play' : 'cast'} ${markerResult.granted} exiled card(s)`);
    }
  }

  return {
    applied: true,
    state: nextState,
    log: log.length > 0 ? log : [`Granted no exile permissions: ${step.raw}`],
  };
}

export function applyModifyGraveyardPermissionsStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'modify_graveyard_permissions' }>,
  runtime: {
    readonly lastGrantedGraveyardCards?: readonly any[];
  }
): PlayerStepHandlerResult {
  const lastGrantedGraveyardCards = Array.isArray(runtime.lastGrantedGraveyardCards)
    ? runtime.lastGrantedGraveyardCards
    : [];
  const grantedIds = new Set(
    lastGrantedGraveyardCards
      .map(card => String((card as any)?.id ?? (card as any)?.cardId ?? '').trim())
      .filter(Boolean)
  );

  if (step.scope !== 'last_granted_graveyard_cards' || grantedIds.size === 0) {
    return {
      applied: false,
      message: `Skipped graveyard permission modifier (no granted cards in context): ${step.raw}`,
      reason: 'failed_to_apply',
      options: { classification: 'invalid_input', persist: false },
    };
  }

  let changed = 0;
  const updatedPlayers = (state.players || []).map((player: any) => {
    const graveyard = Array.isArray(player?.graveyard) ? player.graveyard : [];
    if (graveyard.length === 0) return player;

    let playerChanged = false;
    const updatedGraveyard = graveyard.map((card: any) => {
      const id = String(card?.id ?? card?.cardId ?? '').trim();
      if (!id || !grantedIds.has(id)) return card;
      playerChanged = true;
      changed += 1;
      return {
        ...card,
        ...(step.castCost ? { graveyardCastCost: step.castCost } : {}),
      };
    });

    return playerChanged ? ({ ...player, graveyard: updatedGraveyard } as any) : player;
  });

  return {
    applied: true,
    state: { ...(state as any), players: updatedPlayers as any } as any,
    log:
      changed > 0
        ? [`Updated graveyard permissions for ${changed} graveyard card(s)`]
        : [`Updated no graveyard permissions: ${step.raw}`],
  };
}

export function applyPayManaStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'pay_mana' }>,
  ctx: OracleIRExecutionContext
): PlayerStepHandlerResult {
  const players = resolvePlayers(state, step.who, ctx);
  if (players.length === 0) {
    return {
      applied: false,
      message: `Skipped pay mana (unsupported player selector): ${step.raw}`,
      reason: 'unsupported_player_selector',
    };
  }

  const manaCost = parseSupportedManaCostString(step.mana);
  if (!manaCost) {
    return {
      applied: false,
      message: `Skipped pay mana (unsupported mana cost): ${step.raw}`,
      reason: 'failed_to_apply',
      options: { classification: 'ambiguous' },
    };
  }

  let nextState = state;
  const log: string[] = [];
  for (const playerId of players) {
    const manaPoolRecord: Record<PlayerID, any> = { ...((((nextState as any).manaPool || {}) as any) || {}) };
    const currentPool = manaPoolRecord[playerId] || createEmptyManaPool();
    const payment = payManaCost(currentPool, manaCost);
    if (!payment.success || !payment.remainingPool) {
      return {
        applied: false,
        message: `Skipped pay mana (cannot pay ${step.mana}): ${step.raw}`,
        reason: 'failed_to_apply',
        options: {
          classification: 'invalid_input',
          persist: false,
        },
      };
    }

    manaPoolRecord[playerId] = payment.remainingPool;
    nextState = { ...(nextState as any), manaPool: manaPoolRecord } as any;
    log.push(`${playerId} pays ${step.mana}`);
  }

  return {
    applied: true,
    state: nextState,
    log,
  };
}

function resolveVariableAmount(
  state: GameState,
  controllerId: PlayerID,
  amount: Extract<OracleEffectStep, { kind: 'gain_life' | 'lose_life' }>['amount'],
  ctx: OracleIRExecutionContext,
  runtime: ModifyPtRuntime | undefined,
  evaluateWhereX?: (
    state: GameState,
    controllerId: PlayerID,
    whereRaw: string,
    targetCreatureId?: string,
    ctx?: OracleIRExecutionContext,
    runtime?: ModifyPtRuntime
  ) => number | null
): number | null {
  const numericAmount = quantityToNumber(amount);
  if (numericAmount !== null) return numericAmount;
  if (amount.kind !== 'unknown' || !evaluateWhereX) return null;

  const raw = String(amount.raw || '').trim().replace(/^equal to\s+/i, '').trim();
  if (!raw) return null;

  const evaluated = evaluateWhereX(state, controllerId, `X is ${raw}`, undefined, ctx, runtime);
  if (evaluated !== null) return evaluated;

  const sacrificed = Array.isArray(runtime?.lastSacrificedPermanents) ? runtime.lastSacrificedPermanents : [];
  if (sacrificed.length === 1) {
    const snapshot = sacrificed[0] as any;
    const lowerRaw = raw.toLowerCase();
    const readFinite = (value: unknown): number | null => {
      const n = Number(value);
      return Number.isFinite(n) ? n : null;
    };
    if (/^(?:the sacrificed|that) creature's power$/.test(lowerRaw)) return readFinite(snapshot?.power);
    if (/^(?:the sacrificed|that) creature's toughness$/.test(lowerRaw)) return readFinite(snapshot?.toughness);
    if (/^(?:the sacrificed|that) creature's mana value$/.test(lowerRaw)) return readFinite(snapshot?.manaValue);
  }

  const moved = Array.isArray(runtime?.lastMovedCards) ? runtime.lastMovedCards : [];
  if (moved.length === 1) {
    const lowerRaw = raw.toLowerCase();
    const readFinite = (value: unknown): number | null => {
      const n = Number(value);
      return Number.isFinite(n) ? n : null;
    };
    const manaValue = getCardManaValue(moved[0]);
    if (manaValue !== null && /^(?:its|that card's|that creature's) mana value$/.test(lowerRaw)) {
      return manaValue;
    }
    if (/^(?:its|that card's|that creature's) power$/.test(lowerRaw)) {
      return readFinite((moved[0] as any)?.power ?? (moved[0] as any)?.card?.power);
    }
    if (/^(?:its|that card's|that creature's) toughness$/.test(lowerRaw)) {
      return readFinite((moved[0] as any)?.toughness ?? (moved[0] as any)?.card?.toughness);
    }
  }

  return null;
}

export function applyScryStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'scry' }>,
  ctx: OracleIRExecutionContext
): PlayerStepHandlerResult {
  const amount = quantityToNumber(step.amount);
  if (amount === null) {
    return {
      applied: false,
      message: `Skipped scry (unknown amount): ${step.raw}`,
      reason: 'unknown_amount',
      options: { classification: 'ambiguous' },
    };
  }

  const players = resolvePlayers(state, step.who, ctx);
  if (players.length === 0) {
    return {
      applied: false,
      message: `Skipped scry (unsupported player selector): ${step.raw}`,
      reason: 'unsupported_player_selector',
    };
  }

  if (amount <= 0) {
    return {
      applied: true,
      state,
      log: [`Scry ${amount} (no-op): ${step.raw}`],
      lastScryLookedAtCount: 0,
    };
  }

  const wouldNeedChoice = players.some(playerId => {
    const player = state.players.find(p => p.id === playerId) as any;
    const libraryLength = Array.isArray(player?.library) ? player.library.length : 0;
    return libraryLength > 0;
  });

  if (wouldNeedChoice) {
    return {
      applied: false,
      message: `Skipped scry (requires player choice): ${step.raw}`,
      reason: 'player_choice_required',
      options: { classification: 'player_choice' },
    };
  }

  return {
    applied: true,
    state,
    log: [`Scry ${amount} (no cards in library): ${step.raw}`],
    lastScryLookedAtCount: 0,
  };
}

export function applySurveilStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'surveil' }>,
  ctx: OracleIRExecutionContext
): PlayerStepHandlerResult {
  const amount = quantityToNumber(step.amount);
  if (amount === null) {
    return {
      applied: false,
      message: `Skipped surveil (unknown amount): ${step.raw}`,
      reason: 'unknown_amount',
      options: { classification: 'ambiguous' },
    };
  }

  const players = resolvePlayers(state, step.who, ctx);
  if (players.length === 0) {
    return {
      applied: false,
      message: `Skipped surveil (unsupported player selector): ${step.raw}`,
      reason: 'unsupported_player_selector',
    };
  }

  if (amount <= 0) {
    return {
      applied: true,
      state,
      log: [`Surveil ${amount} (no-op): ${step.raw}`],
    };
  }

  const wouldNeedChoice = players.some(playerId => {
    const player = state.players.find(p => p.id === playerId) as any;
    const libraryLength = Array.isArray(player?.library) ? player.library.length : 0;
    return libraryLength > 0;
  });

  if (wouldNeedChoice) {
    return {
      applied: false,
      message: `Skipped surveil (requires player choice): ${step.raw}`,
      reason: 'player_choice_required',
      options: { classification: 'player_choice' },
    };
  }

  return {
    applied: true,
    state,
    log: [`Surveil ${amount} (no cards in library): ${step.raw}`],
  };
}

export function applyLookSelectTopStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'look_select_top' }>,
  ctx: OracleIRExecutionContext
): PlayerStepHandlerResult {
  const amount = quantityToNumber(step.amount);
  const choose = quantityToNumber(step.choose);
  if (amount === null || choose === null) {
    return {
      applied: false,
      message: `Skipped look-select-top (unknown amount): ${step.raw}`,
      reason: 'unknown_amount',
      options: { classification: 'ambiguous' },
    };
  }

  const players = resolvePlayers(state, step.who, ctx);
  if (players.length === 0) {
    return {
      applied: false,
      message: `Skipped look-select-top (unsupported player selector): ${step.raw}`,
      reason: 'unsupported_player_selector',
    };
  }

  let nextState = state;
  const log: string[] = [];
  for (const playerId of players) {
    const result = lookSelectTopCardsForPlayer(
      nextState,
      playerId,
      amount,
      choose,
      step.destination,
      step.restDestination,
      Boolean(step.restToTop)
    );
    nextState = result.state;
    log.push(...result.log);
  }

  return {
    applied: true,
    state: nextState,
    log,
  };
}

export function applyMillStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'mill' }>,
  ctx: OracleIRExecutionContext
): PlayerStepHandlerResult {
  const players = resolvePlayers(state, step.who, ctx);
  if (players.length === 0) {
    return {
      applied: false,
      message: `Skipped mill (unsupported player selector): ${step.raw}`,
      reason: 'unsupported_player_selector',
    };
  }

  const millCountByPlayer = new Map<PlayerID, number>();
  for (const playerId of players) {
    const resolvedCount =
      quantityToNumber(step.amount) ??
      resolveUnknownMillUntilAmountForPlayer(state, playerId, step.amount);
    if (resolvedCount === null) {
      return {
        applied: false,
        message: `Skipped mill (unknown amount): ${step.raw}`,
        reason: 'unknown_amount',
        options: { classification: 'ambiguous' },
      };
    }
    millCountByPlayer.set(playerId, resolvedCount);
  }

  let nextState = state;
  const log: string[] = [];
  for (const playerId of players) {
    const amount = millCountByPlayer.get(playerId) ?? 0;
    const result = millCardsForPlayer(nextState, playerId, amount);
    nextState = result.state;
    log.push(...result.log);
  }

  const unknownRaw = String((step.amount as any)?.raw || '').toLowerCase();
  const isRevealThisWay = step.amount.kind === 'unknown' && unknownRaw.includes('reveal a land card');
  const lastRevealedCardCount = isRevealThisWay
    ? Array.from(millCountByPlayer.values()).reduce((sum, count) => sum + (Number(count) || 0), 0)
    : undefined;

  return {
    applied: true,
    state: nextState,
    log,
    lastRevealedCardCount,
  };
}

export function applyDiscardStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'discard' }>,
  ctx: OracleIRExecutionContext
): PlayerStepHandlerResult {
  const amount = quantityToNumber(step.amount);
  if (amount === null) {
    return {
      applied: false,
      message: `Skipped discard (unknown amount): ${step.raw}`,
      reason: 'unknown_amount',
      options: { classification: 'ambiguous' },
    };
  }

  const players = resolvePlayers(state, step.who, ctx);
  if (players.length === 0) {
    return {
      applied: false,
      message: `Skipped discard (unsupported player selector): ${step.raw}`,
      reason: 'unsupported_player_selector',
    };
  }

  const wouldNeedChoice = players.some(playerId => {
    const player = state.players.find(p => p.id === playerId) as any;
    const handLength = Array.isArray(player?.hand) ? player.hand.length : 0;
    return handLength > Math.max(0, amount | 0);
  });

  if (wouldNeedChoice) {
    return {
      applied: false,
      message: `Skipped discard (requires player choice): ${step.raw}`,
      reason: 'player_choice_required',
      options: { classification: 'player_choice' },
    };
  }

  let nextState = state;
  const log: string[] = [];
  let totalDiscarded = 0;
  for (const playerId of players) {
    const result = discardCardsForPlayer(nextState, playerId, amount);
    nextState = result.state;
    totalDiscarded += Math.max(0, Number(result.discardedCount) || 0);
    log.push(...result.log);
  }

  return {
    applied: true,
    state: nextState,
    log,
    lastDiscardedCardCount: totalDiscarded,
  };
}

export function applyGainLifeStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'gain_life' }>,
  ctx: OracleIRExecutionContext,
  controllerId: PlayerID,
  runtime?: ModifyPtRuntime,
  evaluateWhereX?: (
    state: GameState,
    controllerId: PlayerID,
    whereRaw: string,
    targetCreatureId?: string,
    ctx?: OracleIRExecutionContext,
    runtime?: ModifyPtRuntime
  ) => number | null
): PlayerStepHandlerResult {
  const amount = resolveVariableAmount(state, controllerId, step.amount, ctx, runtime, evaluateWhereX);
  if (amount === null) {
    return {
      applied: false,
      message: `Skipped life gain (unknown amount): ${step.raw}`,
      reason: 'unknown_amount',
      options: { classification: 'ambiguous' },
    };
  }

  const players = resolvePlayers(state, step.who, ctx);
  if (players.length === 0) {
    return {
      applied: false,
      message: `Skipped life gain (unsupported player selector): ${step.raw}`,
      reason: 'unsupported_player_selector',
    };
  }

  let nextState = state;
  const log: string[] = [];
  for (const playerId of players) {
    const result = adjustLife(nextState, playerId, amount);
    nextState = result.state;
    log.push(...result.log);
  }

  return { applied: true, state: nextState, log };
}

export function applyLoseLifeStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'lose_life' }>,
  ctx: OracleIRExecutionContext,
  controllerId: PlayerID,
  runtime?: ModifyPtRuntime,
  evaluateWhereX?: (
    state: GameState,
    controllerId: PlayerID,
    whereRaw: string,
    targetCreatureId?: string,
    ctx?: OracleIRExecutionContext,
    runtime?: ModifyPtRuntime
  ) => number | null
): PlayerStepHandlerResult {
  const amount = resolveVariableAmount(state, controllerId, step.amount, ctx, runtime, evaluateWhereX);
  if (amount === null) {
    return {
      applied: false,
      message: `Skipped life loss (unknown amount): ${step.raw}`,
      reason: 'unknown_amount',
      options: { classification: 'ambiguous' },
    };
  }

  const players = resolvePlayers(state, step.who, ctx);
  if (players.length === 0) {
    return {
      applied: false,
      message: `Skipped life loss (unsupported player selector): ${step.raw}`,
      reason: 'unsupported_player_selector',
    };
  }

  let nextState = state;
  const log: string[] = [];
  for (const playerId of players) {
    const result = adjustLife(nextState, playerId, -amount);
    nextState = result.state;
    log.push(...result.log);
  }

  return { applied: true, state: nextState, log };
}

export function applyDrawStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'draw' }>,
  ctx: OracleIRExecutionContext
): PlayerStepHandlerResult {
  const amount = quantityToNumber(step.amount);
  if (amount === null) {
    return {
      applied: false,
      message: `Skipped draw (unknown amount): ${step.raw}`,
      reason: 'unknown_amount',
      options: { classification: 'ambiguous' },
    };
  }

  const players = resolvePlayers(state, step.who, ctx);
  if (players.length === 0) {
    return {
      applied: false,
      message: `Skipped draw (unsupported player selector): ${step.raw}`,
      reason: 'unsupported_player_selector',
    };
  }

  let nextState = state;
  const log: string[] = [];
  for (const playerId of players) {
    const result = drawCardsForPlayer(nextState, playerId, amount);
    nextState = result.state;
    log.push(...result.log);
  }

  return { applied: true, state: nextState, log };
}

export function applyAddManaStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'add_mana' }>,
  ctx: OracleIRExecutionContext
): PlayerStepHandlerResult {
  const players = resolvePlayers(state, step.who, ctx);
  if (players.length === 0) {
    return {
      applied: false,
      message: `Skipped add mana (unsupported player selector): ${step.raw}`,
      reason: 'unsupported_player_selector',
    };
  }

  let nextState = state;
  const log: string[] = [];
  const manaToAdd = (() => {
    const options = Array.isArray(step.manaOptions)
      ? step.manaOptions.map(option => String(option || '').trim()).filter(Boolean)
      : [];
    if (options.length <= 1) return String(step.mana || '').trim();

    const chosenMana = String(ctx.selectorContext?.chosenMana || '').trim();
    if (!chosenMana) return options[0] || '';
    const match = options.find(option => option.toUpperCase() === chosenMana.toUpperCase());
    return match || options[0] || '';
  })();

  for (const playerId of players) {
    const result = addManaToPoolForPlayer(nextState, playerId, manaToAdd);
    log.push(...result.log);
    if (!result.applied) {
      return {
        applied: false,
        message: log.join('\n') || `Skipped add mana (failed to apply): ${step.raw}`,
        reason: 'failed_to_apply',
        options: {
          metadata: log.length > 0 ? { log } : undefined,
        },
      };
    }
    nextState = result.state;
  }

  return { applied: true, state: nextState, log };
}

export function evaluateUnlessPaysLifeStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'unless_pays_life' }>,
  ctx: OracleIRExecutionContext
): UnlessPaysLifeResult {
  const players = resolvePlayers(state, step.who, ctx);
  if (players.length !== 1) {
    return {
      applied: false,
      message: `Skipped unless-pays-life step (needs player choice): ${step.raw}`,
      reason: 'player_choice_required',
      options: {
        classification: 'player_choice',
        metadata: {
          selectorKind: step.who.kind,
          candidateCount: players.length,
          lifeAmount: step.amount,
        },
      },
    };
  }

  const payerId = players[0];
  const payer = (state.players || []).find(player => String(player?.id || '').trim() === String(payerId || '').trim()) as any;
  if (!payer) {
    return {
      applied: false,
      message: `Skipped unless-pays-life step (unsupported player selector): ${step.raw}`,
      reason: 'unsupported_player_selector',
    };
  }

  const lifeTotal = Number(payer.life);
  const canPayLife = Number.isFinite(lifeTotal) && lifeTotal >= step.amount;
  const explicitChoice =
    ctx.unlessPaysLifeChoice === 'pay' || ctx.unlessPaysLifeChoice === 'decline'
      ? ctx.unlessPaysLifeChoice
      : (ctx.selectorContext?.unlessPaysLifeChoice === 'pay' || ctx.selectorContext?.unlessPaysLifeChoice === 'decline'
          ? ctx.selectorContext.unlessPaysLifeChoice
          : undefined);
  if (canPayLife) {
    if (explicitChoice === 'pay') {
      const payment = adjustLife(state, payerId, -step.amount);
      return {
        applied: true,
        shouldApplyNestedSteps: false,
        state: payment.state,
        log: [
          ...payment.log,
          `Resolved unless-pays-life step (payer chose to pay ${step.amount} life): ${step.raw}`,
        ],
      };
    }

    if (explicitChoice === 'decline') {
      return {
        applied: true,
        shouldApplyNestedSteps: true,
        log: [`Resolved unless-pays-life step (payer declined to pay ${step.amount} life): ${step.raw}`],
      };
    }

    return {
      applied: false,
      message: `Skipped unless-pays-life step (opponent choice required): ${step.raw}`,
      reason: 'player_choice_required',
      options: {
        classification: 'player_choice',
        metadata: {
          payerId,
          payerLife: lifeTotal,
          lifeAmount: step.amount,
        },
      },
    };
  }

  return {
    applied: true,
    shouldApplyNestedSteps: true,
    log: [`Resolved unless-pays-life step (payer cannot pay ${step.amount} life): ${step.raw}`],
  };
}
