import type { BattlefieldPermanent } from '../../shared/src';
import { extractCombatKeywords, getCreaturePower, getCreatureToughness } from './combatAutomation';

type HasPermanentType = (perm: BattlefieldPermanent, type: string) => boolean;
type GetProcessedBattlefield = (gameState: any) => BattlefieldPermanent[];

const COUNTER_SPELL_EMPTY_STACK_PENALTY = -5;
const COUNTER_SPELL_HAS_TARGET_BONUS = 6;
const REMOVAL_SPELL_BONUS = 5;
const CARD_DRAW_VALUE_PER_CARD = 3;
const FLYING_BONUS = 3;
const HASTE_BONUS = 2;
const TRAMPLE_BONUS = 2;
const DEATHTOUCH_BONUS = 3;
const LIFELINK_BONUS = 2;
const VIGILANCE_BONUS = 1;
const MANA_ARTIFACT_EARLY_GAME_BONUS = 8;
const HIGH_CMC_EARLY_PENALTY = -3;
const BUFF_SPELL_NO_CREATURES_PENALTY = -5;
const BUFF_SPELL_WITH_CREATURES_BONUS = 3;
const AURA_NO_TARGET_PENALTY = -10;

export function countOpponentThreats(
  gameState: any,
  playerId: string,
  deps: {
    getProcessedBattlefield: GetProcessedBattlefield;
    hasPermanentType: HasPermanentType;
  }
): number {
  let threatCount = 0;
  const battlefield = deps.getProcessedBattlefield(gameState);

  for (const perm of battlefield) {
    if (perm.controller === playerId) continue;

    if (deps.hasPermanentType(perm, 'creature')) {
      const power = getCreaturePower(perm);
      const toughness = getCreatureToughness(perm);
      if (power >= 4 || toughness >= 5) {
        threatCount += 2;
      } else if (power >= 2) {
        threatCount += 1;
      }

      const keywords = extractCombatKeywords(perm);
      if (keywords.flying || keywords.trample || keywords.deathtouch) {
        threatCount += 1;
      }
    }

    if (deps.hasPermanentType(perm, 'planeswalker')) {
      threatCount += 2;
    }

    if (deps.hasPermanentType(perm, 'enchantment') || deps.hasPermanentType(perm, 'artifact')) {
      const oracleText = (perm.card?.oracle_text || '').toLowerCase();
      if (oracleText.includes('each opponent') || oracleText.includes('damage')) {
        threatCount += 1;
      }
    }
  }

  return threatCount;
}

export function evaluateSpellValue(
  card: any,
  gameState: any,
  playerId: string,
  deps: {
    getProcessedBattlefield: GetProcessedBattlefield;
    hasPermanentType: HasPermanentType;
  }
): number {
  let value = 0;
  const typeLine = (card.type_line || '').toLowerCase();
  const oracleText = (card.oracle_text || '').toLowerCase();
  const cmc = card.cmc || card.mana_value || 0;

  if (typeLine.includes('creature')) {
    const power = parseInt(card.power || '0', 10);
    const toughness = parseInt(card.toughness || '0', 10);
    value += (power + toughness) * 2;
    if (oracleText.includes('flying')) value += FLYING_BONUS;
    if (oracleText.includes('haste')) value += HASTE_BONUS;
    if (oracleText.includes('trample')) value += TRAMPLE_BONUS;
    if (oracleText.includes('deathtouch')) value += DEATHTOUCH_BONUS;
    if (oracleText.includes('lifelink')) value += LIFELINK_BONUS;
    if (oracleText.includes('vigilance')) value += VIGILANCE_BONUS;
  }

  if (typeLine.includes('instant') || typeLine.includes('sorcery')) {
    if (oracleText.includes('destroy target') || oracleText.includes('exile target')) {
      value += REMOVAL_SPELL_BONUS;
    }
    if (oracleText.includes('draw')) {
      const drawMatch = oracleText.match(/draw (\d+)/);
      value += drawMatch ? parseInt(drawMatch[1], 10) * CARD_DRAW_VALUE_PER_CARD : CARD_DRAW_VALUE_PER_CARD;
    }
    if (oracleText.includes('counter target')) {
      value += (gameState.stack || []).length > 0 ? COUNTER_SPELL_HAS_TARGET_BONUS : COUNTER_SPELL_EMPTY_STACK_PENALTY;
    }
  }

  if (typeLine.includes('artifact')) {
    value += 3;
    if (oracleText.includes('add') && oracleText.includes('mana')) {
      const turn = gameState.turn || 1;
      value += Math.max(0, MANA_ARTIFACT_EARLY_GAME_BONUS - turn);
    }
  }

  if (typeLine.includes('enchantment')) {
    value += 3;
    if (typeLine.includes('aura')) {
      const battlefield = deps.getProcessedBattlefield(gameState);
      const hasCreatures = battlefield.some((p: any) => p.controller === playerId && deps.hasPermanentType(p, 'creature'));
      if (!hasCreatures) {
        value += AURA_NO_TARGET_PENALTY;
      }
    }
  }

  const turn = gameState.turn || 1;
  if (cmc > turn + 2) {
    value += HIGH_CMC_EARLY_PENALTY;
  }

  const battlefield = deps.getProcessedBattlefield(gameState);
  const creatureCount = battlefield.filter((p: any) => p.controller === playerId && deps.hasPermanentType(p, 'creature')).length;
  if (oracleText.includes('+1/+1') || oracleText.includes('+2/+2')) {
    value += creatureCount > 0 ? BUFF_SPELL_WITH_CREATURES_BONUS : BUFF_SPELL_NO_CREATURES_PENALTY;
  }

  return value;
}
