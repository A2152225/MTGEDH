// Origin parent: oracleIRExecutorMoveZoneStepHandlers.ts (lines 448-600 and 823-930 before extraction)
// Cluster moved: linked-exile ("exiled with this permanent") support - projecting the source
// permanent's static keyword/protection grants from its linked exiled cards, and the bulk step that
// returns every card exiled with the source.
// Public entry symbols: getCardTypesFromTypeLine, cardHasLinkedKeyword, parseSharedLinkedExileKeywords,
// projectLinkedExileStaticText, tryApplyMoveZoneLinkedExileBulkStep.

import type { GameState, PlayerID } from '../../shared/src';
import type { OracleEffectStep } from './oracleIR';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';
import {
  cardMatchesType,
  findCardsExiledWithSource,
  moveTargetedCardFromExile,
  parseMoveZoneAllCardsExiledWithIt,
  parseMoveZoneAllExiledWithThisPermanent,
  parseMoveZoneMechtitanReturnExiledExceptSelf,
  parseMoveZoneTheCardsExiledWithIt,
} from './oracleIRExecutorZoneOps';
import type {
  MoveZoneStepHandlerResult,
  StepApplyResult,
} from './oracleIRExecutorMoveZoneStepTypes';
import { buildAppliedResult } from './oracleIRExecutorMoveZoneStepResultBuilders';

const CARD_TYPE_WORDS = ['artifact', 'battle', 'creature', 'enchantment', 'instant', 'kindred', 'land', 'planeswalker', 'sorcery'] as const;
const LINKED_EXILE_SHARED_KEYWORDS = [
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
] as const;

export function getCardTypesFromTypeLine(card: any): readonly string[] {
  const typeLine = String(card?.type_line || card?.card?.type_line || '').toLowerCase();
  if (!typeLine) return [];

  const found: string[] = [];
  for (const typeWord of CARD_TYPE_WORDS) {
    if (typeLine.includes(typeWord) && !found.includes(typeWord)) {
      found.push(typeWord);
    }
  }
  return found;
}

export function cardHasLinkedKeyword(card: any, keyword: string): boolean {
  const normalizedKeyword = String(keyword || '').trim().toLowerCase();
  if (!normalizedKeyword) return false;

  const oracleText = String(card?.oracle_text || card?.card?.oracle_text || '').toLowerCase();
  const printedKeywords = Array.isArray(card?.keywords) ? card.keywords : Array.isArray(card?.card?.keywords) ? card.card.keywords : [];
  const grantedAbilities = Array.isArray(card?.grantedAbilities) ? card.grantedAbilities : Array.isArray(card?.card?.grantedAbilities) ? card.card.grantedAbilities : [];

  return (
    oracleText.includes(normalizedKeyword) ||
    printedKeywords.some((entry: unknown) => String(entry || '').trim().toLowerCase() === normalizedKeyword) ||
    grantedAbilities.some((entry: unknown) => String(entry || '').trim().toLowerCase() === normalizedKeyword)
  );
}

export function parseSharedLinkedExileKeywords(sourceText: string): readonly string[] {
  const normalized = String(sourceText || '').toLowerCase();
  if (!normalized.includes('this creature has flying as long as a card exiled with it has flying')) return [];

  const keywords = new Set<string>(['flying']);
  const sameIsTrueMatch = normalized.match(/the same is true for ([^.]+)/i);
  if (sameIsTrueMatch) {
    const parts = String(sameIsTrueMatch[1] || '')
      .split(/,\s*|\s+and\s+/i)
      .map(part => part.trim().toLowerCase())
      .filter(Boolean);
    for (const part of parts) {
      if ((LINKED_EXILE_SHARED_KEYWORDS as readonly string[]).includes(part)) {
        keywords.add(part);
      }
    }
  }

  return [...keywords];
}

