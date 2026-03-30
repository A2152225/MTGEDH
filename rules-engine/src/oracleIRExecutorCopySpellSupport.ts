import type { GameState, PlayerID } from '../../shared/src';
import type { OracleEffectStep } from './oracleIR';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';
import { parseOracleTextToIR } from './oracleIRParser';
import { getStackItems } from './stackOperations';
import {
  cardMatchesMoveZoneSingleTargetCriteria,
  findCardsExiledWithSource,
  parseMoveZoneSingleTargetFromYourGraveyard,
} from './oracleIRExecutorZoneOps';
import { getCurrentTurnNumber } from './oracleIRExecutorPlayerUtils';
import { payManaCost } from './spellCasting';
import { createEmptyManaPool, type ManaCost } from './types/mana';
import { parseManaSymbols } from './types/numbers';

export function prepareCopiedSpellExecutionContext(params: {
  state: GameState;
  replaySteps: readonly OracleEffectStep[];
  ctx: OracleIRExecutionContext;
}): {
  readonly ctx: OracleIRExecutionContext;
  readonly log: readonly string[];
  readonly requiresChoice?: boolean;
  readonly candidateCount?: number;
} {
  const { state, replaySteps, ctx } = params;
  const copiedCtx: OracleIRExecutionContext = {
    ...ctx,
    castFromZone: undefined,
    enteredFromZone: undefined,
  };

  const targetMoveStep = replaySteps.find((step): step is Extract<OracleEffectStep, { kind: 'move_zone' }> => {
    if (step.kind !== 'move_zone') return false;
    return Boolean(parseMoveZoneSingleTargetFromYourGraveyard(step.what as any));
  });
  if (!targetMoveStep) {
    return { ctx: copiedCtx, log: [] };
  }

  const criteria = parseMoveZoneSingleTargetFromYourGraveyard(targetMoveStep.what as any);
  if (!criteria) {
    return { ctx: copiedCtx, log: [] };
  }

  const controllerId = (String(ctx.controllerId || '').trim() || ctx.controllerId) as PlayerID;
  const player = (state.players || []).find((candidate: any) => String(candidate?.id || '').trim() === controllerId) as any;
  const graveyard = Array.isArray(player?.graveyard) ? player.graveyard : [];
  const currentTargetId = String(ctx.targetPermanentId || ctx.targetCreatureId || '').trim();
  const currentTurn = Number((state as any).turnNumber ?? (state as any).turn ?? 0) || 0;

  if (currentTargetId) {
    const currentTargetStillLegal = graveyard.some((card: any) => {
      const cardId = String(card?.id || '').trim();
      return cardId === currentTargetId && cardMatchesMoveZoneSingleTargetCriteria(card, criteria, undefined, currentTurn);
    });
    if (currentTargetStillLegal) {
      return { ctx: copiedCtx, log: [] };
    }
  }

  const alternativeMatches = graveyard.filter((card: any) => {
    const cardId = String(card?.id || '').trim();
    if (!cardId || cardId === currentTargetId) return false;
    return cardMatchesMoveZoneSingleTargetCriteria(card, criteria, undefined, currentTurn);
  });

  if (alternativeMatches.length !== 1) {
    return {
      ctx: copiedCtx,
      log: [],
      ...(alternativeMatches.length > 1 ? { requiresChoice: true, candidateCount: alternativeMatches.length } : {}),
    };
  }

  const retargetedId = String((alternativeMatches[0] as any)?.id || '').trim();
  if (!retargetedId) return { ctx: copiedCtx, log: [] };

  return {
    ctx: {
      ...copiedCtx,
      targetPermanentId: retargetedId,
      targetCreatureId: retargetedId,
    },
    log: [`[oracle-ir] Auto-retargeted copied spell to ${retargetedId}`],
  };
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
      generic += Number.parseInt(upper.slice(1, -1), 10);
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

export function getCopiedSpellReplaySteps(card: any): readonly OracleEffectStep[] {
  const copiedSpellText = String(card?.oracle_text || card?.card?.oracle_text || '').trim();
  if (!copiedSpellText) return [];

  const copiedSpellIr = parseOracleTextToIR(
    copiedSpellText,
    String(card?.name || card?.card?.name || 'Copied Spell')
  );
  return copiedSpellIr.abilities
    .flatMap((ability) => ability.steps)
    .filter((candidate): candidate is OracleEffectStep => candidate.kind !== 'copy_spell' && candidate.kind !== 'unknown');
}

export function getThisSpellReplayStepsFromState(state: GameState, sourceId?: string): readonly OracleEffectStep[] {
  const normalizedSourceId = String(sourceId || '').trim();
  if (!normalizedSourceId) return [];

  const stackObject = getStackItems((state as any)?.stack).find(
    (item: any) => String(item?.id || '').trim() === normalizedSourceId && String(item?.type || '').trim() === 'spell'
  ) as any;
  if (!stackObject) return [];

  const oracleText = String(
    stackObject?.card?.oracle_text ||
      stackObject?.spell?.oracle_text ||
      stackObject?.oracle_text ||
      ''
  ).trim();
  if (!oracleText) return [];

  const sourceName = String(
    stackObject?.cardName ||
      stackObject?.card?.name ||
      stackObject?.spell?.name ||
      'Copied Spell'
  ).trim() || 'Copied Spell';

  const copiedSpellIr = parseOracleTextToIR(oracleText, sourceName);
  return copiedSpellIr.abilities
    .flatMap((ability) => ability.steps)
    .filter((candidate): candidate is OracleEffectStep => candidate.kind !== 'copy_spell' && candidate.kind !== 'unknown');
}

export function resolveCopySpellCount(
  state: GameState,
  controllerId: PlayerID,
  step: Extract<OracleEffectStep, { kind: 'copy_spell' }>
): number {
  if (!step.copies) return 1;
  if (step.copies.kind === 'number') {
    return Math.max(0, Number(step.copies.value) || 0);
  }
  if (step.copies.kind === 'spells_cast_before_this_turn') {
    const stateAny = state as any;
    const totalCastThisTurn = Number((stateAny?.spellsCastThisTurn || {})?.[controllerId] || 0);
    return Math.max(0, totalCastThisTurn - 1);
  }
  return 0;
}

function parseRomanChapterList(text: string): readonly number[] {
  const chapterMap: Record<string, number> = {
    I: 1,
    II: 2,
    III: 3,
    IV: 4,
    V: 5,
    VI: 6,
    VII: 7,
    VIII: 8,
    IX: 9,
    X: 10,
  };

  return String(text || '')
    .split(/\s*,\s*/)
    .map(part => chapterMap[String(part || '').trim().toUpperCase()])
    .filter((value): value is number => Number.isFinite(value));
}

export function getCopiedChapterAbilityReplaySteps(card: any, chapter: number): readonly OracleEffectStep[] {
  const oracleText = String(card?.oracle_text || card?.card?.oracle_text || '').replace(/\r/g, '').trim();
  if (!oracleText || !Number.isFinite(chapter) || chapter <= 0) return [];

  const lines = oracleText.split(/\n+/).map(line => line.trim()).filter(Boolean);
  for (const line of lines) {
    const match = line.match(/^([IVX]+(?:\s*,\s*[IVX]+)*)\s*[-\u2013\u2014]\s*([\s\S]+)$/i);
    if (!match) continue;

    const chapterNumbers = parseRomanChapterList(String(match[1] || ''));
    if (!chapterNumbers.includes(chapter)) continue;

    const effectText = String(match[2] || '').trim();
    if (!effectText) return [];

    const copiedIr = parseOracleTextToIR(effectText, String(card?.name || card?.card?.name || 'Copied Chapter'));
    return copiedIr.abilities
      .flatMap((ability) => ability.steps)
      .filter((candidate): candidate is OracleEffectStep =>
        candidate.kind !== 'copy_spell' &&
        candidate.kind !== 'copy_chapter_ability' &&
        candidate.kind !== 'unknown'
      );
  }

  return [];
}

export function resolveCopiedSpellSourceCards(params: {
  state: GameState;
  step: Extract<OracleEffectStep, { kind: 'copy_spell' }>;
  ctx: OracleIRExecutionContext;
  lastMovedCards: readonly any[];
}): {
  readonly cards?: readonly any[];
  readonly reason?: 'invalid_source' | 'player_choice_required';
  readonly metadata?: Record<string, unknown>;
} {
  const { state, step, ctx, lastMovedCards } = params;

  if (step.subject === 'last_moved_card') {
    return lastMovedCards.length === 1
      ? { cards: [lastMovedCards[0]] }
      : { reason: 'invalid_source' };
  }

  if (step.subject === 'linked_exiled_cards') {
    const sourceId = String(ctx.sourceId || '').trim();
    if (!sourceId) return { reason: 'invalid_source' };
    const matches = findCardsExiledWithSource(state, sourceId, { cardType: 'any' });
    return matches.length > 0
      ? { cards: matches.map(match => match.card) }
      : { reason: 'invalid_source' };
  }

  return { reason: 'invalid_source' };
}

export function payCopiedSpellCastCost(params: {
  state: GameState;
  controllerId: PlayerID;
  card: any;
  step: Extract<OracleEffectStep, { kind: 'copy_spell' }>;
}): {
  readonly state: GameState;
  readonly log: readonly string[];
  readonly paid?: boolean;
  readonly reason?: 'unsupported_cost' | 'cannot_pay';
} {
  const { state, controllerId, card, step } = params;
  if (step.withoutPayingManaCost) return { state, log: [] };

  const rawCost =
    step.castCost === 'mana_cost' || typeof step.castCost === 'undefined'
      ? String(card?.mana_cost || card?.manaCost || card?.card?.mana_cost || card?.card?.manaCost || '').trim()
      : String(step.castCost || '').trim();
  if (!rawCost) {
    return { state, log: [], reason: 'unsupported_cost' };
  }

  const manaCost = parseSupportedManaCostString(rawCost);
  if (!manaCost) {
    return { state, log: [], reason: 'unsupported_cost' };
  }

  const playerIndex = (state.players || []).findIndex(
    (player: any) => String(player?.id || '').trim() === String(controllerId || '').trim()
  );
  const player = playerIndex >= 0 ? (state.players[playerIndex] as any) : null;
  const manaPoolRecord: Record<PlayerID, any> = { ...((((state as any).manaPool || {}) as any) || {}) };
  const currentPool = player?.manaPool || manaPoolRecord[controllerId] || createEmptyManaPool();
  const payment = payManaCost(currentPool, manaCost);
  if (!payment.success || !payment.remainingPool) {
    return { state, log: [], reason: 'cannot_pay' };
  }

  manaPoolRecord[controllerId] = payment.remainingPool;
  const updatedPlayers =
    playerIndex >= 0
      ? (state.players || []).map((candidate: any, index: number) =>
          index === playerIndex ? ({ ...candidate, manaPool: payment.remainingPool } as any) : candidate
        )
      : state.players;
  return {
    state: { ...(state as any), manaPool: manaPoolRecord, players: updatedPlayers as any } as any,
    log: [`${controllerId} pays ${rawCost} to cast the copied spell`],
    paid: true,
  };
}

function buildCopiedCardId(existingIds: Set<string>, originalId: string, ordinal: number): string {
  const base = `${originalId || 'copied-spell'}-copy`;
  let suffix = ordinal;
  let candidate = `${base}-${suffix}`;
  while (existingIds.has(candidate)) {
    suffix += 1;
    candidate = `${base}-${suffix}`;
  }
  existingIds.add(candidate);
  return candidate;
}

export function createCastableCopiedSpellCards(params: {
  state: GameState;
  controllerId: PlayerID;
  cards: readonly any[];
  step: Extract<OracleEffectStep, { kind: 'copy_spell' }>;
}): {
  readonly state: GameState;
  readonly createdCards: readonly any[];
  readonly log: readonly string[];
} {
  const { state, controllerId, cards, step } = params;
  if (!Array.isArray(cards) || cards.length === 0) {
    return { state, createdCards: [], log: [] };
  }

  const existingIds = new Set<string>();
  for (const player of state.players as any[]) {
    for (const card of Array.isArray(player?.exile) ? player.exile : []) {
      const id = String(card?.id ?? card?.cardId ?? '').trim();
      if (id) existingIds.add(id);
    }
  }

  const playableUntilTurn = getCurrentTurnNumber(state);
  const stateAny: any = state as any;
  stateAny.playableFromExile = stateAny.playableFromExile || {};
  stateAny.playableFromExile[controllerId] = stateAny.playableFromExile[controllerId] || {};

  const createdCards: any[] = [];
  const updatedPlayers = (state.players || []).map((player: any) => {
    if (String(player?.id || '').trim() !== String(controllerId || '').trim()) return player;

    const exile = Array.isArray(player?.exile) ? [...player.exile] : [];
    cards.forEach((sourceCard, index) => {
      const base = sourceCard?.card && typeof sourceCard.card === 'object'
        ? { ...sourceCard.card, ...(sourceCard || {}) }
        : { ...(sourceCard || {}) };
      const originalId = String(base?.copiedFromCardId || base?.id || base?.cardId || '').trim();
      const copyId = buildCopiedCardId(existingIds, originalId, index + 1);
      const copiedCard = {
        ...base,
        id: copyId,
        zone: 'exile',
        isCopy: true,
        copiedFromCardId: originalId || undefined,
        canBePlayedBy: controllerId,
        playableUntilTurn,
        ...(step.withoutPayingManaCost ? { withoutPayingManaCost: true } : {}),
        ...(step.castCost && step.castCost !== 'mana_cost' ? { exileCastCost: step.castCost } : {}),
      };
      exile.push(copiedCard);
      createdCards.push(copiedCard);
      stateAny.playableFromExile[controllerId][copyId] = playableUntilTurn;
    });

    return { ...player, exile };
  });

  return {
    state: { ...(stateAny as any), players: updatedPlayers as any } as any,
    createdCards,
    log: createdCards.length > 0
      ? [`[oracle-ir] Created ${createdCards.length} castable copied spell${createdCards.length === 1 ? '' : 's'} in exile`]
      : [],
  };
}
