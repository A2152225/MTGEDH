import type { PlayerID } from '../../../../shared/src/index.js';
import type { OracleEffectStep } from '../../../../rules-engine/src/oracleIR.js';
import { parseOracleTextToIR } from '../../../../rules-engine/src/oracleIRParser.js';
import type { GameContext } from '../context.js';
import { debug, debugWarn } from '../../utils/debug.js';
import { getOrCreatePlayerZones, millCardsFromLibrary } from './triggerLibraryMillUtils.js';
import { queueCastFromExileResolutionPrompt } from './triggerCastFromExileUtils.js';

export function normalizeOracleResolutionText(value: string): string {
  return String(value || '')
    .replace(/\u2019/g, "'")
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[.;:,]+$/g, '')
    .trim();
}

function shuffleForLibraryBottom<T>(items: readonly T[], rng: () => number): T[] {
  const shuffled = [...items];
  for (let idx = shuffled.length - 1; idx > 0; idx -= 1) {
    const swapIdx = Math.floor(Math.max(0, Math.min(0.999999, rng())) * (idx + 1));
    [shuffled[idx], shuffled[swapIdx]] = [shuffled[swapIdx], shuffled[idx]];
  }
  return shuffled;
}

function moveCardsToLibraryBottom(stateAny: any, playerId: PlayerID, cards: readonly any[], rng: () => number): number {
  if (!Array.isArray(cards) || cards.length === 0) return 0;
  const zones = getOrCreatePlayerZones(stateAny, playerId);
  const shuffled = shuffleForLibraryBottom(cards, rng).map(card => ({ ...card, zone: 'library' }));
  zones.library.push(...shuffled);
  zones.libraryCount = zones.library.length;
  return shuffled.length;
}

export interface SupplementalOracleIRSpellOptions {
  readonly targetPlayerId?: PlayerID;
  readonly referenceSpellName?: string;
  readonly sourceImage?: string;
  readonly skipRawSteps?: readonly string[];
}

/**
 * Ad-hoc Oracle IR resolution for spell riders not covered by categorizeSpell / IR primary.
 */
