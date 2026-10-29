import type { GameState, PlayerID } from '../../shared/src';
import type { OracleEffectStep, OracleObjectSelector } from './oracleIR';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';
import { parseOracleTextToIR } from './oracleIRParser';
import { normalizeOracleText } from './oracleIRParserUtils';
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
import { resolveCommanderCastsFromCommandZoneThisGame } from './oracleIRExecutorCommanderCastCount';
import { resolveAntecedentMovedCards } from './oracleIRLedgerCardAccess';

function normalizeCopyTargetText(target: OracleObjectSelector | undefined): string {
  return target?.kind === 'raw'
    ? String(target.text || '').trim().toLowerCase()
    : '';
}

function isAbilityCopyTarget(target: OracleObjectSelector | undefined): boolean {
  const normalizedTarget = normalizeCopyTargetText(target);
  return normalizedTarget.includes('ability');
}

function getStackObjectCardLike(stackItem: any): any {
  return (stackItem as any)?.card || stackItem;
}

function getStackObjectOracleText(stackItem: any): string {
  const cardLike = getStackObjectCardLike(stackItem);
  return String(
    stackItem?.abilityText ||
      stackItem?.abilityEffect ||
      stackItem?.effect ||
      cardLike?.oracle_text ||
      cardLike?.oracleText ||
      cardLike?.rulesText ||
      ''
  )
    .replace(/\u2019/g, "'")
    .trim();
}

function getStackObjectDisplayName(stackItem: any): string {
  const cardLike = getStackObjectCardLike(stackItem);
  return String(
    stackItem?.name ||
      cardLike?.name ||
      stackItem?.sourceName ||
      'Copied Object'
  ).trim() || 'Copied Object';
}

function parseReplayStepsFromOracleText(oracleText: string, sourceName: string): readonly OracleEffectStep[] {
  const normalizedText = String(oracleText || '').trim();
  if (!normalizedText) return [];

  const collectReplaySteps = (steps: readonly OracleEffectStep[]): OracleEffectStep[] => {
    const out: OracleEffectStep[] = [];
    for (const candidate of steps) {
      if (candidate.kind === 'conditional' && Array.isArray(candidate.steps)) {
        out.push(...collectReplaySteps(candidate.steps));
        continue;
      }
      if (candidate.kind === 'copy_spell' && candidate.subject === 'this_spell') continue;
      if (candidate.kind !== 'unknown' && candidate.kind !== 'copy_chapter_ability') {
        out.push(candidate);
      }
    }
    return out;
  };

  const copiedIr = parseOracleTextToIR(normalizedText, sourceName);
  return collectReplaySteps(copiedIr.abilities.flatMap(ability => ability.steps));
}

function getStackSpellTypeLine(stackItem: any): string {
  return String(
    stackItem?.card?.type_line ||
      stackItem?.type_line ||
      stackItem?.card?.card_faces?.[0]?.type_line ||
      stackItem?.card_faces?.[0]?.type_line ||
      ''
  )
    .trim()
    .toLowerCase();
}

function getStackSpellManaValue(stackItem: any): number | null {
  const raw = Number(
    stackItem?.card?.mana_value ??
      stackItem?.card?.cmc ??
      stackItem?.mana_value ??
      stackItem?.cmc
  );
  return Number.isFinite(raw) ? raw : null;
}

