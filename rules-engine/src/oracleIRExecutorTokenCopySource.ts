/**
 * Extracted from oracleIRExecutorTokenStepHandlers.ts.
 * Cluster: resolveCopyTokenSource and exclusive copy-source helpers
 * (getChosenObjectIds through resolveCopyTokenSource, including createCopiedTokenPermanent).
 * Public: resolveCopyTokenSource, createCopiedTokenPermanent, splitCopyTokenReference,
 * typeLineHasWord, findSourceObjectByIdAcrossState, normalizeReferenceText.
 */

import type { GameState, PlayerID, BattlefieldPermanent } from '../../shared/src';
import type { CopyTokenOverrides } from '../../shared/src/copyTokenOverrides.js';
import { copyAsEntersCopiableChoicesFromSource } from '../../shared/src/copyTokenUtils.js';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';
import {
  findCardsExiledWithSource,
  parseMoveZoneSingleTargetFromLinkedExile,
} from './oracleIRExecutorZoneOps';

type TokenStepRuntime = {
  readonly lastMovedBattlefieldPermanentIds?: readonly string[];
  readonly lastMovedCards?: readonly any[];
  readonly lastMilledCards?: readonly any[];
  readonly lastReferenceAmount?: number;
  readonly lastSacrificedPermanents?: readonly any[];
  readonly lastCreatedTokenIds?: readonly string[];
};

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

function normalizeCopyReferenceBody(body: string): string {
  let reference = String(body || '').trim();
  reference = reference.replace(/\s+and\s+that(?:'|\u2019)?s?\s+(?:tapped(?:\s+and\s+attacking)?|attacking|are\s+tapped(?:\s+and\s+attacking)?).*$/i, '');
  reference = reference.replace(/\s+attached\s+to\s+(?:that|this|the)\s+(?:creature|permanent(?:\s+twin)?)\b.*$/i, '');
  reference = reference.replace(/\s+tapped\s+and\s+attacking\s+that\s+player\b.*$/i, '');
  reference = reference.replace(/\s+tapped\s+and\s+attacking\b.*$/i, '');
  reference = reference.replace(/,\s*where\s+x\s+is\b.*$/i, '');
  reference = reference.replace(/\.\s*exile\b.*$/i, '');
  reference = reference.replace(/\.\s*sacrifice\b.*$/i, '');
  reference = reference.replace(/\.\s*at\s+the\s+beginning\b.*$/i, '');
  reference = reference.replace(/\s+at the beginning of the next end step\b.*$/i, '');
  reference = reference.replace(/\s+instead$/i, '');
  return reference.replace(/[.\s]+$/g, '').trim();
}

function splitCopyTokenReference(tokenHint: string): {
  readonly referenceText: string;
  readonly exceptionText: string;
} | null {
  const raw = String(tokenHint || '').trim();
  if (!/\bcop(?:y|ies)\s+of\b/i.test(raw)) return null;

  const body = normalizeCopyReferenceBody(raw.replace(/^.*?\bcop(?:y|ies)\s+of\s+/i, '').trim());
  if (!body) return null;

  const exceptMatch = body.match(/^(.*?)(?:,\s*|\s+)except\s+(.+)$/i);
  if (!exceptMatch) {
    return {
      referenceText: body,
      exceptionText: '',
    };
  }

  return {
    referenceText: normalizeCopyReferenceBody(String(exceptMatch[1] || '')),
    exceptionText: String(exceptMatch[2] || '').replace(/[.\s]+$/g, '').trim(),
  };
}

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
  readonly copySourcePermanentId?: string;
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
  const subtypes = params.overrides.replaceSubtypes && params.overrides.replaceSubtypes.length > 0
    ? dedupeStrings([...params.overrides.replaceSubtypes])
    : dedupeStrings([...(split.subtypes || []), ...(params.overrides.addSubtypes || [])]);
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
    isCopyOfPrintedCard: true,
    zone: 'battlefield',
  } as any;

  const hasHasteFromOverrides = (params.overrides.addAbilities || []).some(
    (ability) => String(ability).toLowerCase() === 'haste',
  );
  const isCreatureType = cardTypes.some((type) => String(type).toLowerCase() === 'creature');

  const tokenPermanent = {
    id: tokenId,
    controller: params.controllerId,
    owner: params.controllerId,
    ownerId: params.controllerId,
    tapped: Boolean(params.entersTapped),
    summoningSickness: isCreatureType && !hasHasteFromOverrides,
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
    isCopyToken: true,
    copyTokenOverrides: params.overrides,
    ...(String(params.copySourcePermanentId || sourceObject?.id || '').trim()
      ? { copiedFromPermanentId: String(params.copySourcePermanentId || sourceObject.id).trim() }
      : {}),
    ...(params.sourceId ? { createdBySourceId: String(params.sourceId).trim() } : {}),
    ...(params.sourceName ? { createdBySourceName: String(params.sourceName).trim() } : {}),
  } as BattlefieldPermanent;

  // CR 707.2 — inherit as-enters choices (e.g. Morophon creature type) from the copied object.
  copyAsEntersCopiableChoicesFromSource(sourceObject, tokenPermanent);

  return tokenPermanent;
}