export function applySupplementalOracleIRForResolvedSpell(
  ctx: GameContext,
  oracleText: string,
  caster: PlayerID,
  spellName: string,
  sourcePermanentId?: string,
  sourceId?: string,
  options?: SupplementalOracleIRSpellOptions,
): number {
  void caster;
  void sourcePermanentId;

  try {
    const text = String(oracleText || '').trim();
    if (!text) return 0;

    const ir = parseOracleTextToIR(text, spellName);
    const steps: OracleEffectStep[] = [];
    for (const ability of ir.abilities || []) {
      for (const step of ability.steps || []) steps.push(step as any);
    }

    if (steps.length === 0) return 0;

    const stateAny: any = (ctx as any).state;
    const gameId = String((ctx as any).gameId || '').trim();
    const isReplaying = Boolean((ctx as any).isReplaying);
    const rng = typeof (ctx as any).rng === 'function' ? () => Number((ctx as any).rng()) || 0 : () => Math.random();
    const skippedRawSteps = new Set(
      (options?.skipRawSteps || []).map(raw => normalizeOracleResolutionText(String(raw || ''))).filter(Boolean),
    );
    const referenceSpellName = normalizeOracleResolutionText(String(options?.referenceSpellName || ''));
    let lastNumericResult: number | null = null;
    let applied = 0;
    const randomChoiceTextMatch = text.match(/\bchoose\s+(\d+)\s*,\s*(\d+)\s*,\s*or\s+(\d+)\s+at\s+random\b/i);
    const chooseRandomNumberIfNeeded = (): boolean => {
      if (lastNumericResult !== null) return true;
      if (!randomChoiceTextMatch) return false;

      const choices = randomChoiceTextMatch
        .slice(1)
        .map(value => Number.parseInt(String(value || ''), 10))
        .filter(Number.isFinite);
      if (choices.length === 0) return false;

      const choiceIndex = Math.floor(Math.max(0, Math.min(0.999999, rng())) * choices.length);
      lastNumericResult = choices[Math.min(choiceIndex, choices.length - 1)] ?? null;
      if (lastNumericResult === null) return false;

      debug(2, `[oracleIR] ${spellName}: chose ${lastNumericResult} at random`);
      applied += 1;
      return true;
    };

    for (const step of steps) {
      if (!step) continue;

      if (step.kind === 'unknown') {
        const normalized = normalizeOracleResolutionText(String((step as any).raw || ''));
        if (!normalized || skippedRawSteps.has(normalized)) continue;

        const randomChoiceMatch = normalized.match(/^choose\s+(\d+)\s*,\s*(\d+)\s*,\s*or\s+(\d+)\s+at\s+random$/i);
        if (randomChoiceMatch) {
          const choices = randomChoiceMatch.slice(1).map(value => Number.parseInt(String(value || ''), 10)).filter(Number.isFinite);
          if (choices.length > 0) {
            const choiceIndex = Math.floor(Math.max(0, Math.min(0.999999, rng())) * choices.length);
            lastNumericResult = choices[Math.min(choiceIndex, choices.length - 1)] ?? null;
            if (lastNumericResult !== null) {
              debug(2, `[oracleIR] ${spellName}: chose ${lastNumericResult} at random`);
              applied += 1;
            }
          }
          continue;
        }

        const millsThatMany = /^(?:its controller|that player|they|he or she|target player|target opponent|that opponent)\s+mills?\s+that many cards$/i.test(normalized);
        if (millsThatMany && options?.targetPlayerId && lastNumericResult && lastNumericResult > 0) {
          const milled = millCardsFromLibrary(stateAny, options.targetPlayerId, lastNumericResult, ctx);
          if (milled > 0) {
            debug(2, `[oracleIR] ${spellName}: ${options.targetPlayerId} milled ${milled} card(s)`);
            if (typeof (ctx as any).bumpSeq === 'function') {
              (ctx as any).bumpSeq();
            }
            applied += 1;
          }
          continue;
        }

        continue;
      }

      const millStep = step as any;
      const millsThatManyStep =
        millStep.kind === 'mill' &&
        normalizeOracleResolutionText(String(millStep?.amount?.raw || '')) === 'that many';
      if (millsThatManyStep && options?.targetPlayerId && chooseRandomNumberIfNeeded() && lastNumericResult && lastNumericResult > 0) {
        const milled = millCardsFromLibrary(stateAny, options.targetPlayerId, lastNumericResult, ctx);
        if (milled > 0) {
          debug(2, `[oracleIR] ${spellName}: ${options.targetPlayerId} milled ${milled} card(s)`);
          if (typeof (ctx as any).bumpSeq === 'function') {
            (ctx as any).bumpSeq();
          }
          applied += 1;
        }
        continue;
      }

      if (step.kind !== 'impulse_exile_top') continue;
      if (!options?.targetPlayerId || !referenceSpellName) continue;

      const amountRaw = normalizeOracleResolutionText(String((step as any)?.amount?.raw || ''));
      const identityExilePattern =
        amountRaw === 'until they exile a nonland card with a different name than that spell' ||
        amountRaw === 'until you exile a nonland card with a different name than that spell';
      if (!identityExilePattern) continue;

      const playerId = options.targetPlayerId;
      const zones = getOrCreatePlayerZones(stateAny, playerId);
      const exiledThisWay: any[] = [];
      let hitCard: any | null = null;

      while (zones.library.length > 0) {
        const card = zones.library.shift();
        if (!card) break;
        const exiledCard = { ...card, zone: 'exile', exiledBy: spellName };
        exiledThisWay.push(exiledCard);

        const typeLine = normalizeOracleResolutionText(String(card?.type_line || ''));
        const cardName = normalizeOracleResolutionText(String(card?.name || ''));
        if (!typeLine.includes('land') && cardName && cardName !== referenceSpellName) {
          hitCard = exiledCard;
          break;
        }
      }

      zones.libraryCount = zones.library.length;

      if (hitCard) {
        const rest = exiledThisWay.filter(card => String(card?.id || '') !== String(hitCard?.id || ''));
        if (rest.length > 0) {
          moveCardsToLibraryBottom(stateAny, playerId, rest, rng);
        }

        const queuedExileCard = {
          ...hitCard,
          canBePlayedBy: playerId,
          playableUntilTurn: Number(stateAny.turnNumber ?? 0),
          withoutPayingManaCost: true,
        };
        zones.exile.push(queuedExileCard);
        zones.exileCount = zones.exile.length;

        if (gameId && gameId !== 'unknown' && !isReplaying) {
          queueCastFromExileResolutionPrompt(
            ctx,
            gameId,
            playerId,
            spellName,
            sourceId,
            options?.sourceImage,
            queuedExileCard,
          );
        }

        debug(
          2,
          `[oracleIR] ${spellName}: exiled until ${playerId} hit ${queuedExileCard.name}; ${rest.length} other card(s) moved to the bottom`,
        );
      } else if (exiledThisWay.length > 0) {
        const returned = moveCardsToLibraryBottom(stateAny, playerId, exiledThisWay, rng);
        debug(2, `[oracleIR] ${spellName}: no qualifying exile hit for ${playerId}; returned ${returned} card(s) to the bottom`);
      }

      if (typeof (ctx as any).bumpSeq === 'function') {
        (ctx as any).bumpSeq();
      }
      applied += 1;
    }

    return applied;
  } catch (err) {
    debugWarn(1, `[oracleIR] Failed supplemental resolution for ${spellName}:`, err);
    return 0;
  }
}
