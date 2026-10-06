/**
 * Extracted from oracleIRExecutorTokenStepHandlers.ts.
 * Cluster: addTokensToBattlefield, resolveTokenAmount, tryApplyThoseReferencedTokenCreation,
 * and exclusive amount / battlefield-entry helpers (normalizeTokenTypeText through addTokensToBattlefield).
 * Public: addTokensToBattlefield, resolveTokenAmount, resolveTokenCreationSpecsForReplacementEffects.
 */

import type { GameState, PlayerID, BattlefieldPermanent } from '../../shared/src';
import { parseCopyTokenOverrides } from '../../shared/src/copyTokenOverrides.js';
import { createTokens, resolveTokenCharacteristicsFromOracleStep } from './tokenCreation';
import type { OracleEffectStep } from './oracleIR';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';
import { evaluateModifyPtWhereX } from './oracleIRExecutorModifyPtWhereEvaluator';
import {
  createCopiedTokenPermanent,
  findSourceObjectByIdAcrossState,
  normalizeReferenceText,
  resolveCopyTokenSource,
  splitCopyTokenReference,
} from './oracleIRExecutorTokenCopySource';
import { applyBlockingEntryToCreatedTokens } from './oracleIRExecutorTokenBlockingEntry';
import { getCardManaValue, quantityToNumber } from './oracleIRExecutorPlayerUtils';
import { tryResolveForEachReferenceAmount } from './oracleIRExecutorForEachQuantity';
import { applyVariableTokenPowerToughness } from './oracleIRExecutorTokenVariablePt';
import {
  resolveBattlefieldEntryFromOracleIrContext,
  type OracleIrBattlefieldEntryContext,
} from './oracleIRExecutorBattlefieldEntryCommit';
import { collectThisWayGraveyardObjects } from './oracleIRExecutorReferenceUtils';

type StepApplyResult = {
  readonly applied: true;
  readonly state: GameState;
  readonly log: readonly string[];
  readonly createdTokenIds?: readonly string[];
};

type StepSkipResult = {
  readonly applied: false;
  readonly message: string;
  readonly reason: 'unknown_amount' | 'unsupported_player_selector' | 'player_choice_required' | 'impossible_action';
  readonly options?: {
    readonly classification?: 'ambiguous' | 'player_choice';
    readonly metadata?: Record<string, string | number | boolean | null | readonly string[]>;
  };
};

type TokenStepRuntime = {
  readonly lastMovedBattlefieldPermanentIds?: readonly string[];
  readonly lastMovedCards?: readonly any[];
  readonly lastMilledCards?: readonly any[];
  readonly lastReferenceAmount?: number;
  readonly lastSacrificedPermanents?: readonly any[];
  readonly lastCreatedTokenIds?: readonly string[];
};

type TokenCreationSpec = {
  readonly tokenHint: string;
  readonly amount: number;
};

