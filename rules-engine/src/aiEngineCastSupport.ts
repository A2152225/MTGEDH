import { AIDecisionType, type AIDecision, type AIDecisionContext, type AIPlayerConfig } from './AIEngine';

type SpellCategory = 'removal' | 'counter' | 'draw' | 'creature' | 'ramp' | 'mana_rock' | 'other';

export function makeBasicCastDecision(
  context: AIDecisionContext,
  _config: AIPlayerConfig,
  deps: {
    evaluateSpellValue: (card: any, gameState: AIDecisionContext['gameState'], playerId: string) => number;
    countOpponentThreats: (gameState: AIDecisionContext['gameState'], playerId: string) => number;
  }
): AIDecision {
  const { gameState, playerId, options } = context;
  const player = gameState.players.find(p => p.id === playerId);

  if (!player || !player.hand || player.hand.length === 0) {
    return {
      type: AIDecisionType.CAST_SPELL,
      playerId,
      action: { spell: null },
      reasoning: 'No cards in hand',
      confidence: 0,
    };
  }

  const manaPool = player.manaPool || { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 };
  const totalMana = manaPool.white + manaPool.blue + manaPool.black + manaPool.red + manaPool.green + manaPool.colorless;
  const castableCards = (options || player.hand).filter((card: any) => {
    const cmc = card.cmc || card.mana_value || 0;
    return cmc <= totalMana;
  });

  if (castableCards.length === 0) {
    return {
      type: AIDecisionType.CAST_SPELL,
      playerId,
      action: { spell: null },
      reasoning: 'No castable spells with available mana',
      confidence: 0.8,
    };
  }

  const handSize = player.hand.length;
  const categorizedCards = castableCards.map((card: any) => {
    const typeLine = (card.type_line || '').toLowerCase();
    const oracleText = (card.oracle_text || '').toLowerCase();
    const value = deps.evaluateSpellValue(card, gameState, playerId);

    let category: SpellCategory = 'other';
    let shouldHold = false;

    if (oracleText.includes('destroy target') || oracleText.includes('exile target')) {
      category = 'removal';
      shouldHold = deps.countOpponentThreats(gameState, playerId) === 0;
    }

    if (oracleText.includes('counter target')) {
      category = 'counter';
      shouldHold = true;
    }

    if (oracleText.includes('draw') && !oracleText.includes('draw a card')) {
      category = 'draw';
      shouldHold = handSize > 5;
    }

    if (typeLine.includes('creature')) {
      category = 'creature';
      shouldHold = false;
    }

    if (oracleText.includes('search your library') && oracleText.includes('land')) {
      category = 'ramp';
      const turn = gameState.turn || 1;
      shouldHold = turn > 8;
    }

    if (typeLine.includes('artifact') && oracleText.includes('add') && oracleText.includes('mana')) {
      category = 'mana_rock';
      const turn = gameState.turn || 1;
      shouldHold = turn > 6;
    }

    return {
      card,
      value,
      category,
      shouldHold,
    };
  });

  const cardsToConsider = categorizedCards.filter(c => !c.shouldHold);
  if (cardsToConsider.length === 0) {
    return {
      type: AIDecisionType.CAST_SPELL,
      playerId,
      action: { spell: null },
      reasoning: 'Holding cards for better timing',
      confidence: 0.7,
    };
  }

  const priorities: Record<SpellCategory, number> = {
    ramp: 100,
    creature: 80,
    draw: 70,
    removal: 60,
    mana_rock: 50,
    other: 40,
    counter: 0,
  };

  cardsToConsider.sort((a, b) => {
    const aPriority = priorities[a.category] + a.value;
    const bPriority = priorities[b.category] + b.value;
    return bPriority - aPriority;
  });

  const bestSpell = cardsToConsider[0];
  if (bestSpell.value > 0) {
    return {
      type: AIDecisionType.CAST_SPELL,
      playerId,
      action: { spell: bestSpell.card, targets: [] },
      reasoning: `Casting ${bestSpell.card.name || 'spell'} [${bestSpell.category}] (value: ${bestSpell.value})`,
      confidence: Math.min(0.9, 0.5 + bestSpell.value / 20),
    };
  }

  return {
    type: AIDecisionType.CAST_SPELL,
    playerId,
    action: { spell: null },
    reasoning: 'No valuable spells to cast right now',
    confidence: 0.6,
  };
}