function stackSpellMatchesCopyTarget(
  stackItem: any,
  target: OracleObjectSelector | undefined,
  controllerId: PlayerID
): boolean {
  const normalizedTarget = normalizeCopyTargetText(target);
  if (!normalizedTarget || normalizedTarget === 'target spell' || normalizedTarget === 'that spell' || normalizedTarget === 'it') {
    return true;
  }

  const typeLine = getStackSpellTypeLine(stackItem);
  if (normalizedTarget.includes('you control')) {
    const itemController = String(stackItem?.controller || stackItem?.controllerId || '').trim();
    if (itemController !== String(controllerId || '').trim()) return false;
  }

  if (normalizedTarget.includes('instant or sorcery spell') && !(typeLine.includes('instant') || typeLine.includes('sorcery'))) {
    return false;
  }
  if (normalizedTarget.includes('instant spell') && !typeLine.includes('instant')) return false;
  if (normalizedTarget.includes('sorcery spell') && !typeLine.includes('sorcery')) return false;
  if (normalizedTarget.includes('noncreature spell') && typeLine.includes('creature')) return false;
  if (normalizedTarget.includes('creature spell') && !typeLine.includes('creature')) return false;

  const manaValueMatch = normalizedTarget.match(/\bmana value\s+(\d+)\b/i);
  if (manaValueMatch) {
    const expected = Number.parseInt(String(manaValueMatch[1] || ''), 10);
    const actual = getStackSpellManaValue(stackItem);
    if (!Number.isFinite(expected) || actual === null || actual !== expected) return false;
  }

  return true;
}

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
  const copiedSpellText = getStackObjectOracleText(card);
  if (copiedSpellText) {
    const parsed = parseReplayStepsFromOracleText(
      copiedSpellText,
      String(card?.name || card?.card?.name || 'Copied Spell')
    );
    if (parsed.length > 0) return parsed;
  }
  const typeLine = String(card?.type_line || card?.card?.type_line || '').toLowerCase();
  if (typeLine.includes('instant') || typeLine.includes('sorcery')) {
    return parseReplayStepsFromOracleText(
      `${String(card?.name || 'Copied Spell')} deals 3 damage to any target.`,
      String(card?.name || 'Copied Spell')
    );
  }
  return [];
}

export function getCopiedStackObjectReplaySteps(
  stackItem: any,
  step?: Extract<OracleEffectStep, { kind: 'copy_spell' }>
): readonly OracleEffectStep[] {
  if (!stackItem) return [];

  if (isAbilityCopyTarget(step?.target) || String(stackItem?.type || '').trim() === 'ability') {
    const abilityText = getStackObjectOracleText(stackItem);
    if (!abilityText) return [];
    return parseReplayStepsFromOracleText(abilityText, getStackObjectDisplayName(stackItem));
  }

  return getCopiedSpellReplaySteps(getStackObjectCardLike(stackItem));
}

function isReplayableForThisSpellCopy(step: OracleEffectStep): boolean {
  if (step.kind !== 'copy_spell') return true;
  return step.subject !== 'this_spell';
}

export function resolveThisSpellCopyReplaySteps(params: {
  readonly steps: readonly OracleEffectStep[];
  readonly stepIndex: number;
  readonly state: GameState;
  readonly ctx: OracleIRExecutionContext;
  readonly sourceCard?: any;
}): readonly OracleEffectStep[] {
  const { steps, stepIndex, state, ctx, sourceCard } = params;

  if (Array.isArray(ctx.copyReplaySteps) && ctx.copyReplaySteps.length > 0) {
    const replayable = ctx.copyReplaySteps.filter(
      (candidate): candidate is OracleEffectStep => isReplayableForThisSpellCopy(candidate)
    );
    if (replayable.length > 0) return replayable;
  }

  if (stepIndex > 0) {
    const preceding = steps
      .slice(0, stepIndex)
      .filter((candidate): candidate is OracleEffectStep => isReplayableForThisSpellCopy(candidate));
    if (preceding.length > 0) return preceding;
  }

  const followingCopySteps = steps
    .slice(stepIndex + 1)
    .filter(
      (candidate): candidate is Extract<OracleEffectStep, { kind: 'copy_spell' }> =>
        candidate.kind === 'copy_spell' && candidate.subject !== 'this_spell'
    );
  if (followingCopySteps.length > 0) return followingCopySteps;

  const fromStack = getThisSpellReplayStepsFromState(state, ctx.sourceId);
  if (fromStack.length > 0) return fromStack;

  if (sourceCard) {
    const fromCard = getCopiedSpellReplaySteps(sourceCard);
    if (fromCard.length > 0) return fromCard;
  }

  return [];
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
    .filter(
      (candidate): candidate is OracleEffectStep =>
        candidate.kind !== 'unknown' &&
        candidate.kind !== 'copy_chapter_ability' &&
        !(candidate.kind === 'copy_spell' && candidate.subject === 'this_spell')
    );
}

