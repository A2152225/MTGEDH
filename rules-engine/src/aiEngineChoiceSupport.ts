import type { GameState, PlayerID } from '../../shared/src';
import { AIDecisionType, type AIDecision, type AIDecisionContext } from './AIEngine';

export function makeTokenCreationDecision(
  context: AIDecisionContext,
  evaluateTokenValue: (tokenName: string) => number
): AIDecision {
  const { playerId, options, constraints } = context;
  const tokenType = constraints?.type || 'creature';
  const count = constraints?.count || 1;

  let selectedToken = '1/1 Soldier';

  if (tokenType === 'artifact') {
    selectedToken = 'Treasure';
  } else if (options && options.length > 0) {
    let bestToken = options[0];
    let bestValue = 0;

    for (const tokenName of options) {
      const value = evaluateTokenValue(tokenName);
      if (value > bestValue) {
        bestValue = value;
        bestToken = tokenName;
      }
    }

    selectedToken = bestToken;
  }

  return {
    type: AIDecisionType.CREATE_TOKEN,
    playerId,
    action: { tokenType: selectedToken, count },
    reasoning: `Creating ${count}x ${selectedToken}`,
    confidence: 0.8,
  };
}

export function makeModeChoiceDecision(
  context: AIDecisionContext,
  evaluateModeValue: (mode: any) => number
): AIDecision {
  const { playerId, options, constraints } = context;
  const modeCount = constraints?.count || 1;

  if (!options || options.length === 0) {
    return {
      type: AIDecisionType.CHOOSE_MODE,
      playerId,
      action: { modes: [] },
      reasoning: 'No modes available',
      confidence: 0,
    };
  }

  const scoredModes = options.map((mode: any) => ({
    mode,
    score: evaluateModeValue(mode),
  }));

  scoredModes.sort((a: any, b: any) => b.score - a.score);
  const selectedModes = scoredModes.slice(0, modeCount).map((m: any) => m.mode);

  return {
    type: AIDecisionType.CHOOSE_MODE,
    playerId,
    action: { modes: selectedModes },
    reasoning: `Selected ${selectedModes.length} highest-value mode(s)`,
    confidence: 0.7,
  };
}

export function makeDiscardDecision(
  context: AIDecisionContext,
  evaluateCardValue: (card: any) => number
): AIDecision {
  const { gameState, playerId, constraints } = context;
  const discardCount = constraints?.count || 1;
  const player = findPlayer(gameState, playerId);

  if (!player || !player.hand || player.hand.length === 0) {
    return {
      type: AIDecisionType.DISCARD,
      playerId,
      action: { discarded: [] },
      reasoning: 'No cards to discard',
      confidence: 0,
    };
  }

  const handWithValue = player.hand.map((card: any) => ({
    card,
    value: evaluateCardValue(card),
  }));

  handWithValue.sort((a: any, b: any) => a.value - b.value);
  const discarded = handWithValue.slice(0, discardCount).map((c: any) => c.card.id);

  return {
    type: AIDecisionType.DISCARD,
    playerId,
    action: { discarded },
    reasoning: `Discarding ${discarded.length} lowest value card(s)`,
    confidence: 0.7,
  };
}

function findPlayer(gameState: GameState, playerId: PlayerID): any | null {
  return gameState.players.find(p => p.id === playerId) || null;
}
