/**
 * Origin parent: oracleIRExecutorBattlefieldGrantStaticAbilityStep.ts
 * Cluster: until-your-next-turn grant_static_ability
 *   “can't be attacked except by creatures with …” stamps state.lastingEffects
 *   attackYouProhibitedExceptKeywords. Idle Island Sanctuary is not a
 *   continuous StaticEffectSpec. Expiry uses removeExpiredUntilNextTurnEffects.
 * Public: tryApplyAttackYouProhibitedExceptKeywordsGrant
 * Leaf must not import oracleIRExecutorMainLoop.ts or oracleIRExecutorBattlefieldStepHandlers.ts.
 */

import type { GameState } from '../../shared/src';
import type { OracleEffectStep, OraclePlayerSelector } from './oracleIR';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';
import type { BattlefieldStepHandlerResult } from './oracleIRExecutorBattlefieldStepTypes';
import { resolvePlayers } from './oracleIRExecutorPlayerResolvePlayers';
import { parsePlayerSelector } from './oracleIRParserUtils';

const UNTIL_NEXT_TURN_DURATIONS = new Set(['until_next_turn', 'until_your_next_turn']);
const STAMP_TYPE = 'attackYouProhibitedExceptKeywords';

const EXCEPT_KEYWORDS_RE =
  /can(?:not|'t|’t)\s+be\s+attacked\s+except\s+by\s+creatures\s+with\s+(.+)/i;

function grantEffectText(step: Extract<OracleEffectStep, { kind: 'grant_static_ability' }>): string {
  return [
    ...(Array.isArray(step.effectText) ? step.effectText : []),
    ...(Array.isArray(step.abilities) ? step.abilities : []),
  ]
    .map((entry) => String(entry || '').trim().toLowerCase())
    .filter(Boolean)
    .join(' ');
}

function parseExceptKeywordList(raw: string): string[] {
  return String(raw || '')
    .replace(/\.+$/, '')
    .split(/\s*(?:,\s*(?:and\/or|and|or)\s+|and\/or|\s+or\s+|\s+and\s+|,\s+)\s*/i)
    .map((part) => part.trim().toLowerCase())
    .filter((part) => /^[a-z][a-z\s]*$/.test(part));
}

function playerSelectorFromGrantTarget(
  target: Extract<OracleEffectStep, { kind: 'grant_static_ability' }>['target'],
): OraclePlayerSelector | null {
  const text = String((target as { text?: string; raw?: string } | undefined)?.text
    || (target as { raw?: string } | undefined)?.raw
    || '')
    .replace(/\u2019/g, "'")
    .trim()
    .toLowerCase();
  if (!text) return null;
  const selector = parsePlayerSelector(text);
  if (selector.kind === 'unknown') return null;
  return selector;
}

export function tryApplyAttackYouProhibitedExceptKeywordsGrant(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'grant_static_ability' }>,
  ctx: OracleIRExecutionContext,
): BattlefieldStepHandlerResult | null {
  const duration = String(step.duration || 'static').trim();
  if (!UNTIL_NEXT_TURN_DURATIONS.has(duration)) return null;

  const effectText = grantEffectText(step);
  const exceptMatch = effectText.match(EXCEPT_KEYWORDS_RE);
  if (!exceptMatch) return null;

  const keywords = parseExceptKeywordList(String(exceptMatch[1] || ''));
  if (keywords.length === 0) return null;

  const selector = playerSelectorFromGrantTarget(step.target);
  if (!selector) return null;

  const playerIds = resolvePlayers(state, selector, ctx);
  const targetText = String((step.target as { text?: string } | undefined)?.text || '').trim();
  if (playerIds.length === 0 && /^target\b/i.test(targetText)) {
    return {
      applied: false,
      message: `Skipped until-next-turn attack-you lock (needs player choice): ${step.raw}`,
      reason: 'player_choice_required',
      options: { classification: 'player_choice' },
    };
  }

  if (playerIds.length === 0) {
    return {
      applied: true,
      state,
      log: [`Skipped until-next-turn attack-you lock (no affected players): ${step.raw}`],
    };
  }

  const existing = Array.isArray(state.lastingEffects)
    ? [...state.lastingEffects]
    : [];
  const sourceName = String(ctx.sourceName || '').trim();
  const source = sourceName || 'Until-next-turn lock';
  const controllerId = String(ctx.controllerId || playerIds[0] || '').trim();
  const turnApplied = Number(
    (state as { turnNumber?: number; turn?: number }).turnNumber
      ?? (state as { turn?: number }).turn
      ?? 0,
  ) || 0;
  const nextEffects = [...existing];
  for (const playerId of playerIds) {
    const alreadyStamped = nextEffects.some((entry) => {
      const effect = entry as { type?: string; targetPlayer?: string; keywords?: unknown };
      if (effect?.type !== STAMP_TYPE) return false;
      if (String(effect?.targetPlayer || '') !== String(playerId)) return false;
      const existingKeywords = Array.isArray(effect.keywords)
        ? effect.keywords.map((keyword) => String(keyword || '').toLowerCase()).join('|')
        : '';
      return existingKeywords === keywords.join('|');
    });
    if (alreadyStamped) continue;
    nextEffects.push({
      type: STAMP_TYPE,
      duration: 'until_next_turn',
      targetPlayer: playerId,
      keywords,
      source,
      controllerId,
      turnApplied,
    });
  }

  return {
    applied: true,
    state: {
      ...state,
      lastingEffects: nextEffects,
    },
    log: [`Stamped until-next-turn ${STAMP_TYPE} for ${playerIds.join(', ')}`],
  };
}
