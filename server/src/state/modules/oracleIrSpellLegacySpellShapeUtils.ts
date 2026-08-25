const WORD_TO_NUMBER: Record<string, number> = {
  a: 1,
  an: 1,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
};

export function parseNumberWord(word: string | undefined, defaultValue = 1): number {
  if (!word) return defaultValue;
  const lower = word.toLowerCase();
  if (WORD_TO_NUMBER[lower] !== undefined) {
    return WORD_TO_NUMBER[lower];
  }
  const num = parseInt(lower, 10);
  return Number.isNaN(num) ? defaultValue : num;
}

export function isExtraTurnSpell(cardName: string, oracleTextLower: string): boolean {
  const nameLower = (cardName || '').toLowerCase();

  const extraTurnSpells = new Set([
    'time warp',
    'time walk',
    'temporal mastery',
    'nexus of fate',
    'expropriate',
    "alrund's epiphany",
    "karn's temporal sundering",
    'temporal manipulation',
    'time stretch',
    'beacon of tomorrows',
    'capture of jingzhou',
    'temporal trespass',
    'walk the aeons',
    'savor the moment',
    'final fortune',
    "warrior's oath",
    'last chance',
    'chance for glory',
    'medomai the ageless',
    "magistrate's scepter",
    'part the waterveil',
    'lighthouse chronologist',
    'wanderwine prophets',
    'emrakul, the promised end',
    "ugin's nexus",
    'sage of hours',
    'notorious throng',
  ]);

  if (extraTurnSpells.has(nameLower)) {
    return true;
  }

  return (
    oracleTextLower.includes('take an extra turn') ||
    oracleTextLower.includes('takes an extra turn') ||
    oracleTextLower.includes('extra turn after this one')
  );
}

export function isJoinForcesSpell(cardName: string, oracleTextLower: string): boolean {
  const nameLower = (cardName || '').toLowerCase();

  const joinForcesSpells = new Set([
    'minds aglow',
    'collective voyage',
    'alliance of arms',
    'shared trauma',
  ]);

  if (joinForcesSpells.has(nameLower)) {
    return true;
  }

  return (
    oracleTextLower.includes('join forces') &&
    oracleTextLower.includes('starting with you') &&
    oracleTextLower.includes('each player may pay')
  );
}

export function isTemptingOfferSpell(cardName: string, oracleTextLower: string): boolean {
  const nameLower = (cardName || '').toLowerCase();

  const temptingOfferSpells = new Set([
    'tempt with bunnies',
    'tempt with discovery',
    'tempt with glory',
    'tempt with immortality',
    'tempt with mayhem',
    'tempt with reflections',
    'tempt with vengeance',
  ]);

  if (temptingOfferSpells.has(nameLower)) {
    return true;
  }

  return oracleTextLower.includes('tempting offer');
}

export function isPonderStyleSpell(cardName: string, oracleTextLower: string): boolean {
  const nameLower = (cardName || '').toLowerCase();

  const ponderStyleSpells = new Set([
    'ponder',
    'index',
    'mystic speculation',
    'telling time',
    'sage of epityr',
    'halimar depths',
  ]);

  if (ponderStyleSpells.has(nameLower)) {
    return true;
  }

  return (
    oracleTextLower.includes('look at the top') &&
    oracleTextLower.includes('put them back in any order')
  );
}

export function detectTopCardsToHandSelectionSpell(oracleTextLower: string): {
  lookCount: number | 'mana_spent_total';
  pickCount: number;
  remainderDestination: 'graveyard' | 'bottom';
  remainderRandomOrder: boolean;
} | null {
  const fixedGraveyardMatch = oracleTextLower.match(
    /look at the top (one|two|three|four|five|six|seven|eight|nine|ten|\d+) cards? of your library\.\s*put (one|two|three|four|five|six|seven|eight|nine|ten|\d+) of them into your hand and the rest into your graveyard\.?/i,
  );
  if (fixedGraveyardMatch) {
    return {
      lookCount: parseNumberWord(fixedGraveyardMatch[1], 1),
      pickCount: parseNumberWord(fixedGraveyardMatch[2], 1),
      remainderDestination: 'graveyard',
      remainderRandomOrder: false,
    };
  }

  const manaSpentBottomMatch = oracleTextLower.match(
    /look at the top x cards? of your library, where x is the amount of mana spent to cast this spell\.\s*put (one|two|three|four|five|six|seven|eight|nine|ten|\d+) of them into your hand and the rest on the bottom of your library in a random order\.?/i,
  );
  if (manaSpentBottomMatch) {
    return {
      lookCount: 'mana_spent_total',
      pickCount: parseNumberWord(manaSpentBottomMatch[1], 1),
      remainderDestination: 'bottom',
      remainderRandomOrder: true,
    };
  }

  const fixedBottomMatch = oracleTextLower.match(
    /look at the top (one|two|three|four|five|six|seven|eight|nine|ten|\d+) cards? of your library\.\s*put (one|two|three|four|five|six|seven|eight|nine|ten|\d+) of them into your hand and the rest on the bottom of your library in a random order\.?/i,
  );
  if (fixedBottomMatch) {
    return {
      lookCount: parseNumberWord(fixedBottomMatch[1], 1),
      pickCount: parseNumberWord(fixedBottomMatch[2], 1),
      remainderDestination: 'bottom',
      remainderRandomOrder: true,
    };
  }

  return null;
}

