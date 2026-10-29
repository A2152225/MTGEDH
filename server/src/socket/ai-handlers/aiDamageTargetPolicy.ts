/**
 * Origin parent: server/src/socket/ai-handlers/aiTargetChoiceHandlers.ts
 *
 * Cluster: damage-to-chosen-target scoring. The choice is judged from the
 * damage clause, not the rest of the source card (a later "put a counter"
 * or "you control" must not make the caster a good damage target).
 *
 * Public entry: cardForDamageChoiceScoring, selfDamageIsWorthTaking,
 * ownCreatureDamageTargetScore.
 */

import { cardHasCreatureType } from '../../../../shared/src/creatureTypes.js';

function permanentOracle(permanent: any): string {
  return String(permanent?.card?.oracle_text || permanent?.oracle_text || '').toLowerCase();
}

function ownBattlefield(game: any, playerId: string): any[] {
  const battlefield = Array.isArray(game?.state?.battlefield) ? game.state.battlefield : [];
  return battlefield.filter((permanent: any) => String(permanent?.controller || '') === String(playerId));
}

function redirectsDamageFromYou(text: string): boolean {
  if (!/would deal damage to you|damage that would be dealt to you/.test(text)) return false;
  if (/instead/.test(text) && /(any target|target |an opponent|that player|enchanted creature)/.test(text)) {
    return true;
  }
  return /prevent/.test(text)
    && /deals? (?:that much|the same amount|\d+) damage to (?:target |any target|an opponent)/.test(text);
}

/**
 * Damage that would be dealt to you is worth taking only when it is redirected
 * away, or when being dealt damage creates creature tokens and another
 * permanent you control gains life as creatures enter (the life offsets the hit).
 */
