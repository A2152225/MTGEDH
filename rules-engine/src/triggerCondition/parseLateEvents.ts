/**
 * Later trigger-event sentences.
 * Origin parent: parseFamilies.ts parseTriggerEventSentence.
 * Public: parseLateTriggerSentence.
 *
 * Returns null unless the sentence is one event the record can describe.
 * "or" of two different events stays on the old detector, except
 * "create or sacrifice", which sets pairedEvent.
 */

import { parseSubjectPhrase } from './parseSubjectPhrase.js';
import type { TriggerConditionEvent, TriggerConditionIR } from './types.js';

export interface LateTriggerSentence {
  readonly condition: TriggerConditionIR;
  readonly effect: string;
}

function actorController(actor: string): 'you' | 'not_you' | 'any' {
  if (actor === 'you') return 'you';
  if (actor === 'an opponent') return 'not_you';
  return 'any';
}

function withController(condition: TriggerConditionIR, controller: 'you' | 'not_you' | 'any'): TriggerConditionIR {
  return {
    ...condition,
    alternatives: condition.alternatives.map((alternative) => ({ ...alternative, controller })),
  };
}

function prepareSubjectPhrase(raw: string): string {
  let text = raw.replace(/\band\/or\b/gi, 'or').replace(/,(?=\s*non)/gi, '').replace(/\bcards?\b/g, ' ').replace(/\s+/g, ' ').trim();
  if (text === 'one or more' || text.startsWith('one or more ')) {
    const rest = text.slice('one or more'.length).trim();
    const noun = rest === '' || rest === 'a' || rest === 'an' ? 'permanent' : rest;
    const article = /^(?:a|an|this|another|other)\b/.test(noun) ? noun : `a ${noun}`;
    return `one or more ${article}`;
  }
  if (text === '' || text === 'a' || text === 'an') return 'a permanent';
  if (text === '~') return 'this permanent';
  if (text === 'this' || text === 'that') return 'this permanent';
  if (text === 'another' || text === 'other') return 'another permanent';
  if (!/^(?:a|an|this|another|other|enchanted|equipped)\b/.test(text)) return `a ${text}`;
  return text;
}

function subjectEvent(
  event: TriggerConditionEvent,
  rawSubject: string,
  effect: string,
  extra: Partial<TriggerConditionIR> = {},
): LateTriggerSentence | null {
  const attached = /^(enchanted|equipped)\s+(.+)$/.exec(rawSubject.trim());
  let subject = parseSubjectPhrase(prepareSubjectPhrase(rawSubject), event);
  if (!subject && attached) {
    const inner = parseSubjectPhrase(prepareSubjectPhrase(attached[2]), event);
    subject = inner
      ? { ...inner, alternatives: inner.alternatives.map((alternative) => ({ ...alternative, source: attached[1] as 'enchanted' | 'equipped' })) }
      : null;
  }
  const trimmed = effect.trim();
  if (!subject || !trimmed) return null;
  return { condition: { ...subject, ...extra, event }, effect: trimmed };
}

const PERFORM_ACTIONS: ReadonlyArray<{ phrase: string; action: string }> = [
  { phrase: 'activate an exhaust ability', action: 'activate_exhaust' },
  { phrase: "activate an ability that isn't a mana ability", action: 'activate_nonmana' },
  { phrase: "activate an ability of an artifact or creature that isn't a mana ability", action: 'activate_nonmana' },
  { phrase: 'activate an ability that targets a creature or player', action: 'activate_targeting' },
  { phrase: "activate an ability of a creature or artifact that isn't a mana ability", action: 'activate_nonmana' },
  { phrase: 'activate a loyalty ability', action: 'activate_loyalty' },
  { phrase: 'plot', action: 'plot' },
  { phrase: 'activate an ability of an artifact', action: 'activate_artifact' },
  { phrase: 'activate an ability of an elemental', action: 'activate_elemental' },
  { phrase: 'activate an eternalize or embalm ability', action: 'activate_eternalize_or_embalm' },
  { phrase: 'activate a ninjutsu ability', action: 'activate_ninjutsu' },
  { phrase: 'activate an embalm ability', action: 'activate_embalm' },
  { phrase: 'activate an eternalize ability', action: 'activate_eternalize' },
  { phrase: 'put an ability sticker on a creature', action: 'place_ability_sticker' },
  { phrase: 'activate an ability of a creature', action: 'activate_creature' },
  { phrase: 'activate an ability', action: 'activate_ability' },
  { phrase: 'foretell a card', action: 'foretell' },
  { phrase: 'roll a die', action: 'roll_die' },
  { phrase: 'roll the planar die', action: 'roll_planar_die' },
  { phrase: 'roll one or more dice', action: 'roll_die' },
  { phrase: 'win a coin flip', action: 'win_coin_flip' },
  { phrase: 'win the flip', action: 'win_coin_flip' },
  { phrase: 'lose a coin flip', action: 'lose_coin_flip' },
  { phrase: 'become the monarch', action: 'become_monarch' },
  { phrase: 'collect evidence', action: 'collect_evidence' },
  { phrase: 'waterbend', action: 'waterbend' },
  { phrase: 'roll to visit your attractions', action: 'visit_attraction' },
  { phrase: 'put an art sticker on a creature', action: 'place_art_sticker' },
  { phrase: 'put a name sticker on a creature', action: 'place_name_sticker' },
  { phrase: 'choose a creature as your ring-bearer', action: 'choose_ring_bearer' },
  { phrase: 'place a sticker', action: 'place_sticker' },
  { phrase: 'put a sticker on this enchantment', action: 'place_sticker' },
  { phrase: 'exert a creature', action: 'exert' },
  { phrase: 'complete a dungeon', action: 'complete_dungeon' },
  { phrase: 'surveil', action: 'surveil' },
  { phrase: 'scry', action: 'scry' },
  { phrase: 'explore', action: 'explore' },
  { phrase: 'connive', action: 'connive' },
  { phrase: 'discover', action: 'discover' },
  { phrase: 'clash', action: 'clash' },
  { phrase: 'win a clash', action: 'win_clash' },
  { phrase: 'expend', action: 'expend' },
  { phrase: 'proliferate', action: 'proliferate' },
  { phrase: 'forage', action: 'forage' },
  { phrase: 'investigate', action: 'investigate' },
  { phrase: 'give a gift', action: 'give_gift' },
  { phrase: 'manifest dread', action: 'manifest_dread' },
  { phrase: 'open an attraction', action: 'open_attraction' },
  { phrase: 'visit an attraction', action: 'visit_attraction' },
];

