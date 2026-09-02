import type { PlayerID } from '../../../../shared/src/index.js';
import type { GameContext } from '../context.js';
import { uid, triggerLifeGainEffects } from '../utils.js';
import { resolveOpponentDirectedDamage } from './game-state-effects.js';
import { applyDamageToPermanentWithCounterEffects } from './counter-common-effects.js';
import { detectCombatDamageTriggers } from './triggers/index.js';
import { isInterveningIfSatisfied } from './triggers/intervening-if.js';
import { buildTriggerSourcePermanentSnapshot } from './triggerSourceUtils.js';
import { appendEvent } from '../../db/index.js';
import { debug, debugWarn } from '../../utils/debug.js';

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function typeLineHasAllWords(typeLine: string, phrase: string): boolean {
  const tl = String(typeLine || '')
    .toLowerCase()
    .replace(/['']/g, "'")
    .replace(/—/g, ' ')
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const tokens = String(phrase || '')
    .toLowerCase()
    .split(/\s+/)
    .map((t) => t.trim())
    .filter(Boolean);
  if (!tokens.length) return true;
  return tokens.every((tok) => new RegExp(`\\b${escapeRegExp(tok)}\\b`, 'i').test(tl));
}

export function modifyTriggerEffectLife(
  state: any,
  playerId: string,
  delta: number,
): void {
  const players = state?.players || [];
  const startingLife = state?.startingLife || 40;

  if (!state.life) {
    state.life = {};
  }

  const currentLife = state.life[playerId] ?? startingLife;
  state.life[playerId] = currentLife + delta;

  const player = players.find((p: any) => p.id === playerId);
  if (player) {
    player.life = state.life[playerId];
  }

  if (delta > 0) {
    state.lifeGainedThisTurn = state.lifeGainedThisTurn || {};
    state.lifeGainedThisTurn[playerId] = Number(state.lifeGainedThisTurn[playerId] || 0) + delta;
  } else if (delta < 0) {
    state.lifeLostThisTurn = state.lifeLostThisTurn || {};
    state.lifeLostThisTurn[playerId] = Number(state.lifeLostThisTurn[playerId] || 0) + Math.abs(delta);
  }

  const action = delta > 0 ? 'gained' : 'lost';
  const amount = Math.abs(delta);
  debug(2, `[executeTriggerEffect] ${playerId} ${action} ${amount} life (${currentLife} -> ${state.life[playerId]})`);
}

export function applyTriggerOpponentDamageFromPermanent(
  ctx: GameContext,
  controller: PlayerID,
  state: any,
  battlefield: readonly any[],
  targetPlayerId: string,
  baseDamage: number,
  sourcePermanentId?: string,
): number {
  let sourceCard: any;
  if (sourcePermanentId) {
    sourceCard = battlefield.find((p: any) => String(p?.id) === String(sourcePermanentId))?.card;
  }
  const ctxForDamage = (ctx as any).state ? ctx : ({ ...(ctx as any), state } as GameContext);
  const resolved = resolveOpponentDirectedDamage(ctxForDamage, {
    sourceControllerId: String(controller || ''),
    targetPlayerId: String(targetPlayerId || ''),
    damageAmount: baseDamage,
    sourceCard,
    sourcePermanentId,
  });
  const actualDamage = Math.max(0, Number(resolved.damageDealt) || 0);
  if (actualDamage > 0) {
    modifyTriggerEffectLife(state, targetPlayerId, -actualDamage);
    try {
      state.damageTakenThisTurnByPlayer = state.damageTakenThisTurnByPlayer || {};
      state.damageTakenThisTurnByPlayer[targetPlayerId] =
        (state.damageTakenThisTurnByPlayer[targetPlayerId] || 0) + actualDamage;
    } catch {
      /* best-effort */
    }
  }
  return actualDamage;
}

const EACH_OPPONENT_DAMAGE_PATTERN = /deals? (\d+) damage to each opponent/i;

/**
 * Generic "deals N damage to each opponent" trigger clause.
 * Routes through resolveOpponentDirectedDamage so prevent-and-mill replacements apply.
 */
