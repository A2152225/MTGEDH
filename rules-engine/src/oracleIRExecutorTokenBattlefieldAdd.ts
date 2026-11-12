/**
 * Extracted from oracleIRExecutorTokenStepHandlers.ts.
 * Cluster: addTokensToBattlefield, tryApplyThoseReferencedTokenCreation,
 * and exclusive battlefield-entry helpers.
 * Amount helpers live in oracleIRExecutorTokenAmountResolution.ts.
 * Public: addTokensToBattlefield, resolveTokenAmount, resolveTokenCreationSpecsForReplacementEffects.
 */

import type { GameState, PlayerID, BattlefieldPermanent } from '../../shared/src';
import { parseCopyTokenOverrides } from '../../shared/src/copyTokenOverrides.js';
import { createTokens, resolveMultipliedTokenCount, resolveTokenCharacteristicsFromOracleStep } from './tokenCreation';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';
import {
  createCopiedTokenPermanent,
  normalizeReferenceText,
  resolveCopyTokenSource,
  splitCopyTokenReference,
} from './oracleIRExecutorTokenCopySource';
import { applyBlockingEntryToCreatedTokens } from './oracleIRExecutorTokenBlockingEntry';
import { applyVariableTokenPowerToughness } from './oracleIRExecutorTokenVariablePt';
import {
  resolveBattlefieldEntryFromOracleIrContext,
  type OracleIrBattlefieldEntryContext,
} from './oracleIRExecutorBattlefieldEntryCommit';
import {
  resolveEnterFaceForCard,
  applyBackFaceCharacteristicsToCard,
} from './enterBattlefieldTransformedOrConverted';
import {
  resolveTokenAmount,
  resolveTokenCreationSpecsForReplacementEffects,
  type TokenStepRuntime,
} from './oracleIRExecutorTokenAmountResolution';

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
  entersTransformed?: boolean,
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
    entersTransformed,
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
    const faced = applyEnterFaceToCreatedToken(
      applyTemporaryGrantedAbilitiesToToken(tokenWithPermanentAbilities, temporaryGrantedAbilities),
      entryMods.entersTransformed || entersTransformed,
      (reference as any)?.card || reference,
    );
    if (faced) copiedTokens.push(faced);
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
    readonly entersTransformed?: boolean;
    readonly copySourceId?: string;
  },
): { readonly entersTapped: boolean; readonly withCounters: Record<string, number>; readonly entersTransformed: boolean; readonly halted: boolean } {
  const entry: OracleIrBattlefieldEntryContext = { ctx, stepKind: 'create_token' };
  const resolved = resolveBattlefieldEntryFromOracleIrContext(state, tokenCard, controllerId, explicit, entry);
  if ('halted' in resolved) {
    return { entersTapped: false, withCounters: {}, entersTransformed: false, halted: true };
  }
  return {
    entersTapped: resolved.entersTapped,
    withCounters: resolved.withCounters,
    entersTransformed: Boolean(resolved.entersTransformed || explicit.entersTransformed),
    halted: false,
  };
}

function applyEnterFaceToCreatedToken(token: any, entersTransformed: boolean | undefined, representingCard?: unknown): any | null {
  if (!token) return token;
  const card = token.card || token;
  const converted = Boolean(card?.entersConverted || card?.entersBattlefieldConverted || token?.entersConverted);
  const wants = Boolean(
    entersTransformed
    || converted
    || card?.entersTransformed
    || card?.entersBattlefieldTransformed
    || token?.entersTransformed
    || token?.transformed === true
  );
  if (!wants) return token;
  const enterFace = resolveEnterFaceForCard(card, {
    sourceZone: 'other',
    extra: representingCard || card,
    intent: converted ? 'converted' : 'transformed',
    representingCard: representingCard || card,
  });
  if (enterFace.outcome === 'stay_in_zone' || enterFace.outcome === 'graveyard') return null;
  if (enterFace.outcome === 'enter_back_face') {
    const nextCard = applyBackFaceCharacteristicsToCard(card);
    token.card = nextCard;
    token.transformed = true;
    if (nextCard && 'power' in nextCard) token.basePower = nextCard.power;
    if (nextCard && 'toughness' in nextCard) token.baseToughness = nextCard.toughness;
  }
  return token;
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
  entersTransformed?: boolean,
  attackTargetPlayerId?: string,
  temporaryGrantedAbilities?: readonly string[],
  permanentGrantedAbilities?: readonly string[],
  blockTargetPermanentId?: string,
): StepApplyResult | StepSkipResult {
  const hasOverrides = Boolean(entersTapped) || Boolean(entersTransformed) || (withCounters && Object.keys(withCounters).length > 0);
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
    entersTransformed,
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
      // Vacuous success: "create a token that's a copy of that card" with no antecedent
      // (e.g. Anikthea "up to one" exile declined) must not fail all-or-nothing or fall
      // through to legacy — and must not invent a copy of the ability source.
      return {
        applied: true,
        state,
        log: [`Skipped token creation (copy source unavailable): ${clauseRaw}`],
        createdTokenIds: [],
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
    const copyCard = (copySource.sourceObject as any)?.card || copySource.sourceObject;
    const count = resolveMultipliedTokenCount(
      controllerId,
      state.battlefield || [],
      Math.max(1, amount | 0),
      { tokenIsCreature: /\bcreature\b/i.test(String(copyCard?.type_line || copyCard?.typeLine || '')) },
    ).count;
    const entryMods = resolveTokenBattlefieldEntry(state, copyCard, controllerId, ctx, {
      entersTapped,
      withCounters,
      entersTransformed,
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
      const faced = applyEnterFaceToCreatedToken(
        applyTemporaryGrantedAbilitiesToToken(tokenWithPermanentAbilities, temporaryGrantedAbilities),
        entryMods.entersTransformed || entersTransformed,
        copyCard,
      );
      if (faced) copiedTokens.push(faced);
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
    { entersTapped, withCounters, entersTransformed },
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
    return applyEnterFaceToCreatedToken(
      applyTemporaryGrantedAbilitiesToToken(tokenWithPermanentAbilities, temporaryGrantedAbilities),
      parsedEntryMods.entersTransformed || entersTransformed,
      tokenCharacteristicsToEntryCard(tokenCharacteristics),
    );
  }).filter(Boolean);
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