function normalizeTokenTypeText(value: unknown): string {
  return String(value || '')
    .replace(/\u2019/g, "'")
    .toLowerCase()
    .replace(/\b(?:token|tokens|artifact|creature|enchantment)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenHintMatchesReplacementType(tokenHint: string, tokenType: string): boolean {
  const normalizedHint = normalizeTokenTypeText(tokenHint);
  const normalizedType = normalizeTokenTypeText(tokenType);
  if (!normalizedHint || !normalizedType) return false;
  return normalizedHint === normalizedType || normalizedHint.includes(normalizedType);
}

function quantitySpecToNumber(value: unknown): number {
  if (!value || typeof value !== 'object') return 1;
  const kind = String((value as any).kind || '').trim();
  if (kind === 'number') {
    const n = Number((value as any).value);
    return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 1;
  }
  if (kind === 'one') return 1;
  return 1;
}

function readFiniteAmount(value: unknown): number | null {
  const amount = Number(value);
  return Number.isFinite(amount) ? Math.max(0, Math.floor(amount)) : null;
}

function parseSmallTokenQuantityText(value: string | undefined): number | null {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return null;
  if (/^\d+$/.test(raw)) return Number.parseInt(raw, 10);
  const wordCounts: Record<string, number> = {
    a: 1,
    an: 1,
    one: 1,
    two: 2,
    three: 3,
    four: 4,
    five: 5,
    six: 6,
    seven: 7,
    eight: 8,
    nine: 9,
    ten: 10,
    eleven: 11,
    twelve: 12,
    thirteen: 13,
    fourteen: 14,
    fifteen: 15,
    sixteen: 16,
    seventeen: 17,
    eighteen: 18,
    nineteen: 19,
    twenty: 20,
  };
  return wordCounts[raw] ?? null;
}

function pluralizeCountExpression(value: string): string {
  const raw = String(value || '')
    .replace(/\.$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!raw) return raw;
  if (/\b(?:you|they|player|opponent|control|controls|this way|this turn|attacking|blocked|died|destroyed)\b/i.test(raw)) {
    const words = raw.split(/\s+/g);
    const first = words[0] || '';
    const nounIndex = /^(?:non[- ]?token|non[- ]?land|tapped|untapped|attacking|blocked|other)$/i.test(first) && words[1] ? 1 : 0;
    const noun = words[nounIndex] || '';
    if (noun && !/(?:s|x|ch|sh)$/i.test(noun) && !/^(?:each|one|two|three|four|five|six|seven|eight|nine|ten)$/i.test(noun)) {
      words[nounIndex] = `${noun}s`;
      return words.join(' ');
    }
  }
  return raw;
}

function evaluateTokenAmountExpression(
  state: GameState,
  controllerId: PlayerID,
  expression: string,
  ctx: OracleIRExecutionContext,
  runtime?: TokenStepRuntime,
  step?: OracleEffectStep,
): number | null {
  const rawExpression = String(expression || '')
    .replace(/\.$/g, '')
    .replace(/^the\s+difference$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!rawExpression) return null;

  const counterOnItMatch = rawExpression.match(/^([a-z/+.-]+) counters? on it$/i);
  if (counterOnItMatch) {
    const counterName = String(counterOnItMatch[1] || '').trim();
    const evaluatedCounter = evaluateModifyPtWhereX(
      state,
      controllerId,
      `X is the number of ${counterName} counters on it`,
      String(ctx.sourceId || ctx.targetPermanentId || '').trim() || undefined,
      ctx,
      runtime as any,
      0,
      step,
    );
    if (evaluatedCounter !== null) return Math.max(0, Math.floor(evaluatedCounter));
  }

  const evaluated = evaluateModifyPtWhereX(
    state,
    controllerId,
    /^x\s+is\b/i.test(rawExpression) ? rawExpression : `X is ${rawExpression}`,
    undefined,
    ctx,
    runtime as any,
    0,
    step,
  );
  return evaluated === null ? null : Math.max(0, Math.floor(evaluated));
}

function resolveForEachPerTokenAmount(
  perTokenAmountRaw: string,
  ctx: OracleIRExecutionContext,
  runtime?: TokenStepRuntime,
): number | null {
  if (/^x$/i.test(perTokenAmountRaw)) {
    return readFiniteAmount(ctx.referenceAmount ?? runtime?.lastReferenceAmount);
  }
  if (/^twice\s+x$/i.test(perTokenAmountRaw)) {
    const ref = readFiniteAmount(ctx.referenceAmount ?? runtime?.lastReferenceAmount);
    return ref === null ? null : ref * 2;
  }
  return parseSmallTokenQuantityText(perTokenAmountRaw);
}

function isGraveyardThisWayCountExpression(countedExpression: string): boolean {
  return /\b(?:milled this way|put into (?:a |your |their |the )?graveyard this way)\b/i.test(
    String(countedExpression || ''),
  );
}

function resolveForEachTokenAmount(
  state: GameState,
  controllerId: PlayerID,
  raw: string,
  ctx: OracleIRExecutionContext,
  runtime?: TokenStepRuntime,
  step?: OracleEffectStep,
): number | null {
  const match = String(raw || '').match(
    /^for each\s+(.+?),\s+(?:(?:you|they|that player|target player|target opponent)\s+)?create(?:s)?\s+(twice\s+x|that many|that much|a|an|\d+|x|[a-z]+)\s+/i
  );
  if (!match) return null;

  const countedExpression = String(match[1] || '').trim();
  const perTokenAmountRaw = String(match[2] || '').trim();
  const perTokenAmount = resolveForEachPerTokenAmount(perTokenAmountRaw, ctx, runtime);

  if (isGraveyardThisWayCountExpression(countedExpression)) {
    const objects = collectThisWayGraveyardObjects(ctx, countedExpression, runtime, step);
    return objects.length * (perTokenAmount ?? 1);
  }

  if (/\bthis way\b/i.test(countedExpression)) {
    const fallbackAmount = readFiniteAmount(runtime?.lastReferenceAmount ?? ctx.referenceAmount);
    if (fallbackAmount !== null) return fallbackAmount;
  }

  const count = evaluateTokenAmountExpression(
    state,
    controllerId,
    `the number of ${pluralizeCountExpression(countedExpression)}`,
    ctx,
    runtime,
    step,
  );
  if (count === null) return null;

  return count * (perTokenAmount ?? 1);
}

function resolveEqualToTokenAmount(
  state: GameState,
  controllerId: PlayerID,
  raw: string,
  ctx: OracleIRExecutionContext,
  runtime?: TokenStepRuntime,
  step?: OracleEffectStep,
): number | null {
  const match = String(raw || '').match(/\bcreate(?:s)?\s+a\s+number\s+of\s+.+?\s+tokens?\s+equal\s+to\s+(.+)$/i);
  if (!match) return null;
  return evaluateTokenAmountExpression(state, controllerId, String(match[1] || ''), ctx, runtime, step);
}

function resolveTokenCreationSpecsForReplacementEffects(
  state: GameState,
  playerId: PlayerID,
  tokenHint: string,
  amount: number
): readonly TokenCreationSpec[] {
  const effects = Array.isArray((state as any).tokenCreationReplacementEffects)
    ? (state as any).tokenCreationReplacementEffects
    : [];
  if (effects.length === 0) return [{ tokenHint, amount }];

  let specs: TokenCreationSpec[] = [{ tokenHint, amount }];
  for (const effect of effects) {
    const playerIds = Array.isArray(effect?.playerIds)
      ? effect.playerIds.map((id: unknown) => String(id || '').trim()).filter(Boolean)
      : [];
    if (playerIds.length > 0 && !playerIds.includes(String(playerId))) continue;

    const tokenTypes = Array.isArray(effect?.tokenTypes)
      ? effect.tokenTypes.map((value: unknown) => String(value || '').trim().toLowerCase()).filter(Boolean)
      : [];
    if (tokenTypes.length === 0) continue;

    const nextSpecs: TokenCreationSpec[] = [];
    for (const spec of specs) {
      const matches = tokenTypes.some(tokenType => tokenHintMatchesReplacementType(spec.tokenHint, tokenType));
      if (!matches) {
        nextSpecs.push(spec);
        continue;
      }

      if (effect.mode === 'replace_with_one_of_each') {
        for (const tokenType of tokenTypes) {
          nextSpecs.push({ tokenHint: tokenType, amount: spec.amount });
        }
        continue;
      }

      if (effect.mode === 'add_additional_token') {
        nextSpecs.push({
          tokenHint: spec.tokenHint,
          amount: spec.amount + quantitySpecToNumber(effect.additionalAmount),
        });
        continue;
      }

      nextSpecs.push(spec);
    }
    specs = nextSpecs;
  }

  return specs;
}

function applyTemporaryGrantedAbilitiesToToken(
  token: BattlefieldPermanent | any,
  grantedAbilities: readonly string[] | undefined
): BattlefieldPermanent | any {
  if (!Array.isArray(grantedAbilities) || grantedAbilities.length === 0) return token;

  const normalizedAbilities = grantedAbilities
    .map(value => String(value || '').trim().toLowerCase())
    .filter(Boolean);
  if (normalizedAbilities.length === 0) return token;

  const nextGrantedAbilities = Array.from(
    new Set([...(Array.isArray((token as any)?.grantedAbilities) ? (token as any).grantedAbilities : []), ...normalizedAbilities])
  );
  const nextTemporaryEffects = Array.isArray((token as any)?.temporaryEffects)
    ? [...(token as any).temporaryEffects]
    : [];

  for (const ability of normalizedAbilities) {
    nextTemporaryEffects.push({
      id: `${String((token as any)?.id || 'token')}:temp:${ability.replace(/[^a-z0-9]+/g, '-')}`,
      description: ability,
      expiresAt: 'end_of_turn',
      grantedAbilities: [ability],
    } as any);
  }

  return {
    ...token,
    grantedAbilities: nextGrantedAbilities,
    temporaryEffects: nextTemporaryEffects,
    ...(normalizedAbilities.includes('haste') ? { summoningSickness: false } : {}),
  } as any;
}


function resolveTokenAmount(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'create_token' }>,
  ctx: OracleIRExecutionContext,
  runtime?: TokenStepRuntime
): number | null {
  const numericAmount = quantityToNumber(step.amount, ctx);
  if (numericAmount !== null) return numericAmount;
  if (step.amount.kind === 'reference_amount') {
    const referenced = tryResolveForEachReferenceAmount(
      state,
      (String(ctx.controllerId || '').trim() || ctx.controllerId) as PlayerID,
      String(step.amount.raw || ''),
      ctx,
      { runtime: runtime as any },
    );
    if (referenced !== null) return referenced;
    const fromRuntime = readFiniteAmount(runtime?.lastReferenceAmount);
    if (fromRuntime !== null) return fromRuntime;
    const source = findSourceObjectByIdAcrossState(state, String(ctx.sourceId || '').trim());
    const squadTimesPaid = Number(
      (source as any)?.squadTimesPaid
      ?? (source as any)?.card?.squadTimesPaid
      ?? (ctx as any)?.sourceCard?.squadTimesPaid,
    );
    if (Number.isFinite(squadTimesPaid)) return Math.max(0, Math.floor(squadTimesPaid));
    if (/copy of it/i.test(String(step.token || '')) || /\bsquad\b/i.test(String(step.raw || ''))) {
      return 0;
    }
    return null;
  }
  if (step.amount.kind !== 'x') return null;

  const controllerId = (String(ctx.controllerId || '').trim() || ctx.controllerId) as PlayerID;
  if (!controllerId) return null;

  const raw = String(step.raw || '').trim();
  const twiceXMultiplier = /\bcreate(?:s)?\s+twice\s+x\b/i.test(raw) ? 2 : 1;

  const suffixForEachMatch = raw.match(/\bfor each\s+(.+?)\.?$/i);
  if (suffixForEachMatch) {
    const countedExpression = String(suffixForEachMatch[1] || '').trim();
    const count =
      evaluateTokenAmountExpression(state, controllerId, countedExpression, ctx, runtime, step) ??
      evaluateTokenAmountExpression(
        state,
        controllerId,
        `the number of ${pluralizeCountExpression(countedExpression)}`,
        ctx,
        runtime,
        step,
      );
    if (count !== null) return count;
  }

  const forEachAmount = resolveForEachTokenAmount(state, controllerId, raw, ctx, runtime, step);
  if (forEachAmount !== null) return forEachAmount;

  const equalToAmount = resolveEqualToTokenAmount(state, controllerId, raw, ctx, runtime, step);
  if (equalToAmount !== null) return equalToAmount * twiceXMultiplier;

  const whereMatch = raw.match(/\bwhere\s+x\s+is\s+(.+)$/i);
  if (!whereMatch) {
    // A plain "Create X ..." on a spell or ability whose X was chosen at cast/activation (Martial Coup,
    // Hordeling Outburst-style X makers) reads that announced X. Without this the amount stayed unknown
    // and the whole step was skipped.
    const announcedX = readFiniteAmount(ctx.xValue);
    if (announcedX !== null) return Math.max(0, Math.floor(announcedX)) * twiceXMultiplier;
    const contextX = readFiniteAmount(ctx.referenceAmount ?? runtime?.lastReferenceAmount);
    return contextX === null ? null : contextX * twiceXMultiplier;
  }

  const whereExpr = String(whereMatch[1] || '')
    .trim()
    .replace(/["')\].]+$/g, '')
    .replace(/[.;:,]+$/g, '')
    .trim();
  const whereRaw = `X is ${whereExpr}`;
  const targetCreatureId = String(
    ctx.targetCreatureId ||
      ctx.targetPermanentId ||
      ctx.selectorContext?.targetCreatureId ||
      ctx.selectorContext?.targetPermanentId ||
      ''
  ).trim() || undefined;
  const evaluated = evaluateModifyPtWhereX(
    state,
    controllerId,
    whereRaw,
    targetCreatureId,
    ctx,
    runtime as any,
    0,
    step,
  );
  if (evaluated !== null) return evaluated * twiceXMultiplier;

  const normalizedWhere = String(whereRaw || '').trim().toLowerCase();
  if (/^x is that creature's mana value$/.test(normalizedWhere)) {
    const creature = targetCreatureId
      ? (state.battlefield || []).find((perm) => String((perm as any)?.id || '').trim() === targetCreatureId)
      : undefined;
    const moved = [
      ...(Array.isArray(runtime?.lastMovedCards) ? runtime.lastMovedCards : []),
      ...(Array.isArray((ctx as any).lastMovedCards) ? (ctx as any).lastMovedCards : []),
    ];
    const destroyed = [
      ...(Array.isArray((runtime as any)?.lastDestroyedPermanents) ? (runtime as any).lastDestroyedPermanents : []),
      ...(Array.isArray((ctx as any).lastDestroyedPermanents) ? (ctx as any).lastDestroyedPermanents : []),
    ];
    const snapshot = creature || moved[moved.length - 1] || destroyed[destroyed.length - 1];
    const creatureManaValue = snapshot ? getCardManaValue(snapshot) : null;
    if (creatureManaValue !== null) return creatureManaValue * twiceXMultiplier;
    const boundCmc = Number((ctx as any)?.referenceSpellManaValue ?? ctx.xValue);
    if (Number.isFinite(boundCmc) && boundCmc > 0) return Math.floor(boundCmc) * twiceXMultiplier;
  }

  const sacrificed = Array.isArray(runtime?.lastSacrificedPermanents)
    ? runtime.lastSacrificedPermanents
    : Array.isArray((ctx as any).lastSacrificedPermanents)
      ? (ctx as any).lastSacrificedPermanents
      : [];
  if (sacrificed.length > 0) {
    const snapshot = sacrificed[sacrificed.length - 1] as any;
    const readFiniteStat = (value: unknown): number | null => {
      const n = Number(value);
      return Number.isFinite(n) ? n : null;
    };
    if (
      /^x is that creature's toughness$/.test(normalizedWhere) ||
      /^x is the sacrificed creature's toughness$/.test(normalizedWhere)
    ) {
      const toughness = readFiniteStat(
        snapshot?.toughness ?? snapshot?.effectiveToughness ?? snapshot?.card?.toughness,
      );
      if (toughness !== null) return toughness * twiceXMultiplier;
    }
    if (
      /^x is that creature's power$/.test(normalizedWhere) ||
      /^x is the sacrificed creature's power$/.test(normalizedWhere)
    ) {
      const power = readFiniteStat(snapshot?.power ?? snapshot?.effectivePower ?? snapshot?.card?.power);
      if (power !== null) return power * twiceXMultiplier;
    }
  }

  const moved = Array.isArray(runtime?.lastMovedCards) ? runtime.lastMovedCards : [];
  if (moved.length !== 1) return null;

  const normalized = normalizedWhere;
  const movedCard = moved[0] as any;
  const readFinite = (value: unknown): number | null => {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  };

  if (/^x is (?:its|that card's|that creature's|the exiled card's|the exiled creature's) power$/.test(normalized)) {
    return readFinite(movedCard?.power ?? movedCard?.card?.power);
  }
  if (/^x is (?:its|that card's|that creature's|the exiled card's|the exiled creature's) toughness$/.test(normalized)) {
    return readFinite(movedCard?.toughness ?? movedCard?.card?.toughness);
  }
  if (/^x is (?:its|that card's|that creature's|the exiled card's|the exiled creature's) mana value$/.test(normalized)) {
    const manaValue = getCardManaValue(movedCard);
    return manaValue === null ? null : manaValue;
  }

  return null;
}

function isThoseTokenReferenceHint(tokenHint: string): boolean {
  const normalized = normalizeReferenceText(tokenHint);
  return normalized === 'of those'
    || normalized === 'those'
    || normalized === 'those tokens'
    || normalized === 'of those tokens';
}

function resolveThoseTokenReferencePermanents(
  state: GameState,
  controllerId: PlayerID,
  runtime?: TokenStepRuntime,
): readonly any[] {
  const createdIds = Array.isArray(runtime?.lastCreatedTokenIds)
    ? runtime.lastCreatedTokenIds.map((id) => String(id || '').trim()).filter(Boolean)
    : [];
  if (createdIds.length > 0) {
    const fromCreated = (state.battlefield || []).filter((perm: any) =>
      createdIds.includes(String(perm?.id || '').trim())
      && String(perm?.controller || '').trim() === String(controllerId).trim()
    );
    if (fromCreated.length > 0) return fromCreated;
  }

  return (state.battlefield || []).filter((perm: any) => {
    if (String(perm?.controller || '').trim() !== String(controllerId).trim()) return false;
    const typeLine = String(perm?.card?.type_line || perm?.type_line || '');
    return Boolean(perm?.isToken) || /\btoken\b/i.test(typeLine);
  });
}

function tryApplyThoseReferencedTokenCreation(
  state: GameState,
  controllerId: PlayerID,
  amount: number,
  tokenHint: string,
  clauseRaw: string,
  ctx: OracleIRExecutionContext,
  runtime?: TokenStepRuntime,
  entersTapped?: boolean,
  withCounters?: Record<string, number>,
  attackTargetPlayerId?: string,
  temporaryGrantedAbilities?: readonly string[],
  permanentGrantedAbilities?: readonly string[],
  blockTargetPermanentId?: string,
): StepApplyResult | StepSkipResult | null {
  if (!isThoseTokenReferenceHint(tokenHint)) return null;

  const references = resolveThoseTokenReferencePermanents(state, controllerId, runtime);
  if (references.length === 0) {
    return {
      applied: false,
      message: `Skipped token creation (those-token reference unavailable): ${clauseRaw}`,
      reason: 'impossible_action',
    };
  }

  const isInsteadReplacement = /\binstead\b/i.test(clauseRaw);
  let count = Math.max(0, amount | 0);
  if (isInsteadReplacement) {
    count = Math.max(0, count - references.length);
  }
  if (count <= 0) {
    return {
      applied: true,
      state,
      log: [`Those-token replacement already satisfied: ${clauseRaw}`],
      createdTokenIds: [],
    };
  }

  const reference = references[0];
  const copySourcePermanentId = String((reference as any)?.id || '').trim() || undefined;
  const entryMods = resolveTokenBattlefieldEntry(state, (reference as any)?.card || reference, controllerId, ctx, {
    entersTapped,
    withCounters,
    copySourceId: copySourcePermanentId,
  });
  if (entryMods.halted) {
    return { applied: true, state, log: [], createdTokenIds: [] };
  }

  const copiedTokens: BattlefieldPermanent[] = [];
  for (let idx = 0; idx < count; idx += 1) {
    const token = createCopiedTokenPermanent({
      sourceObject: reference,
      controllerId,
      sourceId: ctx.sourceId,
      sourceName: ctx.sourceName,
      copySourcePermanentId,
      entersTapped: entryMods.entersTapped,
      withCounters: entryMods.withCounters,
      overrides: {},
    }) as any;

    if (attackTargetPlayerId) {
      token.tapped = Boolean(entersTapped);
      token.summoningSickness = false;
      token.attacking = attackTargetPlayerId;
      token.attackingPlayerId = controllerId;
      token.defendingPlayerId = attackTargetPlayerId;
    }

    const tokenWithPermanentAbilities =
      Array.isArray(permanentGrantedAbilities) && permanentGrantedAbilities.length > 0
        ? (() => {
            const base = token;
            const nextGranted = Array.from(
              new Set([
                ...(Array.isArray(base.grantedAbilities) ? base.grantedAbilities : []),
                ...permanentGrantedAbilities,
              ]),
            );
            const card = base.card || {};
            const nextKeywords = Array.from(
              new Set([
                ...(Array.isArray(card.keywords) ? card.keywords.map((k) => String(k || '')) : []),
                ...permanentGrantedAbilities.map((ability) => String(ability || '')),
              ].filter(Boolean)),
            );
            const existingOracle = String(card.oracle_text || '').trim();
            const oracleParts = [
              existingOracle,
              ...permanentGrantedAbilities.map((ability) => String(ability || '').trim()).filter(Boolean),
            ].filter(Boolean);
            const dedupedOracle = [];
            for (const part of oracleParts) {
              if (!dedupedOracle.some((entry) => entry.toLowerCase() === part.toLowerCase())) {
                dedupedOracle.push(part);
              }
            }
            return {
              ...base,
              grantedAbilities: nextGranted,
              summoningSickness: permanentGrantedAbilities.some((ability) => /\bhaste\b/i.test(String(ability || '')))
                ? false
                : base.summoningSickness,
              card: {
                ...card,
                keywords: nextKeywords,
                oracle_text: dedupedOracle.join('\n'),
              },
            };
          })()
        : token;
    copiedTokens.push(applyTemporaryGrantedAbilitiesToToken(tokenWithPermanentAbilities, temporaryGrantedAbilities));
  }

  let nextState: GameState = {
    ...state,
    battlefield: [...(state.battlefield || []), ...copiedTokens],
  };
  if (blockTargetPermanentId) {
    nextState = applyBlockingEntryToCreatedTokens(
      nextState,
      copiedTokens.map((token) => String((token as any)?.id || '').trim()).filter(Boolean),
      blockTargetPermanentId,
    );
  }

  const referenceName = String((reference as any)?.card?.name || (reference as any)?.name || 'token');
  return {
    applied: true,
    state: nextState,
    log: [`Created ${count} token(s) matching ${referenceName}${isInsteadReplacement ? ' (graveyard replacement)' : ''}`],
    createdTokenIds: copiedTokens.map((token) => String((token as any)?.id || '').trim()).filter(Boolean),
  };
}

function tokenCharacteristicsToEntryCard(characteristics: {
  readonly name?: string;
  readonly types?: readonly string[];
  readonly subtypes?: readonly string[];
  readonly abilities?: readonly string[];
  readonly isLegendary?: boolean;
  readonly isArtifact?: boolean;
}): any {
  const keywordNames: Record<string, string> = {
    deathtouch: 'Deathtouch',
    defender: 'Defender',
    flying: 'Flying',
    haste: 'Haste',
    lifelink: 'Lifelink',
    menace: 'Menace',
    reach: 'Reach',
    trample: 'Trample',
    vigilance: 'Vigilance',
  };
  const abilities = (characteristics.abilities || []).map((ability) => {
    const normalized = String(ability || '').trim();
    const key = normalized.replace(/[.!]+$/, '').toLowerCase().replace(/\s+/g, '_');
    return keywordNames[key] || normalized;
  });
  const cardTypes = [...(characteristics.types || [])];
  if (characteristics.isArtifact && !cardTypes.includes('Artifact')) cardTypes.unshift('Artifact');
  const subtypeText = [...(characteristics.subtypes || [])].join(' ');
  const mainTypes = [
    'Token',
    characteristics.isLegendary ? 'Legendary' : '',
    ...cardTypes,
  ].filter(Boolean).join(' ');
  const typeLine = subtypeText ? `${mainTypes} — ${subtypeText}` : mainTypes || 'Creature';
  return {
    name: characteristics.name || 'Token',
    type_line: typeLine,
    oracle_text: abilities.join('\n'),
  };
}

function resolveTokenBattlefieldEntry(
  state: GameState,
  tokenCard: unknown,
  controllerId: PlayerID,
  ctx: OracleIRExecutionContext,
  explicit: {
    readonly entersTapped?: boolean;
    readonly withCounters?: Record<string, number>;
    readonly copySourceId?: string;
  },
): { readonly entersTapped: boolean; readonly withCounters: Record<string, number>; readonly halted: boolean } {
  const entry: OracleIrBattlefieldEntryContext = { ctx, stepKind: 'create_token' };
  const resolved = resolveBattlefieldEntryFromOracleIrContext(state, tokenCard, controllerId, explicit, entry);
  if ('halted' in resolved) {
    return { entersTapped: false, withCounters: {}, halted: true };
  }
  return {
    entersTapped: resolved.entersTapped,
    withCounters: resolved.withCounters,
    halted: false,
  };
}

function isCurseTokenAttachedToDefendingPlayerHint(tokenHint: string): boolean {
  const normalized = String(tokenHint || '').trim().toLowerCase();
  return normalized.includes('curse') && normalized.includes('defending player');
}

function createCurseTokenAttachedToPlayer(
  controllerId: PlayerID,
  enchantedPlayerId: string,
  ctx: OracleIRExecutionContext,
): BattlefieldPermanent {
  const curseId = `curse_token_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  return {
    id: curseId,
    controller: controllerId,
    owner: controllerId,
    isToken: true,
    enchantedPlayerId,
    attachedTo: enchantedPlayerId,
    card: {
      id: curseId,
      name: 'Curse',
      type_line: 'Token Enchantment — Aura Curse',
      oracle_text: 'Enchant player\nAt the beginning of your upkeep, you lose 1 life.',
    },
    type_line: 'Token Enchantment — Aura Curse',
    cardType: 'Token Enchantment — Aura Curse',
    createdBySourceId: ctx.sourceId ? String(ctx.sourceId).trim() || undefined : undefined,
    createdBySourceName: ctx.sourceName ? String(ctx.sourceName).trim() || undefined : undefined,
  } as BattlefieldPermanent;
}

function addTokensToBattlefield(
  state: GameState,
  controllerId: PlayerID,
  amount: number,
  tokenHint: string,
  clauseRaw: string,
  ctx: OracleIRExecutionContext,
  runtime?: TokenStepRuntime,
  entersTapped?: boolean,
  withCounters?: Record<string, number>,
  attackTargetPlayerId?: string,
  temporaryGrantedAbilities?: readonly string[],
  permanentGrantedAbilities?: readonly string[],
  blockTargetPermanentId?: string,
): StepApplyResult | StepSkipResult {
  const hasOverrides = Boolean(entersTapped) || (withCounters && Object.keys(withCounters).length > 0);
  const thoseReferencedResult = tryApplyThoseReferencedTokenCreation(
    state,
    controllerId,
    amount,
    tokenHint,
    clauseRaw,
    ctx,
    runtime,
    entersTapped,
    withCounters,
    attackTargetPlayerId,
    temporaryGrantedAbilities,
    permanentGrantedAbilities,
    blockTargetPermanentId,
  );
  if (thoseReferencedResult) return thoseReferencedResult;

  const copySource = resolveCopyTokenSource(state, tokenHint, ctx, runtime);
  if (copySource) {
    if (copySource.kind === 'player_choice_required') {
      return {
        applied: false,
        message: `Skipped token creation (copy source requires player choice): ${clauseRaw}`,
        reason: 'player_choice_required',
        options: {
          classification: 'player_choice',
          metadata: {
            availableCopySources: copySource.availableIds,
          },
        },
      };
    }
    if (copySource.kind === 'unavailable') {
      return {
        applied: false,
        message: `Skipped token creation (copy source unavailable): ${clauseRaw}`,
        reason: 'impossible_action',
      };
    }

    const copySourcePermanentId = [
      String(ctx.targetPermanentId || '').trim(),
      String(ctx.targetCreatureId || '').trim(),
      String(ctx.selectorContext?.targetPermanentId || '').trim(),
      ...(Array.isArray(ctx.selectorContext?.chosenObjectIds)
        ? ctx.selectorContext.chosenObjectIds.map((id: unknown) => String(id || '').trim())
        : []),
      String((copySource.sourceObject as any)?.id || '').trim(),
    ].find((id) => id.length > 0);

    const copyParts = splitCopyTokenReference(tokenHint);
    const overrides = parseCopyTokenOverrides(copyParts?.exceptionText || '');
    const count = Math.max(1, amount | 0);
    const copyCard = (copySource.sourceObject as any)?.card || copySource.sourceObject;
    const entryMods = resolveTokenBattlefieldEntry(state, copyCard, controllerId, ctx, {
      entersTapped,
      withCounters,
      copySourceId: copySourcePermanentId,
    });
    if (entryMods.halted) {
      return { applied: true, state, log: [] };
    }
    const resolvedEntersTapped = entryMods.entersTapped;
    const resolvedWithCounters = entryMods.withCounters;
    const copiedTokens: BattlefieldPermanent[] = [];
    for (let idx = 0; idx < count; idx += 1) {
      const token = createCopiedTokenPermanent({
          sourceObject: copySource.sourceObject,
          controllerId,
          sourceId: ctx.sourceId,
          sourceName: ctx.sourceName,
          copySourcePermanentId,
          entersTapped: resolvedEntersTapped,
          withCounters: resolvedWithCounters,
          overrides,
        }) as any;

      if (attackTargetPlayerId) {
        token.tapped = Boolean(entersTapped);
        token.summoningSickness = false;
        token.attacking = attackTargetPlayerId;
        token.attackingPlayerId = controllerId;
        token.defendingPlayerId = attackTargetPlayerId;
      }

      const tokenWithPermanentAbilities =
        Array.isArray(permanentGrantedAbilities) && permanentGrantedAbilities.length > 0
          ? (() => {
              const nextGranted = Array.from(
                new Set([
                  ...(Array.isArray(token.grantedAbilities) ? token.grantedAbilities : []),
                  ...permanentGrantedAbilities,
                ]),
              );
              const card = token.card || {};
              const nextKeywords = Array.from(
                new Set([
                  ...(Array.isArray(card.keywords) ? card.keywords.map((k) => String(k || '')) : []),
                  ...permanentGrantedAbilities.map((ability) => String(ability || '')),
                ].filter(Boolean)),
              );
              const existingOracle = String(card.oracle_text || '').trim();
              const oracleParts = [
                existingOracle,
                ...permanentGrantedAbilities.map((ability) => String(ability || '').trim()).filter(Boolean),
              ].filter(Boolean);
              const dedupedOracle = [];
              for (const part of oracleParts) {
                if (!dedupedOracle.some((entry) => entry.toLowerCase() === part.toLowerCase())) {
                  dedupedOracle.push(part);
                }
              }
              return {
                ...token,
                grantedAbilities: nextGranted,
                summoningSickness: permanentGrantedAbilities.some((ability) => /\bhaste\b/i.test(String(ability || '')))
                  ? false
                  : token.summoningSickness,
                card: {
                  ...card,
                  keywords: nextKeywords,
                  oracle_text: dedupedOracle.join('\n'),
                },
              };
            })()
          : token;
      copiedTokens.push(applyTemporaryGrantedAbilitiesToToken(tokenWithPermanentAbilities, temporaryGrantedAbilities));
    }
    const nextState: any = {
      ...state,
      battlefield: [...(state.battlefield || []), ...copiedTokens],
    };
    const morophonChosenType = { ...(((state as any).morophonChosenType || {}) as Record<string, string>) };
    let morophonMapChanged = false;
    for (const token of copiedTokens) {
      const creatureType = String((token as any)?.chosenCreatureType || '').trim();
      const tokenId = String((token as any)?.id || '').trim();
      if (
        !creatureType
        || !tokenId
        || !String((token as any)?.card?.name || (token as any)?.name || '').toLowerCase().includes('morophon')
      ) {
        continue;
      }
      morophonChosenType[tokenId] = creatureType;
      morophonMapChanged = true;
    }
    if (morophonMapChanged) {
      nextState.morophonChosenType = morophonChosenType;
    }
    return {
      applied: true,
      state: nextState,
      log: [`Created ${count} token copy/copies of ${String((copySource.sourceObject as any)?.name || (copySource.sourceObject as any)?.card?.name || 'object')}`],
      createdTokenIds: copiedTokens.map(token => String((token as any)?.id || '').trim()).filter(Boolean),
    };
  }

  if (isCurseTokenAttachedToDefendingPlayerHint(tokenHint)) {
    const enchantedPlayerId = String(
      attackTargetPlayerId ||
        ctx.selectorContext?.targetOpponentId ||
        ctx.selectorContext?.targetPlayerId ||
        (ctx as any).targetOpponentId ||
        (ctx as any).targetPlayerId ||
        ''
    ).trim();
    if (!enchantedPlayerId) {
      return { applied: true, state, log: ['Skipped curse token (no defending player)'], createdTokenIds: [] };
    }
    const count = Math.max(1, amount | 0);
    const tokensToAdd: BattlefieldPermanent[] = [];
    for (let idx = 0; idx < count; idx += 1) {
      tokensToAdd.push(createCurseTokenAttachedToPlayer(controllerId, enchantedPlayerId, ctx));
    }
    return {
      applied: true,
      state: { ...state, battlefield: [...(state.battlefield || []), ...tokensToAdd] },
      log: [`Created curse token attached to ${enchantedPlayerId}`],
      createdTokenIds: tokensToAdd.map((token) => String(token.id || '').trim()).filter(Boolean),
    };
  }

  const parsedCharacteristics = resolveTokenCharacteristicsFromOracleStep(tokenHint, clauseRaw);
  // X/X tokens: resolve X like an X token amount ("where X is ..." or the announced X).
  const tokenCharacteristics = parsedCharacteristics && applyVariableTokenPowerToughness(parsedCharacteristics, tokenHint, clauseRaw, () =>
    resolveTokenAmount(state, { kind: 'create_token', who: { kind: 'you' }, amount: { kind: 'x' }, token: tokenHint, raw: clauseRaw } as any, ctx, runtime));
  if (parsedCharacteristics && !tokenCharacteristics) {
    return { applied: false, message: `Skipped token creation (unknown X power/toughness): ${clauseRaw}`, reason: 'unknown_amount', options: { classification: 'ambiguous' } };
  }
  if (!tokenCharacteristics) {
    // Do not report applied:true with zero tokens — that skips legacy create fallbacks
    // (named artifact tokens like Vibranium/Powerstone when hint matching fails).
    return { applied: false, message: 'Token creation not recognized', reason: 'impossible_action' };
  }

  const count = Math.max(1, amount | 0);

  const parsedEntryMods = resolveTokenBattlefieldEntry(
    state,
    tokenCharacteristicsToEntryCard(tokenCharacteristics),
    controllerId,
    ctx,
    { entersTapped, withCounters },
  );
  if (parsedEntryMods.halted) {
    return { applied: true, state, log: [] };
  }

  const created = createTokens(
    {
      characteristics: {
        ...tokenCharacteristics,
        entersTapped: parsedEntryMods.entersTapped ?? entersTapped ?? tokenCharacteristics.entersTapped,
      },
      count,
      controllerId,
      sourceId: ctx.sourceId,
      sourceName: ctx.sourceName,
      withCounters: parsedEntryMods.withCounters,
    },
    state.battlefield || []
  );

  const tokensToAdd = created.tokens.map(token => {
    const createdToken = token.token as any;
    if (attackTargetPlayerId) {
      createdToken.tapped = Boolean(entersTapped);
      createdToken.summoningSickness = false;
      createdToken.attacking = attackTargetPlayerId;
      createdToken.attackingPlayerId = controllerId;
      createdToken.defendingPlayerId = attackTargetPlayerId;
    }
    const tokenWithPermanentAbilities =
      Array.isArray(permanentGrantedAbilities) && permanentGrantedAbilities.length > 0
        ? (() => {
            const nextGranted = Array.from(
              new Set([
                ...(Array.isArray(createdToken.grantedAbilities) ? createdToken.grantedAbilities : []),
                ...permanentGrantedAbilities,
              ]),
            );
            const card = createdToken.card || {};
            const nextKeywords = Array.from(
              new Set([
                ...(Array.isArray(card.keywords) ? card.keywords.map((k: any) => String(k || '')) : []),
                ...permanentGrantedAbilities.map((ability) => String(ability || '')),
              ].filter(Boolean)),
            );
            const existingOracle = String(card.oracle_text || '').trim();
            const oracleParts = [
              existingOracle,
              ...permanentGrantedAbilities.map((ability) => String(ability || '').trim()).filter(Boolean),
            ].filter(Boolean);
            const dedupedOracle: string[] = [];
            for (const part of oracleParts) {
              if (!dedupedOracle.some((entry) => entry.toLowerCase() === part.toLowerCase())) {
                dedupedOracle.push(part);
              }
            }
            return {
              ...createdToken,
              grantedAbilities: nextGranted,
              summoningSickness: permanentGrantedAbilities.some((ability) => /\bhaste\b/i.test(String(ability || '')))
                ? false
                : createdToken.summoningSickness,
              card: {
                ...card,
                keywords: nextKeywords,
                oracle_text: dedupedOracle.join('\n'),
              },
            };
          })()
        : createdToken;
    return applyTemporaryGrantedAbilitiesToToken(tokenWithPermanentAbilities, temporaryGrantedAbilities);
  });
  return {
    applied: true,
    state: { ...state, battlefield: [...(state.battlefield || []), ...(tokensToAdd as BattlefieldPermanent[])] },
    log: [...created.log],
    createdTokenIds: tokensToAdd.map(token => String((token as any)?.id || '').trim()).filter(Boolean),
  };
}


export {
  addTokensToBattlefield,
  resolveTokenAmount,
  resolveTokenCreationSpecsForReplacementEffects,
};
