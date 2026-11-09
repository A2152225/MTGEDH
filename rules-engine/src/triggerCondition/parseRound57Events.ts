/**
 * Round 57: ordinary leftover events/conditions — life thresholds, has flying, ring tempts,
 * suspected, play another land, gain-control-from-you, become-tapped batch, exile from BF,
 * token+token attack, another-player loses, multi-player discard/sac, attack different players,
 * lore-on-saga, other-than-basic-land, DFC artifact, named dies, next-attack delayed,
 * Gonti don't-own, Ketramose zone-OR, kicks, subtype/keyword attack batches, War Doctor OR,
 * Pyromancer's Goggles promote, then this-way riders (Hidetsugu / Rowen / Explosion).
 * Origin parent: parseFamilies.ts parseTriggerEventSentence.
 * Public: parseRound57TriggerSentence.
 */

import type { TriggerConditionIR } from './types.js';

type Parsed = { condition: TriggerConditionIR; effect: string };
type Reparse = (sentence: string) => Parsed | null;

function withFields(base: Parsed | null, fields: Record<string, unknown>): Parsed | null {
  return base ? { ...base, condition: { ...base.condition, ...fields } as TriggerConditionIR } : null;
}

const WORD_N: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  twenty: 20, thousand: 1000,
};

function stampSubject(base: Parsed | null, patch: Record<string, unknown>): Parsed | null {
  if (!base) return null;
  const alts = (base.condition.alternatives || []).map((a) => ({
    ...a,
    subject: { ...a.subject, ...patch },
  }));
  return { ...base, condition: { ...base.condition, alternatives: alts } as TriggerConditionIR };
}

