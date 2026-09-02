/**
 * Origin parent: server/src/socket/ai-handlers/aiFindCastableSpells.ts
 * (cast gate) and AI JOIN_FORCES resolution answers.
 *
 * Cluster: Join Forces spells resolve X from table contributions, not from the
 * cheap {U}/{G}/{W}/{B} cost. Skip the cast until leftover-after-paying plus
 * other players' possible mana is at least 2. The initiator then contributes
 * leftover lands so that self-funded X is not immediately paid as 0.
 * Other AIs also pay into shared-positive X (draw / basic lands) because they
 * get the same cards or lands; they skip mill and source-pump.
 *
 * Public entry symbols: MIN_JOIN_FORCES_POTENTIAL_MANA,
 * shouldAICastJoinForcesSpell, evaluateAIJoinForcesCast,
 * chooseAIJoinForcesContribution.
 */
import type { PlayerID } from "../../../../shared/src/types.js";
import { getAvailableMana, getTotalManaFromPool, parseManaCost } from "../../state/modules/mana-check.js";
import { isJoinForcesSpell } from "../../state/modules/oracleIrSpellLegacySpellShapeUtils.js";

/** Wait until leftover + other players' possible mana can make Join Forces X meaningful. */
export const MIN_JOIN_FORCES_POTENTIAL_MANA = 2;

type ManaCostLike = {
  generic?: number;
  colors?: Record<string, number>;
};

function oracleTextOf(card: any): string {
  return String(card?.oracle_text || card?.oracleText || card?.text || '');
}

function manaAmountFromCost(cost?: ManaCostLike | null): number {
  if (!cost) return 0;
  const colors = cost.colors || {};
  const colored = Object.values(colors).reduce((sum, value) => sum + Number(value || 0), 0);
  return Math.max(0, Number(cost.generic || 0) + colored);
}

function paymentCostAmount(card: any, paymentCost?: ManaCostLike | null): number {
  if (paymentCost) return manaAmountFromCost(paymentCost);
  const manaCost = String(card?.mana_cost || card?.manaCost || '').trim();
  if (!manaCost) return 0;
  return manaAmountFromCost(parseManaCost(manaCost));
}

function sumOtherPlayersAvailableMana(game: any, playerId: PlayerID | string): number {
  const casterId = String(playerId || '');
  const players = Array.isArray(game?.state?.players) ? game.state.players : [];
  let total = 0;
  for (const player of players) {
    const id = String(player?.id || '').trim();
    if (!id || id === casterId) continue;
    if (player?.eliminated === true || player?.lost === true || player?.spectator === true) continue;
    total += getTotalManaFromPool(getAvailableMana(game.state, id));
  }
  return Math.max(0, total);
}

function leftoverJoinForcesManaAfterPaying(
  game: any,
  playerId: PlayerID | string,
  card: any,
  paymentCost?: ManaCostLike | null,
): number {
  const available = getTotalManaFromPool(getAvailableMana(game.state, playerId));
  return Math.max(0, available - paymentCostAmount(card, paymentCost));
}

export function evaluateAIJoinForcesCast(
  game: any,
  playerId: PlayerID | string,
  card: any,
  paymentCost?: ManaCostLike | null,
): { shouldCast: boolean; leftoverMana: number; otherPlayersMana: number } {
  if (!isJoinForcesSpell(String(card?.name || ''), oracleTextOf(card).toLowerCase())) {
    return { shouldCast: true, leftoverMana: 0, otherPlayersMana: 0 };
  }
  const leftoverMana = leftoverJoinForcesManaAfterPaying(game, playerId, card, paymentCost);
  const otherPlayersMana = sumOtherPlayersAvailableMana(game, playerId);
  return {
    shouldCast: leftoverMana + otherPlayersMana >= MIN_JOIN_FORCES_POTENTIAL_MANA,
    leftoverMana,
    otherPlayersMana,
  };
}

export function shouldAICastJoinForcesSpell(
  game: any,
  playerId: PlayerID | string,
  card: any,
  paymentCost?: ManaCostLike | null,
): boolean {
  return evaluateAIJoinForcesCast(game, playerId, card, paymentCost).shouldCast;
}

type JoinForcesBenefit =
  | 'shared_draw'
  | 'shared_lands'
  | 'shared_tokens'
  | 'shared_mill'
  | 'source_pump'
  | 'unknown';

function joinForcesEffectBlob(step: any): string {
  return [
    String(step?.cardName || step?.sourceName || ''),
    String(step?.effectDescription || step?.description || ''),
  ].join(' ').toLowerCase();
}

function classifyJoinForcesBenefit(step: any): JoinForcesBenefit {
  const blob = joinForcesEffectBlob(step);
  if (/\+\s*x\s*\/\s*\+0/.test(blob) || /\bgets?\s+\+x\b/.test(blob)) return 'source_pump';
  if (/\bsearch(?:es)?\b/.test(blob) && /\bland/.test(blob)) return 'shared_lands';
  if (/\bdraws?\s+x\b/.test(blob) || /\bdraw\s+x\s+cards?\b/.test(blob)) return 'shared_draw';
  if (/\bmills?\s+x\b/.test(blob) || /\bput(?:s)? the top x\b/.test(blob)) return 'shared_mill';
  if (/\bcreates?\s+x\b/.test(blob) || /\bcreature tokens?\b/.test(blob)) return 'shared_tokens';
  return 'unknown';
}

function isJoinForcesRespondersTurn(game: any, step: any): boolean {
  const playerId = String(step?.playerId || '').trim();
  if (!playerId) return false;
  const turnPlayer = String(game?.state?.turnPlayer || game?.state?.activePlayer || '').trim();
  return Boolean(turnPlayer) && turnPlayer === playerId;
}

/**
 * Shared draw/lands: paying N raises X by N, and this player gets N more cards
 * or lands. Dump leftover as initiator. Other AIs pay most of their untapped
 * lands, holding 1 on an opponent's turn when they have 3+ so they are not
 * fully tapped for interaction.
 */
function chooseSharedPositiveJoinForcesAmount(
  available: number,
  options: { isInitiator: boolean; reserve: number },
): number {
  if (options.isInitiator) return available;
  return Math.max(0, available - Math.max(0, options.reserve));
}

/**
 * Initiator spends leftover lands. Other AIs contribute when they also get X
 * (draw / ramp lands / modest tokens) and skip effects that only help the
 * source or mill the table.
 */
export function chooseAIJoinForcesContribution(game: any, step: any): number {
  const available = Math.max(0, Math.floor(Number(step?.availableMana || 0)));
  if (available <= 0) return 0;

  const isInitiator = step?.isInitiator === true;
  const benefit = classifyJoinForcesBenefit(step);
  const ownTurn = isJoinForcesRespondersTurn(game, step);
  const reserve = !isInitiator && !ownTurn && available >= 3 ? 1 : 0;

  if (benefit === 'source_pump' || benefit === 'shared_mill' || benefit === 'unknown') {
    return isInitiator ? available : 0;
  }

  if (benefit === 'shared_tokens') {
    if (isInitiator) return available;
    return Math.min(2, Math.max(0, available - reserve));
  }

  // shared_draw / shared_lands: paying N raises X by N, and this AI draws or
  // ramps the same N. Worth paying even when earlier players already put X > 0.
  return chooseSharedPositiveJoinForcesAmount(available, { isInitiator, reserve });
}
