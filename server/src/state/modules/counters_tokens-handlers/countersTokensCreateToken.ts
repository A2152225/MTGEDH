// server/src/state/modules/counters_tokens-handlers/countersTokensCreateToken.ts
// Origin parent: server/src/state/modules/counters_tokens.ts
// Cluster moved: createToken + createCopyTokensOfCard plus exclusive helpers
// buildCreateTokenReplayPayload, persistCreateTokenEvents, mergeUniqueAbilityStrings,
// resolveCreateTokenAbilities, normalizeManaCostXToZero, and CreateTokenOptions.
// Public entry symbols: createToken, createCopyTokensOfCard, CreateTokenOptions.

import type { PlayerID } from "../../../../../shared/src/index.js";
import type { GameContext } from "../../context.js";
import { uid, parsePT } from "../../utils.js";
import { appendEvent } from "../../../db/index.js";
import { debug, debugWarn } from "../../../utils/debug.js";
import {
  applyTokenPrintingToCard,
  buildTokenImageSpec,
  getCommonToken,
  getTokenImageUrls,
  lookupExactTokenPrinting,
  resolveTokenPrinting,
} from "../../../services/tokens.js";
import {
  deriveCreateTokenSourceFragment,
  extractCreateTokenGrantedAbilities,
} from "../../../../../rules-engine/src/oracleReminderText.js";
import { evaluateTokenCreationReplacementEvent } from "../replacement-effects.js";
import { triggerETBEffectsForPermanent } from "../triggerEtbPermanentEffects.js";
import { queueTokenCreatedTriggers } from "../triggers/tokens.js";
import { hydrateCardOracleInPlace } from "../cardOracleHydration.js";
import { ResolutionQueueManager } from "../../resolution/index.js";
import { ResolutionStepType } from "../../resolution/types.js";
import {
  applyCopyTokenOverrides,
  type CopyTokenOverrides,
} from "../../../../../shared/src/copyTokenOverrides.js";
import { copyAsEntersCopiableChoicesFromSource } from "../../../../../shared/src/copyTokenUtils.js";
import { getCountersTokensHandlerDeps } from "./countersTokensHandlerDeps.js";
import { applyGraveyardTypeEntryCounterGrants } from "../graveyardTypeEntryCounterBonus.js";

function runSBA(ctx: GameContext): void {
  getCountersTokensHandlerDeps().runSBA(ctx);
}

export type CreateTokenOptions = {
  colors?: string[];
  typeLine?: string;
  abilities?: string[];
  /**
   * Optional create-clause / oracle fragment used to extract token-granted abilities
   * (`with flying`, Vibranium-style reminders, `It has flying.` follow-ups).
   */
  sourceText?: string;
  /** Alias for sourceText (call sites that pass a raw description string). */
  description?: string;
  /**
   * Full source-card oracle. Used only when sourceText/description are absent:
   * deriveCreateTokenSourceFragment picks the matching create clause (+ It has follow-ups).
   */
  sourceOracleText?: string;
  isArtifact?: boolean;
  entersTapped?: boolean;
  withCounters?: Record<string, number>;
  /** When true, do not append executeEffect/createToken to the event log (replay/applyEvent paths). */
  skipEventPersistence?: boolean;
};