export function tryApplyEachOpponentDamageTrigger(
  ctx: GameContext,
  controller: PlayerID,
  description: string,
  sourcePermanentId?: string,
): number {
  const match = String(description || '').match(EACH_OPPONENT_DAMAGE_PATTERN);
  if (!match) return 0;
  const amount = Math.max(0, parseInt(match[1], 10) || 0);
  if (amount <= 0) return 0;

  const state = (ctx as any).state;
  const battlefield = Array.isArray(state?.battlefield) ? state.battlefield : [];
  const opponents = (Array.isArray(state?.players) ? state.players : [])
    .map((player: any) => String(player?.id || '').trim())
    .filter((id: string) => id && id !== String(controller || ''));
  if (opponents.length === 0) return 0;

  for (const opponentId of opponents) {
    applyTriggerOpponentDamageFromPermanent(
      ctx,
      controller,
      state,
      battlefield,
      opponentId,
      amount,
      sourcePermanentId,
    );
  }
  const gainMatch = String(description || '').match(/you gain (\d+) life/i);
  if (gainMatch) {
    applyTriggerLifeGain(
      state,
      String(controller || ''),
      Math.max(0, parseInt(gainMatch[1], 10) || 0),
      'each-opponent-damage rider',
    );
  }
  // Same-clause rider: "put a +1/+1 counter on ~ and it deals N damage to each opponent".
  if (
    sourcePermanentId
    && /\bput a \+1\/\+1 counter on (?!target\b)/i.test(String(description || ''))
  ) {
    const source = battlefield.find((permanent: any) => String(permanent?.id || '') === String(sourcePermanentId));
    if (source) {
      source.counters = source.counters && typeof source.counters === 'object' ? source.counters : {};
      source.counters['+1/+1'] = Number(source.counters['+1/+1'] || 0) + 1;
    }
  }
  return opponents.length;
}

const TARGETED_DAMAGE_PATTERN =
  /\bdeals? (\d+) damage to (?:any )?target(?: creature| player| opponent| permanent)?(?:\b|$)/i;
const THAT_PLAYER_DAMAGE_PATTERN = /\bdeals? (\d+) damage to that player\b/i;

function collectEffectTargetIds(triggerItem: any): string[] {
  const raw = triggerItem?.targets;
  if (Array.isArray(raw)) {
    return raw
      .map((entry: any) => (typeof entry === 'string' ? entry : String(entry?.id || '')))
      .map((id: string) => id.trim())
      .filter(Boolean);
  }
  const single = String(raw || triggerItem?.targetId || '').trim();
  return single ? [single] : [];
}

function isPlayerTargetId(state: any, id: string): boolean {
  if (!id) return false;
  const players = Array.isArray(state?.players) ? state.players : [];
  if (players.some((player: any) => String(player?.id || '') === id)) return true;
  if (state?.life && Object.prototype.hasOwnProperty.call(state.life, id)) return true;
  return false;
}

function notePermanentDamageThisTurn(permanent: any, amount: number): void {
  if (!permanent || amount <= 0) return;
  permanent.damageThisTurn = Number(permanent.damageThisTurn || 0) + amount;
  permanent.tookDamageThisTurn = true;
}

/**
 * Generic "deals N damage to target / any target / that player" trigger or
 * activated-ability clause. Used when IR trigger primary is off.
 */