export function parseRound57TriggerSentence(text: string, reparse: Reparse): Parsed | null {
  // --- Life thresholds --------------------------------------------------
  const oppLifeLess = /^(?:whenever|when)\s+an opponent has (\d+|N|ten|twenty) or less life,\s*(.+)$/.exec(text);
  if (oppLifeLess) {
    const n = oppLifeLess[1] === 'N' || oppLifeLess[1] === 'n' ? 10 : (WORD_N[oppLifeLess[1]] ?? Number(oppLifeLess[1]));
    return withFields(reparse('whenever a player loses life, ' + oppLifeLess[2]), {
      lifeMaximum: n,
      playerSubject: true,
      action: 'life_threshold',
    } as any);
  }
  const youLifeMore = /^(?:whenever|when)\s+you have (\d+|N|twenty|fifty) or more life,\s*(.+)$/.exec(text);
  if (youLifeMore) {
    const n = youLifeMore[1] === 'N' || youLifeMore[1] === 'n' ? 50 : (WORD_N[youLifeMore[1]] ?? Number(youLifeMore[1]));
    return withFields(reparse('whenever you gain life, ' + youLifeMore[2]), {
      lifeMinimum: n,
      action: 'life_threshold',
    } as any);
  }

  // --- Has flying (keyword state) ---------------------------------------
  const hasFlying = /^(?:whenever|when)\s+(this creature|this permanent|~)\s+has flying,\s*(.+)$/.exec(text);
  if (hasFlying) {
    return withFields(reparse(`when ${hasFlying[1]} has no counters on it, ` + hasFlying[2]), {
      noCounters: undefined,
      hasKeyword: 'flying',
    } as any);
  }

  // --- Ring tempts ------------------------------------------------------
  const ringTempts = /^(?:whenever|when)\s+the ring tempts you,\s*(.+)$/.exec(text);
  if (ringTempts) {
    return withFields(reparse('whenever you choose a creature as your ring-bearer, ' + ringTempts[1]), {
      action: 'ring_tempts',
    } as any);
  }

  // --- Suspected attack batch -------------------------------------------
  const suspectedAtk = /^(?:whenever|when)\s+one or more suspected creatures you control attack,\s*(.+)$/.exec(text);
  if (suspectedAtk) {
    return stampSubject(
      withFields(reparse('whenever one or more creatures you control attack, ' + suspectedAtk[1]), {} as any),
      { suspected: true },
    );
  }

  // --- Play another land ------------------------------------------------
  const playAnother = /^(?:whenever|when)\s+you play another land,\s*(.+)$/.exec(text);
  if (playAnother) {
    return withFields(reparse('whenever you play a land, ' + playAnother[1]), {
      excludeSource: true,
    } as any);
  }

  // --- Gain control from you --------------------------------------------
  const gainFromYou = /^(?:whenever|when)\s+an opponent gains control of (a permanent|a creature) from you,\s*(.+)$/.exec(text);
  if (gainFromYou) {
    return withFields(reparse(`whenever an opponent gains control of ${gainFromYou[1]}, ` + gainFromYou[2]), {
      fromYou: true,
    } as any) ?? withFields(reparse(`whenever you lose control of ${gainFromYou[1]}, ` + gainFromYou[2]), {
      fromYou: true,
      pairedEvent: 'gains_control',
    } as any);
  }

  // --- Become-tapped batch ----------------------------------------------
  const becomeTappedBatch = /^(?:whenever|when)\s+one or more creatures you control become tapped,\s*(.+)$/.exec(text);
  if (becomeTappedBatch) {
    return withFields(reparse('whenever a creature you control becomes tapped, ' + becomeTappedBatch[1]), {
      quantity: 'one_or_more',
    } as any);
  }

  // --- Exile from battlefield -------------------------------------------
  const exileFromBf = /^(?:whenever|when)\s+(~|this (?:artifact|creature|permanent|enchantment)|this card)\s+(?:is )?put into exile from the battlefield,\s*(.+)$/.exec(text);
  if (exileFromBf) {
    return withFields(reparse(`whenever ${exileFromBf[1]} is put into exile, ` + exileFromBf[2]), {
      fromZone: 'battlefield',
    } as any);
  }

  // --- Token + token attack ---------------------------------------------
  const tokenTokenAtk = /^(?:whenever|when)\s+this token and at least one other creature token attack,\s*(.+)$/.exec(text);
  if (tokenTokenAtk) {
    return stampSubject(
      withFields(reparse('whenever this creature attacks, ' + tokenTokenAtk[1]), {
        minOtherAttackers: 1,
        sourceAmongAttackers: true,
      } as any),
      { token: 'token' },
    );
  }

  // --- Another player loses ---------------------------------------------
  const anotherLoses = /^(?:whenever|when)\s+another player loses the game,\s*(.+)$/.exec(text);
  if (anotherLoses) {
    return withFields(reparse('whenever a player loses the game, ' + anotherLoses[1]), {
      losesGame: 'not_you' as any,
      action: 'lose_game',
    } as any);
  }
  const anyLoses = /^(?:whenever|when)\s+a player loses the game,\s*(.+)$/.exec(text);
  if (anyLoses) {
    return withFields(reparse('when the chosen player loses the game, ' + anyLoses[1]), {
      losesGame: 'any',
      action: 'lose_game',
    } as any);
  }

  // --- Multi-player discard / sacrifice ---------------------------------
  const multiDiscard = /^(?:whenever|when)\s+one or more players discard one or more cards,\s*(.+)$/.exec(text);
  if (multiDiscard) {
    return withFields(reparse('whenever a player discards a card, ' + multiDiscard[1]), {
      quantity: 'one_or_more',
      onceEachTurn: /this ability triggers only once each turn/i.test(text) ? true : undefined,
    } as any);
  }
  const multiSac = /^(?:whenever|when)\s+one or more players sacrifice one or more creatures,\s*(.+)$/.exec(text);
  if (multiSac) {
    return withFields(reparse('whenever a player sacrifices a creature, ' + multiSac[1]), {
      quantity: 'one_or_more',
    } as any);
  }

  // --- Attack different players -----------------------------------------
  const diffPlayers = /^(?:whenever|when)\s+(this creature|this permanent|~)\s+and another creature attack different players,\s*(.+)$/.exec(text);
  if (diffPlayers) {
    return withFields(reparse(`whenever ${diffPlayers[1]} attacks, ` + diffPlayers[2]), {
      attackDifferentPlayers: true,
      minOtherAttackers: 1,
      sourceAmongAttackers: true,
    } as any);
  }

  // --- Lore counter on a Saga -------------------------------------------
  const loreSaga = /^(?:whenever|when)\s+you put a lore counter on a saga you control,\s*(.+)$/.exec(text);
  if (loreSaga) {
    return withFields(reparse('whenever you put a lore counter on a permanent you control, ' + loreSaga[1]), {
      placedCounter: 'lore',
      sagaSubject: true,
    } as any);
  }

  // --- Other than a basic land ------------------------------------------
  const otherThanBasic = /^(?:whenever|when)\s+a permanent other than a basic land enters(?: the battlefield)?,\s*(.+)$/.exec(text);
  if (otherThanBasic) {
    return stampSubject(
      withFields(reparse('whenever a permanent enters, ' + otherThanBasic[1]), {} as any),
      { excludeBasicLand: true },
    );
  }

  // --- DFC artifact -----------------------------------------------------
  const dfcArtifact = /^(?:whenever|when)\s+(~|this creature|this permanent)\s+or another double-faced artifact you control enters(?: the battlefield)?,\s*(.+)$/.exec(text);
  if (dfcArtifact) {
    return stampSubject(
      withFields(reparse('whenever an artifact you control enters, ' + dfcArtifact[2]), {
        includeSource: true,
      } as any),
      { doubleFaced: true },
    );
  }

  // --- Named dies -------------------------------------------------------
  const namedDies = /^(?:whenever|when)\s+([a-z][a-z0-9' -]{1,40}?)\s+dies,\s*(.+)$/.exec(text);
  if (namedDies && !/^(this|another|an|a|each|one|you|enchanted|equipped|your|the|that|its|a|an)\b/.test(namedDies[1]) && namedDies[1].trim().split(/\s+/).length <= 4) {
    return withFields(reparse('whenever a creature dies, ' + namedDies[2]), {
      requireSubjectName: namedDies[1].trim().toLowerCase(),
    } as any);
  }

  // --- Next attack delayed ----------------------------------------------
  const nextAttack = /^(?:whenever|when)\s+you next attack this turn,\s*(.+)$/.exec(text);
  if (nextAttack) {
    return withFields(reparse('whenever you attack, ' + nextAttack[1]), {
      delayedNextAttack: true,
      onceEachTurn: true,
    } as any);
  }

  // --- Gonti don't-own --------------------------------------------------
  const dontOwn = /^(?:whenever|when)\s+(a player|an opponent|you)\s+casts? a spell (?:they|he or she|that player) don'?t own,\s*(.+)$/.exec(text);
  if (dontOwn) {
    const who = dontOwn[1] === 'you' ? 'you' : dontOwn[1] === 'an opponent' ? 'an opponent' : 'a player';
    return withFields(reparse(`whenever ${who} casts a spell, ` + dontOwn[2]), {
      spellNotOwned: true,
    } as any);
  }

  // --- Ketramose zone-OR exile ------------------------------------------
  const ketramose = /^(?:whenever|when)\s+one or more cards are put into exile from graveyards and\/or the battlefield(?: during your turn)?,\s*(.+)$/.exec(text);
  if (ketramose) {
    return withFields(reparse('whenever one or more cards are put into exile from graveyards, ' + ketramose[1]), {
      fromZone: 'battlefield_or_graveyard',
      quantity: 'one_or_more',
      ...( /during your turn/.test(text) ? { whoseTurn: 'you' } : {}),
    } as any);
  }

  // --- Kicks ------------------------------------------------------------
  const kicks = /^(?:whenever|when)\s+(a player|an opponent|you)\s+kicks? a spell,\s*(.+)$/.exec(text);
  if (kicks) {
    const who = kicks[1] === 'you' ? 'you' : kicks[1] === 'an opponent' ? 'an opponent' : 'a player';
    return withFields(reparse(`whenever ${who} casts a spell, ` + kicks[2]), {
      kickedSpell: true,
    } as any);
  }

  // --- Shipwreck: Spirit or disturb -------------------------------------
  const spiritOrDisturb = /^(?:whenever|when)\s+you discard a spirit card or a card with disturb,\s*(.+)$/.exec(text);
  if (spiritOrDisturb) {
    return stampSubject(
      withFields(reparse('whenever you discard a card, ' + spiritOrDisturb[1]), {
        orHasKeyword: 'disturb',
      } as any),
      { subtypeGroups: [['spirit']] },
    );
  }

  // --- Attack batches: N subtype / keyword ------------------------------
  const atkNSubtype = /^(?:whenever|when)\s+you attack with (?:at least )?(\d+|one|two|three|four|five|six|seven|eight|nine|ten) or more ([a-z][a-z]+?)s?,\s*(.+)$/.exec(text);
  if (atkNSubtype && !/^(creature|permanent|token|nontoken|other|attacking|tapped|untapped)/.test(atkNSubtype[2])) {
    const n = WORD_N[atkNSubtype[1]] ?? Number(atkNSubtype[1]);
    const subtype = atkNSubtype[2].replace(/s$/, '');
    const base = reparse(`whenever one or more ${subtype} creatures you control attack, ` + atkNSubtype[3]);
    if (base && Number.isFinite(n)) {
      return withFields(base, { minAttackers: n, quantity: 'one_or_more' } as any);
    }
  }
  const atkKeyword = /^(?:whenever|when)\s+you attack with at least (two|three|four|five) creatures that have ([a-z][a-z ,/-]+?),\s*(.+)$/.exec(text);
  if (atkKeyword) {
    const n = WORD_N[atkKeyword[1]] ?? Number(atkKeyword[1]);
    const raw = atkKeyword[2].replace(/\s+and\/or\s+/g, ',').replace(/\s+and\s+/g, ',');
    const keywords = raw.split(/,\s*/).map((k) => k.trim()).filter(Boolean);
    const base = reparse('whenever one or more creatures you control attack, ' + atkKeyword[3]);
    if (base && Number.isFinite(n)) {
      return stampSubject(withFields(base, { minAttackers: n, quantity: 'one_or_more' } as any), {
        keywordsWithAny: keywords,
      });
    }
  }

  // --- War Doctor: phase out OR exile -----------------------------------
  const warDoctor = /^(?:whenever|when)\s+one or more other permanents phase out and whenever one or more other cards are put into exile from anywhere,\s*(.+)$/.exec(text);
  if (warDoctor) {
    return withFields(reparse('whenever one or more other permanents leave the battlefield, ' + warDoctor[1]), {
      pairedEvent: 'exiled',
      action: 'phase_out',
      excludeSource: true,
      fromZone: 'anywhere',
    } as any);
  }
  const phaseOut = /^(?:whenever|when)\s+(one or more (?:other )?permanents|a permanent) phase(?:s)? out,\s*(.+)$/.exec(text);
  if (phaseOut) {
    return withFields(reparse(`whenever ${phaseOut[1].replace(/phase.*/, '').trim() || 'a permanent'} leaves the battlefield, ` + phaseOut[2]), {
      action: 'phase_out',
      notDying: true,
    } as any);
  }

  // --- Pyromancer's Goggles: red I/S with source mana --------------------
  const pyroGoggles = /^when that mana is spent to cast an? (red )?(instant or sorcery spell|creature spell),\s*(.+)$/.exec(text);
  if (pyroGoggles) {
    const kind = pyroGoggles[2];
    const base = withFields(reparse(`whenever you cast ${kind.startsWith('instant') ? 'an instant or sorcery spell' : 'a creature spell'}, ` + pyroGoggles[3]), {
      requiresSourceMana: true,
    } as any);
    if (!base) return null;
    if (pyroGoggles[1]) {
      return stampSubject(base, { colors: ['r'] });
    }
    return base;
  }

  // --- Enchanted opponent's end step ------------------------------------
  const enchOppEnd = /^at the beginning of enchanted opponent'?s? end step,\s*(.+)$/.exec(text);
  if (enchOppEnd) {
    return withFields(reparse("at the beginning of enchanted player's end step, " + enchOppEnd[1]), {
      enchantedOpponent: true,
    } as any);
  }

  // --- This-way riders --------------------------------------------------
  const exileThisWay = /^(?:whenever|when)\s+you exile an? (nonland card|card) this way,\s*(.+)$/.exec(text);
  if (exileThisWay) {
    return withFields(reparse('whenever a card is put into exile, ' + exileThisWay[2]), {
      thisWay: true,
      causedByYou: true,
      ...(exileThisWay[1].startsWith('nonland') ? { nonland: true } : {}),
    } as any);
  }
  const revealBasicThisWay = /^(?:whenever|when)\s+you reveal a basic land card this way,\s*(.+)$/.exec(text);
  if (revealBasicThisWay) {
    return withFields(reparse('whenever you play a land, ' + revealBasicThisWay[1]), {
      action: 'reveal',
      thisWay: true,
      basicLand: true,
    } as any);
  }
  const drawThisWay = /^(?:whenever|when)\s+(?:a card is drawn|you draw a card) this way,\s*(.+)$/.exec(text);
  if (drawThisWay) {
    return withFields(reparse('whenever you draw a card, ' + drawThisWay[1]), {
      thisWay: true,
    } as any);
  }
  const preventThisWay = /^(?:whenever|when)\s+damage(?: from (?:a creature|a black or red source))? is prevented this way(?: this turn)?,\s*(.+)$/.exec(text);
  if (preventThisWay) {
    return withFields(reparse('whenever damage that would be dealt to you is prevented, ' + preventThisWay[1]), {
      thisWay: true,
      damagePrevented: true,
    } as any);
  }

  // --- Fuse counters / Magmarch single nonland (cheap leftovers) --------
  const fuseCounters = /^(?:whenever|when)\s+a creature has (four|five|\d+) or more fuse counters on it,\s*(.+)$/.exec(text);
  if (fuseCounters) {
    const n = WORD_N[fuseCounters[1]] ?? Number(fuseCounters[1]);
    return withFields(reparse('whenever a creature enters, ' + fuseCounters[2]), {
      counterMinimum: n,
      placedCounter: 'fuse',
      action: 'counter_state',
    } as any);
  }
  const magmarch = /^(?:whenever|when)\s+you cast an? instant or sorcery spell that targets only a single nonland permanent an opponent controls,\s*(.+)$/.exec(text);
  if (magmarch) {
    return withFields(reparse('whenever you cast an instant or sorcery spell, ' + magmarch[1]), {
      targets: 'permanent',
      targetsOnlyNonland: true,
      targetsOpponent: true,
    } as any);
  }

  // --- Opponent gains control of a permanent (no "from you") base -------
  const oppGains = /^(?:whenever|when)\s+an opponent gains control of (a permanent|a creature),\s*(.+)$/.exec(text);
  if (oppGains) {
    return withFields(reparse(`whenever you lose control of ${oppGains[1]}, ` + oppGains[2]), {
      pairedEvent: 'gains_control',
    } as any);
  }

  return null;
}