type CopySourceResolution =
  | { readonly kind: 'resolved'; readonly sourceObject: any }
  | { readonly kind: 'player_choice_required'; readonly availableIds: readonly string[] }
  | { readonly kind: 'unavailable' };

function snapshotToCopySourceObject(snapshot: any): any | null {
  if (!snapshot || typeof snapshot !== 'object') return null;
  const typeLine = String(snapshot.typeLine || snapshot.type_line || 'Permanent').trim();
  const id = String(snapshot.id || '').trim();
  if (!id) return null;
  return {
    id,
    name: String(snapshot.name || 'Permanent').trim() || 'Permanent',
    type_line: typeLine,
    card: {
      id,
      name: String(snapshot.name || 'Permanent').trim() || 'Permanent',
      type_line: typeLine,
      ...(snapshot.manaValue !== undefined ? { cmc: snapshot.manaValue, manaValue: snapshot.manaValue } : {}),
    },
    ...(snapshot.power !== undefined ? { power: snapshot.power } : {}),
    ...(snapshot.toughness !== undefined ? { toughness: snapshot.toughness } : {}),
    ...(Array.isArray(snapshot.colors) ? { colors: snapshot.colors } : {}),
  };
}

function collectCopySourceSnapshots(ctx: OracleIRExecutionContext, runtime?: TokenStepRuntime): any[] {
  const snapshots = [
    ...(Array.isArray(runtime?.lastSacrificedPermanents) ? runtime.lastSacrificedPermanents : []),
    ...(Array.isArray((ctx as any).lastSacrificedPermanents) ? (ctx as any).lastSacrificedPermanents : []),
  ];
  const sourceId = String(ctx.sourceId || '').trim();
  if (!sourceId) return snapshots;
  return snapshots.filter((snapshot) => String((snapshot as any)?.id || '').trim() === sourceId);
}

function resolveSnapshotCopySource(
  ctx: OracleIRExecutionContext,
  runtime?: TokenStepRuntime
): CopySourceResolution | null {
  const snapshots = collectCopySourceSnapshots(ctx, runtime)
    .map(snapshotToCopySourceObject)
    .filter((entry): entry is any => Boolean(entry));
  if (snapshots.length === 1) return { kind: 'resolved', sourceObject: snapshots[0] };
  return null;
}

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

function findBattlefieldObjectById(state: GameState, id: string): any | null {
  const normalized = String(id || '').trim();
  if (!normalized) return null;
  return (state.battlefield || []).find((perm: any) => String(perm?.id || perm?.card?.id || '').trim() === normalized) || null;
}

function typeLineHasWord(object: any, word: string): boolean {
  const typeLine = String(object?.type_line || object?.cardType || object?.card?.type_line || '').toLowerCase();
  return new RegExp(`\\b${word}\\b`, 'i').test(typeLine);
}

function getCopyReferenceTypeAlternatives(reference: string): readonly string[] | null {
  const typeWords = ['artifact', 'creature', 'enchantment', 'land', 'planeswalker'] as const;
  const found = typeWords.filter((word) => new RegExp(`\\b${word}\\b`, 'i').test(reference));
  if (found.length <= 1) return null;
  if (/\bor\b/i.test(reference) || /,/.test(reference)) return found;
  return null;
}

