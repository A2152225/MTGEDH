import type { BattlefieldPermanent, KnownCardRef } from '../../shared/src';
import { extractCombatKeywords, getCreaturePower, getCreatureToughness } from './combatAutomation';

type HasPermanentType = (perm: BattlefieldPermanent, type: string) => boolean;

export interface CombatValueAssessment {
  readonly combatValue: number;
  readonly wantsToGetKilled: boolean;
  readonly deathBenefit: number;
}

export function evaluateDeathTrigger(card: KnownCardRef): number {
  const oracleText = (card?.oracle_text || '').toLowerCase();
  let benefit = 0;

  if (!oracleText.includes('when') || !oracleText.includes('dies')) {
    return 0;
  }

  if (
    (oracleText.includes('search') && oracleText.includes('land')) ||
    (oracleText.includes('search your library') && oracleText.includes('basic land'))
  ) {
    benefit += 8;
  }

  if (oracleText.includes('draw')) {
    const drawMatch = oracleText.match(/draw (\d+)/);
    benefit += drawMatch ? parseInt(drawMatch[1], 10) * 3 : 3;
  }

  if (oracleText.includes('create') && (oracleText.includes('token') || oracleText.includes('creature token'))) {
    benefit += 4;
  }

  if (oracleText.includes('return') && oracleText.includes('to') && oracleText.includes('hand')) {
    benefit += 3;
  }

  if (oracleText.includes('damage') && (oracleText.includes('opponent') || oracleText.includes('each opponent'))) {
    benefit += 2;
  }

  if (oracleText.includes('gain') && oracleText.includes('life')) {
    benefit += 1;
  }

  if (oracleText.includes('search your library') && !oracleText.includes('land')) {
    benefit += 5;
  }

  if (oracleText.includes('each player')) {
    benefit = Math.max(1, Math.floor(benefit * 0.7));
  }

  return benefit;
}

export function evaluatePermanentValue(
  perm: BattlefieldPermanent,
  deps: { readonly hasPermanentType: HasPermanentType }
): number {
  const card = perm.card as KnownCardRef;
  let value = 0;
  const typeLine = (card?.type_line || '').toLowerCase();
  const oracleText = (card?.oracle_text || '').toLowerCase();

  if (deps.hasPermanentType(perm, 'creature')) {
    const power = getCreaturePower(perm);
    const toughness = getCreatureToughness(perm);
    value += (power + toughness) * 2;

    const keywords = extractCombatKeywords(perm);
    if (keywords.flying) value += 3;
    if (keywords.deathtouch) value += 4;
    if (keywords.lifelink) value += 3;
    if (keywords.trample) value += 2;
    if (keywords.indestructible) value += 10;
    if (keywords.doubleStrike) value += 5;

    if (oracleText.includes('when') && oracleText.includes('enters the battlefield')) {
      if (oracleText.includes('draw')) value += 3;
      if (oracleText.includes('search')) value += 3;
      if (oracleText.includes('create')) value += 2;
      if (oracleText.includes('return') && oracleText.includes('from your graveyard')) value += 3;
    }
  }

  if (typeLine.includes('artifact')) {
    value += 3;
    if (oracleText.includes('add') && oracleText.includes('mana')) value += 4;
  }

  if (typeLine.includes('enchantment')) value += 4;

  if (typeLine.includes('land')) {
    value += typeLine.includes('basic') ? 1 : 3;
  }

  if (perm.isToken) value -= 2;
  value += (perm.counters?.['+1/+1'] || 0) * 2;

  return Math.max(0, value);
}

export function evaluateCombatValue(perm: BattlefieldPermanent): CombatValueAssessment {
  const card = perm.card as KnownCardRef;
  const power = getCreaturePower(perm);
  const toughness = getCreatureToughness(perm);
  let combatValue = power + toughness;
  const deathBenefit = evaluateDeathTrigger(card);
  const wantsToGetKilled = deathBenefit > 0;

  if (wantsToGetKilled) {
    combatValue += deathBenefit * 3;
    if (power + toughness <= 2 && deathBenefit >= 5) {
      combatValue += 10;
    }
  }

  return { combatValue, wantsToGetKilled, deathBenefit };
}