function buildCreateTokenReplayPayload(controllerId: PlayerID, tokenPermanent: any): Record<string, unknown> {
  const keywords = Array.isArray(tokenPermanent?.card?.keywords) ? tokenPermanent.card.keywords : [];
  const rawPower = tokenPermanent?.basePower ?? tokenPermanent?.card?.power;
  const rawToughness = tokenPermanent?.baseToughness ?? tokenPermanent?.card?.toughness;
  const power = Number.isFinite(Number(rawPower)) ? Number(rawPower) : undefined;
  const toughness = Number.isFinite(Number(rawToughness)) ? Number(rawToughness) : undefined;
  const chosenCreatureType = String(
    tokenPermanent?.chosenCreatureType || tokenPermanent?.card?.chosenCreatureType || '',
  ).trim();
  const chosenColor = String(tokenPermanent?.chosenColor || tokenPermanent?.card?.chosenColor || '').trim();
  const chosenCardName = String(tokenPermanent?.chosenCardName || tokenPermanent?.card?.chosenCardName || '').trim();
  const chosenPlayer = String(tokenPermanent?.chosenPlayer || tokenPermanent?.card?.chosenPlayer || '').trim();
  const copiedFromPermanentId = String(tokenPermanent?.copiedFromPermanentId || '').trim();
  const oracleText = String(tokenPermanent?.card?.oracle_text || '').trim();

  return {
    effectType: 'createToken',
    controllerId,
    tokenData: {
      id: String(tokenPermanent?.id || ''),
      name: String(tokenPermanent?.card?.name || 'Token'),
      typeLine: String(tokenPermanent?.card?.type_line || 'Token'),
      ...(power != null ? { power } : {}),
      ...(toughness != null ? { toughness } : {}),
      colors: Array.isArray(tokenPermanent?.card?.colors) ? [...tokenPermanent.card.colors] : [],
      abilities: keywords.map((keyword: unknown) => String(keyword || '')),
      hasHaste: keywords.some((keyword: unknown) => String(keyword || '').toLowerCase() === 'haste'),
      ...(chosenCreatureType ? { chosenCreatureType } : {}),
      ...(chosenColor ? { chosenColor } : {}),
      ...(chosenCardName ? { chosenCardName } : {}),
      ...(chosenPlayer ? { chosenPlayer } : {}),
      ...(copiedFromPermanentId ? { copiedFromPermanentId } : {}),
      ...(tokenPermanent?.isCopyToken || tokenPermanent?.isCopyOfPrintedCard || copiedFromPermanentId
        ? { isCopyToken: true }
        : {}),
      ...(oracleText ? { oracleText } : {}),
    },
  };
}

function persistCreateTokenEvents(
  ctx: GameContext,
  controllerId: PlayerID,
  createdPermanentIds: readonly string[],
): void {
  if ((ctx as any).isReplaying) return;
  const gameId = String((ctx as any).gameId || '').trim();
  if (!gameId || gameId === 'unknown') return;

  const battlefield = Array.isArray((ctx as any).state?.battlefield) ? (ctx as any).state.battlefield : [];
  for (const tokenId of createdPermanentIds) {
    const tokenPermanent = battlefield.find((entry: any) => entry && String(entry.id || '') === String(tokenId));
    if (!tokenPermanent) continue;

    try {
      appendEvent(
        gameId,
        Number((ctx as any).seq?.value ?? (ctx as any).seq ?? ((ctx as any).state as any)?.seq ?? 0),
        'executeEffect',
        buildCreateTokenReplayPayload(controllerId, tokenPermanent),
      );
    } catch (err) {
      debugWarn(1, '[createToken] appendEvent(executeEffect/createToken) failed:', err);
    }
  }
}


function mergeUniqueAbilityStrings(values: readonly string[]): string[] {
  const out: string[] = [];
  for (const value of values) {
    const normalized = String(value || '').trim();
    if (!normalized) continue;
    if (!out.some((entry) => entry.toLowerCase() === normalized.toLowerCase())) {
      out.push(normalized);
    }
  }
  return out;
}

/**
 * Choke-point ability resolution for legacy createToken:
 * merge caller abilities + catalog abilities + extractor(sourceText/description),
 * with sourceOracleText create-clause fallback when those are absent.
 */
function resolveCreateTokenAbilities(
  tokenName: string,
  options?: CreateTokenOptions,
  tokenPower?: number,
  tokenToughness?: number,
): string[] {
  let sourceText = String(options?.sourceText || options?.description || '').trim();
  if (!sourceText) {
    const sourceOracleText = String(options?.sourceOracleText || '').trim();
    if (sourceOracleText) {
      sourceText = deriveCreateTokenSourceFragment(
        tokenName,
        sourceOracleText,
        tokenPower,
        tokenToughness,
      );
    }
  }
  const extracted = sourceText ? extractCreateTokenGrantedAbilities(sourceText) : [];
  const catalog = getCommonToken(tokenName);
  const catalogAbilities = Array.isArray(catalog?.abilities) ? catalog!.abilities : [];
  const provided = Array.isArray(options?.abilities) ? options!.abilities : [];
  return mergeUniqueAbilityStrings([...provided, ...catalogAbilities, ...extracted]);
}