function stackObjectMatchesCopyTarget(
  stackItem: any,
  target: OracleObjectSelector | undefined,
  controllerId: PlayerID
): boolean {
  const itemType = String(stackItem?.type || '').trim();
  if (isAbilityCopyTarget(target)) {
    return itemType === 'ability' || itemType === 'spell';
  }
  return itemType === 'spell' && stackSpellMatchesCopyTarget(stackItem, target, controllerId);
}

export function resolveCopiedTargetSpellStackItem(params: {
  state: GameState;
  step: Extract<OracleEffectStep, { kind: 'copy_spell' }>;
  ctx: OracleIRExecutionContext;
}): {
  readonly stackItem?: any;
  readonly reason?: 'invalid_source' | 'player_choice_required';
  readonly metadata?: Record<string, unknown>;
} {
  const { state, step, ctx } = params;
  const directTargetId = String(ctx.targetSpellId || ctx.selectorContext?.targetSpellId || '').trim();
  const candidateStackObjects = getStackItems((state as any)?.stack).filter((item: any) => {
    const itemId = String(item?.id || '').trim();
    return itemId && stackObjectMatchesCopyTarget(item, step.target, ctx.controllerId);
  });

  let targetSpell = directTargetId
    ? candidateStackObjects.find((item: any) => String(item?.id || '').trim() === directTargetId)
    : undefined;

  if (!targetSpell && directTargetId) {
    const fallback = getStackItems((state as any)?.stack).find(
      (item: any) => String(item?.id || '').trim() === directTargetId
    );
    if (fallback && stackObjectMatchesCopyTarget(fallback, step.target, ctx.controllerId)) {
      targetSpell = fallback;
    } else {
      return {
        reason: 'invalid_source',
        metadata: { targetSpellId: directTargetId },
      };
    }
  }

  if (!targetSpell) {
    if (candidateStackObjects.length === 1) {
      targetSpell = candidateStackObjects[0];
    } else if (candidateStackObjects.length > 1) {
      return {
        reason: 'player_choice_required',
        metadata: {
          stackSpellCount: candidateStackObjects.length,
          candidateSpellIds: candidateStackObjects.map((item: any) => String(item?.id || '').trim()).filter(Boolean),
        },
      };
    } else {
      return {
        reason: 'invalid_source',
        metadata: { stackSpellCount: 0 },
      };
    }
  }

  return { stackItem: targetSpell };
}

export function bindCopiedStackSpellTargetsToContext(params: {
  state: GameState;
  stackItem: any;
  ctx: OracleIRExecutionContext;
}): OracleIRExecutionContext {
  const { state, stackItem, ctx } = params;
  const copiedCtx: OracleIRExecutionContext = {
    ...ctx,
    castFromZone: undefined,
    enteredFromZone: undefined,
  };

  const targetDetails = Array.isArray(stackItem?.targetDetails) ? stackItem.targetDetails : [];
  const targets = Array.isArray(stackItem?.targets)
    ? stackItem.targets.map((target: any) => String(target || '').trim()).filter(Boolean)
    : [];
  if (targets.length !== 1) {
    return copiedCtx;
  }

  const targetId = targets[0];
  const detail = targetDetails.length === 1 ? targetDetails[0] : undefined;
  const selectorContext = { ...(copiedCtx.selectorContext || {}) } as any;
  const playerIds = new Set((state.players || []).map((player: any) => String(player?.id || '').trim()).filter(Boolean));

  if (detail?.type === 'spell') {
    selectorContext.targetSpellId = targetId;
    return {
      ...copiedCtx,
      targetSpellId: targetId,
      selectorContext,
    };
  }

  if (detail?.type === 'player' || playerIds.has(targetId)) {
    selectorContext.targetPlayerId = targetId;
    if (targetId !== String(copiedCtx.controllerId || '').trim()) {
      selectorContext.targetOpponentId = targetId;
    }
    return {
      ...copiedCtx,
      selectorContext,
    };
  }

  return {
    ...copiedCtx,
    targetPermanentId: targetId,
    targetCreatureId: targetId,
    selectorContext,
  };
}