export function evaluateTokenValue(tokenName: string): number {
  const ptMatch = tokenName.match(/(\d+)\/(\d+)/);
  if (ptMatch) {
    const power = parseInt(ptMatch[1], 10);
    const toughness = parseInt(ptMatch[2], 10);
    let value = power + toughness;
    const lowerName = tokenName.toLowerCase();
    if (lowerName.includes('flying')) value += 2;
    if (lowerName.includes('deathtouch')) value += 3;
    if (lowerName.includes('lifelink')) value += 2;
    if (lowerName.includes('haste')) value += 1;
    if (lowerName.includes('trample')) value += 1;
    return value;
  }

  const lowerName = tokenName.toLowerCase();
  if (lowerName.includes('treasure')) return 4;
  if (lowerName.includes('food')) return 3;
  if (lowerName.includes('clue')) return 3;
  if (lowerName.includes('blood')) return 2;
  return 1;
}

export function evaluateModeValue(mode: any): number {
  const modeText = (typeof mode === 'string' ? mode : mode.text || '').toLowerCase();
  let value = 5;

  if (modeText.includes('draw')) value += 4;
  if (modeText.includes('destroy') && !modeText.includes('your')) value += 4;
  if (modeText.includes('exile') && !modeText.includes('your')) value += 4;
  if (modeText.includes('counter')) value += 3;
  if (modeText.includes('gain') && modeText.includes('life')) value += 2;
  if (modeText.includes('create')) value += 3;
  if (modeText.includes('+1/+1')) value += 2;
  if (modeText.includes('search')) value += 3;
  if (modeText.includes('return') && modeText.includes('hand')) value += 2;
  if (modeText.includes('damage') && !modeText.includes('to you')) value += 3;

  if (modeText.includes('sacrifice') && modeText.includes('you')) value -= 3;
  if (modeText.includes('discard') && !modeText.includes('opponent')) value -= 2;
  if (modeText.includes('lose') && modeText.includes('life') && !modeText.includes('opponent')) value -= 2;
  if (modeText.includes('damage to you')) value -= 3;

  return Math.max(0, value);
}

export function evaluateCardValue(card: any): number {
  let value = 0;
  const typeLine = (card.type_line || '').toLowerCase();
  const oracleText = (card.oracle_text || '').toLowerCase();
  const cmc = card.cmc || card.mana_value || 0;

  if (typeLine.includes('land')) {
    value = typeLine.includes('basic') ? 3 : 6;
  } else if (typeLine.includes('creature')) {
    const power = parseInt(card.power || '0', 10);
    const toughness = parseInt(card.toughness || '0', 10);
    value = 5 + cmc + (power + toughness) / 2;
    value += evaluateDeathTrigger(card) * 2;
  } else if (typeLine.includes('instant')) {
    value = 8 + cmc * 1.5;
    if (oracleText.includes('destroy') || oracleText.includes('exile')) {
      value += 5;
    }
    if (oracleText.includes('counter target')) {
      value += 8;
    }
  } else if (typeLine.includes('sorcery')) {
    value = 5 + cmc;
    if (oracleText.includes('draw')) {
      value += 6;
    }
    if (oracleText.includes('destroy') || oracleText.includes('exile')) {
      value += 4;
    }
    if (oracleText.includes('destroy all') || oracleText.includes('exile all')) {
      value += 10;
    }
  } else if (typeLine.includes('artifact') || typeLine.includes('enchantment')) {
    value = 6 + cmc;
    if (oracleText.includes('draw')) {
      value += 5;
    }
    if (oracleText.includes('add') && oracleText.includes('mana')) {
      value += 3;
    }
  } else {
    value = 4 + cmc;
  }

  if (cmc >= 7) {
    value -= 2;
  }

  return Math.max(1, value);
}