function copyReferenceMatchesObject(referenceText: string, object: any, controllerId: PlayerID, sourceId?: string): boolean {
  const reference = normalizeReferenceText(referenceText);
  if (!object) return false;
  if (/\byou control\b/i.test(reference) && String(object?.controller || '').trim() !== String(controllerId)) return false;
  if (/\banother\b/i.test(reference) && sourceId && String(object?.id || '').trim() === String(sourceId).trim()) return false;
  if (/\bnoncreature\b/i.test(reference) && typeLineHasWord(object, 'creature')) return false;
  if (/\btoken\b/i.test(reference) && !Boolean(object?.isToken || object?.card?.isToken)) return false;

  const typeAlternatives = getCopyReferenceTypeAlternatives(reference);
  if (typeAlternatives) {
    if (!typeAlternatives.some((word) => typeLineHasWord(object, word))) return false;
    return true;
  }

  if (/\bcreature\b/i.test(reference) && !/\bnoncreature\b/i.test(reference) && !typeLineHasWord(object, 'creature')) return false;
  if (/\bpermanent\b/i.test(reference) && /\bnoncreature\b/i.test(reference) && typeLineHasWord(object, 'creature')) return false;
  if (/\bartifact\b/i.test(reference) && !typeLineHasWord(object, 'artifact')) return false;
  if (/\benchantment\b/i.test(reference) && !typeLineHasWord(object, 'enchantment')) return false;
  if (/\bland\b/i.test(reference) && !typeLineHasWord(object, 'land')) return false;
  return true;
}

function resolveTargetCopySource(
  state: GameState,
  referenceText: string,
  ctx: OracleIRExecutionContext
): CopySourceResolution | null {
  const reference = normalizeReferenceText(referenceText);
  if (/\bexiled with this\b/i.test(reference)) return null;
  if (!/\btarget\b/i.test(reference)) return null;

  const controllerId = ctx.controllerId;
  const sourceId = String(ctx.sourceId || '').trim();
  const explicitIds = [
    ctx.targetCreatureId,
    ctx.targetPermanentId,
    ctx.selectorContext?.targetCreatureId,
    ctx.selectorContext?.targetPermanentId,
    ...getChosenObjectIds(ctx),
  ]
    .map(id => String(id || '').trim())
    .filter(Boolean);

  const seen = new Set<string>();
  const explicitMatches: any[] = [];
  for (const id of explicitIds) {
    if (seen.has(id)) continue;
    seen.add(id);
    const object = findBattlefieldObjectById(state, id);
    if (object && copyReferenceMatchesObject(reference, object, controllerId, sourceId)) explicitMatches.push(object);
  }

  if (explicitMatches.length === 1) return { kind: 'resolved', sourceObject: explicitMatches[0] };
  if (explicitMatches.length > 1) {
    return {
      kind: 'player_choice_required',
      availableIds: explicitMatches.map(object => String(object?.id || '').trim()).filter(Boolean),
    };
  }

  const candidates = (state.battlefield || []).filter((perm: any) => copyReferenceMatchesObject(reference, perm, controllerId, sourceId));
  if (candidates.length === 1) return { kind: 'resolved', sourceObject: candidates[0] };
  if (candidates.length > 1) {
    return {
      kind: 'player_choice_required',
      availableIds: candidates.map((object: any) => String(object?.id || '').trim()).filter(Boolean),
    };
  }

  return { kind: 'unavailable' };
}

function resolveStackSpellCopySource(state: GameState, ctx: OracleIRExecutionContext): any | null {
  const spellId = String(ctx.targetSpellId || ctx.selectorContext?.targetSpellId || '').trim();
  if (!spellId) return null;
  const stackItem = (state.stack || []).find((item: any) => String(item?.id || '').trim() === spellId) as any;
  if (!stackItem) return null;
  return stackItem?.card || stackItem;
}