export function tryApplyTargetedDamageFromEffectText(
  ctx: GameContext,
  controller: PlayerID,
  description: string,
  triggerItem?: any,
): boolean {
  const text = String(description || '').replace(/\s+/g, ' ').trim();
  if (!text || /to each opponent/i.test(text)) return false;

  const thatPlayerMatch = text.match(THAT_PLAYER_DAMAGE_PATTERN);
  const targetedMatch = !thatPlayerMatch ? text.match(TARGETED_DAMAGE_PATTERN) : null;
  const amount = Math.max(0, parseInt(String(thatPlayerMatch?.[1] || targetedMatch?.[1] || ''), 10) || 0);
  if (amount <= 0) return false;

  const state = (ctx as any).state;
  if (!state) return false;
  const battlefield = Array.isArray(state.battlefield) ? state.battlefield : [];
  const sourcePermanentId = String(
    triggerItem?.source || triggerItem?.permanentId || triggerItem?.sourceId || '',
  ).trim();
  const targetIds = collectEffectTargetIds(triggerItem);
  const thatPlayerId = String(
    triggerItem?.targetPlayer
    || triggerItem?.thatPlayerId
    || triggerItem?.effectData?.shuffledPlayerId
    || triggerItem?.effectData?.thatPlayerId
    || triggerItem?.effectData?.payingPlayerId
    || '',
  ).trim();

  const playerIds = new Set<string>();
  const permanentIds = new Set<string>();
  const qualifier = String(targetedMatch?.[0] || '').toLowerCase();
  const playersOnly = Boolean(thatPlayerMatch) || /\btarget player\b|\btarget opponent\b/.test(qualifier);
  const permanentsOnly = /\btarget creature\b|\btarget permanent\b/.test(qualifier);

  if (thatPlayerId && isPlayerTargetId(state, thatPlayerId)) {
    playerIds.add(thatPlayerId);
  }
  for (const id of targetIds) {
    if (!permanentsOnly && isPlayerTargetId(state, id)) playerIds.add(id);
    else if (!playersOnly) permanentIds.add(id);
  }

  let applied = false;
  for (const playerId of playerIds) {
    const dealt = applyTriggerOpponentDamageFromPermanent(
      ctx,
      controller,
      state,
      battlefield,
      playerId,
      amount,
      sourcePermanentId || undefined,
    );
    if (dealt > 0 && sourcePermanentId) {
      queueDealsDamageToPlayerTriggersFromPermanent(ctx, sourcePermanentId, playerId, dealt);
    }
    if (dealt > 0) applied = true;
  }

  for (const permanentId of permanentIds) {
    const permanent = battlefield.find((entry: any) => String(entry?.id || '') === permanentId);
    if (!permanent) continue;
    const result = applyDamageToPermanentWithCounterEffects(permanent, amount, 'damageMarked', {
      state,
      sourceId: sourcePermanentId || undefined,
      targetPlayerId: String(permanent.controller || ''),
    });
    if (result.prevented || result.appliedAmount <= 0) continue;
    notePermanentDamageThisTurn(permanent, result.appliedAmount);
    applied = true;
  }

  return applied;
}

export function getTriggerEffectHandSize(state: any, playerId: string): number {
  const zone = state?.zones?.[playerId];
  if (!zone) return 0;
  if (Array.isArray(zone.hand)) return zone.hand.length;
  return Math.max(0, Number(zone.handCount || 0));
}

export function applyTriggerLifeGain(
  state: any,
  playerId: string,
  amount: number,
  reason: string,
): void {
  if (!Number.isFinite(amount) || amount <= 0) return;
  modifyTriggerEffectLife(state, playerId, amount);
  try {
    triggerLifeGainEffects(state, playerId, amount);
  } catch {
    // Best-effort follow-up triggers should not block the life gain.
  }
  debug(2, `[executeTriggerEffect] ${reason}: ${playerId} gains ${amount} life`);
}

