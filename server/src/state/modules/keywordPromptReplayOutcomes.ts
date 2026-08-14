import type { PlayerID } from '../../../../shared/src/index.js';
import type { GameContext } from '../context.js';
import { consumeManaFromPool, getOrInitManaPool, resolveManaCostForPoolPayment } from '../../socket/util.js';
import { requeueExploitRewardTriggersOnReplay } from './exploitKeywordTriggerUtils.js';
import { createToken } from './counters_tokens.js';
import { movePermanentToGraveyard } from './counters_tokens.js';
import { applyHauntExileToTarget } from './hauntKeywordUtils.js';

function findBattlefieldPermanent(state: any, permanentId: string): any | null {
  const id = String(permanentId || '').trim();
  if (!id) return null;
  const battlefield = Array.isArray(state?.battlefield) ? state.battlefield : [];
  return battlefield.find((permanent: any) => permanent && String(permanent.id || '') === id) || null;
}

function grantKeywordHaste(permanent: any): void {
  const grantedAbilities = Array.isArray(permanent.grantedAbilities)
    ? permanent.grantedAbilities
    : (permanent.grantedAbilities = []);
  if (!grantedAbilities.some((ability: unknown) => String(ability || '').toLowerCase() === 'haste')) {
    grantedAbilities.push('Haste');
  }
  permanent.summoningSickness = false;
}

function setTributePaidFlags(permanent: any, wasPaid: boolean): void {
  permanent.tributePaid = wasPaid;
  permanent.tributeWasPaid = wasPaid;
  if (permanent.card && typeof permanent.card === 'object') {
    permanent.card.tributePaid = wasPaid;
    permanent.card.tributeWasPaid = wasPaid;
  }
}

function applyExtortLifeOutcome(state: any, controllerId: string): void {  const pid = String(controllerId || '').trim();
  if (!pid) return;

  state.life = state.life || {};
  const players = Array.isArray(state.players) ? state.players : [];
  const opponents = players.filter((player: any) => String(player?.id || '').trim() !== pid);

  let totalLifeGained = 0;
  for (const opponent of opponents) {
    const opponentId = String(opponent?.id || '').trim();
    if (!opponentId) continue;

    const currentLife = Number(state.life?.[opponentId] ?? opponent?.life ?? state.startingLife ?? 40);
    const nextLife = Math.max(0, currentLife - 1);
    const lifeLost = Math.max(0, currentLife - nextLife);

    state.life[opponentId] = nextLife;
    if (opponent && typeof opponent === 'object') {
      opponent.life = nextLife;
    }
    if (lifeLost > 0) {
      totalLifeGained += lifeLost;
      state.lifeLostThisTurn = state.lifeLostThisTurn || {};
      state.lifeLostThisTurn[opponentId] = Number(state.lifeLostThisTurn[opponentId] || 0) + lifeLost;
    }
  }

  const controllerPlayer = players.find((player: any) => String(player?.id || '').trim() === pid);
  const controllerLife = Number(state.life?.[pid] ?? controllerPlayer?.life ?? state.startingLife ?? 40);
  state.life[pid] = controllerLife + totalLifeGained;
  if (totalLifeGained > 0) {
    state.lifeGainedThisTurn = state.lifeGainedThisTurn || {};
    state.lifeGainedThisTurn[pid] = Number(state.lifeGainedThisTurn[pid] || 0) + totalLifeGained;
  }
  if (controllerPlayer && typeof controllerPlayer === 'object') {
    controllerPlayer.life = state.life[pid];
  }
}

function applyReplayPaymentManaDelta(state: any, playerId: string, event: Record<string, unknown>): void {
  const pid = String(playerId || '').trim();
  if (!pid) return;

  const manaDelta = (event as any).paymentManaDelta;
  if (manaDelta && typeof manaDelta === 'object' && !Array.isArray(manaDelta)) {
    const pool = getOrInitManaPool(state, pid as PlayerID) as any;
    for (const [poolKey, rawAmount] of Object.entries(manaDelta as Record<string, unknown>)) {
      const amount = Number(rawAmount || 0);
      if (!Number.isFinite(amount) || amount === 0) continue;
      pool[poolKey] = Number(pool[poolKey] || 0) + amount;
    }
    return;
  }

  const manaCost = String((event as any).manaCost || '').trim();
  const payment = Array.isArray((event as any).payment) ? (event as any).payment : [];
  const poolOnlyPayment = payment.length === 0
    || payment.every((item: any) => String(item?.permanentId || '').startsWith('__pool__:'));
  if (!manaCost || !poolOnlyPayment) return;

  const pool = getOrInitManaPool(state, pid as PlayerID) as any;
  const resolved = resolveManaCostForPoolPayment(pool, manaCost);
  if (resolved?.ok) {
    consumeManaFromPool(pool, resolved.coloredCost || {}, resolved.genericCost || 0);
  }
}

function applyReplayTappedPermanents(state: any, event: Record<string, unknown>): void {
  const tappedIds = Array.isArray((event as any).tappedPermanents)
    ? (event as any).tappedPermanents
    : [];
  if (tappedIds.length === 0) return;

  const battlefield = Array.isArray(state?.battlefield) ? state.battlefield : [];
  for (const rawId of tappedIds) {
    const permanentId = String(rawId || '').trim();
    if (!permanentId) continue;
    const permanent = battlefield.find((entry: any) => String(entry?.id || '') === permanentId);
    if (permanent) {
      permanent.tapped = true;
    }
  }
}

