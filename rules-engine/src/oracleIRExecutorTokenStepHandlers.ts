import type { GameState, PlayerID, BattlefieldPermanent } from '../../shared/src';
import { COMMON_TOKENS, createTokens, createTokensByName, parseTokenCreationFromText } from './tokenCreation';
import {
  DelayedTriggerTiming,
  createDelayedTrigger,
  createDelayedTriggerRegistry,
  registerDelayedTrigger,
} from './delayedTriggeredAbilities';
import type { OracleEffectStep } from './oracleIR';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';
import { evaluateModifyPtWhereX } from './oracleIRExecutorModifyPtWhereEvaluator';
import {
  attachExistingBattlefieldPermanentToTarget,
  findCardsExiledWithSource,
  parseMoveZoneSingleTargetFromLinkedExile,
} from './oracleIRExecutorZoneOps';
import { getCardManaValue, quantityToNumber, resolvePlayers } from './oracleIRExecutorPlayerUtils';

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

export type TokenStepHandlerResult = StepApplyResult | StepSkipResult;

type TokenStepRuntime = {
  readonly lastMovedBattlefieldPermanentIds?: readonly string[];
  readonly lastMovedCards?: readonly any[];
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
  } as any;
}

function getOwnerIdFromCard(card: any): string {
  return String(
    card?.ownerId ??
      card?.owner ??
      card?.card?.ownerId ??
      card?.card?.owner ??
      ''
  ).trim();
}

function resolveTokenControllersFromMovedCards(runtime?: TokenStepRuntime): readonly PlayerID[] {
  const movedCards = Array.isArray(runtime?.lastMovedCards) ? runtime.lastMovedCards : [];
  const seen = new Set<string>();
  const out: PlayerID[] = [];
  for (const card of movedCards) {
    const ownerId = getOwnerIdFromCard(card);
    if (!ownerId || seen.has(ownerId)) continue;
    seen.add(ownerId);
    out.push(ownerId as PlayerID);
  }
  return out;
}

