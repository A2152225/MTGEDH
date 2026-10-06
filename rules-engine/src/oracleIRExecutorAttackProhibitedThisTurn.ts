/**
 * Origin parent: oracleIRExecutorBattlefieldGrantStaticAbilityStep.ts
 * Cluster: this-turn "creatures <player> control(s) can't attack <you / Xs you control>"
 *   (Jace, Multiverse Architect: "If they don't, creatures they control can't attack
 *   Jaces you control this turn."). Stamps state.lastingEffects attackProhibitedThisTurn,
 *   which server attack legality enforces; cleanup expires this_turn entries.
 *   Taxes ("... unless its controller pays") stay in oracleIRExecutorAttackTaxThisTurn.
 * Public: tryApplyAttackProhibitedThisTurnGrant, parseAttackProhibitedThisTurnText
 * Leaf must not import oracleIRExecutorMainLoop.ts or oracleIRExecutorBattlefieldStepHandlers.ts.
 */

import type { GameState } from '../../shared/src';
import type { OracleEffectStep, OraclePlayerSelector } from './oracleIR';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';
import type { BattlefieldStepHandlerResult } from './oracleIRExecutorBattlefieldStepTypes';
import { resolvePlayers } from './oracleIRExecutorPlayerResolvePlayers';

export const ATTACK_PROHIBITED_THIS_TURN = 'attackProhibitedThisTurn';

export interface AttackProhibitedThisTurnText {
  /** "can't attack you" - the source controller can't be attacked. */
  readonly protectsPlayer: boolean;
  /** Singular lowercase type/subtype words of protected permanents ("jace", "planeswalker"). */
  readonly protectedPermanentTypes: readonly string[];
}

function normalize(text: string): string {
  return String(text || '').replace(/[\u2018\u2019]/g, "'").trim().toLowerCase();
}

function singularizeTypeWord(word: string): string | null {
  const w = word.trim();
  if (!/^[a-z][a-z'-]*$/.test(w)) return null;
  if (/(ches|shes|sses|xes)$/.test(w)) return w.slice(0, -2);
  if (w.endsWith('ies')) return `${w.slice(0, -3)}y`;
  if (w.endsWith('s') && !w.endsWith('ss')) return w.slice(0, -1);
  return null;
}

/**
 * Parses "can't attack <protected> this turn" where protected is "you", "<Xs> you control",
 * or a list of those ("you or planeswalkers you control", "Jaces and battles you control").
 */
export function parseAttackProhibitedThisTurnText(effectText: string): AttackProhibitedThisTurnText | null {
  const text = normalize(effectText).replace(/\.+$/, '');
  if (/\bunless\b/.test(text)) return null;
  const match = text.match(/^can(?:not|'t)\s+attack\s+(.+?)\s+this\s+turn$/);
  if (!match) return null;

  let phrase = String(match[1] || '').trim();
  const sharedYouControl = /\s+you\s+control$/.test(phrase);
  if (sharedYouControl) phrase = phrase.replace(/\s+you\s+control$/, '');
  const items = phrase
    .split(/\s*,\s*(?:or\s+|and\s+)?|\s+or\s+|\s+and\s+/)
    .map((item) => item.replace(/\s+you\s+control$/, '').trim())
    .filter(Boolean);
  if (items.length === 0) return null;

  let protectsPlayer = false;
  const types: string[] = [];
  for (const item of items) {
    if (item === 'you') {
      protectsPlayer = true;
      continue;
    }
    if (!sharedYouControl) return null;
    const singular = singularizeTypeWord(item);
    if (!singular) return null;
    types.push(singular);
  }
  return { protectsPlayer, protectedPermanentTypes: types };
}

function grantEffectText(step: Extract<OracleEffectStep, { kind: 'grant_static_ability' }>): string {
  return [
    ...(Array.isArray(step.effectText) ? step.effectText : []),
    ...(Array.isArray(step.abilities) ? step.abilities : []),
  ]
    .map((entry) => String(entry || '').trim())
    .filter(Boolean)
    .join(' ');
}

/** "creatures they control" -> whose creatures are restricted. */
function attackerPlayerSelector(targetText: string): OraclePlayerSelector | null {
  const text = normalize(targetText);
  const match = text.match(/^creatures\s+(.+?)\s+controls?$/);
  if (!match) return null;
  const who = String(match[1] || '').trim();
  if (who === 'they' || who === 'that player' || who === 'target player' || who === 'defending player') {
    return { kind: 'target_player' };
  }
  if (who === 'target opponent' || who === 'that opponent') return { kind: 'target_opponent' };
  if (who === 'your opponents' || who === 'each opponent' || who === 'opponents') return { kind: 'each_opponent' };
  return null;
}

function currentTurnNumber(state: GameState): number {
  const turn = Number((state as { turnNumber?: number; turn?: number }).turnNumber
    ?? (state as { turn?: number }).turn
    ?? 0);
  return Number.isFinite(turn) ? turn : 0;
}

export function tryApplyAttackProhibitedThisTurnGrant(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'grant_static_ability' }>,
  ctx: OracleIRExecutionContext,
): BattlefieldStepHandlerResult | null {
  const duration = String(step.duration || 'static').trim();
  if (duration !== 'static' && duration !== 'this_turn') return null;

  const rawEffect = grantEffectText(step);
  const effectText = duration === 'this_turn' && !/\bthis turn\b/i.test(rawEffect)
    ? `${rawEffect} this turn`
    : rawEffect;
  const parsed = parseAttackProhibitedThisTurnText(effectText);
  if (!parsed) return null;

  const targetText = String((step.target as { text?: string; raw?: string } | undefined)?.text
    || (step.target as { raw?: string } | undefined)?.raw
    || '');
  const selector = attackerPlayerSelector(targetText);
  if (!selector) return null;

  const protectedController = String(ctx.controllerId || '').trim();
  const attackerControllers = resolvePlayers(state, selector, ctx)
    .map((id) => String(id || '').trim())
    .filter((id) => id && id !== protectedController);
  if (attackerControllers.length === 0) {
    return {
      applied: false,
      message: `Skipped this-turn attack restriction (affected player unknown): ${step.raw}`,
      reason: 'player_choice_required',
      options: { classification: 'player_choice' },
    };
  }

  const currentLastingEffects = (state as unknown as { lastingEffects?: unknown }).lastingEffects;
  const existing: unknown[] = Array.isArray(currentLastingEffects) ? [...currentLastingEffects] : [];
  const turnApplied = currentTurnNumber(state);
  const source = String(ctx.sourceName || '').trim() || 'An effect';
  const sourceId = String(ctx.sourceId || '').trim() || undefined;
  for (const attackerController of attackerControllers) {
    existing.push({
      type: ATTACK_PROHIBITED_THIS_TURN,
      duration: 'this_turn',
      attackerController,
      protectedController,
      protectsPlayer: parsed.protectsPlayer,
      protectedPermanentTypes: [...parsed.protectedPermanentTypes],
      source,
      ...(sourceId ? { sourceId } : {}),
      turnApplied,
    });
  }

  const protectedLabel = [
    ...(parsed.protectsPlayer ? ['you'] : []),
    ...parsed.protectedPermanentTypes.map((type) => `${type}s you control`),
  ].join(' or ');
  return {
    applied: true,
    state: { ...(state as object), lastingEffects: existing } as unknown as GameState,
    log: [`Creatures controlled by ${attackerControllers.join(', ')} can't attack ${protectedLabel} this turn (${source})`],
  };
}