export function createToken(
  ctx: GameContext,
  controller: PlayerID,
  name: string,
  count = 1,
  basePower?: number,
  baseToughness?: number,
  options?: CreateTokenOptions,
  skipMirrormindReplacement = false
) : string[] {
  const { state, bumpSeq } = ctx;

  const createdPermanentIds: string[] = [];
  
  // Apply token doubling effects (Anointed Procession, Doubling Season, Elspeth, etc.)
  let tokensToCreate = count;
  try {
    const replacement = evaluateTokenCreationReplacementEvent({
      state,
      controllerId: String(controller),
      count,
      tokenName: name,
      tokenTypeLine: options?.typeLine,
    });
    const multiplier = Number((replacement.metadata as any)?.multiplier || 1);
    tokensToCreate = Math.floor(Number(replacement.replacementAmount ?? count));
    if (multiplier > 1) {
      debug(2, `[createToken] Token doubling: creating ${tokensToCreate} tokens (base: ${count}, multiplier: ${multiplier})`);
    }
  } catch (err) {
    debugWarn(1, "[createToken] Error calculating token doubling, using base count:", err);
  }

  // Mirrormind Crown (replacement effect):
  // "As long as this Equipment is attached to a creature, the first time you would create one or more tokens each turn,
  // you may instead create that many tokens that are copies of equipped creature."
  //
  // We model this as a Resolution Queue OPTION_CHOICE prompt.
  // - We only offer it when the controller of the token creation controls an attached Mirrormind Crown.
  // - We track usage per equipment permanent id for the current turn.
  // - On replays/unknown gameId, we skip prompting.
  try {
    const gameId = String((ctx as any).gameId || '');
    const isReplaying = Boolean((ctx as any).isReplaying);
    const battlefield = state.battlefield || [];

    if (!skipMirrormindReplacement && !isReplaying && gameId && gameId !== 'unknown' && tokensToCreate > 0) {
      (state as any).mirrormindCrownUsedThisTurn = (state as any).mirrormindCrownUsedThisTurn || {};
      const used: Record<string, boolean> = (state as any).mirrormindCrownUsedThisTurn;

      const crowns = battlefield.filter((p: any) => {
        const nm = String(p?.card?.name || '').toLowerCase();
        const tl = String(p?.card?.type_line || '').toLowerCase();
        return p && p.controller === controller && nm === 'mirrormind crown' && tl.includes('equipment');
      });

      const crown = crowns.find((eq: any) => {
        const eqId = String(eq?.id || '');
        if (!eqId || used[eqId]) return false;
        const attachedTo = String((eq as any)?.attachedTo || '').trim();
        if (!attachedTo) return false;
        const creature = battlefield.find((bp: any) => String(bp?.id || '') === attachedTo);
        if (!creature) return false;
        const creatureTL = String(creature?.card?.type_line || '').toLowerCase();
        return creatureTL.includes('creature');
      });

      if (crown) {
        const eqId = String(crown.id);
        const attachedTo = String((crown as any).attachedTo);
        const equippedCreature = battlefield.find((bp: any) => String(bp?.id || '') === attachedTo);

        if (equippedCreature?.card) {
          // Mark used immediately: if the player declines, it still counts as the first time.
          used[eqId] = true;

          const equippedCardSnapshot = JSON.parse(JSON.stringify(equippedCreature.card));

          const optionReplace = {
            id: 'replace',
            label: `Replace with ${tokensToCreate} token(s) copying ${String(equippedCreature.card?.name || 'equipped creature')}`,
          };
          const optionNormal = {
            id: 'normal',
            label: `Create the normal ${tokensToCreate} token(s) (${name})`,
          };

          ResolutionQueueManager.addStep(gameId, {
            type: ResolutionStepType.OPTION_CHOICE,
            playerId: controller,
            description: `Mirrormind Crown: The first time you would create token(s) this turn, you may instead create that many copies of the equipped creature.`,
            mandatory: true,
            sourceId: eqId,
            sourceName: 'Mirrormind Crown',
            mirrormindCrownTokenReplacementChoice: true,
            mirrormindCrownEquipmentId: eqId,
            mirrormindCrownEquippedCreatureId: String(equippedCreature.id),
            mirrormindCrownEquippedCreatureCard: equippedCardSnapshot,
            mirrormindCrownOriginalTokenCreate: {
              controller,
              name,
              count: tokensToCreate,
              basePower,
              baseToughness,
              options,
            },
            options: [optionReplace, optionNormal],
          } as any);

          // Defer token creation until the step response.
          return [];
        }
      }
    }
  } catch (err) {
    debugWarn(1, '[createToken] Mirrormind Crown replacement check failed (continuing normally):', err);
  }
  
  // Build type line based on options
  let typeLine = options?.typeLine || 'Token Creature';
  if (!options?.typeLine) {
    // Auto-generate type line if not provided
    const parts = ['Token'];
    if (options?.isArtifact) parts.push('Artifact');
    parts.push('Creature');
    if (name) parts.push(`— ${name}`);
    typeLine = parts.join(' ');
  }

  const tokenAbilities = resolveCreateTokenAbilities(name, options, basePower, baseToughness);
  const tokenIsCreature = String(typeLine || '').toLowerCase().includes('creature');
  const tokenHasHaste = tokenAbilities.some((ability) => /\bhaste\b/i.test(String(ability || '')));
  
  // Get token image URLs from the token service (pass abilities for exact matching)
  const tokenSpec = buildTokenImageSpec({
    name,
    power: basePower,
    toughness: baseToughness,
    colors: options?.colors,
    abilities: tokenAbilities,
    typeLine,
    isArtifact: options?.isArtifact,
  });
  const imageUrls = getTokenImageUrls(name, basePower, baseToughness, options?.colors, tokenAbilities, options?.isArtifact);
  const syncExactPrinting = lookupExactTokenPrinting(tokenSpec);
  
  const entersTapped = !!options?.entersTapped;
  const initialCountersRaw = options?.withCounters;
  const initialCounters: Record<string, number> = {};
  if (initialCountersRaw && typeof initialCountersRaw === 'object') {
    for (const [kRaw, vRaw] of Object.entries(initialCountersRaw)) {
      const k = String(kRaw || '').trim();
      const v = Math.floor(Number(vRaw) || 0);
      if (!k || !v) continue;
      initialCounters[k] = (initialCounters[k] || 0) + v;
    }
  }

  for (let i = 0; i < Math.max(1, tokensToCreate | 0); i++) {
    const permanentId = uid("tok");
    createdPermanentIds.push(permanentId);
    const tokenPerm: any = {
      id: permanentId,
      controller,
      owner: controller,
      tapped: entersTapped,
      counters: Object.keys(initialCounters).length ? { ...initialCounters } : {},
      basePower,
      baseToughness,
      summoningSickness: tokenIsCreature && !tokenHasHaste,
      isToken: true,
      card: { 
        id: uid("card"), 
        name, 
        type_line: typeLine, 
        zone: "battlefield",
        colors: options?.colors || [],
        image_uris: syncExactPrinting?.image_uris || imageUrls,
        oracle_text: tokenAbilities.join('\n') || '',
        keywords: [...tokenAbilities],
        power: String(basePower),
        toughness: String(baseToughness),
      } as any  // Cast to any to allow keywords field
    };
    if (syncExactPrinting) {
      applyTokenPrintingToCard(tokenPerm.card, {
        image_uris: syncExactPrinting.image_uris,
        printing: syncExactPrinting,
        matchKind: 'exact',
      });
    }
    state.battlefield.push(tokenPerm);
    applyGraveyardTypeEntryCounterGrants(state, tokenPerm, String(controller));

    if (!tokenPerm.card.image_uris?.normal && !tokenPerm.card.image_uris?.small) {
      void resolveTokenPrinting(tokenSpec).then((resolved) => {
        if (resolved) applyTokenPrintingToCard(tokenPerm.card, resolved);
      });
    }

    // Fire ETB triggers (including the token's own ETBs if applicable).
    try {
      triggerETBEffectsForPermanent(ctx as any, tokenPerm, controller);
    } catch {
      // Defensive: do not block token creation.
    }
  }

  // Per-turn tracking for intervening-if templates like "if you created a token this turn".
  try {
    const stateAny = state as any;
    const key = String(controller);
    stateAny.tokensCreatedThisTurn = stateAny.tokensCreatedThisTurn || {};
    stateAny.tokensCreatedThisTurn[key] = (stateAny.tokensCreatedThisTurn[key] || 0) + createdPermanentIds.length;

    // Aliases consumed by intervening-if.
    stateAny.tokenCreatedThisTurn = stateAny.tokenCreatedThisTurn || {};
    stateAny.createdTokenThisTurn = stateAny.createdTokenThisTurn || {};
    stateAny.tokenCreatedThisTurn[key] = (stateAny.tokenCreatedThisTurn[key] || 0) + createdPermanentIds.length;
    stateAny.createdTokenThisTurn[key] = (stateAny.createdTokenThisTurn[key] || 0) + createdPermanentIds.length;
  } catch {
    // best-effort only
  }

  queueTokenCreatedTriggers(ctx, String(controller), createdPermanentIds, {
    name,
    typeLine,
  });

  if (!options?.skipEventPersistence) {
    persistCreateTokenEvents(ctx, controller, createdPermanentIds);
  }

  bumpSeq();
  runSBA(ctx);

  return createdPermanentIds;
}