function fromZoneOf(phrase: string): TriggerConditionIR['fromZone'] | null {
  if (phrase === 'the battlefield') return 'battlefield';
  if (phrase === 'anywhere') return 'anywhere';
  if (phrase === 'anywhere other than your hand') return 'not_hand';
  if (phrase === 'your library') return 'library';
  if (phrase === 'your hand') return 'hand';
  if (phrase === 'your graveyard' || phrase === 'a graveyard' || phrase === 'graveyard') return 'graveyard';
  if (phrase === 'exile') return 'exile';
  return null;
}

export function parseLateTriggerSentence(text: string): LateTriggerSentence | null {
  const bfOrGyExile = /^(?:whenever|when)\s+one or more creatures you control and\/or creature cards in your graveyard (?:are|is) put into exile,\s*(.+)$/.exec(text);
  if (bfOrGyExile) {
    return subjectEvent('exiled', 'one or more creatures you control', bfOrGyExile[1], { fromZone: 'battlefield_or_graveyard', quantity: 'one_or_more' } as any);
  }
  const otherThanSelfExiled = /^(?:whenever|when)\s+a creature other than (~|this creature|this permanent) is exiled(?: from the battlefield)?,\s*(.+)$/.exec(text);
  if (otherThanSelfExiled) {
    return subjectEvent('exiled', 'another creature', otherThanSelfExiled[2], { fromZone: 'battlefield' } as any);
  }
  const weddingDraw = /^(?:whenever|when)\s+an opponent who controls an artifact named (~|this artifact|[^,]+) draws? a card during their turn,\s*(.+)$/.exec(text);
  if (weddingDraw) {
    const named = weddingDraw[1] === '~' || weddingDraw[1] === 'this artifact' ? 'self' : weddingDraw[1];
    const parsed = subjectEvent('draws_card', 'a permanent', weddingDraw[2], { requiresOpponentControlsNamed: named === 'self' ? undefined : named, whoseTurn: 'not_you', playerSubject: true } as any);
    return parsed ? { condition: withController({ ...parsed.condition, requiresOpponentControlsNamed: named === 'self' ? '__SOURCE_NAME__' : named, whoseTurn: 'not_you' } as any, 'not_you'), effect: parsed.effect } : null;
  }
  const weddingLife = /^(?:whenever|when)\s+an opponent who controls an artifact named (~|this artifact|[^,]+) gains? life during their turn,\s*(.+)$/.exec(text);
  if (weddingLife) {
    const named = weddingLife[1] === '~' || weddingLife[1] === 'this artifact' ? '__SOURCE_NAME__' : weddingLife[1];
    const parsed = subjectEvent('gains_life', 'a permanent', weddingLife[2], { requiresOpponentControlsNamed: named, whoseTurn: 'not_you', playerSubject: true } as any);
    return parsed ? { condition: withController(parsed.condition, 'not_you'), effect: parsed.effect } : null;
  }
  const attackSelfOrCommander = /^whenever you attack with (?:this creature|~) and\/or your commander,\s*(.+)$/.exec(text);
  if (attackSelfOrCommander) {
    const base = parseSubjectPhrase('one or more creatures you control', 'attacks');
    if (!base) return null;
    return { condition: { ...base, sourceAmongAttackers: true, orCommanderAttacks: true, minOtherAttackers: 0 } as any, effect: attackSelfOrCommander[1].trim() };
  }
  const tergrid = /^(?:whenever|when)\s+an opponent sacrifices a nontoken permanent or discards a permanent card,\s*(.+)$/.exec(text);
  if (tergrid) {
    const parsed = subjectEvent('sacrifices', 'a nontoken permanent', tergrid[1], { pairedEvent: 'discards' } as any);
    return parsed ? { condition: withController(parsed.condition, 'not_you'), effect: parsed.effect } : null;
  }
  const painMag = /^(?:whenever|when)\s+an opponent is dealt (\d+) or more damage by a single source,\s*(.+)$/.exec(text);
  if (painMag) {
    const parsed = subjectEvent('dealt_damage', 'a permanent', painMag[2], { playerSubject: true, minDamageAmount: Number(painMag[1]) } as any);
    return parsed ? { condition: withController(parsed.condition, 'not_you'), effect: parsed.effect } : null;
  }
  const firstNoncreature = /^(?:whenever|when)\s+the first noncreature spell of a turn is cast,\s*(.+)$/.exec(text);
  if (firstNoncreature) {
    return subjectEvent('spell_cast', 'a noncreature spell', firstNoncreature[1], { spellOrdinal: 1, anyController: true } as any);
  }
  const castFromNotHand = /^(?:whenever|when)\s+(?:another player|an opponent) casts? a spell from anywhere other than (?:their|his or her) hand,\s*(.+)$/.exec(text);
  if (castFromNotHand) {
    const parsed = subjectEvent('spell_cast', 'a spell', castFromNotHand[1], { castFromZone: 'not_hand' } as any);
    return parsed ? { condition: withController(parsed.condition, 'not_you'), effect: parsed.effect } : null;
  }
  const oppPutsCounters = /^(?:whenever|when)\s+an opponent puts? one or more counters on a creature they control,\s*(.+)$/.exec(text);
  if (oppPutsCounters) {
    const parsed = subjectEvent('counter_placed', 'a creature', oppPutsCounters[1], { causedByOpponent: true } as any);
    return parsed ? { condition: withController(parsed.condition, 'not_you'), effect: parsed.effect } : null;
  }
  const playNonbasic = /^(?:whenever|when)\s+an opponent plays? a nonbasic land,\s*(.+)$/.exec(text);
  if (playNonbasic) {
    const parsed = subjectEvent('plays_land', 'a nonbasic land', playNonbasic[1]);
    return parsed ? { condition: withController(parsed.condition, 'not_you'), effect: parsed.effect } : null;
  }
  const drawFirstOrSecond = /^(?:whenever|when)\s+you draw your (?:first or second|second or first) card each turn,\s*(.+)$/.exec(text);
  if (drawFirstOrSecond) {
    const parsed = subjectEvent('draws_card', 'a permanent', drawFirstOrSecond[1], { drawOrdinalMax: 2, playerSubject: true } as any);
    return parsed ? { condition: withController(parsed.condition, 'you'), effect: parsed.effect } : null;
  }
  const opponentsAttacked = /^(?:whenever|when)\s+one or more of your opponents (?:are|is) attacked,\s*(.+)$/.exec(text);
  if (opponentsAttacked) {
    const base = parseSubjectPhrase('one or more creatures', 'attacks');
    if (!base) return null;
    return { condition: { ...base, attackedPlayer: 'opponent', quantity: 'one_or_more' } as any, effect: opponentsAttacked[1].trim() };
  }
  const sameNameAsGy = /^(?:whenever|when)\s+(?:you|an opponent) casts? an? (instant or sorcery|creature or planeswalker) spell that has the same name as a card in (?:your|their) graveyard,\s*(.+)$/.exec(text);
  if (sameNameAsGy) {
    const actor = /^whenever you/.test(text) ? 'you' : 'not_you';
    const kind = sameNameAsGy[1].includes('instant') ? 'an instant or sorcery spell' : 'a creature or planeswalker spell';
    const parsed = subjectEvent('spell_cast', kind, sameNameAsGy[2], { sameNameAsGraveyard: true } as any);
    return parsed ? { condition: withController(parsed.condition, actor as any), effect: parsed.effect } : null;
  }
  const loseFlip = /^(?:whenever|when)\s+you lose (?:the|a) (?:coin )?flip,\s*(.+)$/.exec(text);
  if (loseFlip) {
    const parsed = subjectEvent('performs', 'a permanent', loseFlip[1], { action: 'lose_coin_flip' } as any);
    return parsed ? { condition: withController(parsed.condition, 'you'), effect: parsed.effect } : null;
  }
  const noLegendaryVampire = /^(?:whenever|when) you don't control a legendary vampire,\s*(.+)$/.exec(text);
  if (noLegendaryVampire) {
    const parsed = parseSubjectPhrase('a legendary vampire', 'controls_none' as any);
    return parsed ? { condition: withController({ ...parsed, event: 'controls_none' } as any, 'you'), effect: noLegendaryVampire[1].trim() } : null;
  }
  const putIntoExileAny = /^(?:whenever|when)\s+(.+?)\s+(?:is|are) put into exile(?: during your turn)?,\s*(.+)$/.exec(text);
  if (putIntoExileAny && !/from /.test(putIntoExileAny[1]) && !/from /.test(text)) {
    return subjectEvent('exiled', putIntoExileAny[1], putIntoExileAny[2], {
      fromZone: 'anywhere',
      ...(/ during your turn,/.test(text) ? { whoseTurn: 'you' as const } : {}),
    });
  }
  const putIntoExile = /^(?:whenever|when)\s+(.+?)\s+(?:is|are) put into exile from (?:your |a )?graveyards?,\s*(.+)$/.exec(text);
  if (putIntoExile) return subjectEvent('exiled', putIntoExile[1], putIntoExile[2], { fromZone: 'graveyard' });

  const control = /^(?:whenever|when)\s+you\s+(gain|lose)\s+control\s+of\s+(.+?)(?:\s+from another player)?,\s*(.+)$/.exec(text);
  if (control) {
    const parsed = subjectEvent(control[1] === 'gain' ? 'gains_control' : 'loses_control', control[2], control[3]);
    return parsed ? { condition: withController(parsed.condition, 'you'), effect: parsed.effect } : null;
  }

  const isSacrificed = /^(?:whenever|when)\s+(.+?)\s+(?:is|are) sacrificed,\s*(.+)$/.exec(text);
  if (isSacrificed && !/\bor\b/.test(isSacrificed[1].replace(/\bone or more\b/g, '')) && !/destroyed/.test(text)) {
    return subjectEvent('sacrifices', isSacrificed[1], isSacrificed[2]);
  }
  const isDestroyed = /^(?:whenever|when)\s+(.+?)\s+(?:is|are) destroyed,\s*(.+)$/.exec(text);
  if (isDestroyed && !/\bor\b/.test(isDestroyed[1].replace(/\bone or more\b/g, '')) && !/sacrificed/.test(text)) {
    return subjectEvent('dies', isDestroyed[1], isDestroyed[2]);
  }
  const sacOrDestroyed = /^(?:whenever|when)\s+(.+?)\s+(?:is|are) sacrificed or destroyed,\s*(.+)$/.exec(text);
  if (sacOrDestroyed && !/\bor\b/.test(sacOrDestroyed[1].replace(/\bone or more\b/g, ''))) {
    return subjectEvent('sacrifices', sacOrDestroyed[1], sacOrDestroyed[2], { pairedEvent: 'dies' } as any);
  }
  const leaves = /^(?:whenever|when)\s+(.+?)\s+leave(?:s)?(?: the battlefield)?( during your turn)?( without dying)?,\s*(.+)$/.exec(text);
  if (leaves && !/\bor\b/.test(leaves[1].replace(/\bone or more\b/g, ''))) {
    return subjectEvent('leaves_battlefield', leaves[1], leaves[4], {
      ...(leaves[2] ? { whoseTurn: 'you' as const } : {}),
      ...(leaves[3] ? { notDying: true } : {}),
    });
  }

  const cumulativeUnpaid = /^(?:whenever|when) a player doesn't pay (?:this enchantment's |this permanent's )?cumulative upkeep,\s*(.+)$/.exec(text);
  if (cumulativeUnpaid) {
    return subjectEvent('performs', 'a permanent', cumulativeUnpaid[1], { action: 'cumulative_upkeep_unpaid', cumulativeUpkeepUnpaid: true } as any);
  }
  const preventedDmg = /^(?:whenever|when) damage that would be dealt to you is prevented,\s*(.+)$/.exec(text);
  if (preventedDmg) {
    const parsed = subjectEvent('dealt_damage', 'a permanent', preventedDmg[1], { damagePrevented: true, playerSubject: true } as any);
    return parsed ? { condition: withController(parsed.condition, 'you'), effect: parsed.effect } : null;
  }
  const naturalRoll = /^(?:whenever|when) you roll a natural (\d+),\s*(.+)$/.exec(text);
  if (naturalRoll) {
    const parsed = subjectEvent('performs', 'a permanent', naturalRoll[2], { action: 'roll_die', naturalRoll: Number(naturalRoll[1]) } as any);
    return parsed ? { condition: withController(parsed.condition, 'you'), effect: parsed.effect } : null;
  }
  const noLands = /^(?:whenever|when) there are no lands on the battlefield,\s*(.+)$/.exec(text);
  if (noLands) {
    const parsed = parseSubjectPhrase('a land', 'controls_none' as any);
    return parsed ? { condition: withController({ ...parsed, event: 'controls_none' } as any, 'any'), effect: noLands[1].trim() } : null;
  }
  const noCardsHand = /^(?:whenever|when) a player has no cards in hand,\s*(.+)$/.exec(text);
  if (noCardsHand) {
    return subjectEvent('controls_none' as any, 'a permanent', noCardsHand[1], { emptyZone: 'hand', playerSubject: true } as any);
  }
  const noGy = /^(?:whenever|when) there are no cards in your graveyard,\s*(.+)$/.exec(text);
  if (noGy) {
    return subjectEvent('controls_none' as any, 'a permanent', noGy[1], { emptyZone: 'graveyard' } as any);
  }
  const playExiledWith = /^(?:whenever|when)\s+(you|a player|an opponent) plays? a card exiled with (~|this creature|this permanent|this artifact),\s*(.+)$/.exec(text);
  if (playExiledWith) {
    const ctrl = actorController(playExiledWith[1] === 'a player' ? 'a player' : playExiledWith[1]);
    const parsed = subjectEvent('spell_cast', 'a permanent', playExiledWith[3], { exiledWithSource: true, castFromZone: 'exile', anyObject: true } as any);
    if (parsed) return { condition: withController({ ...parsed.condition, alternatives: parsed.condition.alternatives.map((a) => ({ ...a, subject: { ...a.subject, anyObject: true } })) } as any, ctrl), effect: parsed.effect };
    // Fallback: plays_land shape for land cards from exile
    const land = subjectEvent('plays_land', 'a land', playExiledWith[3], { exiledWithSource: true } as any);
    return land ? { condition: withController(land.condition, ctrl), effect: land.effect } : null;
  }
  const chalice = /^(?:whenever|when) a player casts a spell with mana value equal to the number of charge counters on (?:this artifact|this permanent|~),\s*(.+)$/.exec(text);
  if (chalice) {
    const parsed = subjectEvent('spell_cast', 'a permanent', chalice[1], { manaValueEqualsChargeCounters: true, anyObject: true } as any);
    return parsed ? { condition: { ...parsed.condition, alternatives: parsed.condition.alternatives.map((a) => ({ ...a, subject: { ...a.subject, anyObject: true } })) }, effect: parsed.effect } : null;
  }
  const ichneumon = /^(?:whenever|when) an opponent casts an? (instant|sorcery) spell other than the first \1 spell that player casts each turn,\s*(.+)$/.exec(text);
  if (ichneumon) {
    const parsed = subjectEvent('spell_cast', 'a permanent', ichneumon[2], { excludeFirstSpellEachTurn: true, spellTypes: [ichneumon[1]] } as any);
    return parsed ? { condition: withController({ ...parsed.condition, alternatives: parsed.condition.alternatives.map((a) => ({ ...a, subject: { ...a.subject, anyObject: true, ...(ichneumon[1] === 'instant' ? { typeGroups: [['instant']], groups: [{ types: ['instant'], subtypes: [] }] } : { typeGroups: [['sorcery']], groups: [{ types: ['sorcery'], subtypes: [] }] }) } })) } as any, 'not_you'), effect: parsed.effect } : null;
  }
  const golemTarget = /^(?:whenever|when) a player casts an? (instant or sorcery spell) that targets only a single ([a-z]+),\s*(.+)$/.exec(text);
  if (golemTarget) {
    const parsed = subjectEvent('spell_cast', 'a permanent', golemTarget[3], { targets: 'creature', targetsOnlySubtype: golemTarget[2] } as any);
    return parsed ? { condition: { ...parsed.condition, alternatives: parsed.condition.alternatives.map((a) => ({ ...a, subject: { ...a.subject, anyObject: true, typeGroups: [['instant'], ['sorcery']], groups: [{ types: ['instant'], subtypes: [] }, { types: ['sorcery'], subtypes: [] }] } })) }, effect: parsed.effect } : null;
  }
  const sourceMinDmg = /^(?:whenever|when) a source you control deals (\d+) or more damage to (?:a player|an opponent|you),\s*(.+)$/.exec(text);
  if (sourceMinDmg) {
    const parsed = subjectEvent('deals_damage', 'a permanent you control', sourceMinDmg[2], { minDamageAmount: Number(sourceMinDmg[1]) } as any);
    return parsed ? { condition: withController(parsed.condition, 'you'), effect: parsed.effect } : null;
  }
  const destroyNoncre = /^(?:whenever|when) a spell or ability an opponent controls destroys a (noncreature permanent you control|permanent you control),\s*(.+)$/.exec(text);
  if (destroyNoncre) {
    return subjectEvent('dies', destroyNoncre[1].replace(' you control', ''), destroyNoncre[2], { destroyedByOpponent: true } as any);
  }
  const discardOrMill = /^(?:whenever|when) (you|an opponent|a player) discards? a card or mills? one or more cards,\s*(.+)$/.exec(text);
  if (discardOrMill) {
    const parsed = subjectEvent('discards', 'a card', discardOrMill[2], { pairedEvent: 'mills' } as any);
    return parsed ? { condition: withController(parsed.condition, actorController(discardOrMill[1])), effect: parsed.effect } : null;
  }
  const losesGame = /^(?:whenever|when) (the chosen player|enchanted player|a player) loses the game,\s*(.+)$/.exec(text);
  if (losesGame) {
    const who = losesGame[1].startsWith('the chosen') ? 'chosen_player' : losesGame[1].startsWith('enchanted') ? 'enchanted_player' : 'any';
    return subjectEvent('performs', 'a permanent', losesGame[2], { action: 'lose_game', losesGame: who } as any);
  }
  const chargeMin = /^(?:whenever|when) (?:this artifact|this permanent|~) has (\w+) or more charge counters on it,\s*(.+)$/.exec(text);
  if (chargeMin) {
    const WORD: Record<string, number> = { ten: 10, twenty: 20, thirty: 30, forty: 40, fifty: 50 };
    const n = WORD[chargeMin[1]] ?? Number(chargeMin[1]);
    if (Number.isFinite(n)) return subjectEvent('controls_none' as any, 'this permanent', chargeMin[2], { chargeCounterMinimum: n } as any);
  }
  const loyaltyMax = /^(?:whenever|when) (?:this permanent|this creature|~|[a-z][a-z]+) has (\w+) or fewer loyalty counters on (?:him|her|it|them),\s*(.+)$/.exec(text);
  if (loyaltyMax) {
    const WORD: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5 };
    const n = WORD[loyaltyMax[1]] ?? Number(loyaltyMax[1]);
    if (Number.isFinite(n)) return subjectEvent('controls_none' as any, 'this permanent', loyaltyMax[2], { loyaltyMaximum: n } as any);
  }
  const exileLibGy = /^(?:whenever|when) one or more cards are put into exile from your library and\/or your graveyard,\s*(.+)$/.exec(text);
  if (exileLibGy) {
    return subjectEvent('exiled', 'a permanent', exileLibGy[1], { fromZone: 'library_or_graveyard', quantity: 'one_or_more' } as any);
  }
  const fightOrBlocked = /^(?:whenever|when) one or more creatures you control fight or become blocked,\s*(.+)$/.exec(text);
  if (fightOrBlocked) {
    return subjectEvent('becomes_blocked', 'one or more creatures you control', fightOrBlocked[1], { pairedEvent: 'performs', action: 'fight' } as any);
  }
  const unblockedAttackYou = /^(?:whenever|when) one or more creatures an opponent controls attack you and aren't blocked,\s*(.+)$/.exec(text);
  if (unblockedAttackYou) {
    return subjectEvent('attacks_unblocked', 'one or more creatures an opponent controls', unblockedAttackYou[1], { attackedPlayer: 'you' } as any);
  }
  const surrak = /^(?:whenever|when) a creature you control or a creature spell you control becomes the target of a spell or ability an opponent controls,\s*(.+)$/.exec(text);
  if (surrak) {
    return subjectEvent('becomes_target', 'a creature you control', surrak[1], { orSpellSubject: true, targetedBy: { controller: 'not_you', kind: 'spell_or_ability' } } as any);
  }
  const endStepOfThatNext = /^(?:at the beginning of the end step of that player's next turn),\s*(.+)$/.exec(text);
  if (endStepOfThatNext) {
    return { condition: { event: 'beginning_of_end_step', quantity: 'one', whoseTurn: 'that_player', delayedNextTurn: true, alternatives: [] } as any, effect: endStepOfThatNext[1].trim() };
  }
  const lastOre = /^(?:whenever|when) the last ([a-z]+) counter is removed from (?:this aura|this permanent|~),\s*(.+)$/.exec(text);
  if (lastOre) {
    return subjectEvent('last_counter_removed' as any, 'this permanent', lastOre[2], { placedCounter: lastOre[1] } as any);
  }
  const twelfthHour = /^(?:whenever|when) the twelfth hour counter is put on (?:this artifact|this permanent|~),\s*(.+)$/.exec(text);
  if (twelfthHour) {
    return subjectEvent('counter_placed', 'this permanent', twelfthHour[1], { placedCounter: 'hour', counterOrdinal: 12 } as any);
  }
  const hellish = /^(?:whenever|when) (?:this permanent|this creature|~) deals damage to the player who cast (?:~|this spell|[^,]+),\s*(.+)$/.exec(text);
  if (hellish) {
    return subjectEvent('deals_damage', 'this permanent', hellish[1], { damageRecipient: 'opponent', thatSpell: true } as any);
  }
  const bounce = /^(?:whenever|when)\s+(.+?)\s+(?:is|are) returned to (your|its owner's|a player's)? ?hand(?: from the battlefield)?,\s*(.+)$/.exec(text);
  if (bounce) {
    const zoneOwner = bounce[2] === 'your' ? 'you' : 'any';
    return subjectEvent('returned_to_hand', bounce[1], bounce[3], { zoneOwner });
  }

  const countered = /^(?:whenever|when)\s+(a spell you control|a spell you've cast|a spell you have cast|a spell)\s+is countered,\s*(.+)$/.exec(text);
  if (countered) {
    const yours = countered[1] !== 'a spell';
    const parsed = subjectEvent('spell_countered', 'a permanent', countered[2], yours ? { zoneOwner: 'you' } : {});
    return parsed;
  }

  const youCounter = /^(?:whenever|when)\s+you counter a spell,\s*(.+)$/.exec(text);
  if (youCounter) {
    const parsed = subjectEvent('counters_spell', 'a permanent', youCounter[1]);
    return parsed ? { condition: withController(parsed.condition, 'you'), effect: parsed.effect } : null;
  }

  const yourSpellCounters = /^(?:whenever|when)\s+a spell or ability you control counters a spell,\s*(.+)$/.exec(text);
  if (yourSpellCounters) {
    const parsed = subjectEvent('counters_spell', 'a permanent', yourSpellCounters[1]);
    return parsed ? { condition: withController(parsed.condition, 'you'), effect: parsed.effect } : null;
  }

  const stack = /^(?:whenever|when)\s+a spell or ability is put onto the stack,\s*(.+)$/.exec(text);
  if (stack) return subjectEvent('put_on_stack', 'a permanent', stack[1]);

  const cycleOrDiscard = /^(?:whenever|when)\s+(you|an opponent|a player)\s+cycles? or discards?\s+(?:a|another|one or more)\s+cards?,\s*(.+)$/.exec(text);
  if (cycleOrDiscard) {
    const parsed = subjectEvent('cycles', 'a card', cycleOrDiscard[2], { pairedEvent: 'discards' });
    return parsed ? { condition: withController(parsed.condition, actorController(cycleOrDiscard[1])), effect: parsed.effect } : null;
  }
  const cycle = /^(?:whenever|when)\s+(you|an opponent|a player)\s+cycles?\s+(?:a|another|one or more)\s+cards?,\s*(.+)$/.exec(text);
  if (cycle && !/\bcycle or discard\b/.test(text)) {
    const parsed = subjectEvent('cycles', 'a card', cycle[2]);
    return parsed ? { condition: withController(parsed.condition, actorController(cycle[1])), effect: parsed.effect } : null;
  }

  const becomeUntappedSelf = /^(?:whenever|when)\s+(~|this creature|this permanent) becomes? untapped(?: during your untap step)?,\s*(.+)$/.exec(text);
  if (becomeUntappedSelf) {
    return subjectEvent('becomes_untapped', becomeUntappedSelf[1], becomeUntappedSelf[2], {
      ...(/during your untap step/.test(text) ? { duringUntapStep: true } : {}),
    } as any);
  }
  const transform = /^(?:whenever|when)\s+(.+?)\s+transforms,\s*(.+)$/.exec(text);
  if (transform) return subjectEvent('transforms', transform[1], transform[2]);

  const mutate = /^(?:whenever|when)\s+(.+?)\s+mutates,\s*(.+)$/.exec(text);
  if (mutate) return subjectEvent('mutates', mutate[1], mutate[2]);

  const attached = /^(?:whenever|when)\s+this equipment becomes attached to (?:a creature|a permanent),\s*(.+)$/.exec(text);
  if (attached) return subjectEvent('becomes_attached', 'this equipment', attached[1]);
  // Host watchers: "Whenever an Aura becomes attached to this creature".
  const auraYouCtrlAttached = /^(?:whenever|when)\s+(?:an? )?aura you control becomes attached to (a creature you control|a nonland permanent an opponent controls(?: with mana value less than or equal to that aura's mana value)?),\s*(.+)$/i.exec(text);
  if (auraYouCtrlAttached) {
    return subjectEvent('becomes_attached', 'an aura you control', auraYouCtrlAttached[2]);
  }
  const auraToHost = /^(?:whenever|when)\s+(?:an? )?(aura) becomes attached to (?:this creature|this permanent|~),\s*(.+)$/i.exec(text);
  if (auraToHost) {
    return subjectEvent('becomes_attached', 'an ' + auraToHost[1], auraToHost[2], { attachedToSource: true });
  }

  const unattached = /^(?:whenever|when)\s+this equipment becomes unattached from a permanent,\s*(.+)$/.exec(text);
  if (unattached) return subjectEvent('becomes_unattached', 'this equipment', unattached[1]);

  const monstrous = /^(?:whenever|when)\s+this creature becomes monstrous,\s*(.+)$/.exec(text);
  if (monstrous) return subjectEvent('becomes_monstrous', 'this creature', monstrous[1]);

  const crewed = /^(?:whenever|when)\s+this vehicle becomes crewed( for the first time each turn)?,\s*(.+)$/.exec(text);
  if (crewed) return subjectEvent('becomes_crewed', 'this vehicle', crewed[2], crewed[1] ? { onceEachTurn: true } : {});

  const saddled = /^(?:whenever|when)\s+this creature becomes saddled( for the first time each turn)?,\s*(.+)$/.exec(text);
  if (saddled) return subjectEvent('becomes_saddled', 'this creature', saddled[2], saddled[1] ? { onceEachTurn: true } : {});

  const cardsAreExiled = /^(?:whenever|when)\s+(one or more )?cards? (?:is|are) exiled(?: from (anywhere|the battlefield|a graveyard|your graveyard|your hand|your library))?(?: during your turn)?,\s*(.+)$/.exec(text);
  if (cardsAreExiled) {
    const fromZone = !cardsAreExiled[2] || cardsAreExiled[2] === 'anywhere' ? 'anywhere'
      : cardsAreExiled[2] === 'the battlefield' ? 'battlefield'
      : /graveyard/.test(cardsAreExiled[2]) ? 'graveyard'
      : cardsAreExiled[2] === 'your hand' ? 'hand'
      : cardsAreExiled[2] === 'your library' ? 'library' : 'anywhere';
    const parsed = subjectEvent('exiled', 'a permanent', cardsAreExiled[3], { fromZone, anyObject: true } as any);
    const during = / during your turn,/.test(text);
    return parsed ? { condition: { ...parsed.condition, ...(during ? { whoseTurn: 'you' as const } : {}), ...(cardsAreExiled[1] ? { quantity: 'one_or_more' as const } : {}) }, effect: parsed.effect } : null;
  }
  const actorDealt = /^(?:whenever|when)\s+(an opponent|a player)\s+(?:is|are) dealt (excess )?(combat |noncombat )?damage,\s*(.+)$/.exec(text);
  if (actorDealt) {
    const damageKind = actorDealt[3]?.trim() === 'combat' ? 'combat' : actorDealt[3]?.trim() === 'noncombat' ? 'noncombat' : 'any';
    const parsed = subjectEvent('dealt_damage', 'a permanent', actorDealt[4], { damageKind, playerSubject: true, ...(actorDealt[2] ? { requiresExcess: true } : {}) });
    return parsed ? { condition: withController(parsed.condition, actorController(actorDealt[1])), effect: parsed.effect } : null;
  }
  const youDealt = /^(?:whenever|when)\s+you(?:'re| are)\s+dealt (combat |noncombat )?damage,\s*(.+)$/.exec(text);
  if (youDealt) {
    const damageKind = youDealt[1]?.trim() === 'combat' ? 'combat' : youDealt[1]?.trim() === 'noncombat' ? 'noncombat' : 'any';
    const parsed = subjectEvent('dealt_damage', 'a permanent', youDealt[2], { damageKind, playerSubject: true });
    return parsed ? { condition: withController(parsed.condition, 'you'), effect: parsed.effect } : null;
  }

  const dealt = /^(?:whenever|when)\s+(.+?)\s+(?:is|are) dealt (excess )?(combat |noncombat )?damage,\s*(.+)$/.exec(text);
  if (dealt) {
    const damageKind = dealt[3]?.trim() === 'combat' ? 'combat' : dealt[3]?.trim() === 'noncombat' ? 'noncombat' : 'any';
    return subjectEvent('dealt_damage', dealt[1], dealt[4], { damageKind, ...(dealt[2] ? { requiresExcess: true } : {}) });
  }

  const playerPutsLand = /^(?:whenever|when)\s+(you|an opponent|a player)\s+puts? (?:an? )?(plains|island|swamp|mountain|forest|basic land|nontoken creature|nontoken permanent) onto the battlefield,\s*(.+)$/i.exec(text);
  if (playerPutsLand) {
    const kind = playerPutsLand[2].toLowerCase();
    const subject = kind === 'nontoken creature' ? 'a nontoken creature' : kind === 'nontoken permanent' ? 'a nontoken permanent' : kind === 'basic land' ? 'a basic land' : 'a ' + kind;
    const parsed = subjectEvent('enters', subject, playerPutsLand[3]);
    return parsed ? { condition: withController(parsed.condition, actorController(playerPutsLand[1])), effect: parsed.effect } : null;
  }
  const playerPutsColorOr = /^(?:whenever|when)\s+a player puts? an? (plains|island|swamp|mountain|forest) or (white|blue|black|red|green) permanent onto the battlefield,\s*(.+)$/i.exec(text);
  if (playerPutsColorOr) {
    return subjectEvent('enters', 'a ' + playerPutsColorOr[1].toLowerCase(), playerPutsColorOr[3]);
  }
  const legendaryLandOrSpell = /^(?:whenever|when)\s+you play a legendary land or cast a legendary spell,\s*(.+)$/.exec(text);
  if (legendaryLandOrSpell) {
    const parsed = subjectEvent('plays_land', 'a legendary land', legendaryLandOrSpell[1], { pairedEvent: 'spell_cast' } as any);
    return parsed ? { condition: withController(parsed.condition, 'you'), effect: parsed.effect } : null;
  }
  const playsLandTyped = /^(?:whenever|when)\s+(you|an opponent|a player)\s+plays? an? (plains|island|swamp|mountain|forest|basic land|legendary land),\s*(.+)$/i.exec(text);
  if (playsLandTyped) {
    const kind = playsLandTyped[2].toLowerCase();
    const subjectText = kind === 'basic land' ? 'a basic land' : kind === 'legendary land' ? 'a legendary land' : 'a ' + kind;
    const parsed = subjectEvent('plays_land', subjectText, playsLandTyped[3]);
    return parsed ? { condition: withController(parsed.condition, actorController(playsLandTyped[1])), effect: parsed.effect } : null;
  }
  const playsLand = /^(?:whenever|when)\s+(you|an opponent|a player)\s+plays? a land,\s*(.+)$/.exec(text);
  if (playsLand) {
    const parsed = subjectEvent('plays_land', 'a land', playsLand[2]);
    return parsed ? { condition: withController(parsed.condition, actorController(playsLand[1])), effect: parsed.effect } : null;
  }

  const unlock = /^(?:whenever|when)\s+you unlock this door,\s*(.+)$/.exec(text);
  if (unlock) return subjectEvent('unlocks_door', 'this permanent', unlock[1]);

  const causedShuffle = /^(?:whenever|when)\s+a spell or ability causes\s+(you|an opponent|a player)\s+to shuffle\s+(their|your|his or her)\s+library,\s*(.+)$/.exec(text);
  if (causedShuffle) {
    const parsed = subjectEvent('shuffles_library', 'a permanent', causedShuffle[3], {
      libraryOwner: causedShuffle[2] === 'your' ? 'source' : 'subject',
    });
    return parsed ? { condition: withController(parsed.condition, actorController(causedShuffle[1])), effect: parsed.effect } : null;
  }

  const entersFrom = /^(?:whenever|when)\s+(.+?)\s+enters(?: the battlefield)? from (anywhere other than your hand|your library|your graveyard|your hand),\s*(.+)$/.exec(text);
  if (entersFrom) {
    const fromZone = fromZoneOf(entersFrom[2]);
    if (!fromZone) return null;
    return subjectEvent('enters', entersFrom[1], entersFrom[3], { fromZone });
  }

  // Cards put into a library from anywhere (Wan Shi Tong).
  const intoLibrary = /^(?:whenever|when)\s+(?:one or more )?cards? (?:are|is) put into (?:a|your) library from anywhere,\s*(.+)$/i.exec(text);
  if (intoLibrary) {
    const parsed = subjectEvent('put_into_library', 'a permanent', intoLibrary[1], { fromZone: 'anywhere', quantity: 'one_or_more' });
    return parsed;
  }
  // Plot: "when this card becomes plotted".
  const plotted = /^(?:whenever|when)\s+(?:this card|this permanent|~) becomes plotted,\s*(.+)$/i.exec(text);
  if (plotted) {
    const parsed = subjectEvent('performs', 'a permanent', plotted[1], { action: 'plot' });
    return parsed ? { condition: withController(parsed.condition, 'you'), effect: parsed.effect } : null;
  }
  // Hero of Bretagard / Ranar: exile from hand OR you exile from battlefield.
  const exileOr = /^(?:whenever|when)\s+one or more cards are put into exile from your hand or a spell or ability you control exiles one or more permanents from the battlefield,\s*(.+)$/i.exec(text);
  if (exileOr) {
    const parsed = subjectEvent('exiled', 'a permanent', exileOr[1], {
      fromZone: 'hand_or_battlefield',
      zoneOwner: 'you',
      causedByYou: true,
      quantity: 'one_or_more',
    });
    return parsed;
  }

  // Energy: "whenever you get one or more {E} (energy counters)".
  const energy = /^(?:whenever|when)\s+(you|an opponent|a player)\s+get(?:s)? one or more \{e\}(?: \(energy counters\))?(?: during your turn)?,\s*(.+)$/i.exec(text);
  if (energy) {
    const parsed = subjectEvent('performs', 'a permanent', energy[2], { action: 'get_energy' });
    return parsed ? { condition: withController(parsed.condition, actorController(energy[1])), effect: parsed.effect } : null;
  }
  // Saga final chapter ability resolves.
  const sagaFinal = /^(?:whenever|when)\s+the final chapter ability of (?:a|another) saga you control (?:resolves|triggers),\s*(.+)$/i.exec(text);
  if (sagaFinal) {
    const parsed = subjectEvent('performs', 'a permanent', sagaFinal[1], { action: 'saga_final_chapter' });
    return parsed ? { condition: withController(parsed.condition, 'you'), effect: parsed.effect } : null;
  }

  const exploits = /^(?:whenever|when)\s+(.+?)\s+exploits (?:a|another) (creature|non-human creature|nonhuman creature),\s*(.+)$/i.exec(text);
  if (exploits) {
    const parsed = subjectEvent('performs', exploits[1], exploits[3], { action: 'exploit' });
    return parsed;
  }
  const tapThisForMana = /^(?:whenever|when)\s+(you|an opponent|a player)\s+taps? (this (?:creature|land|permanent|artifact)|~) for mana,\s*(.+)$/.exec(text);
  if (tapThisForMana) {
    const parsed = subjectEvent('tapped_for_mana', tapThisForMana[2], tapThisForMana[3]);
    return parsed ? { condition: withController(parsed.condition, actorController(tapThisForMana[1])), effect: parsed.effect } : null;
  }
  const tapForColor = /^(?:whenever|when)\s+(you|an opponent|a player)\s+taps? (an? [a-z ]+?) for \{([wubrgc])\},\s*(.+)$/i.exec(text);
  if (tapForColor) {
    const parsed = subjectEvent('tapped_for_mana', tapForColor[2], tapForColor[4], { manaColor: tapForColor[3].toLowerCase() } as any);
    return parsed ? { condition: withController(parsed.condition, actorController(tapForColor[1])), effect: parsed.effect } : null;
  }
  const oppActivateLoyalty = /^(?:whenever|when)\s+an opponent activates? a loyalty ability,\s*(.+)$/.exec(text);
  if (oppActivateLoyalty) {
    const parsed = subjectEvent('performs', 'a permanent', oppActivateLoyalty[1], { action: 'activate_loyalty' });
    return parsed ? { condition: withController(parsed.condition, 'not_you'), effect: parsed.effect } : null;
  }
  const oppCastOrActivate = /^(?:whenever|when)\s+an opponent casts? a spell or activates? an ability,\s*(.+)$/.exec(text);
  if (oppCastOrActivate) {
    const parsed = subjectEvent('spell_cast', 'a permanent', oppCastOrActivate[1], { pairedEvent: 'performs', action: 'activate_ability' } as any);
    return parsed ? { condition: withController(parsed.condition, 'not_you'), effect: parsed.effect } : null;
  }
  const perform = /^(?:whenever|when)\s+(you|an opponent|a player)\s+(.+?),\s*(.+)$/.exec(text);
  if (perform) {
    let onceEachTurn = false;
    let rawVerb = perform[2];
    if (/\s+for the first time each turn$/.test(rawVerb)) {
      onceEachTurn = true;
      rawVerb = rawVerb.replace(/\s+for the first time each turn$/, '').trim();
    }
    let verb = rawVerb === 'scry' || /^scry \d+$/.test(rawVerb)
      ? 'scry'
      : /^expend(?: \d+)?$/.test(rawVerb)
        ? 'expend'
        : rawVerb;
    // Printed verbs are often conjugated ("wins", "becomes"); Attraction is capitalized in oracle.
    verb = verb.toLowerCase();
    if (!PERFORM_ACTIONS.some((entry) => entry.phrase === verb)) {
      const deconjugated = verb
        .replace(/^wins\b/, 'win')
        .replace(/^loses\b/, 'lose')
        .replace(/^becomes\b/, 'become')
        .replace(/^gets\b/, 'get')
        .replace(/^collects\b/, 'collect')
        .replace(/^places\b/, 'place')
        .replace(/^puts\b/, 'put')
        .replace(/^scries\b/, 'scry')
        .replace(/^surveils\b/, 'surveil')
        .replace(/^opens\b/, 'open')
        .replace(/^visits\b/, 'visit')
        .replace(/^gives\b/, 'give')
        .replace(/^manifests\b/, 'manifest')
        .replace(/^forages\b/, 'forage')
        .replace(/^investigates\b/, 'investigate')
        .replace(/^activates\b/, 'activate');
      if (PERFORM_ACTIONS.some((entry) => entry.phrase === deconjugated)) verb = deconjugated;
    }
    const known = PERFORM_ACTIONS.find((entry) => entry.phrase === verb);
    if (known) {
      const expendAmount = known.action === 'expend' ? Number(/^expend (\d+)$/.exec(perform[2])?.[1]) : NaN;
      const parsed = subjectEvent('performs', 'a permanent', perform[3], {
        action: known.action,
        ...(Number.isFinite(expendAmount) ? { actionAmount: expendAmount } : {}),
        ...(onceEachTurn ? { onceEachTurn: true } : {}),
      });
      return parsed ? { condition: withController(parsed.condition, actorController(perform[1])), effect: parsed.effect } : null;
    }
  }

  if (/^whenever the ring tempts you,\s*(.+)$/.exec(text)) {
    const ring = /^whenever the ring tempts you,\s*(.+)$/.exec(text);
    if (!ring) return null;
    const parsed = subjectEvent('performs', 'a permanent', ring[1], { action: 'ring_tempts' });
    return parsed ? { condition: withController(parsed.condition, 'you'), effect: parsed.effect } : null;
  }

  const day = /^whenever day becomes night or night becomes day,\s*(.+)$/.exec(text);
  if (day) return subjectEvent('performs', 'a permanent', day[1], { action: 'day_night' });

  const chaos = /^whenever chaos ensues,\s*(.+)$/.exec(text);
  if (chaos) return subjectEvent('performs', 'a permanent', chaos[1], { action: 'chaos' });

  const vote = /^whenever players finish voting,\s*(.+)$/.exec(text);
  if (vote) return subjectEvent('performs', 'a permanent', vote[1], { action: 'vote' });

  return null;
}