export function detectTopCardsToExileSelectionSpell(oracleTextLower: string): {
  lookCount: number;
  pickCount: number;
  remainderDestination: 'bottom';
  remainderRandomOrder: boolean;
  destinationFaceDown: boolean;
  grantPlayableFromExileSpendManaAsThoughAnyType: boolean;
} | null {
  const targetedOpponentFaceDownExileMatch = oracleTextLower.match(
    /look at the top (one|two|three|four|five|six|seven|eight|nine|ten|\d+) cards? of target opponent['’]s library\.\s*exile (one|two|three|four|five|six|seven|eight|nine|ten|\d+) of them face down and put (?:the other|the rest) on the bottom of that library\.\s*you may play the exiled card for as long as it remains exiled, and you may spend mana as though it were mana of any color to cast that spell\.?/i,
  );
  if (!targetedOpponentFaceDownExileMatch) {
    return null;
  }

  return {
    lookCount: parseNumberWord(targetedOpponentFaceDownExileMatch[1], 1),
    pickCount: parseNumberWord(targetedOpponentFaceDownExileMatch[2], 1),
    remainderDestination: 'bottom',
    remainderRandomOrder: false,
    destinationFaceDown: true,
    grantPlayableFromExileSpendManaAsThoughAnyType: true,
  };
}

export function isLimDulsVaultSpell(cardName: string, oracleTextLower: string): boolean {
  const nameLower = (cardName || '').toLowerCase();
  if (nameLower === "lim-dûl's vault" || nameLower === "lim-dul's vault") {
    return true;
  }

  return (
    oracleTextLower.includes('look at the top five cards of your library') &&
    oracleTextLower.includes('pay 1 life') &&
    oracleTextLower.includes('put those cards on the bottom of your library in any order') &&
    oracleTextLower.includes('put the last cards you looked at this way on top in any order')
  );
}

export function isDanceWithCalamitySpell(cardName: string, oracleTextLower: string): boolean {
  const nameLower = (cardName || '').toLowerCase();
  if (nameLower === 'dance with calamity') {
    return true;
  }

  return (
    oracleTextLower.includes('shuffle your library') &&
    oracleTextLower.includes('as many times as you choose') &&
    oracleTextLower.includes('you may exile the top card of your library') &&
    oracleTextLower.includes('if the total mana value of the cards exiled this way is 13 or less') &&
    oracleTextLower.includes('you may cast any number of spells from among those cards without paying their mana costs')
  );
}

export function getPonderConfig(
  cardName: string,
  oracleTextLower: string,
): {
  cardCount: number;
  variant: 'ponder' | 'index' | 'telling_time' | 'brainstorm' | 'architects';
  canShuffle: boolean;
  drawAfter: boolean;
  pickToHand: number;
} {
  const nameLower = (cardName || '').toLowerCase();

  type PonderVariant = 'ponder' | 'index' | 'telling_time' | 'brainstorm' | 'architects';

  let config: {
    cardCount: number;
    variant: PonderVariant;
    canShuffle: boolean;
    drawAfter: boolean;
    pickToHand: number;
  } = {
    cardCount: 3,
    variant: 'ponder',
    canShuffle: false,
    drawAfter: false,
    pickToHand: 0,
  };

  if (nameLower === 'ponder') {
    config = {
      cardCount: 3,
      variant: 'ponder',
      canShuffle: true,
      drawAfter: true,
      pickToHand: 0,
    };
  } else if (nameLower === 'index') {
    config = {
      cardCount: 5,
      variant: 'index',
      canShuffle: false,
      drawAfter: false,
      pickToHand: 0,
    };
  } else if (nameLower === 'telling time') {
    config = {
      cardCount: 3,
      variant: 'telling_time',
      canShuffle: false,
      drawAfter: false,
      pickToHand: 1,
    };
  } else if (nameLower === 'mystic speculation') {
    config = {
      cardCount: 3,
      variant: 'index',
      canShuffle: false,
      drawAfter: false,
      pickToHand: 0,
    };
  } else if (nameLower === 'halimar depths') {
    config = {
      cardCount: 3,
      variant: 'index',
      canShuffle: false,
      drawAfter: false,
      pickToHand: 0,
    };
  } else {
    const topMatch = oracleTextLower.match(/look at the top (\d+|three|four|five|six|seven)/i);
    if (topMatch) {
      const numWords: Record<string, number> = {
        one: 1,
        two: 2,
        three: 3,
        four: 4,
        five: 5,
        six: 6,
        seven: 7,
        eight: 8,
        nine: 9,
        ten: 10,
      };
      config.cardCount = numWords[topMatch[1].toLowerCase()] || parseInt(topMatch[1], 10) || 3;
    }

    if (oracleTextLower.includes('may shuffle')) {
      config.canShuffle = true;
    }

    if (oracleTextLower.includes('draw a card') || oracleTextLower.includes('draw 1 card')) {
      config.drawAfter = true;
    }
  }

  return config;
}

export type { InstantSorcerySpellShapeFlags } from './stackResolveSharedTypes.js';
import type { InstantSorcerySpellShapeFlags } from './stackResolveSharedTypes.js';

export function detectInstantSorcerySpellShapeFlags(
  _cardName: string,
  oracleTextLower: string,
): InstantSorcerySpellShapeFlags {
  const normalizedOracleTextLower = String(oracleTextLower || '').replace(/\s+/g, ' ');
  const isRiteOfHarmonyStyleWindow = /whenever a creature or enchantment you control enters this turn, draw a card\.?/i.test(normalizedOracleTextLower);
  const isDivineReckoningStyleChoice = /each player chooses a creature they control\. destroy the rest\.?/i.test(normalizedOracleTextLower);
  const isPrisonersDilemmaStyleChoice = /each opponent secretly chooses silence or snitch, then the choices are revealed\./i.test(normalizedOracleTextLower)
    && /if each opponent chose silence, .* deals 4 damage to each of them\./i.test(normalizedOracleTextLower)
    && /if each opponent chose snitch, .* deals 8 damage to each of them\./i.test(normalizedOracleTextLower)
    && /otherwise, .* deals 12 damage to each opponent who chose silence\./i.test(normalizedOracleTextLower);
  const isSummonsOfSarumanStyle = /\bamass\s+orcs\s+x\b/i.test(normalizedOracleTextLower)
    && /\bmill\s+x\s+cards\b/i.test(normalizedOracleTextLower)
    && /\bwithout\s+paying\s+its\s+mana\s+cost\b/i.test(normalizedOracleTextLower);
  const isNibelheimAflameStyleSweep = /choose target creature you control\. it deals damage equal to its power to each other creature\./i.test(normalizedOracleTextLower);
  const hasNibelheimGraveyardRider = /if this spell was cast from a graveyard, discard your hand and draw four cards\.?/i.test(normalizedOracleTextLower);

  return {
    normalizedOracleTextLower,
    isRiteOfHarmonyStyleWindow,
    isDivineReckoningStyleChoice,
    isPrisonersDilemmaStyleChoice,
    isSummonsOfSarumanStyle,
    isNibelheimAflameStyleSweep,
    hasNibelheimGraveyardRider,
    skipLegacySpellCategorization: isRiteOfHarmonyStyleWindow
      || isDivineReckoningStyleChoice
      || isPrisonersDilemmaStyleChoice
      || isSummonsOfSarumanStyle
      || isNibelheimAflameStyleSweep,
  };
}

export function shouldSkipLegacySpellCategorizationForInstantSorcery(
  cardName: string,
  oracleTextLower: string,
): boolean {
  return detectInstantSorcerySpellShapeFlags(cardName, oracleTextLower).skipLegacySpellCategorization;
}