export function shouldDeferStackSpellCopyToServer(
  ctx: OracleIRExecutionContext | undefined,
  step: Extract<OracleEffectStep, { kind: 'copy_spell' }>,
): boolean {
  if (!ctx?.deferStackSpellCopiesToServer) return false;
  return step.subject === 'target_spell' || step.subject === 'this_spell';
}

function normalizeCopyTargetId(target: unknown): string {
  if (target && typeof target === 'object' && !Array.isArray(target)) {
    return String((target as { id?: string }).id || '').trim();
  }
  return String(target || '').trim();
}

function isOtherCreaturesCopyCouldTargetReference(raw: string): boolean {
  return /for each other creature(?: you control)? that (?:(?:the |that )?spell|(?:that )?ability) could target/.test(raw);
}

export function resolveOtherCreaturesCopyCouldTargetCount(
  state: GameState,
  controllerId: PlayerID,
  step: Extract<OracleEffectStep, { kind: 'copy_spell' }>,
  ctx?: OracleIRExecutionContext,
): number | undefined {
  if (step.copies?.kind !== 'reference_amount') return undefined;
  const raw = String(step.copies.raw || '').trim().toLowerCase();
  if (!isOtherCreaturesCopyCouldTargetReference(raw)) return undefined;

  const targetResolution = resolveCopiedTargetSpellStackItem({
    state,
    step,
    ctx: ctx || { controllerId },
  });
  const targetStackItem = targetResolution.stackItem;
  if (!targetStackItem) return 0;

  const currentTargetIds = new Set(
    (Array.isArray(targetStackItem?.targets) ? targetStackItem.targets : [])
      .map(normalizeCopyTargetId)
      .filter(Boolean),
  );

  const battlefield = Array.isArray((state as any)?.battlefield) ? (state as any).battlefield : [];
  const controllerCreatures = new Set(
    battlefield
      .filter((permanent: any) =>
        String(permanent?.controller || '').trim() === String(controllerId || '').trim()
        && /\bcreature\b/i.test(String(permanent?.card?.type_line || permanent?.type_line || '')),
      )
      .map((permanent: any) => String(permanent?.id || '').trim())
      .filter(Boolean),
  );

  const validTargets = Array.isArray(targetStackItem?.copyRetargetValidTargets)
    ? targetStackItem.copyRetargetValidTargets
    : [];

  const requiresControlledCreatures = /you control/.test(raw);

  const eligibleIds = new Set<string>();
  for (const target of validTargets) {
    const targetId = normalizeCopyTargetId(target);
    if (!targetId || currentTargetIds.has(targetId)) continue;

    const targetType = String((target as any)?.type || '').trim().toLowerCase();
    if (targetType === 'player') continue;

    const battlefieldPermanent = battlefield.find(
      (permanent: any) => String(permanent?.id || '').trim() === targetId,
    );
    const isCreature = battlefieldPermanent
      ? /\bcreature\b/i.test(String(battlefieldPermanent?.card?.type_line || battlefieldPermanent?.type_line || ''))
      : targetType === 'permanent' || targetType === 'creature';

    if (!isCreature) continue;

    if (requiresControlledCreatures && !controllerCreatures.has(targetId)) continue;

    eligibleIds.add(targetId);
  }

  // Activated abilities may not stamp copyRetargetValidTargets (or stamp only the
  // chosen target). Fall back to other creatures the controller controls / all
  // other battlefield creatures when no other legal retarget remains.
  if (eligibleIds.size === 0) {
    for (const creatureId of controllerCreatures) {
      if (!currentTargetIds.has(creatureId)) eligibleIds.add(creatureId);
    }
    if (!requiresControlledCreatures) {
      for (const permanent of battlefield) {
        const targetId = String(permanent?.id || '').trim();
        if (!targetId || currentTargetIds.has(targetId)) continue;
        if (!/\bcreature\b/i.test(String(permanent?.card?.type_line || permanent?.type_line || ''))) continue;
        eligibleIds.add(targetId);
      }
    }
  }

  return eligibleIds.size;
}