function resolveAttachedAuraOnBattlefield(
  state: GameState,
  ctx: OracleIRExecutionContext,
  hostIds?: readonly string[]
): any | null {
  const hosts = new Set(
    (hostIds && hostIds.length > 0
      ? hostIds
      : [
          String(ctx.targetPermanentId || ctx.targetCreatureId || '').trim(),
          String(ctx.sourceId || '').trim(),
          ...getChosenObjectIds(ctx),
        ]
    )
      .map(id => String(id || '').trim())
      .filter(Boolean)
  );
  if (hosts.size === 0) return null;

  const auras = (state.battlefield || []).filter((perm: any) => {
    const attachedTo = String(perm?.attachedTo || '').trim();
    if (!attachedTo || !hosts.has(attachedTo)) return false;
    return typeLineHasWord(perm, 'enchantment');
  });
  if (auras.length === 1) return auras[0];
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

  const targetCopySource = resolveTargetCopySource(state, referenceText, ctx);
  if (targetCopySource) return targetCopySource;

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
      if (chosenObjectIds.length === 1) {
        const antecedentCard = findSourceObjectByIdAcrossState(state, chosenObjectIds[0]!);
        if (antecedentCard) return { kind: 'resolved', sourceObject: antecedentCard };
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
    if (sourceFallback) return { kind: 'resolved', sourceObject: sourceFallback };
    const snapshotFallback = resolveSnapshotCopySource(ctx, runtime);
    return snapshotFallback || { kind: 'unavailable' };
  }

  if (
    referenceText === 'this creature' ||
    referenceText === 'this permanent' ||
    referenceText === 'this artifact' ||
    referenceText === 'this equipment' ||
    referenceText === 'this enchantment' ||
    referenceText === 'this vehicle' ||
    referenceText === 'this token'
  ) {
    const sourceFallback = findSourceObjectByIdAcrossState(state, String(ctx.sourceId || '').trim());
    if (sourceFallback) return { kind: 'resolved', sourceObject: sourceFallback };
    const snapshotFallback = resolveSnapshotCopySource(ctx, runtime);
    return snapshotFallback || { kind: 'unavailable' };
  }

  if (referenceText === 'that artifact or creature' || referenceText === 'that creature or artifact') {
    const stackSource = resolveStackSpellCopySource(state, ctx);
    if (stackSource) return { kind: 'resolved', sourceObject: stackSource };
    const explicitIds = [
      ctx.targetPermanentId,
      ctx.targetCreatureId,
      ctx.selectorContext?.targetPermanentId,
      ctx.selectorContext?.targetCreatureId,
      ...getChosenObjectIds(ctx),
    ]
      .map(id => String(id || '').trim())
      .filter(Boolean);
    for (const id of explicitIds) {
      const object = findBattlefieldObjectById(state, id) || findSourceObjectByIdAcrossState(state, id);
      if (object && (typeLineHasWord(object, 'artifact') || typeLineHasWord(object, 'creature'))) {
        return { kind: 'resolved', sourceObject: object };
      }
    }
    return { kind: 'unavailable' };
  }

  if (/^that aura(?: attached to (?:that|the) creature)?$/i.test(referenceText)) {
    const aura = resolveAttachedAuraOnBattlefield(state, ctx);
    if (aura) return { kind: 'resolved', sourceObject: aura };
    const sourceFallback = findSourceObjectByIdAcrossState(state, String(ctx.sourceId || '').trim());
    if (sourceFallback && typeLineHasWord(sourceFallback, 'enchantment')) {
      return { kind: 'resolved', sourceObject: sourceFallback };
    }
    return { kind: 'unavailable' };
  }

  if (/^one of those creatures$/i.test(referenceText)) {
    const candidateIds = (() => {
      const battlefieldIds = Array.isArray(runtime?.lastMovedBattlefieldPermanentIds)
        ? runtime.lastMovedBattlefieldPermanentIds.map(id => String(id || '').trim()).filter(Boolean)
        : [];
      if (chosenObjectIds.length > 0) {
        return chosenObjectIds.filter(id =>
          (state.battlefield || []).some((perm: any) => {
            if (String(perm?.id || '').trim() !== id) return false;
            return typeLineHasWord(perm, 'creature');
          })
        );
      }
      return battlefieldIds.filter(id =>
        (state.battlefield || []).some((perm: any) => {
          if (String(perm?.id || '').trim() !== id) return false;
          return typeLineHasWord(perm, 'creature');
        })
      );
    })();
    if (candidateIds.length === 0) return { kind: 'unavailable' };
    if (candidateIds.length === 1) {
      const permanent = (state.battlefield || []).find(perm => String((perm as any)?.id || '').trim() === candidateIds[0]);
      return permanent ? { kind: 'resolved', sourceObject: permanent } : { kind: 'unavailable' };
    }
    return { kind: 'player_choice_required', availableIds: candidateIds };
  }

  if (/^a permanent you control$/i.test(referenceText)) {
    const controllerId = String(ctx.controllerId || '').trim();
    const permanents = (state.battlefield || []).filter(
      (perm: any) => String(perm?.controller || '').trim() === controllerId
    );
    if (permanents.length === 1) return { kind: 'resolved', sourceObject: permanents[0] };
    if (permanents.length > 1) {
      return {
        kind: 'player_choice_required',
        availableIds: permanents.map((perm: any) => String(perm?.id || '').trim()).filter(Boolean),
      };
    }
    return { kind: 'unavailable' };
  }

  if (/^(?:a )?creature token you control$/i.test(referenceText)) {
    const controllerId = String(ctx.controllerId || '').trim();
    const tokens = (state.battlefield || []).filter((perm: any) => {
      if (String(perm?.controller || '').trim() !== controllerId) return false;
      if (!typeLineHasWord(perm, 'creature')) return false;
      return Boolean(perm?.isToken) || /\btoken\b/i.test(String(perm?.type_line || perm?.card?.type_line || ''));
    });
    const preferred = tokens.filter((perm: any) => chosenObjectIds.includes(String(perm?.id || '').trim()));
    const pool = preferred.length > 0 ? preferred : tokens;
    if (pool.length === 1) return { kind: 'resolved', sourceObject: pool[0] };
    if (pool.length > 1) {
      return {
        kind: 'player_choice_required',
        availableIds: pool.map((perm: any) => String(perm?.id || '').trim()).filter(Boolean),
      };
    }
    return { kind: 'unavailable' };
  }

  if (referenceText === 'the sacrificed creature' || referenceText === 'sacrificed creature') {
    const sacrificed = Array.isArray(runtime?.lastSacrificedPermanents) ? runtime.lastSacrificedPermanents : [];
    if (sacrificed.length === 1) return { kind: 'resolved', sourceObject: sacrificed[0] };
    if (sacrificed.length > 1) {
      return {
        kind: 'player_choice_required',
        availableIds: sacrificed.map((entry) => String((entry as any)?.id || '').trim()).filter(Boolean),
      };
    }
    return { kind: 'unavailable' };
  }

  if (
    referenceText === 'that creature' ||
    referenceText === 'that permanent' ||
    referenceText === 'that artifact'
  ) {
    const contextualCards = [
      ...(Array.isArray(runtime?.lastMovedCards) ? runtime.lastMovedCards : []),
      ...(Array.isArray(ctx?.lastMovedCards) ? ctx.lastMovedCards : []),
      ...(Array.isArray(runtime?.lastSacrificedPermanents) ? runtime.lastSacrificedPermanents : []),
      ...(Array.isArray((ctx as any)?.lastDestroyedPermanents) ? (ctx as any).lastDestroyedPermanents : []),
    ];
    const contextualCreatures = contextualCards.filter((card) => {
      const typeLine = String((card as any)?.type_line || (card as any)?.card?.type_line || '').toLowerCase();
      if (referenceText === 'that artifact') return typeLine.includes('artifact');
      return typeLine.includes('creature');
    });
    if (contextualCreatures.length === 1) {
      return { kind: 'resolved', sourceObject: contextualCreatures[0] };
    }
    if (contextualCreatures.length > 1) {
      return {
        kind: 'player_choice_required',
        availableIds: contextualCreatures
          .map((card) => String((card as any)?.id || '').trim())
          .filter(Boolean),
      };
    }

    const battlefieldIds = Array.isArray(runtime?.lastMovedBattlefieldPermanentIds)
      ? runtime.lastMovedBattlefieldPermanentIds.map(id => String(id || '').trim()).filter(Boolean)
      : [];
    const candidateIds = battlefieldIds.length > 0
      ? chosenObjectIds.length > 0
        ? battlefieldIds.filter(id => chosenObjectIds.includes(id))
        : battlefieldIds
      : chosenObjectIds;
    if (candidateIds.length !== 1) {
      if (referenceText === 'that creature' || referenceText === 'that permanent') {
        const preferredTargetId = String(
          ctx.targetCreatureId ||
            ctx.targetPermanentId ||
            ctx.selectorContext?.targetCreatureId ||
            ctx.selectorContext?.targetPermanentId ||
            ctx.selectorContext?.combatOpponentCreatureId ||
            ''
        ).trim();
        if (preferredTargetId) {
          const preferredPermanent = (state.battlefield || []).find(
            (perm) => String((perm as any)?.id || '').trim() === preferredTargetId
          );
          if (preferredPermanent) return { kind: 'resolved', sourceObject: preferredPermanent };
        }
      }
      return candidateIds.length > 1
        ? { kind: 'player_choice_required', availableIds: candidateIds }
        : { kind: 'unavailable' };
    }
    const permanent = (state.battlefield || []).find(perm => String((perm as any)?.id || '').trim() === candidateIds[0]);
    if (permanent) return { kind: 'resolved', sourceObject: permanent };
    const offBattlefield = contextualCards.find(
      (card) => String((card as any)?.id || '').trim() === candidateIds[0]
    );
    return offBattlefield ? { kind: 'resolved', sourceObject: offBattlefield } : { kind: 'unavailable' };
  }

  if (referenceText === 'equipped creature') {
    const sourceId = String(ctx.sourceId || '').trim();
    const sourcePermanent = (state.battlefield || []).find(perm => String((perm as any)?.id || '').trim() === sourceId) as any;
    const attachedTo = String(sourcePermanent?.attachedTo || '').trim();
    if (!attachedTo) return { kind: 'unavailable' };
    const equippedCreature = (state.battlefield || []).find(perm => String((perm as any)?.id || '').trim() === attachedTo);
    return equippedCreature ? { kind: 'resolved', sourceObject: equippedCreature } : { kind: 'unavailable' };
  }

  if (referenceText === 'enchanted creature' || referenceText === 'blighted creature') {
    const sourceId = String(ctx.sourceId || '').trim();
    const sourcePermanent = (state.battlefield || []).find(perm => String((perm as any)?.id || '').trim() === sourceId) as any;
    const attachedTo = String(sourcePermanent?.attachedTo || '').trim();
    if (!attachedTo) return { kind: 'unavailable' };
    const enchantedCreature = (state.battlefield || []).find(perm => String((perm as any)?.id || '').trim() === attachedTo);
    return enchantedCreature ? { kind: 'resolved', sourceObject: enchantedCreature } : { kind: 'unavailable' };
  }

  if (referenceText === 'enchanted artifact') {
    const sourceId = String(ctx.sourceId || '').trim();
    const sourcePermanent = (state.battlefield || []).find(perm => String((perm as any)?.id || '').trim() === sourceId) as any;
    const attachedTo = String(sourcePermanent?.attachedTo || '').trim();
    if (!attachedTo) return { kind: 'unavailable' };
    const enchantedArtifact = (state.battlefield || []).find(perm => String((perm as any)?.id || '').trim() === attachedTo);
    return enchantedArtifact ? { kind: 'resolved', sourceObject: enchantedArtifact } : { kind: 'unavailable' };
  }

  if (referenceText === 'that wizard') {
    const candidateIds = chosenObjectIds.length > 0
      ? chosenObjectIds
      : [String(ctx.targetPermanentId || ctx.targetCreatureId || '').trim()].filter(Boolean);
    const wizards = (state.battlefield || []).filter((perm: any) => {
      const id = String(perm?.id || '').trim();
      if (candidateIds.length > 0 && !candidateIds.includes(id)) return false;
      const typeLine = String(perm?.card?.type_line || perm?.type_line || '').toLowerCase();
      return /\bwizard\b/.test(typeLine);
    });
    if (wizards.length === 1) return { kind: 'resolved', sourceObject: wizards[0] };
    if (wizards.length > 1) {
      return {
        kind: 'player_choice_required',
        availableIds: wizards.map((perm: any) => String(perm?.id || '').trim()).filter(Boolean),
      };
    }
    return { kind: 'unavailable' };
  }

  if (/^a non-?saga token you control$/i.test(referenceText)) {
    const tokens = (state.battlefield || []).filter((perm: any) => {
      if (String(perm?.controller || '').trim() !== String(ctx.controllerId || '').trim()) return false;
      if (!perm?.isToken) return false;
      const typeLine = String(perm?.card?.type_line || perm?.type_line || '').toLowerCase();
      return !/\bsaga\b/.test(typeLine);
    });
    if (tokens.length === 1) return { kind: 'resolved', sourceObject: tokens[0] };
    if (tokens.length > 1) {
      return {
        kind: 'player_choice_required',
        availableIds: tokens.map((perm: any) => String(perm?.id || '').trim()).filter(Boolean),
      };
    }
    return { kind: 'unavailable' };
  }

  if (/^a nonlegendary enchantment you control$/i.test(referenceText)) {
    const enchantments = (state.battlefield || []).filter((perm: any) => {
      if (String(perm?.controller || '').trim() !== String(ctx.controllerId || '').trim()) return false;
      const typeLine = String(perm?.card?.type_line || perm?.type_line || '').toLowerCase();
      return /\benchantment\b/.test(typeLine) && !/\blegendary\b/.test(typeLine);
    });
    if (enchantments.length === 1) return { kind: 'resolved', sourceObject: enchantments[0] };
    if (enchantments.length > 1) {
      return {
        kind: 'player_choice_required',
        availableIds: enchantments.map((perm: any) => String(perm?.id || '').trim()).filter(Boolean),
      };
    }
    return { kind: 'unavailable' };
  }

  if (/^one of (?:them|those permanents)$/i.test(referenceText)) {
    const candidateIds = chosenObjectIds.length > 0
      ? chosenObjectIds
      : Array.isArray(runtime?.lastMovedBattlefieldPermanentIds)
        ? runtime.lastMovedBattlefieldPermanentIds.map(id => String(id || '').trim()).filter(Boolean)
        : [];
    if (candidateIds.length === 0) return { kind: 'unavailable' };
    if (candidateIds.length === 1) {
      const permanent = (state.battlefield || []).find(perm => String((perm as any)?.id || '').trim() === candidateIds[0]);
      return permanent ? { kind: 'resolved', sourceObject: permanent } : { kind: 'unavailable' };
    }
    return { kind: 'player_choice_required', availableIds: candidateIds };
  }

  if (/^the card with the chosen name$/i.test(referenceText)) {
    const chosenName = String(
      ctx.selectorContext?.chosenName || (ctx as any).chosenName || (ctx as any).chosenCardName || ''
    ).trim();
    if (chosenName) {
      return {
        kind: 'resolved',
        sourceObject: { name: chosenName, type_line: 'Instant', oracle_text: '', cmc: 1 },
      };
    }
    return { kind: 'unavailable' };
  }

  if (/^a card you exiled with cards named this permanent$/i.test(referenceText)) {
    const sourceId = String(ctx.sourceId || '').trim();
    if (!sourceId) return { kind: 'unavailable' };
    const matches = findCardsExiledWithSource(state, sourceId, { cardType: 'any' });
    if (matches.length === 1) return { kind: 'resolved', sourceObject: matches[0].card };
    if (matches.length > 1) {
      return {
        kind: 'player_choice_required',
        availableIds: matches.map((match) => match.cardId),
      };
    }
    return { kind: 'unavailable' };
  }

  if (/\bexiled with this\b/i.test(parsed.referenceText) || /\bexiled with this\b/i.test(String(tokenHint || ''))) {
    const criteria = parseMoveZoneSingleTargetFromLinkedExile({
      kind: 'raw',
      text: parsed.referenceText || String(tokenHint || ''),
    });
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


export {
  normalizeReferenceText,
  typeLineHasWord,
  createCopiedTokenPermanent,
  findSourceObjectByIdAcrossState,
  splitCopyTokenReference,
  resolveCopyTokenSource,
};
