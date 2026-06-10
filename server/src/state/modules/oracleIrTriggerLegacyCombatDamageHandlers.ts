import type { PlayerID } from '../../../../shared/src/index.js';
import type { GameContext } from '../context.js';
import { drawCards as drawCardsFromZone } from './zones.js';
import { debug } from '../../utils/debug.js';
import { broadcastGame } from '../../socket/util.js';
import { modifyTriggerEffectLife } from './triggerLifeDamageUtils.js';
import { queueOptionalPaymentStep } from '../../socket/optional-payment-prompts.js';

function getCombatDamagedPlayerIds(state: any): string[] {
  const tracker = state?.creaturesThatDealtDamageToPlayer;
  if (!tracker || typeof tracker !== 'object') return [];

  return Object.entries(tracker)
    .filter(([, entry]) => entry && typeof entry === 'object' && Object.keys(entry as any).length > 0)
    .map(([playerId]) => String(playerId));
}

function countOpponentsDealtCombatDamageThisTurn(state: any, controller: PlayerID): number {
  const players = Array.isArray(state?.players) ? state.players : [];
  const opponentIds = new Set(
    players
      .map((player: any) => String(player?.id || ''))
      .filter((playerId: string) => playerId && playerId !== String(controller)),
  );

  return getCombatDamagedPlayerIds(state).filter((playerId) => opponentIds.has(playerId)).length;
}

function countPlayersDealtCombatDamageThisTurn(state: any): number {
  return getCombatDamagedPlayerIds(state).length;
}

function countOpponentsDealtCombatDamageBySourceOrSubtypeThisTurn(
  state: any,
  controller: PlayerID,
  options: {
    sourcePermanentId?: string;
    sourceName?: string;
    subtype?: string;
  },
): number {
  const tracker = state?.creaturesThatDealtDamageToPlayer;
  if (!tracker || typeof tracker !== 'object') return 0;

  const battlefield = Array.isArray(state?.battlefield) ? state.battlefield : [];
  const players = Array.isArray(state?.players) ? state.players : [];
  const opponentIds = new Set(
    players
      .map((player: any) => String(player?.id || ''))
      .filter((playerId: string) => playerId && playerId !== String(controller)),
  );

  const sourcePermanentId = String(options.sourcePermanentId || '').trim();
  const sourceName = String(options.sourceName || '').trim().toLowerCase();
  const subtype = String(options.subtype || '').trim().toLowerCase();

  let count = 0;
  for (const playerId of opponentIds) {
    const entry = (tracker as any)?.[String(playerId)];
    if (!entry || typeof entry !== 'object') continue;

    const matched = Object.entries(entry as Record<string, any>).some(([creatureId, data]) => {
      const damageSourceName = String((data as any)?.creatureName || '').trim().toLowerCase();
      if (sourcePermanentId && String(creatureId) === sourcePermanentId) {
        return true;
      }
      if (sourceName && damageSourceName === sourceName) {
        return true;
      }
      if (!subtype) {
        return false;
      }

      const permanent = battlefield.find((candidate: any) => String(candidate?.id || '') === String(creatureId));
      if (!permanent || String(permanent?.controller || '') !== String(controller)) {
        return false;
      }

      const typeLine = String(permanent?.card?.type_line || '').toLowerCase();
      return typeLine.includes(subtype);
    });

    if (matched) {
      count += 1;
    }
  }

  return count;
}

export interface TriggerLegacyCombatDamageParams {
  readonly ctx: GameContext;
  readonly controller: PlayerID;
  readonly sourceName: string;
  readonly desc: string;
  readonly triggerItem: any;
  readonly state: any;
  readonly sourceNameLower: string;
  readonly triggerSourceNameLower: string;
}