function normalizeManaCostXToZero(manaCostRaw: any): string {
  const manaCost = String(manaCostRaw || '');
  if (!manaCost) return manaCost;
  return manaCost
    .replace(/\{X\}/g, '{0}')
    .replace(/\{x\}/g, '{0}')
    .replace(/\bX\b/g, '0')
    .replace(/\bx\b/g, '0');
}

export function createCopyTokensOfCard(
  ctx: GameContext,
  controller: PlayerID,
  sourceCard: any,
  count: number,
  skipMirrormindReplacement = false,
  copyTokenOverrides?: CopyTokenOverrides,
): string[] {
  const { state, bumpSeq } = ctx;
  const n = Math.max(0, Number(count || 0));
  if (!sourceCard || n <= 0) return [];

  // Do NOT re-trigger Mirrormind while creating the copies.
  if (skipMirrormindReplacement) {
    // no-op: flag consumed by caller; this helper never prompts.
  }

  const created: string[] = [];
  state.battlefield = state.battlefield || [];

  const typeLine = String(sourceCard?.type_line || '');
  const isCreature = typeLine.toLowerCase().includes('creature');
  const sourceKeywords = Array.isArray((sourceCard as any)?.keywords) ? (sourceCard as any).keywords : [];
  const sourceOracleText = String(sourceCard?.oracle_text || '');
  const overrides = copyTokenOverrides || {};
  const overrideHaste = (overrides.addAbilities || []).some(
    (ability) => String(ability).toLowerCase() === 'haste',
  );
  const hasHaste = overrideHaste
    || sourceKeywords.some((keyword: any) => /\bhaste\b/i.test(String(keyword || '')))
    || /\bhaste\b/i.test(sourceOracleText);
  const basePower = isCreature ? parsePT(sourceCard?.power) : undefined;
  const baseToughness = isCreature ? parsePT(sourceCard?.toughness) : undefined;

  const manaCost = normalizeManaCostXToZero(sourceCard?.mana_cost);
  const cardForCopy = JSON.parse(JSON.stringify(sourceCard));
  hydrateCardOracleInPlace(cardForCopy);

  for (let i = 0; i < n; i++) {
    const permanentId = uid('copytok');
    created.push(permanentId);

    const tokenPerm: any = {
      id: permanentId,
      controller,
      owner: controller,
      tapped: false,
      counters: {},
      basePower,
      baseToughness,
      summoningSickness: isCreature && !hasHaste,
      isToken: true,
      isCopyToken: true,
      ...(Object.keys(overrides).length > 0 ? { copyTokenOverrides: overrides } : {}),
      card: {
        ...cardForCopy,
        id: uid('card'),
        zone: 'battlefield',
        mana_cost: manaCost,
        isToken: true,
        isCopyOfPrintedCard: true,
      },
    };

    hydrateCardOracleInPlace(tokenPerm.card, { isToken: true, isCopyToken: true });
    if (Object.keys(overrides).length > 0) {
      applyCopyTokenOverrides(tokenPerm.card, overrides, tokenPerm);
    }
    // CR 707.2 — inherit as-enters choices when present on the copied card/permanent shell.
    copyAsEntersCopiableChoicesFromSource(sourceCard, tokenPerm);
    const inheritedType = String(tokenPerm.chosenCreatureType || '').trim();
    if (
      inheritedType
      && String(tokenPerm.card?.name || tokenPerm.name || '').toLowerCase().includes('morophon')
    ) {
      const morophonChosenType = ((state as any).morophonChosenType || {}) as Record<string, string>;
      morophonChosenType[permanentId] = inheritedType;
      (state as any).morophonChosenType = morophonChosenType;
    }

    const resolvedTypeLine = String(tokenPerm.card?.type_line || typeLine).toLowerCase();
    const resolvedIsCreature = resolvedTypeLine.includes('creature');
    const resolvedOracle = String(tokenPerm.card?.oracle_text || sourceOracleText);
    const resolvedKeywords = Array.isArray(tokenPerm.card?.keywords) ? tokenPerm.card.keywords : [];
    const resolvedHasHaste =
      resolvedKeywords.some((keyword: any) => /\bhaste\b/i.test(String(keyword || '')))
      || /\bhaste\b/i.test(resolvedOracle);
    tokenPerm.summoningSickness = resolvedIsCreature && !resolvedHasHaste;
    if (overrides.power != null) tokenPerm.basePower = overrides.power;
    if (overrides.toughness != null) tokenPerm.baseToughness = overrides.toughness;

    state.battlefield.push(tokenPerm);
    applyGraveyardTypeEntryCounterGrants(state, tokenPerm, String(controller));

    // Fire ETB triggers for the copy token.
    try {
      triggerETBEffectsForPermanent(ctx as any, tokenPerm, controller);
    } catch {
      // Defensive.
    }
  }

  // Per-turn tracking for intervening-if templates like "if you created a token this turn".
  try {
    const stateAny = state as any;
    const key = String(controller);
    stateAny.tokensCreatedThisTurn = stateAny.tokensCreatedThisTurn || {};
    stateAny.tokensCreatedThisTurn[key] = (stateAny.tokensCreatedThisTurn[key] || 0) + created.length;

    // Aliases consumed by intervening-if.
    stateAny.tokenCreatedThisTurn = stateAny.tokenCreatedThisTurn || {};
    stateAny.createdTokenThisTurn = stateAny.createdTokenThisTurn || {};
    stateAny.tokenCreatedThisTurn[key] = (stateAny.tokenCreatedThisTurn[key] || 0) + created.length;
    stateAny.createdTokenThisTurn[key] = (stateAny.createdTokenThisTurn[key] || 0) + created.length;
  } catch {
    // best-effort only
  }

  queueTokenCreatedTriggers(ctx, String(controller), created, {
    name: String(sourceCard?.name || 'Token Copy'),
    typeLine,
  });

  bumpSeq();
  runSBA(ctx);
  return created;
}