export function projectLinkedExileStaticText(params: {
  state: GameState;
  movedCards?: readonly any[];
  ctx: OracleIRExecutionContext;
}): GameState {
  const sourceId = String(params.ctx.sourceId || '').trim();
  let movedCards = Array.isArray(params.movedCards) ? params.movedCards : [];
  if (!sourceId) return params.state;
  const linkedMatches = findCardsExiledWithSource(params.state, sourceId, { cardType: 'any' });
  if (movedCards.length !== 1) {
    movedCards = linkedMatches.length === 1 ? [linkedMatches[0].card] : [];
  }

  const battlefield = Array.isArray((params.state as any).battlefield) ? ((params.state as any).battlefield as any[]) : [];
  const sourcePermanent = battlefield.find((perm: any) => String((perm as any)?.id || '').trim() === sourceId);
  if (!sourcePermanent) return params.state;

  const sourceText = `${String((sourcePermanent as any)?.oracle_text || '').trim()}\n${String((sourcePermanent as any)?.card?.oracle_text || '').trim()}`
    .toLowerCase();
  const sharedKeywords = parseSharedLinkedExileKeywords(sourceText);
  if (sharedKeywords.length > 0) {
    const linkedCards = linkedMatches.map(match => match.card);
    const projectedKeywords = sharedKeywords.filter(keyword =>
      linkedCards.some(card => cardHasLinkedKeyword(card, keyword))
    );
    const previousProjected = Array.isArray((sourcePermanent as any)?.linkedExileGrantedAbilities)
      ? (sourcePermanent as any).linkedExileGrantedAbilities
          .map((entry: unknown) => String(entry || '').trim().toLowerCase())
          .filter(Boolean)
      : [];
    const existingGranted = Array.isArray((sourcePermanent as any)?.grantedAbilities)
      ? (sourcePermanent as any).grantedAbilities
          .map((entry: unknown) => String(entry || '').trim().toLowerCase())
          .filter(Boolean)
      : [];
    const retainedGranted = existingGranted.filter((entry: string) => !previousProjected.includes(entry));
    const nextGranted = Array.from(new Set([...retainedGranted, ...projectedKeywords]));
    const nextBattlefield = battlefield.map((perm: any) =>
      String((perm as any)?.id || '').trim() === sourceId
        ? ({
            ...perm,
            linkedExileGrantedAbilities: projectedKeywords,
            grantedAbilities: nextGranted,
          } as any)
        : perm
    );

    return {
      ...(params.state as any),
      battlefield: nextBattlefield as any,
    } as GameState;
  }

  if (movedCards.length !== 1) return params.state;
  if (!sourceText.includes("has protection from each of the exiled card's card types")) {
    return params.state;
  }

  const projectedTypes = getCardTypesFromTypeLine(movedCards[0]);
  if (projectedTypes.length === 0) return params.state;

  const existingGranted = Array.isArray((sourcePermanent as any)?.grantedAbilities)
    ? (sourcePermanent as any).grantedAbilities
        .map((entry: unknown) => String(entry || '').trim())
        .filter(Boolean)
    : [];
  const nextGranted = [...existingGranted];
  for (const typeWord of projectedTypes) {
    const grantedText = `protection from ${typeWord}`;
    if (!nextGranted.some((entry: string) => entry.toLowerCase() === grantedText)) {
      nextGranted.push(grantedText);
    }
  }

  const nextBattlefield = battlefield.map((perm: any) =>
    String((perm as any)?.id || '').trim() === sourceId
      ? ({
          ...perm,
          grantedAbilities: nextGranted,
        } as any)
      : perm
  );

  return {
    ...(params.state as any),
    battlefield: nextBattlefield as any,
  } as GameState;
}