export function applyRetiredTriggerLegacyCombatDamageDrawEffects(
  params: TriggerLegacyCombatDamageParams,
): boolean {
  if (params.desc.includes('draw cards equal to the number of opponents who were dealt combat damage this turn')) {
    const drawCount = countOpponentsDealtCombatDamageThisTurn(params.state, params.controller);
    if (drawCount > 0) {
      drawCardsFromZone(params.ctx, params.controller, drawCount);
      debug(2, `[executeTriggerEffect] ${params.sourceName}: ${params.controller} draws ${drawCount} card(s) based on opponents dealt combat damage this turn`);
    }
    return true;
  }

  if (params.desc.includes('draw a card for each player who was dealt combat damage this turn')) {
    const drawCount = countPlayersDealtCombatDamageThisTurn(params.state);
    if (drawCount > 0) {
      drawCardsFromZone(params.ctx, params.controller, drawCount);
      debug(2, `[executeTriggerEffect] ${params.sourceName}: ${params.controller} draws ${drawCount} card(s) based on players dealt combat damage this turn`);
    }
    return true;
  }

  const combatDamageXMatch = params.desc.match(/draw x cards and lose x life, where x is the number of your opponents who were dealt combat damage by (.+) this turn/);
  if (combatDamageXMatch) {
    const clause = String(combatDamageXMatch[1] || '').trim();
    const parts = clause.split(/\s+or\s+/).map((part) => part.trim()).filter(Boolean);
    let subtype = '';
    const includesSource = parts.some((part) => part === params.sourceNameLower || part === params.triggerSourceNameLower);

    for (const part of parts) {
      const subtypeMatch = part.match(/^a[n]?\s+([a-z-]+)$/i);
      if (subtypeMatch) {
        subtype = String(subtypeMatch[1] || '').trim().toLowerCase();
        break;
      }
    }

    const drawCount = countOpponentsDealtCombatDamageBySourceOrSubtypeThisTurn(params.state, params.controller, {
      sourcePermanentId: includesSource ? String(params.triggerItem?.source || params.triggerItem?.permanentId || '') : '',
      sourceName: includesSource ? params.sourceNameLower : '',
      subtype,
    });

    if (drawCount > 0) {
      drawCardsFromZone(params.ctx, params.controller, drawCount);
      modifyTriggerEffectLife(params.state, String(params.controller), -drawCount);
      debug(2, `[executeTriggerEffect] ${params.sourceName}: ${params.controller} draws ${drawCount} card(s) and loses ${drawCount} life based on combat damage tracking`);
    }
    return true;
  }

  if (
    params.desc.includes('you may pay x life')
    && params.desc.includes('where x is the number of opponents that were dealt combat damage this turn')
    && params.desc.includes('if you do, draw x cards')
  ) {
    const drawCount = countOpponentsDealtCombatDamageThisTurn(params.state, params.controller);
    if (drawCount <= 0) {
      return true;
    }

    const gameId = String((params.ctx as any).gameId || (params.ctx as any).id || params.triggerItem?.gameId || '').trim();
    if (!gameId || gameId === 'unknown' || (params.ctx as any).isReplaying) {
      return true;
    }

    queueOptionalPaymentStep(gameId, {
      playerId: params.controller,
      sourceName: params.sourceName,
      sourceId: String(params.triggerItem?.source || params.triggerItem?.permanentId || '').trim() || undefined,
      description: `${params.sourceName}: You may pay ${drawCount} life. If you do, draw ${drawCount} card${drawCount === 1 ? '' : 's'}.`,
      mandatory: true,
      payChoiceId: 'pay_life',
      payLabel: `Pay ${drawCount} life`,
      payDescription: `Pay ${drawCount} life and draw ${drawCount} card${drawCount === 1 ? '' : 's'}.`,
      declineChoiceId: 'decline',
      declineLabel: 'Decline',
      declineDescription: 'Do not pay life or draw cards.',
      validationKind: 'life',
      lifeAmount: drawCount,
      stepData: {
        tymnaCombatDamageDraw: true,
        tymnaDrawCount: drawCount,
        cardName: params.sourceName,
      },
      onPay: async () => {
        modifyTriggerEffectLife(params.state, String(params.controller), -drawCount);
        drawCardsFromZone(params.ctx, params.controller, drawCount);
        if (typeof (params.ctx as any).bumpSeq === 'function') {
          (params.ctx as any).bumpSeq();
        }
        const io = (params.ctx as any).io;
        if (io) {
          broadcastGame(io as any, params.ctx as any, gameId);
        }
      },
      onDecline: async () => {
        if (typeof (params.ctx as any).bumpSeq === 'function') {
          (params.ctx as any).bumpSeq();
        }
        const io = (params.ctx as any).io;
        if (io) {
          broadcastGame(io as any, params.ctx as any, gameId);
        }
      },
    });
    return true;
  }

  return false;
}