function resolveTokenAmount(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'create_token' }>,
  ctx: OracleIRExecutionContext,
  runtime?: TokenStepRuntime
): number | null {
  const numericAmount = quantityToNumber(step.amount, ctx);
  if (numericAmount !== null) return numericAmount;
  if (step.amount.kind !== 'x') return null;

  const whereMatch = String(step.raw || '').match(/\bwhere\s+x\s+is\s+(.+)$/i);
  if (!whereMatch) return null;

  const controllerId = (String(ctx.controllerId || '').trim() || ctx.controllerId) as PlayerID;
  if (!controllerId) return null;

  const whereRaw = `X is ${String(whereMatch[1] || '').trim()}`;
  const evaluated = evaluateModifyPtWhereX(
    state,
    controllerId,
    whereRaw,
    undefined,
    ctx,
    {
      lastMovedCards: Array.isArray(runtime?.lastMovedCards) ? runtime.lastMovedCards : [],
    } as any
  );
  if (evaluated !== null) return evaluated;

  const moved = Array.isArray(runtime?.lastMovedCards) ? runtime.lastMovedCards : [];
  if (moved.length !== 1) return null;

  const normalized = String(whereRaw || '').trim().toLowerCase();
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

function normalizeReferenceText(value: string | undefined): string {
  return String(value || '')
    .replace(/\u2019/g, "'")
    .toLowerCase()
    .replace(/[.\s]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function getChosenObjectIds(ctx: OracleIRExecutionContext): readonly string[] {
  const chosen = Array.isArray(ctx.selectorContext?.chosenObjectIds) ? ctx.selectorContext.chosenObjectIds : [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const candidate of chosen) {
    const normalized = String(candidate || '').trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

function splitCopyTokenReference(tokenHint: string): {
  readonly referenceText: string;
  readonly exceptionText: string;
} | null {
  const raw = String(tokenHint || '').trim();
  if (!/^copy of\b/i.test(raw)) return null;

  const body = raw.replace(/^copy of\s+/i, '').trim();
  if (!body) return null;

  const exceptMatch = body.match(/^(.*?),\s*except\s+(.+)$/i);
  if (!exceptMatch) {
    return {
      referenceText: body.replace(/[.\s]+$/g, '').trim(),
      exceptionText: '',
    };
  }

  return {
    referenceText: String(exceptMatch[1] || '').replace(/[.\s]+$/g, '').trim(),
    exceptionText: String(exceptMatch[2] || '').replace(/[.\s]+$/g, '').trim(),
  };
}

type CopyTokenOverrides = {
  readonly power?: number;
  readonly toughness?: number;
  readonly colors?: readonly string[];
  readonly addCardTypes?: readonly string[];
  readonly addSubtypes?: readonly string[];
  readonly addAbilities?: readonly string[];
  readonly removeManaCost?: boolean;
  readonly removeLegendary?: boolean;
};

const COLOR_WORD_TO_SYMBOL: Record<string, string> = {
  white: 'W',
  blue: 'U',
  black: 'B',
  red: 'R',
  green: 'G',
};

function dedupeStrings(values: readonly string[]): readonly string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const normalized = String(value || '').trim();
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(normalized);
  }
  return out;
}

function parseCopyTokenOverrides(exceptionText: string): CopyTokenOverrides {
  const normalized = normalizeReferenceText(exceptionText);
  if (!normalized) return {};

  const ptCreatureMatch = normalized.match(
    /^(?:it's|it is|the token is)\s+a\s+(\d+)\/(\d+)\s+(.+?)\s+creature(?:\s+with\s+(.+?))?(?:\s+in addition to its other types)?$/
  );
  if (ptCreatureMatch) {
    const descriptorWords = String(ptCreatureMatch[3] || '')
      .split(/\s+/g)
      .map(word => word.trim())
      .filter(Boolean);
    const colors: string[] = [];
    const subtypeWords: string[] = [];
    for (const word of descriptorWords) {
      const color = COLOR_WORD_TO_SYMBOL[word];
      if (color) colors.push(color);
      else if (word !== 'and') subtypeWords.push(word);
    }

    const abilities = String(ptCreatureMatch[4] || '')
      .split(/\s*,\s*|\s+and\s+/gi)
      .map(part => part.trim())
      .filter(Boolean)
      .map(part => part.charAt(0).toUpperCase() + part.slice(1));

    return {
      power: Number.parseInt(String(ptCreatureMatch[1] || ''), 10),
      toughness: Number.parseInt(String(ptCreatureMatch[2] || ''), 10),
      ...(colors.length > 0 ? { colors: dedupeStrings(colors) } : {}),
      addCardTypes: ['Creature'],
      ...(subtypeWords.length > 0
        ? {
            addSubtypes: dedupeStrings(
              subtypeWords.map(word => word.charAt(0).toUpperCase() + word.slice(1))
            ),
          }
        : {}),
      ...(abilities.length > 0 ? { addAbilities: dedupeStrings(abilities) } : {}),
    };
  }

  if (/isn't legendary/i.test(exceptionText)) {
    return { removeLegendary: true };
  }

  const colors = Array.from(
    new Set(
      Array.from(normalized.matchAll(/\bit'?s?\s+(white|blue|black|red|green)\b/g))
        .map(match => COLOR_WORD_TO_SYMBOL[String(match[1] || '').trim().toLowerCase()])
        .filter(Boolean)
    )
  );
  const ptMatch = normalized.match(/\bit'?s?\s+(\d+)\/(\d+)\b/);
  const subtypeMatch = normalized.match(/\bit'?s?\s+a\s+([a-z][a-z ]*)\s+in addition to its other types\b/);
  const addSubtypes = subtypeMatch
    ? dedupeStrings(
        String(subtypeMatch[1] || '')
          .split(/\s+and\s+|\s+/g)
          .map(word => word.trim())
          .filter(Boolean)
          .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      )
    : undefined;
  const removeManaCost = /\bhas no mana cost\b/i.test(normalized);

  if (colors.length > 0 || ptMatch || (addSubtypes && addSubtypes.length > 0) || removeManaCost) {
    return {
      ...(colors.length > 0 ? { colors } : {}),
      ...(ptMatch
        ? {
            power: Number.parseInt(String(ptMatch[1] || ''), 10),
            toughness: Number.parseInt(String(ptMatch[2] || ''), 10),
          }
        : {}),
      ...(addSubtypes && addSubtypes.length > 0 ? { addSubtypes } : {}),
      ...(removeManaCost ? { removeManaCost: true } : {}),
    };
  }

  return {};
}

function splitTypeLine(typeLine: string): {
  readonly supertypes: readonly string[];
  readonly cardTypes: readonly string[];
  readonly subtypes: readonly string[];
} {
  const normalized = String(typeLine || '').replace(/\s+/g, ' ').trim();
  if (!normalized) return { supertypes: [], cardTypes: [], subtypes: [] };

  const dashSplit = normalized.split(/\s+(?:\u2014|-)\s+/);
  const main = String(dashSplit[0] || '').trim();
  const subtypePart = String(dashSplit[1] || '').trim();
  const mainWords = main.split(/\s+/g).filter(Boolean);
  const supertypeSet = new Set(['Basic', 'Legendary', 'Ongoing', 'Snow', 'World']);
  const cardTypeSet = new Set([
    'Artifact',
    'Battle',
    'Creature',
    'Enchantment',
    'Instant',
    'Kindred',
    'Land',
    'Planeswalker',
    'Sorcery',
    'Tribal',
  ]);

  const supertypes: string[] = [];
  const cardTypes: string[] = [];
  for (const word of mainWords) {
    if (supertypeSet.has(word)) supertypes.push(word);
    else if (cardTypeSet.has(word)) cardTypes.push(word);
  }

  const subtypes = subtypePart ? subtypePart.split(/\s+/g).filter(Boolean) : [];
  return { supertypes, cardTypes, subtypes };
}

function buildTypeLine(parts: {
  readonly supertypes: readonly string[];
  readonly cardTypes: readonly string[];
  readonly subtypes: readonly string[];
}): string {
  const main = [...parts.supertypes, ...parts.cardTypes].filter(Boolean).join(' ').trim();
  const subtypeText = [...parts.subtypes].filter(Boolean).join(' ').trim();
  if (main && subtypeText) return `${main} \u2014 ${subtypeText}`;
  return main || subtypeText || 'Token';
}

function readNumericCharacteristic(...values: unknown[]): number | undefined {
  for (const value of values) {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

function createCopiedTokenPermanent(params: {
  readonly sourceObject: any;
  readonly controllerId: PlayerID;
  readonly sourceId?: string;
  readonly sourceName?: string;
  readonly entersTapped?: boolean;
  readonly withCounters?: Record<string, number>;
  readonly overrides: CopyTokenOverrides;
}): BattlefieldPermanent {
  const tokenId = `token-copy-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const sourceObject = params.sourceObject || {};
  const baseCard = { ...(sourceObject?.card || sourceObject || {}) } as any;
  const originalTypeLine = String(
    baseCard?.type_line || sourceObject?.type_line || sourceObject?.cardType || 'Token'
  ).trim();
  const split = splitTypeLine(originalTypeLine);
  const supertypes = params.overrides.removeLegendary
    ? split.supertypes.filter(type => type.toLowerCase() !== 'legendary')
    : split.supertypes;
  const cardTypes = dedupeStrings([...(split.cardTypes || []), ...(params.overrides.addCardTypes || [])]);
  const subtypes = dedupeStrings([...(split.subtypes || []), ...(params.overrides.addSubtypes || [])]);
  const typeLine = buildTypeLine({ supertypes, cardTypes, subtypes });

  const keywordSource = [
    ...(Array.isArray(baseCard?.keywords) ? baseCard.keywords : []),
    ...(Array.isArray(sourceObject?.keywords) ? sourceObject.keywords : []),
  ].map((keyword: unknown) => String(keyword || '').trim()).filter(Boolean);
  const keywords = dedupeStrings([...(keywordSource as string[]), ...((params.overrides.addAbilities || []) as string[])]);

  const oracleLines = [
    String(baseCard?.oracle_text || sourceObject?.oracle_text || '').trim(),
    ...((params.overrides.addAbilities || []) as readonly string[]),
  ].filter(Boolean);

  const originalColors = Array.isArray(baseCard?.colors)
    ? baseCard.colors
    : Array.isArray(sourceObject?.colors)
      ? sourceObject.colors
      : [];
  const colors = params.overrides.colors && params.overrides.colors.length > 0
    ? [...params.overrides.colors]
    : [...originalColors];

  const power = params.overrides.power ?? readNumericCharacteristic(
    sourceObject?.basePower,
    sourceObject?.power,
    baseCard?.power
  );
  const toughness = params.overrides.toughness ?? readNumericCharacteristic(
    sourceObject?.baseToughness,
    sourceObject?.toughness,
    baseCard?.toughness
  );

  const tokenCard = {
    ...baseCard,
    id: tokenId,
    type_line: typeLine,
    oracle_text: oracleLines.join('\n'),
    ...(keywords.length > 0 ? { keywords: [...keywords] } : {}),
    ...(colors.length > 0 ? { colors: [...colors] } : {}),
    ...(power !== undefined ? { power: String(power) } : {}),
    ...(toughness !== undefined ? { toughness: String(toughness) } : {}),
    ...(params.overrides.removeManaCost ? { mana_cost: '', manaCost: '' } : {}),
    isToken: true,
    zone: 'battlefield',
  } as any;

  return {
    id: tokenId,
    controller: params.controllerId,
    owner: params.controllerId,
    ownerId: params.controllerId,
    tapped: Boolean(params.entersTapped),
    summoningSickness: cardTypes.some(type => String(type).toLowerCase() === 'creature'),
    counters: params.withCounters || {},
    attachedTo: undefined,
    attachments: [],
    modifiers: [],
    cardType: typeLine,
    type_line: typeLine,
    name: String(tokenCard?.name || sourceObject?.name || 'Token'),
    manaCost: tokenCard?.mana_cost ?? tokenCard?.manaCost,
    ...(power !== undefined ? { power } : {}),
    ...(toughness !== undefined ? { toughness } : {}),
    ...(power !== undefined ? { basePower: power } : {}),
    ...(toughness !== undefined ? { baseToughness: toughness } : {}),
    oracle_text: tokenCard.oracle_text,
    card: tokenCard,
    isToken: true,
    ...(params.sourceId ? { createdBySourceId: String(params.sourceId).trim() } : {}),
    ...(params.sourceName ? { createdBySourceName: String(params.sourceName).trim() } : {}),
  } as BattlefieldPermanent;
}

type CopySourceResolution =
  | { readonly kind: 'resolved'; readonly sourceObject: any }
  | { readonly kind: 'player_choice_required'; readonly availableIds: readonly string[] }
  | { readonly kind: 'unavailable' };

function findSourceObjectByIdAcrossState(state: GameState, sourceId: string): any | null {
  const normalizedSourceId = String(sourceId || '').trim();
  if (!normalizedSourceId) return null;

  for (const permanent of Array.isArray(state.battlefield) ? state.battlefield : []) {
    if (String((permanent as any)?.id || '').trim() === normalizedSourceId) return permanent;
    if (String((permanent as any)?.card?.id || '').trim() === normalizedSourceId) {
      return (permanent as any)?.card || permanent;
    }
  }

  for (const player of state.players as any[]) {
    for (const zoneName of ['exile', 'graveyard', 'hand', 'library']) {
      const zone = Array.isArray(player?.[zoneName]) ? player[zoneName] : [];
      const found = zone.find((card: any) => String(card?.id || card?.cardId || '').trim() === normalizedSourceId);
      if (found) return found;
    }
  }

  return null;
}

function resolveCopyTokenSource(
  state: GameState,
  tokenHint: string,
  ctx: OracleIRExecutionContext,
  runtime?: TokenStepRuntime
): CopySourceResolution | null {
  const parsed = splitCopyTokenReference(tokenHint);
  if (!parsed) return null;

  const referenceText = normalizeReferenceText(parsed.referenceText);
  const chosenObjectIds = getChosenObjectIds(ctx);
  const movedCards = Array.isArray(runtime?.lastMovedCards) ? runtime.lastMovedCards : [];

  if (
    referenceText === 'it' ||
    referenceText === 'that card' ||
    referenceText === 'the exiled card'
  ) {
    if (chosenObjectIds.length > 0) {
      const explicit = movedCards.filter(card => chosenObjectIds.includes(String((card as any)?.id || '').trim()));
      if (explicit.length === 1) return { kind: 'resolved', sourceObject: explicit[0] };
      if (explicit.length > 1) {
        return {
          kind: 'player_choice_required',
          availableIds: explicit.map(card => String((card as any)?.id || '').trim()).filter(Boolean),
        };
      }
    }
    if (movedCards.length === 1) return { kind: 'resolved', sourceObject: movedCards[0] };
    if (movedCards.length > 1) {
      return {
        kind: 'player_choice_required',
        availableIds: movedCards.map(card => String((card as any)?.id || '').trim()).filter(Boolean),
      };
    }

    const sourceFallback = findSourceObjectByIdAcrossState(state, String(ctx.sourceId || '').trim());
    return sourceFallback ? { kind: 'resolved', sourceObject: sourceFallback } : { kind: 'unavailable' };
  }

  if (
    referenceText === 'that creature' ||
    referenceText === 'that permanent'
  ) {
    const battlefieldIds = Array.isArray(runtime?.lastMovedBattlefieldPermanentIds)
      ? runtime.lastMovedBattlefieldPermanentIds.map(id => String(id || '').trim()).filter(Boolean)
      : [];
    const candidateIds = chosenObjectIds.length > 0
      ? battlefieldIds.filter(id => chosenObjectIds.includes(id))
      : battlefieldIds;
    if (candidateIds.length !== 1) {
      return candidateIds.length > 1
        ? { kind: 'player_choice_required', availableIds: candidateIds }
        : { kind: 'unavailable' };
    }
    const permanent = (state.battlefield || []).find(perm => String((perm as any)?.id || '').trim() === candidateIds[0]);
    return permanent ? { kind: 'resolved', sourceObject: permanent } : { kind: 'unavailable' };
  }

  if (referenceText === 'equipped creature') {
    const sourceId = String(ctx.sourceId || '').trim();
    const sourcePermanent = (state.battlefield || []).find(perm => String((perm as any)?.id || '').trim() === sourceId) as any;
    const attachedTo = String(sourcePermanent?.attachedTo || '').trim();
    if (!attachedTo) return { kind: 'unavailable' };
    const equippedCreature = (state.battlefield || []).find(perm => String((perm as any)?.id || '').trim() === attachedTo);
    return equippedCreature ? { kind: 'resolved', sourceObject: equippedCreature } : { kind: 'unavailable' };
  }

  if (/\bexiled with this\b/i.test(parsed.referenceText)) {
    const criteria = parseMoveZoneSingleTargetFromLinkedExile({ kind: 'raw', text: parsed.referenceText });
    const sourceId = String(ctx.sourceId || '').trim();
    if (!criteria || !sourceId) return { kind: 'unavailable' };
    const matches = findCardsExiledWithSource(state, sourceId, criteria);
    if (matches.length === 0) return { kind: 'unavailable' };
    const selectedMatches = chosenObjectIds.length > 0
      ? matches.filter(match => chosenObjectIds.includes(match.cardId))
      : matches;
    if (selectedMatches.length !== 1) {
      return {
        kind: 'player_choice_required',
        availableIds: matches.map(match => match.cardId),
      };
    }
    return { kind: 'resolved', sourceObject: selectedMatches[0].card };
  }

  return { kind: 'unavailable' };
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
  permanentGrantedAbilities?: readonly string[]
): StepApplyResult | StepSkipResult {
  const hasOverrides = Boolean(entersTapped) || (withCounters && Object.keys(withCounters).length > 0);
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

    const copyParts = splitCopyTokenReference(tokenHint);
    const overrides = parseCopyTokenOverrides(copyParts?.exceptionText || '');
    const count = Math.max(1, amount | 0);
    const copiedTokens: BattlefieldPermanent[] = [];
    for (let idx = 0; idx < count; idx += 1) {
      const token = createCopiedTokenPermanent({
          sourceObject: copySource.sourceObject,
          controllerId,
          sourceId: ctx.sourceId,
          sourceName: ctx.sourceName,
          entersTapped,
          withCounters,
          overrides,
        }) as any;

      if (attackTargetPlayerId) {
        token.tapped = true;
        token.summoningSickness = false;
        token.attacking = attackTargetPlayerId;
        token.attackingPlayerId = controllerId;
        token.defendingPlayerId = attackTargetPlayerId;
      }

      const tokenWithPermanentAbilities =
        Array.isArray(permanentGrantedAbilities) && permanentGrantedAbilities.length > 0
          ? {
              ...token,
              grantedAbilities: Array.from(
                new Set([...(Array.isArray(token.grantedAbilities) ? token.grantedAbilities : []), ...permanentGrantedAbilities])
              ),
            }
          : token;
      copiedTokens.push(applyTemporaryGrantedAbilitiesToToken(tokenWithPermanentAbilities, temporaryGrantedAbilities));
    }
    return {
      applied: true,
      state: {
        ...state,
        battlefield: [...(state.battlefield || []), ...copiedTokens],
      },
      log: [`Created ${count} token copy/copies of ${String((copySource.sourceObject as any)?.name || (copySource.sourceObject as any)?.card?.name || 'object')}`],
      createdTokenIds: copiedTokens.map(token => String((token as any)?.id || '').trim()).filter(Boolean),
    };
  }

  const normalizeTokenLookupText = (value: string): string =>
    String(value || '')
      .toLowerCase()
      .replace(/\b(?:white|blue|black|red|green|colorless)\b/g, ' ')
      .replace(/\btoken(s)?\b/g, ' ')
      .replace(/\b(?:creature|artifact|enchantment)\b/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

  const resolveCommonTokenKey = (name: string): string | null => {
    const raw = String(name || '').trim();
    if (!raw) return null;
    if ((COMMON_TOKENS as any)[raw]) return raw;
    const normalized = normalizeTokenLookupText(raw);
    const key = Object.keys(COMMON_TOKENS).find(k => normalizeTokenLookupText(k) === normalized);
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
        const tokensToAdd = result.tokens.map(token => {
          const createdToken = token.token as any;
          if (attackTargetPlayerId) {
            createdToken.tapped = true;
            createdToken.summoningSickness = false;
            createdToken.attacking = attackTargetPlayerId;
            createdToken.attackingPlayerId = controllerId;
            createdToken.defendingPlayerId = attackTargetPlayerId;
          }
          const tokenWithPermanentAbilities =
            Array.isArray(permanentGrantedAbilities) && permanentGrantedAbilities.length > 0
              ? {
                  ...createdToken,
                  grantedAbilities: Array.from(
                    new Set([...(Array.isArray(createdToken.grantedAbilities) ? createdToken.grantedAbilities : []), ...permanentGrantedAbilities])
                  ),
                }
              : createdToken;
          return applyTemporaryGrantedAbilitiesToToken(tokenWithPermanentAbilities, temporaryGrantedAbilities);
        });
        return {
          applied: true,
          state: { ...state, battlefield: [...(state.battlefield || []), ...(tokensToAdd as BattlefieldPermanent[])] },
          log: [...result.log],
          createdTokenIds: tokensToAdd.map(token => String((token as any)?.id || '').trim()).filter(Boolean),
        };
      }
    }
  }

  const tokenParse = parseTokenCreationFromText(clauseRaw);
  if (!tokenParse) {
    return { applied: true, state, log: ['Token creation not recognized'], createdTokenIds: [] };
  }

  const count = Math.max(1, amount | 0);

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
        const tokensToAdd = commonParsed.tokens.map(token => {
          const createdToken = token.token as any;
          if (attackTargetPlayerId) {
            createdToken.tapped = true;
            createdToken.summoningSickness = false;
            createdToken.attacking = attackTargetPlayerId;
            createdToken.attackingPlayerId = controllerId;
            createdToken.defendingPlayerId = attackTargetPlayerId;
          }
          const tokenWithPermanentAbilities =
            Array.isArray(permanentGrantedAbilities) && permanentGrantedAbilities.length > 0
              ? {
                  ...createdToken,
                  grantedAbilities: Array.from(
                    new Set([...(Array.isArray(createdToken.grantedAbilities) ? createdToken.grantedAbilities : []), ...permanentGrantedAbilities])
                  ),
                }
              : createdToken;
          return applyTemporaryGrantedAbilitiesToToken(tokenWithPermanentAbilities, temporaryGrantedAbilities);
        });
        return {
          applied: true,
          state: { ...state, battlefield: [...(state.battlefield || []), ...(tokensToAdd as BattlefieldPermanent[])] },
          log: [...commonParsed.log],
          createdTokenIds: tokensToAdd.map(token => String((token as any)?.id || '').trim()).filter(Boolean),
        };
      }
    }
  }

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

  const tokensToAdd = created.tokens.map(token => {
    const createdToken = token.token as any;
    if (attackTargetPlayerId) {
      createdToken.tapped = true;
      createdToken.summoningSickness = false;
      createdToken.attacking = attackTargetPlayerId;
      createdToken.attackingPlayerId = controllerId;
      createdToken.defendingPlayerId = attackTargetPlayerId;
    }
    const tokenWithPermanentAbilities =
      Array.isArray(permanentGrantedAbilities) && permanentGrantedAbilities.length > 0
        ? {
            ...createdToken,
            grantedAbilities: Array.from(
              new Set([...(Array.isArray(createdToken.grantedAbilities) ? createdToken.grantedAbilities : []), ...permanentGrantedAbilities])
            ),
          }
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

function scheduleTokenCleanup(
  state: GameState,
  controllerId: PlayerID,
  sourceName: string | undefined,
  sourceId: string | undefined,
  tokenIds: readonly string[],
  timing: DelayedTriggerTiming,
  action: 'sacrifice' | 'exile'
): { state: GameState; log: string[] } {
  const normalizedTokenIds = tokenIds.map(id => String(id || '').trim()).filter(Boolean);
  if (normalizedTokenIds.length === 0) {
    return { state, log: [] };
  }

  const currentTurn = Number((state as any).turnNumber ?? (state as any).turn ?? 0) || 0;
  const effect =
    action === 'exile'
      ? normalizedTokenIds.length === 1
        ? 'Exile that token.'
        : 'Exile those tokens.'
      : normalizedTokenIds.length === 1
        ? 'Sacrifice that token.'
        : 'Sacrifice those tokens.';

  const delayedTrigger = createDelayedTrigger(
    String(sourceId || sourceName || 'oracle-ir'),
    String(sourceName || 'Delayed cleanup'),
    controllerId,
    timing,
    effect,
    currentTurn,
    {
      targets: [...normalizedTokenIds],
      eventDataSnapshot: {
        sourceId: sourceId ? String(sourceId).trim() : undefined,
        sourceControllerId: String(controllerId || '').trim() || undefined,
        targetPermanentId: normalizedTokenIds.length === 1 ? normalizedTokenIds[0] : undefined,
        chosenObjectIds: normalizedTokenIds,
      },
    }
  );

  const registry = (state as any).delayedTriggerRegistry || createDelayedTriggerRegistry();
  const nextRegistry = registerDelayedTrigger(registry, delayedTrigger);
  return {
    state: {
      ...(state as any),
      delayedTriggerRegistry: nextRegistry,
    } as GameState,
    log: [
      `Scheduled delayed ${action} for ${normalizedTokenIds.length} token(s) at ${timing.replace(/_/g, ' ')}`,
    ],
  };
}

export function applyCreateTokenStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'create_token' }>,
  ctx: OracleIRExecutionContext,
  runtime?: TokenStepRuntime
): TokenStepHandlerResult {
  const amount = resolveTokenAmount(state, step, ctx, runtime);
  if (amount === null) {
    return {
      applied: false,
      message: `Skipped token creation (unknown amount): ${step.raw}`,
      reason: 'unknown_amount',
      options: { classification: 'ambiguous' },
    };
  }

  const players =
    step.who.kind === 'owner_of_moved_cards'
      ? resolveTokenControllersFromMovedCards(runtime)
      : resolvePlayers(state, step.who, ctx);
  if (players.length === 0) {
    return {
      applied: false,
      message: `Skipped token creation (unsupported player selector): ${step.raw}`,
      reason: 'unsupported_player_selector',
    };
  }

  const defendingPlayerId = String(
    ctx.selectorContext?.targetOpponentId || ctx.selectorContext?.targetPlayerId || ''
  ).trim();
  if ((step.attacking === 'each_other_opponent' || step.attacking === 'defending_player') && !defendingPlayerId) {
    return {
      applied: false,
      message: `Skipped token creation (defending player unavailable): ${step.raw}`,
      reason: 'unsupported_player_selector',
    };
  }

  let nextState = state;
  const log: string[] = [];
  const allCreatedTokenIds: string[] = [];
  for (const playerId of players) {
    const attackTargets =
      step.attacking === 'each_opponent'
        ? (nextState.players || [])
            .map((player: any) => String(player?.id || '').trim())
            .filter((id: string) => id.length > 0 && id !== playerId)
        : step.attacking === 'defending_player'
          ? [defendingPlayerId]
        : step.attacking === 'each_other_opponent'
          ? (nextState.players || [])
              .map((player: any) => String(player?.id || '').trim())
              .filter((id: string) => id.length > 0 && id !== playerId && id !== defendingPlayerId)
        : [undefined];

    for (const attackTarget of attackTargets) {
      const result = addTokensToBattlefield(
        nextState,
        playerId,
        amount,
        step.token,
        step.raw,
        ctx,
        runtime,
        step.entersTapped,
        step.withCounters,
        attackTarget,
        step.grantsHaste === 'until_end_of_turn' ? ['haste'] : step.grantsAbilitiesUntilEndOfTurn,
        step.grantsHaste === 'permanent' ? ['haste'] : undefined
      );
      if (!result.applied) return result;
      nextState = result.state;
      log.push(...result.log);
      allCreatedTokenIds.push(...result.createdTokenIds);

      if (result.createdTokenIds.length > 0 && step.battlefieldAttachedTo) {
        if ((step.battlefieldAttachedTo as any)?.kind !== 'raw') {
          return {
            applied: false,
            message: `Skipped token creation (unsupported attachment selector): ${step.raw}`,
            reason: 'unsupported_player_selector',
          };
        }

        const attachmentTargetText = String((step.battlefieldAttachedTo as any)?.text || '').trim().toLowerCase();
        const priorMovedIds = Array.isArray(runtime?.lastMovedBattlefieldPermanentIds)
          ? runtime.lastMovedBattlefieldPermanentIds.map(id => String(id || '').trim()).filter(Boolean)
          : [];
        const attachmentTargetId =
          attachmentTargetText === 'that creature' || attachmentTargetText === 'it'
            ? priorMovedIds.length === 1
              ? priorMovedIds[0]
              : ''
            : '';

        if (!attachmentTargetId) {
          return {
            applied: false,
            message: `Skipped token creation (attachment target unavailable): ${step.raw}`,
            reason: 'unsupported_player_selector',
          };
        }

        for (const tokenId of result.createdTokenIds) {
          const attachResult = attachExistingBattlefieldPermanentToTarget(nextState, tokenId, attachmentTargetId);
          if (attachResult.kind === 'impossible') {
            return {
              applied: false,
              message: `Skipped token creation (attachment target unavailable): ${step.raw}`,
              reason: 'unsupported_player_selector',
            };
          }
          nextState = attachResult.state;
          log.push(...attachResult.log);
        }
      }

      if (result.createdTokenIds.length > 0 && step.atNextEndStep) {
        const scheduled = scheduleTokenCleanup(
          nextState,
          playerId,
          ctx.sourceName,
          ctx.sourceId,
          result.createdTokenIds,
          DelayedTriggerTiming.NEXT_END_STEP,
          step.atNextEndStep
        );
        nextState = scheduled.state;
        log.push(...scheduled.log);
      }

      if (result.createdTokenIds.length > 0 && step.atEndOfCombat) {
        const scheduled = scheduleTokenCleanup(
          nextState,
          playerId,
          ctx.sourceName,
          ctx.sourceId,
          result.createdTokenIds,
          DelayedTriggerTiming.END_OF_COMBAT,
          step.atEndOfCombat
        );
        nextState = scheduled.state;
        log.push(...scheduled.log);
      }
    }
  }

  return {
    applied: true,
    state: nextState,
    log,
    createdTokenIds: allCreatedTokenIds,
  };
}