/** * Replays keyword prompt outcomes that are not captured by sibling events
 * (e.g. updateCounters for riot counter). keywordPromptResolve always clears
 * the restored queue step; this restores permanent/zone mutations.
 */
export function applyKeywordPromptResolveOutcome(
  ctx: GameContext,
  event: Record<string, unknown>,
): void {
  if ((event as any).cancelled === true) return;

  const keyword = String((event as any).keyword || '').trim().toLowerCase();
  const choiceId = String((event as any).choiceId || '').trim().toLowerCase();
  const permanentId = String((event as any).permanentId || (event as any).sourceId || '').trim();
  const state = ctx.state as any;

  switch (keyword) {
    case 'riot': {
      if (choiceId !== 'haste') break;
      const permanent = findBattlefieldPermanent(state, permanentId);
      if (!permanent) break;
      grantKeywordHaste(permanent);
      break;
    }
    case 'unleash': {
      const permanent = findBattlefieldPermanent(state, permanentId);
      if (!permanent) break;
      if (choiceId === 'counter') {
        permanent.unleashed = true;
      } else if (choiceId === 'none') {
        permanent.unleashed = false;
      }
      break;
    }
    case 'tribute': {
      const permanent = findBattlefieldPermanent(state, permanentId);
      if (!permanent) break;
      if (choiceId === 'pay') {
        setTributePaidFlags(permanent, true);
      } else if (choiceId === 'decline') {
        setTributePaidFlags(permanent, false);
      }
      break;
    }
    case 'devour': {
      const creatureId = String((event as any).creatureId || permanentId || '').trim();
      const permanent = findBattlefieldPermanent(state, creatureId);
      if (!permanent) break;
      const devourValue = Math.max(0, Math.floor(Number((event as any).devourValue || 0)));
      const selectedIds = Array.isArray((event as any).selectedIds)
        ? (event as any).selectedIds.map((value: unknown) => String(value || '').trim()).filter(Boolean)
        : [];
      const countersToAdd = devourValue * selectedIds.length;
      if (countersToAdd <= 0) break;
      permanent.counters = permanent.counters || {};
      permanent.counters['+1/+1'] = (permanent.counters['+1/+1'] || 0) + countersToAdd;
      break;
    }
    case 'soulshift': {
      const selectedCardId = String((event as any).selectedCardId || '').trim();
      const playerId = String((event as any).playerId || '').trim() as PlayerID;
      if (!selectedCardId || !playerId) break;
      const zones = (state.zones = state.zones || {});
      const playerZones = (zones[playerId] = zones[playerId] || {
        hand: [],
        handCount: 0,
        graveyard: [],
        graveyardCount: 0,
      });
      playerZones.hand = Array.isArray(playerZones.hand) ? playerZones.hand : [];
      playerZones.graveyard = Array.isArray(playerZones.graveyard) ? playerZones.graveyard : [];
      const graveyardIndex = playerZones.graveyard.findIndex(
        (card: any) => String(card?.id || '') === selectedCardId,
      );
      if (graveyardIndex < 0) break;
      const [selectedCard] = playerZones.graveyard.splice(graveyardIndex, 1);
      playerZones.hand.push(selectedCard);
      playerZones.handCount = playerZones.hand.length;
      playerZones.graveyardCount = playerZones.graveyard.length;
      break;
    }
    case 'extort': {
      if ((event as any).cancelled === true || choiceId === 'skip') break;
      const controllerId = String((event as any).playerId || '').trim();
      applyReplayPaymentManaDelta(state, controllerId, event);
      applyReplayTappedPermanents(state, event);
      applyExtortLifeOutcome(state, controllerId);
      break;
    }
    case 'fabricate': {
      if (choiceId !== 'tokens') break;
      const amount = Math.max(1, Math.floor(Number((event as any).amount || 1)));
      const controllerId = String((event as any).playerId || '').trim() as PlayerID;
      if (!controllerId) break;
      createToken(
        ctx,
        controllerId,
        'Servo',
        amount,
        1,
        1,
        {
          typeLine: 'Token Artifact Creature — Servo',
          isArtifact: true,
        },
        true,
      );
      break;
    }
    case 'exploit': {
      const selectedPermanentId = String((event as any).selectedPermanentId || '').trim();
      if (!selectedPermanentId) break;
      movePermanentToGraveyard(ctx, selectedPermanentId, false);
      requeueExploitRewardTriggersOnReplay(ctx, event);
      break;
    }
    case 'haunt': {
      const selectedPermanentId = String((event as any).selectedPermanentId || '').trim();
      const hauntCardId = String((event as any).hauntCardId || '').trim();
      const ownerId = String((event as any).ownerId || (event as any).playerId || '').trim();
      if (!selectedPermanentId || !hauntCardId || !ownerId) break;
      applyHauntExileToTarget(state, {
        ownerId,
        hauntCardId,
        targetPermanentId: selectedPermanentId,
        sourceName: String((event as any).sourceName || ''),
      });
      break;
    }
    default:
      break;
  }
}