export function tryApplyMoveZoneLinkedExileBulkStep(params: {
  readonly nextState: GameState;
  readonly step: Extract<OracleEffectStep, { kind: 'move_zone' }>;
  readonly ctx: OracleIRExecutionContext;
  readonly controllerId: PlayerID;
  readonly effectiveWithCounters?: Record<string, number>;
  readonly battlefieldEntryOverrides?: {
    readonly setTypeLine?: string;
    readonly setOracleText?: string;
    readonly loseAllAbilities?: boolean;
  };
  readonly finalizeAppliedResult: (result: {
    readonly state: GameState;
    readonly log: readonly string[];
    readonly movedCards?: readonly any[];
    readonly movedPermanentIds?: readonly string[];
  }) => StepApplyResult;
}): MoveZoneStepHandlerResult | null {
  const parsedAllCardsExiledWithIt = parseMoveZoneAllCardsExiledWithIt(params.step.what as any);
  const parsedAllExiledWithThisPermanent = parseMoveZoneAllExiledWithThisPermanent(params.step.what as any);
  const parsedTheCardsExiledWithIt = parseMoveZoneTheCardsExiledWithIt(params.step.what as any);
  const parsedMechtitan = parseMoveZoneMechtitanReturnExiledExceptSelf(params.step.what as any);
  const exiledSpec =
    parsedAllCardsExiledWithIt ||
    parsedAllExiledWithThisPermanent ||
    (parsedTheCardsExiledWithIt ? { cardType: 'any' as const } : null);
  if (!exiledSpec && !parsedMechtitan) return null;

  const { step, ctx, controllerId, effectiveWithCounters, battlefieldEntryOverrides, finalizeAppliedResult } =
    params;
  let { nextState } = params;
  const sourceId = String(ctx.sourceId || '').trim();
  if (!sourceId) {
    return {
      applied: false,
      message: `Skipped move zone (linked exile source unavailable): ${step.raw}`,
      reason: 'impossible_action',
      options: { persist: false },
    };
  }
  if (step.to !== 'hand' && step.to !== 'graveyard' && step.to !== 'battlefield') {
    return {
      applied: false,
      message: `Skipped move zone (unsupported destination): ${step.raw}`,
      reason: 'unsupported_destination',
    };
  }

  let matches = findCardsExiledWithSource(nextState, sourceId, {
    cardType: exiledSpec?.cardType || 'any',
  });
  if (parsedMechtitan) {
    matches = matches.filter(match => match.cardId !== sourceId);
  }
  if (parsedAllExiledWithThisPermanent?.excludeCreatureCards) {
    matches = matches.filter(match => {
      const player = nextState.players.find(p => p.id === match.playerId) as any;
      const exile = Array.isArray(player?.exile) ? player.exile : [];
      const card = exile.find((entry: any) => String(entry?.id || '').trim() === match.cardId);
      return card ? !cardMatchesType(card, 'creature') : true;
    });
  }
  if (matches.length === 0) {
    return buildAppliedResult({
      state: nextState,
      log: [`No cards exiled with source: ${step.raw}`],
    });
  }

  const entersTapped =
    parsedMechtitan ||
    step.entersTapped === true ||
    /\btapped\b/i.test(String(step.toRaw || step.raw || ''));
  let workingState = nextState;
  const combinedLog: string[] = [];
  let movedPermanentIds: string[] = [];
  for (const match of matches) {
    const battlefieldControllerId =
      step.battlefieldController?.kind === 'owner_of_moved_cards'
        ? match.playerId
        : step.battlefieldController?.kind === 'you'
          ? controllerId
          : undefined;
    const result = moveTargetedCardFromExile(
      workingState,
      match.playerId,
      match.cardId,
      'any',
      step.to === 'battlefield' ? 'battlefield' : step.to,
      step.to === 'battlefield' ? battlefieldControllerId : undefined,
      entersTapped,
      step.entersFaceDown,
      effectiveWithCounters,
      undefined,
      battlefieldEntryOverrides
    );
    if (result.kind !== 'applied') continue;
    workingState = result.state;
    combinedLog.push(...(result.log || []));
    movedPermanentIds = movedPermanentIds.concat(result.movedPermanentIds || []);
  }

  return finalizeAppliedResult({
    state: workingState,
    log: combinedLog.length > 0 ? combinedLog : [`Moved cards exiled with source: ${step.raw}`],
    ...(movedPermanentIds.length > 0 ? { movedPermanentIds } : {}),
  });
}