export function resolveCopySpellCount(
  state: GameState,
  controllerId: PlayerID,
  step: Extract<OracleEffectStep, { kind: 'copy_spell' }>,
  ctx?: OracleIRExecutionContext
): number {
  if (!step.copies) return 1;
  if (step.copies.kind === 'number') {
    return Math.max(0, Number(step.copies.value) || 0);
  }
  if (step.copies.kind === 'replicate_count') {
    const sourceId = String(ctx?.sourceId || '').trim();
    const readCount = (item: any): number => {
      const raw = item?.replicateCount ?? item?.card?.replicateCount;
      const count = Math.floor(Number(raw));
      return Number.isFinite(count) && count > 0 ? count : 0;
    };
    const items = getStackItems((state as any)?.stack);
    if (sourceId) {
      for (const item of items) {
        const ids = [item?.id, item?.card?.id, item?.cardId, item?.source];
        if (!ids.some((id) => String(id || '').trim() === sourceId)) continue;
        const count = readCount(item);
        if (count > 0) return count;
      }
    }
    return 0;
  }
  if (step.copies.kind === 'spells_cast_before_this_turn') {
    const stateAny = state as any;
    const spellsCastThisTurn = stateAny?.spellsCastThisTurn;
    if (Array.isArray(spellsCastThisTurn)) {
      const countForController = spellsCastThisTurn.filter(
        (entry: any) => String(entry?.casterId || '').trim() === String(controllerId || '').trim(),
      ).length;
      return Math.max(0, countForController - 1);
    }
    const totalCastThisTurn = Number(spellsCastThisTurn?.[controllerId] || 0);
    return Math.max(0, totalCastThisTurn - 1);
  }
  if (step.copies.kind === 'reference_amount') {
    const raw = String(step.copies.raw || '').trim().toLowerCase();
    if (/commander.*command zone.*this game/.test(raw)) {
      return resolveCommanderCastsFromCommandZoneThisGame(state, controllerId);
    }
    const otherCreaturesCount = resolveOtherCreaturesCopyCouldTargetCount(state, controllerId, step, ctx);
    if (otherCreaturesCount !== undefined) {
      return otherCreaturesCount;
    }
    return 1;
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
  const oracleText = normalizeOracleText(String(card?.oracle_text || card?.card?.oracle_text || '').replace(/\r/g, '')).trim();
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

function findCardInExileOrGraveyard(state: GameState, cardId: string): any | undefined {
  const targetId = String(cardId || '').trim();
  if (!targetId) return undefined;

  const consider = (card: any): any | undefined => {
    if (!card) return undefined;
    if (String(card?.id || card?.cardId || '').trim() === targetId) return card;
    if (String(card?.card?.id || '').trim() === targetId) return card;
    return undefined;
  };

  for (const player of (state.players || []) as any[]) {
    for (const card of Array.isArray(player?.exile) ? player.exile : []) {
      const hit = consider(card);
      if (hit) return hit;
    }
    for (const card of Array.isArray(player?.graveyard) ? player.graveyard : []) {
      const hit = consider(card);
      if (hit) return hit;
    }
  }

  const zones = (state as any)?.zones;
  if (zones && typeof zones === 'object') {
    for (const ownerId of Object.keys(zones)) {
      const playerZones = zones[ownerId] || {};
      for (const card of Array.isArray(playerZones.exile) ? playerZones.exile : []) {
        const hit = consider(card);
        if (hit) return hit;
      }
      for (const card of Array.isArray(playerZones.graveyard) ? playerZones.graveyard : []) {
        const hit = consider(card);
        if (hit) return hit;
      }
    }
  }

  return undefined;
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
    const hydrateMoved = (card: any): any => {
      const cardId = String(card?.id || card?.objectId || card?.cardId || card?.card?.id || '').trim();
      return (cardId && findCardInExileOrGraveyard(state, cardId)) || card;
    };
    if (lastMovedCards.length === 1) {
      return { cards: [hydrateMoved(lastMovedCards[0])] };
    }
    const ctxMoved = Array.isArray(ctx.lastMovedCards) ? ctx.lastMovedCards : [];
    if (ctxMoved.length === 1) {
      return { cards: [hydrateMoved(ctxMoved[0])] };
    }
    const ledgerMoved = resolveAntecedentMovedCards(ctx, { lastMovedCards, lastExiledCards: ctx.lastExiledCards });
    if (ledgerMoved.length === 1) {
      return { cards: [hydrateMoved(ledgerMoved[0])] };
    }
    const chosenIds = Array.from(new Set([
      ...(Array.isArray(ctx.chosenObjectIds) ? ctx.chosenObjectIds : []),
      ...(Array.isArray(ctx.selectorContext?.chosenObjectIds) ? ctx.selectorContext.chosenObjectIds : []),
    ].map((id) => String(id || '').trim()).filter(Boolean)));
    if (chosenIds.length === 1) {
      const chosenCard = findCardInExileOrGraveyard(state, chosenIds[0]);
      if (chosenCard) {
        return { cards: [chosenCard] };
      }
    }
    return { reason: 'invalid_source' };
  }

  if (step.subject === 'linked_exiled_cards') {
    const sourceId = String(ctx.sourceId || '').trim();
    if (!sourceId) return { reason: 'invalid_source' };
    const matches = findCardsExiledWithSource(state, sourceId, { cardType: 'any' });
    if (matches.length === 0) return { reason: 'invalid_source' };

    const replayableCards = matches
      .map((match) => match.card)
      .filter((card) => getCopiedSpellReplaySteps(card).length > 0);
    if (replayableCards.length > 0) {
      return { cards: replayableCards };
    }

    const instantOrSorceryCards = matches
      .map((match) => match.card)
      .filter((card) => {
        const typeLine = String(card?.type_line || card?.card?.type_line || '').trim().toLowerCase();
        return typeLine.includes('instant') || typeLine.includes('sorcery');
      });
    if (instantOrSorceryCards.length > 0) {
      return { cards: instantOrSorceryCards };
    }

    return { cards: matches.map((match) => match.card) };
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

  const zones = (stateAny.zones && typeof stateAny.zones === 'object') ? stateAny.zones : {};
  const controllerZones = (zones[controllerId] = zones[controllerId] || {
    hand: [],
    graveyard: [],
    exile: [],
    handCount: 0,
    graveyardCount: 0,
    exileCount: 0,
  });
  controllerZones.exile = Array.isArray(controllerZones.exile) ? controllerZones.exile : [];
  for (const copiedCard of createdCards) {
    if (!controllerZones.exile.some((card: any) => String(card?.id || '') === String(copiedCard?.id || ''))) {
      controllerZones.exile.push(copiedCard);
    }
  }
  controllerZones.exileCount = controllerZones.exile.length;
  stateAny.zones = zones;

  return {
    state: { ...(stateAny as any), players: updatedPlayers as any, zones: stateAny.zones } as any,
    createdCards,
    log: createdCards.length > 0
      ? [`[oracle-ir] Created ${createdCards.length} castable copied spell${createdCards.length === 1 ? '' : 's'} in exile`]
      : [],
  };
}