export function selfDamageIsWorthTaking(game: any, playerId: string): boolean {
  const own = ownBattlefield(game, playerId);
  if (own.some((permanent) => redirectsDamageFromYou(permanentOracle(permanent)))) return true;
  const createsTokens = own.some((permanent) =>
    /whenever you(?:'re| are) dealt damage,[^.]*\bcreate\b/.test(permanentOracle(permanent)),
  );
  const gainsLifeOnEnter = own.some((permanent) =>
    /whenever (?:another )?creature[^.]*\benters\b[^.]*\byou gain \d+ life\b/.test(permanentOracle(permanent)),
  );
  return createsTokens && gainsLifeOnEnter;
}

function typeLineOf(permanent: any): string {
  return String(permanent?.card?.type_line || permanent?.type_line || '');
}

function isCreaturePermanent(permanent: any): boolean {
  return /\bcreature\b/i.test(typeLineOf(permanent));
}

function markedDamage(permanent: any): number {
  const fromCounter = Number(permanent?.counters?.damage || 0);
  const fromMarked = Number(permanent?.damageMarked || permanent?.markedDamage || permanent?.damage || 0);
  return Math.max(0, Number.isFinite(fromCounter) ? fromCounter : 0, Number.isFinite(fromMarked) ? fromMarked : 0);
}

function remainingToughness(permanent: any): number {
  const raw = permanent?.baseToughness ?? permanent?.card?.toughness ?? permanent?.toughness ?? 0;
  const printed = Number.parseInt(String(raw), 10);
  const plus = Number(permanent?.counters?.['+1/+1'] || 0);
  const minus = Number(permanent?.counters?.['-1/-1'] || 0);
  const base = Number.isFinite(printed) ? printed : 0;
  return base + plus - minus - markedDamage(permanent);
}

function isIndestructible(permanent: any): boolean {
  if (permanent?.indestructible === true) return true;
  const keywords = Array.isArray(permanent?.keywords) ? permanent.keywords.join(' ') : '';
  return /\bindestructible\b/.test(`${permanentOracle(permanent)} ${keywords}`);
}

function creatureTypeWordMatches(permanent: any, word: string): boolean {
  const normalized = String(word || '').trim().toLowerCase();
  if (!normalized) return false;
  if (normalized === 'creature') return isCreaturePermanent(permanent);
  return cardHasCreatureType(typeLineOf(permanent), permanentOracle(permanent), normalized);
}

function sentenceTriggersWhenDealtDamage(sentence: string, permanent: any, textIsOnThisPermanent: boolean): boolean {
  if (textIsOnThisPermanent && /whenever (?:this creature|~) is dealt damage,?/.test(sentence)) return true;
  const typed = sentence.match(/whenever (?:a|another) ([a-z][a-z0-9/-]*) you control is dealt damage,?/);
  return Boolean(typed && creatureTypeWordMatches(permanent, typed[1]));
}

function dealtDamageTriggerApplies(game: any, playerId: string, permanent: any): boolean {
  if (!isCreaturePermanent(permanent)) return false;
  const ownText = permanentOracle(permanent);
  if (ownText.split(/(?<=\.)\s+/).some((sentence) => sentenceTriggersWhenDealtDamage(sentence, permanent, true))) {
    return true;
  }
  return ownBattlefield(game, playerId).some((other) => {
    if (other === permanent) return false;
    const text = permanentOracle(other);
    return text.split(/(?<=\.)\s+/).some((sentence) => sentenceTriggersWhenDealtDamage(sentence, permanent, false));
  });
}

function powerOf(permanent: any): number {
  const raw = permanent?.basePower ?? permanent?.card?.power ?? permanent?.power ?? 0;
  const printed = Number.parseInt(String(raw), 10);
  const plus = Number(permanent?.counters?.['+1/+1'] || 0);
  const minus = Number(permanent?.counters?.['-1/-1'] || 0);
  return (Number.isFinite(printed) ? printed : 0) + plus - minus;
}

function dealtDamageSentences(game: any, playerId: string, permanent: any): string[] {
  const sentences: string[] = [];
  const collect = (text: string, textIsOnThisPermanent: boolean) => {
    for (const sentence of text.split(/(?<=\.)\s+/)) {
      if (sentenceTriggersWhenDealtDamage(sentence, permanent, textIsOnThisPermanent)) sentences.push(sentence);
    }
  };
  collect(permanentOracle(permanent), true);
  for (const other of ownBattlefield(game, playerId)) {
    if (other === permanent) continue;
    collect(permanentOracle(other), false);
  }
  return sentences;
}

function threatRemovalFromDealtDamage(
  sentences: readonly string[],
  permanent: any,
  pingAmount: number,
): { removesThreat: boolean; threatDamage: number; hardRemoval: boolean } {
  let threatDamage = 0;
  let hardRemoval = false;
  for (const sentence of sentences) {
    const effect = sentence.split(/is dealt damage,?/)[1] || '';
    if (/\b(?:destroy|exile)\b/.test(effect) && /\b(?:target|each|all)\b/.test(effect)) {
      hardRemoval = true;
      threatDamage = Math.max(threatDamage, 99);
    }
    if (/\bfights?\b/.test(effect) || /damage equal to (?:its|this creature's|that creature's) power/.test(effect)) {
      threatDamage = Math.max(threatDamage, powerOf(permanent));
    }
    const fixed = effect.match(/\bdeals?\s+(\d+)\s+damage\b/);
    if (fixed) threatDamage = Math.max(threatDamage, Number.parseInt(fixed[1], 10));
    if (/\bdeals?\s+that much damage\b/.test(effect)) threatDamage = Math.max(threatDamage, pingAmount);
  }
  return {
    removesThreat: hardRemoval || threatDamage >= 3,
    threatDamage: hardRemoval ? Math.max(threatDamage, 99) : threatDamage,
    hardRemoval,
  };
}

function smallerPingsForgone(permanent: any): number {
  const remaining = remainingToughness(permanent);
  if (remaining <= 1) return 0;
  return remaining - 1;
}

function triggerAnswersThreatPingCannot(
  game: any,
  playerId: string,
  pingAmount: number,
  payoff: { threatDamage: number; hardRemoval: boolean },
): boolean {
  const opponents = (Array.isArray(game?.state?.battlefield) ? game.state.battlefield : [])
    .filter((permanent: any) => String(permanent?.controller || '') !== String(playerId) && isCreaturePermanent(permanent));
  if (opponents.length === 0) return payoff.threatDamage > pingAmount;
  return opponents.some((opponent: any) => {
    const toughness = remainingToughness(opponent);
    if (toughness <= 0) return false;
    const pingKills = pingAmount >= toughness;
    if (payoff.hardRemoval) return !pingKills;
    return payoff.threatDamage >= toughness && !pingKills;
  });
}

/**
 * Lethal damage to your own dealt-damage creature is a trade when the trigger
 * can remove a threat this ping cannot, scaled by how many smaller hits that
 * creature could still have survived.
 */
function lethalOwnCreatureTradeScore(
  game: any,
  playerId: string,
  permanent: any,
  damageAmount: number,
): number {
  const payoff = threatRemovalFromDealtDamage(dealtDamageSentences(game, playerId, permanent), permanent, damageAmount);
  if (!payoff.removesThreat) return -400;
  const forgone = smallerPingsForgone(permanent);
  const answers = triggerAnswersThreatPingCannot(game, playerId, damageAmount, payoff);
  if (!answers) return forgone === 0 ? 70 : -200;
  if (forgone === 0) return 130;
  if (forgone <= 2) return 100;
  return 40;
}

/**
 * Damaging your own creature is a bad target, except when being dealt damage
 * triggers an ability. A non-lethal hit can be repeated. A lethal hit is a
 * trade only when that trigger can remove a threat and the creature was
 * unlikely to survive another smaller ping.
 * Returns -400 when the creature should not be damaged.
 */
export function ownCreatureDamageTargetScore(
  game: any,
  playerId: string,
  permanent: any,
  damageAmount: number,
): number {
  const amount = Number(damageAmount) || 0;
  if (!dealtDamageTriggerApplies(game, playerId, permanent)) return -400;
  if (amount <= 0) return -400;
  if (!isIndestructible(permanent) && remainingToughness(permanent) <= amount) {
    return lethalOwnCreatureTradeScore(game, playerId, permanent, amount);
  }
  const cushion = isIndestructible(permanent)
    ? 8
    : Math.max(0, Math.min(8, remainingToughness(permanent) - amount));
  return 72 + cushion;
}

const DAMAGE_TO_CHOSEN_RE = /\b(?:deals?|deal)\b[^.]*\bdamage\b[^.]*\b(?:any target|target (?:creature|player|opponent|permanent|planeswalker)|each opponent)\b/i;

function clauseFromDamageSentence(sentence: string): string | null {
  const text = sentence.replace(/\s+/g, ' ').trim();
  if (!text) return null;
  const chooseAmount = text.match(/choose a target to deal\s+(\d+)\s+damage/i);
  if (chooseAmount) return `deals ${chooseAmount[1]} damage to any target`;
  if (/choose a target to deal\b/i.test(text)) return 'deals damage to any target';
  if (!DAMAGE_TO_CHOSEN_RE.test(text)) return null;
  const amount = text.match(/\b(\d+)\s+damage\b/i);
  if (/any target/i.test(text)) {
    return amount ? `deals ${amount[1]} damage to any target` : 'deals damage to any target';
  }
  if (amount && /\btarget\s+(?:creature|player|opponent|permanent|planeswalker)\b/i.test(text)) {
    const kind = text.match(/\btarget\s+(creature|player|opponent|permanent|planeswalker)\b/i);
    return `deals ${amount[1]} damage to target ${kind?.[1] || 'creature'}`;
  }
  return text;
}

function firstDamageClause(text: string): string | null {
  const normalized = String(text || '').trim();
  if (!normalized) return null;
  const sentences = normalized.split(/(?<=\.)\s+/);
  for (const sentence of sentences) {
    const clause = clauseFromDamageSentence(sentence);
    if (clause) return clause;
  }
  return clauseFromDamageSentence(normalized);
}

/**
 * When this choice deals damage to the selected target, return a copy of the
 * source card whose oracle is only that damage clause. Otherwise return the
 * card unchanged so non-damage choices keep their existing scores.
 */
export function cardForDamageChoiceScoring(step: any, sourceCard: any): any {
  const spellOracle = String(step?.spellCastContext?.oracleText || '').trim();
  if (spellOracle) {
    const spellClause = firstDamageClause(spellOracle);
    if (!spellClause) return sourceCard;
    return { ...sourceCard, oracle_text: spellClause };
  }

  if (step?.damageReceivedTrigger) {
    const amount = Number(step?.damageTrigger?.damageAmount || 0);
    const clause = amount > 0 ? `deals ${amount} damage to any target` : 'deals damage to any target';
    return { ...sourceCard, oracle_text: clause };
  }

  const stepText = [
    step?.abilityText,
    step?.activatedAbilityText,
    step?.planeswalkerAbility?.abilityText,
    step?.abilityDescription,
    step?.effectText,
    step?.description,
  ].map((value) => String(value || '').trim()).filter(Boolean).join(' ');

  const fromStep = firstDamageClause(stepText);
  if (fromStep) return { ...sourceCard, oracle_text: fromStep };
  if (stepText && !/\bdamage\b/i.test(stepText)) return sourceCard;

  const fromCard = firstDamageClause(String(sourceCard?.oracle_text || ''));
  if (!fromCard) return sourceCard;
  return { ...sourceCard, oracle_text: fromCard };
}