export function queueDealsDamageToPlayerTriggersFromPermanent(
  ctx: GameContext,
  sourcePermanentId: string,
  damagedPlayerId: string,
  damageAmount = 0,
): void {
  const state = (ctx as any).state;
  const battlefield = state?.battlefield || [];
  const sourcePerm = battlefield.find((p: any) => p?.id === sourcePermanentId);
  if (!sourcePerm?.card) return;
  if (Math.max(0, Number(damageAmount) || 0) <= 0) return;

  const triggers = detectCombatDamageTriggers(sourcePerm.card, sourcePerm, state);
  const damageToPlayerTriggers = triggers.filter((t: any) => t?.triggerType === 'deals_damage' && !t?.batched);
  if (damageToPlayerTriggers.length === 0) return;

  state.stack = state.stack || [];

  for (const trigger of damageToPlayerTriggers) {
    const text = String(trigger.description || trigger.effect || '').trim();
    if (!text) continue;

    try {
      const synthetic = `Whenever ~ deals damage to a player, ${text}`;
      const needsThatPlayerRef = /\bthat player\b/i.test(synthetic);

      const sourceTypeLine = String(sourcePerm?.card?.type_line || '').toLowerCase();
      const damageIncludedWarriorSource = typeLineHasAllWords(sourceTypeLine, 'warrior');
      const damageSourcePermanentIds = [String(sourcePerm.id)];

      const refs: any = {
        damageSourcePermanentIds,
        damageSourceCreatureIds: damageSourcePermanentIds,
        damageSourceIds: damageSourcePermanentIds,
        damageIncludedWarriorSource,
      };
      if (needsThatPlayerRef) {
        refs.thatPlayerId = String(damagedPlayerId);
        refs.referencedPlayerId = String(damagedPlayerId);
        refs.theirPlayerId = String(damagedPlayerId);
      }
      const ok = isInterveningIfSatisfied(
        ctx as any,
        String(sourcePerm.controller),
        synthetic,
        sourcePerm,
        refs,
      );
      if (ok === false) continue;
    } catch {
      // Conservative fallback: keep the trigger.
    }

    const triggerId = uid('trigger');
    const sourcePermanentSnapshot = buildTriggerSourcePermanentSnapshot(sourcePerm);
    const damageAmountValue = Math.max(0, Number(damageAmount) || 0);
    const damageSourcePermanentIds = [String(sourcePerm.id)];
    const damageIncludedWarriorSource = typeLineHasAllWords(String(sourcePerm?.card?.type_line || '').toLowerCase(), 'warrior');
    const stackItem = {
      id: triggerId,
      type: 'triggered_ability',
      controller: sourcePerm.controller,
      source: sourcePerm.id,
      permanentId: sourcePerm.id,
      sourceName: sourcePerm.card?.name || trigger.cardName,
      description: text,
      triggerType: trigger.triggerType,
      mandatory: trigger.mandatory !== false,
      effect: trigger.effect || text,
      targets: [],
      targetPlayer: String(damagedPlayerId),
      defendingPlayer: String(damagedPlayerId),
      damageSourcePermanentIds,
      damageIncludedWarriorSource,
      effectData: {
        sourcePermanentId: String(sourcePerm.id),
        damagedPlayerId: String(damagedPlayerId),
        damageAmount: damageAmountValue,
      },
      card: sourcePerm.card,
      ...(sourcePermanentSnapshot ? { sourcePermanentSnapshot } : null),
    } as any;

    state.stack.push(stackItem);

    const gameId = String((ctx as any).gameId || '').trim();
    if (gameId && gameId !== 'unknown') {
      try {
        appendEvent(gameId, Number((ctx as any).seq?.value ?? (ctx as any).seq ?? 0), 'pushTriggeredAbility', {
          triggerId,
          sourceId: String(sourcePerm.id),
          permanentId: String(sourcePerm.id),
          sourceName: sourcePerm.card?.name || trigger.cardName,
          controllerId: sourcePerm.controller,
          description: text,
          triggerType: trigger.triggerType,
          effect: trigger.effect || text,
          mandatory: trigger.mandatory !== false,
          targetPlayer: String(damagedPlayerId),
          defendingPlayer: String(damagedPlayerId),
          damagedPlayerId: String(damagedPlayerId),
          damageAmount: damageAmountValue,
          damageSourcePermanentIds,
          damageIncludedWarriorSource,
          card: sourcePerm.card,
          ...(sourcePermanentSnapshot ? { sourcePermanentSnapshot } : null),
          effectData: stackItem.effectData,
        });
      } catch (err) {
        debugWarn(1, '[dealsDamageTrigger] Failed to persist damage-to-player trigger:', err);
      }
    }
  }
}
