import { describe, it, expect } from 'vitest';
import { classifyStaticCensusLine } from '../scripts/static-replacement-census-classify.js';
import { collectReplacementEffectSpecsFromState } from '../src/state/modules/replacementEffectSpec.js';
import { parseStaticEffectSpecsFromOraclePermanent } from '../src/state/modules/staticEffectSpecOracleParsing.js';
import { parseBatch100LongTailStaticKind } from '../src/state/modules/staticEffectSpec-handlers/batch100LongTailStatics.js';
import {
  parsePursuitStudyCounterDrawReplacement,
  parseKrarkCoinIgnoreOneReplacement,
  parseEnergyTwiceReplacement,
  applyEnergyTwiceReplacement,
} from '../src/state/modules/replacementBatch100Collect.js';
import { parseIchorPlanarDiceReplacement } from '../src/state/modules/replacementBatch98Collect.js';
import {
  parsePlayersSkipUntapSteps,
  parseTomikLandProtection,
  parseIsntCreatureUnlessDontOwn,
  parseLessonGraveyardNoDefender,
  parseStationCrewPowerTripled,
  parseStationWithToughnessWhenGreater,
  parseActivateAsThoughHaste,
  parseMoreLandsThanAttackingPlayerToBlock,
  parseAnnihilatorXFromCounters,
  graveyardHasLessonCard,
  annihilatorValue,
  stampBatch100CreatureTypeLoss,
  opponentsCantPlayLandCardsFromGraveyards,
  landCardsInGraveyardsAreUntargetableByOpponent,
  isLandCard,
} from '../src/state/modules/batch100CombatAndKeywords.js';
import { evaluateDefenderCondition } from '../src/socket/combat-handlers/combatDefenderAttackPermission.js';
import {
  controlCountAttackRestrictionReason,
  moreCreaturesBlockRestrictionReason,
  moreLandsBlockRestrictionReason,
} from '../src/socket/combat-handlers/combatBatch33AttackRestrictions.js';
import { effectiveCrewStationPower, crewStationPowerMultiplier, stationUsesToughness } from '../src/socket/crewStationUsedPower.js';
import { parseBorrowedActivatedClause, pushBorrowedActivatedSelfSpecs, collectBorrowedActivatedAbilities } from '../src/state/modules/staticEffectSpecBorrowedActivated.js';
import {
  parsePrimevalSpawnSelfExile,
  wouldPrimevalSpawnExileEntry,
  applyPrimevalSpawnExileIfNeeded,
} from '../src/state/modules/batch100PrimevalSpawnApply.js';
import { parseBatch91LoseGameExileResetSentence, tryApplyLoseGameExileAndResetLife } from '../src/state/modules/replacementBatch91LoseGameReplacements.js';
import { isCreatureNow } from '../src/state/creatureTypeNow.js';
import { addEnergyCounters } from '../src/state/utils.js';

const P1 = 'p1';
const P2 = 'p2';

function perm(partial: any): any {
  return {
    id: partial.id || 'perm-1',
    controller: partial.controller || P1,
    card: partial.card || {},
    ...partial,
  };
}

function sys(line: string, name: string): string {
  return String(classifyStaticCensusLine(line, name)?.system ?? '');
}

const PHOENIX = 'Bestow—{R}, Collect evidence 6. (To pay this bestow cost, pay {R} and exile cards with total mana value 6 or greater from your graveyard.)';
const UNDERDOG = 'Blitz—{2}{B}{B}, Pay 2 life. (If you cast this spell for its blitz cost, it gains haste and "When this creature dies, draw a card." Sacrifice it at the beginning of the next end step.)';
const SABIN = 'Blitz—{2}{R}{R}, Discard a card. (If you cast this spell for its blitz cost, it gains haste and "When this creature dies, draw a card." Sacrifice it at the beginning of the next end step.)';
const VULTURES = 'You may discard this card any time you could cast an instant.';
const MADNESS = 'Madness—{2}{B}, Pay 8 life. (If you discard this card, discard it into exile. When you do, cast it for its madness cost or put it into your graveyard.)';
const ICHOR = 'If you would roll one or more planar dice, instead roll that many planar dice plus one and ignore one.';
const PURSUIT = 'If you would draw a card, you may put a study counter on this enchantment instead.';
const KRARK = 'If you would flip a coin, instead flip two coins and ignore one.';
const STASIS = 'Players skip their untap steps.';
const AETHER = 'If you would get one or more {E} (energy counters), you get twice that many {E} instead.';
const PLATYPUS = "As long as there is a Lesson card in your graveyard, this creature can attack as though it didn't have defender.";
const SULU = 'Sulu stations Spacecraft and crews Vehicles as though his power were tripled.';
const HOUND_ATTACK = "This creature can't attack unless you control more lands than defending player.";
const HOUND_BLOCK = "This creature can't block unless you control more lands than attacking player.";
const ULAMOG = 'Ulamog has annihilator X, where X is the number of +1/+1 counters on it.';
const TAPESTRY = 'Each creature you control with toughness greater than its power stations permanents using its toughness rather than its power.';
const TOMIK = "Lands on the battlefield and land cards in graveyards can't be the targets of spells or abilities your opponents control.\nYour opponents can't play land cards from graveyards.";
const ARVINOX = "Arvinox isn't a creature unless you control three or more permanents you don't own.";
const SKILL = 'As long as the top card of your library is an artifact or creature card, this creature has all activated abilities of that card.';
const FORGE = 'This artifact has all activated abilities of the exiled card.';
const PRIMEVAL = "If this creature would enter and it wasn't cast or no mana was spent to cast it, exile it instead.";
const THRONE = 'If you would lose the game, instead exile The Golden Throne and your life total becomes 1.';
const ARCHANGEL = 'If you would lose the game, instead exile this creature and your life total becomes equal to your starting life total.';
const TYVAR = 'You may activate abilities of creatures you control as though those creatures had haste.';

describe('B100 classifier other for live on-cast and special-action systems', () => {
  it('marks Detective\'s Phoenix bestow+evidence as other', () => {
    expect(sys(PHOENIX, "Detective's Phoenix")).toMatch(/bestowCollectEvidence/i);
  });

  it('marks blitz pay-life and discard extras as other', () => {
    expect(sys(UNDERDOG, 'Tenacious Underdog')).toMatch(/blitzAdditionalCost/i);
    expect(sys(SABIN, 'Sabin, Master Monk')).toMatch(/blitzAdditionalCost/i);
  });

  it('marks Circling Vultures discard-as-instant as other', () => {
    expect(sys(VULTURES, 'Circling Vultures')).toMatch(/circlingVulturesDiscard/i);
  });

  it('marks madness pay-life as other', () => {
    expect(sys(MADNESS, 'Shadowgrange Archfiend')).toMatch(/madnessPayLife/i);
  });
});

describe('B100 live replacements collected for census', () => {
  it('parses and collects Ichor ignore-one', () => {
    expect(parseIchorPlanarDiceReplacement(ICHOR)).toEqual({ extra: 1, ignore: 1 });
    const ichor = perm({ id: 'ichor', card: { name: 'Ichor Elixir', oracle_text: ICHOR } });
    const specs = collectReplacementEffectSpecsFromState({ battlefield: [ichor] });
    expect(specs.some((spec) => spec.effectId === 'planar-dice-plus-ignore')).toBe(true);
  });

  it('parses and collects Pursuit of Knowledge', () => {
    expect(parsePursuitStudyCounterDrawReplacement(PURSUIT)).toBe(true);
    const pursuit = perm({ id: 'pursuit', card: { name: 'Pursuit of Knowledge', oracle_text: PURSUIT } });
    const specs = collectReplacementEffectSpecsFromState({ battlefield: [pursuit] });
    expect(specs.some((spec) => spec.effectId === 'pursuit-study-counter-draw')).toBe(true);
  });

  it('parses and collects Krark\'s Thumb', () => {
    expect(parseKrarkCoinIgnoreOneReplacement(KRARK)).toBe(true);
    const thumb = perm({ id: 'thumb', card: { name: "Krark's Thumb", oracle_text: KRARK } });
    const specs = collectReplacementEffectSpecsFromState({ battlefield: [thumb] });
    expect(specs.some((spec) => spec.effectId === 'coin-flip-ignore-one')).toBe(true);
  });

  it('parses Stasis and emits a static spec', () => {
    expect(parsePlayersSkipUntapSteps(STASIS)).toBe(true);
    expect(parseBatch100LongTailStaticKind(STASIS)).toContain('players-skip-untap-steps');
    const specs = parseStaticEffectSpecsFromOraclePermanent({
      id: 'stasis',
      controller: P1,
      card: { name: 'Stasis', oracle_text: STASIS },
    });
    expect(specs.some((spec) => String(spec.id || '').includes('players-skip-untap-steps'))).toBe(true);
  });

  it('doubles energy when Aether Refinery is in play', () => {
    expect(parseEnergyTwiceReplacement(AETHER)).toEqual({ min: 1 });
    const refinery = perm({ id: 'refinery', card: { name: 'Aether Refinery', oracle_text: AETHER } });
    const state: any = { battlefield: [refinery], energy: { [P1]: 0 } };
    expect(applyEnergyTwiceReplacement(state, P1, 2)).toBe(4);
    expect(addEnergyCounters(state, P1, 2)).toBe(4);
    expect(addEnergyCounters({ battlefield: [], energy: { [P2]: 0 } }, P2, 2)).toBe(2);
  });
});

describe('B100 lesson-in-graveyard defender exception', () => {
  it('parses Platypus-Bear and allows the attack only when a Lesson is in the GY', () => {
    expect(parseLessonGraveyardNoDefender(PLATYPUS)).toBe(true);
    const bear = perm({ id: 'bear', card: { name: 'Platypus-Bear', oracle_text: PLATYPUS } });
    const lesson = { id: 'lesson-1', type_line: 'Instant — Lesson', name: 'Environmental Sciences' };
    const empty: any = { zones: { [P1]: { graveyard: [] } }, battlefield: [bear] };
    const withLesson: any = { zones: { [P1]: { graveyard: [lesson] } }, battlefield: [bear] };
    expect(graveyardHasLessonCard(empty, P1)).toBe(false);
    expect(graveyardHasLessonCard(withLesson, P1)).toBe(true);
    expect(evaluateDefenderCondition('there is a lesson card in your graveyard', bear, [bear], P1, empty)).toBe(false);
    expect(evaluateDefenderCondition('there is a lesson card in your graveyard', bear, [bear], P1, withLesson)).toBe(true);
  });
});

describe('B100 crew, station, and annihilator helpers', () => {
  it('triples Sulu\'s power for crew and station', () => {
    const sulu = perm({
      id: 'sulu',
      card: { name: 'Sulu, Heroic Helmsman', oracle_text: SULU, power: 2, toughness: 2 },
      power: 2,
      toughness: 2,
    });
    expect(parseStationCrewPowerTripled(SULU)).toBe(true);
    expect(crewStationPowerMultiplier(sulu, 'crew')).toBe(3);
    expect(crewStationPowerMultiplier(sulu, 'station')).toBe(3);
    expect(effectiveCrewStationPower(sulu, { battlefield: [sulu] }, 'crew')).toBe(6);
    expect(effectiveCrewStationPower(sulu, { battlefield: [sulu] }, 'station')).toBe(6);
  });

  it('lets a T>P creature station with toughness under Tapestry Warden', () => {
    const warden = perm({ id: 'warden', card: { name: 'Tapestry Warden', oracle_text: TAPESTRY, power: 2, toughness: 4 }, power: 2, toughness: 4 });
    const wall = perm({ id: 'wall', card: { name: 'Wall', type_line: 'Creature', power: 0, toughness: 4 }, power: 0, toughness: 4 });
    const state = { battlefield: [warden, wall] };
    expect(parseStationWithToughnessWhenGreater(TAPESTRY)).toBe(true);
    expect(stationUsesToughness(wall, state)).toBe(true);
    expect(effectiveCrewStationPower(wall, state, 'station')).toBe(4);
    expect(effectiveCrewStationPower(wall, state, 'crew')).toBe(0);
  });

  it('resolves annihilator X from +1/+1 counters', () => {
    const ulamog = perm({ id: 'ulamog', card: { name: 'Ulamog, the Defiler', oracle_text: ULAMOG }, counters: { '+1/+1': 7 } });
    expect(parseAnnihilatorXFromCounters(ULAMOG)).toBe(true);
    expect(annihilatorValue(ulamog, { value: undefined as any })).toBe(7);
    expect(annihilatorValue(ulamog, { value: 3 })).toBe(3);
  });
});

describe('B100 Monstrous Hound land-count attack and block', () => {
  const land = (id: string, controller: string) => perm({ id, controller, card: { name: 'Forest', type_line: 'Basic Land — Forest' } });
  const hound = perm({
    id: 'hound',
    controller: P1,
    card: { name: 'Monstrous Hound', type_line: 'Creature — Dog', oracle_text: `${HOUND_ATTACK}\n${HOUND_BLOCK}` },
  });

  it('blocks the attack unless the attacker controls more lands', () => {
    const few = [hound, land('l1', P1), land('l2', P2), land('l3', P2)];
    const more = [hound, land('l1', P1), land('l2', P1), land('l3', P2)];
    expect(controlCountAttackRestrictionReason(hound, P2, few)).toMatch(/more lands than defending player/);
    expect(controlCountAttackRestrictionReason(hound, P2, more)).toBeNull();
  });

  it('blocks the block unless the blocker controls more lands', () => {
    const attacker = perm({ id: 'atk', controller: P2, card: { name: 'Bear', type_line: 'Creature' } });
    const few = [hound, attacker, land('l1', P1), land('l2', P2), land('l3', P2)];
    const more = [hound, attacker, land('l1', P1), land('l2', P1), land('l3', P2)];
    expect(moreLandsBlockRestrictionReason(hound, attacker, few)).toMatch(/more lands than attacking player/);
    expect(moreLandsBlockRestrictionReason(hound, attacker, more)).toBeNull();
    expect(moreCreaturesBlockRestrictionReason(hound, attacker, few)).toBeNull();
  });
});

describe('B100 Tomik land protection', () => {
  it('parses the lock and stops opponents playing or targeting GY lands', () => {
    expect(parseTomikLandProtection(TOMIK)).toBe(true);
    expect(parseTomikLandProtection("Lands on the battlefield and land cards in graveyards can't be the targets of spells or abilities your opponents control.")).toBe(true);
    expect(parseTomikLandProtection("Your opponents can't play land cards from graveyards.")).toBe(true);
    const tomik = perm({ id: 'tomik', controller: P1, card: { name: 'Tomik, Distinguished Advokist', oracle_text: TOMIK } });
    const state: any = { battlefield: [tomik] };
    expect(opponentsCantPlayLandCardsFromGraveyards(state, P2)).toBe(true);
    expect(opponentsCantPlayLandCardsFromGraveyards(state, P1)).toBe(false);
    expect(landCardsInGraveyardsAreUntargetableByOpponent(state, P2)).toBe(true);
    expect(landCardsInGraveyardsAreUntargetableByOpponent(state, P1)).toBe(false);
    expect(isLandCard({ type_line: 'Land — Plains' })).toBe(true);
    expect(isLandCard({ type_line: 'Creature — Human' })).toBe(false);
  });
});

describe('B100 Arvinox isn\'t a creature unless', () => {
  it('stamps a type loss until the controller has enough unowned permanents', () => {
    expect(parseIsntCreatureUnlessDontOwn(ARVINOX)?.amount).toBe(3);
    const arvinox = perm({
      id: 'arv',
      controller: P1,
      owner: P1,
      card: { name: 'Arvinox, the Mind Flail', type_line: 'Legendary Enchantment Creature — Horror', oracle_text: ARVINOX },
    });
    const stolen = (id: string) => perm({ id, controller: P1, owner: P2, card: { name: 'Island', type_line: 'Basic Land — Island' } });
    const few: any = { battlefield: [arvinox, stolen('s1'), stolen('s2')] };
    stampBatch100CreatureTypeLoss(few);
    expect(isCreatureNow(arvinox)).toBe(false);
    const enough: any = { battlefield: [arvinox, stolen('s1'), stolen('s2'), stolen('s3')] };
    stampBatch100CreatureTypeLoss(enough);
    expect(isCreatureNow(arvinox)).toBe(true);
  });
});

describe('B100 borrowed activated abilities', () => {
  it('parses Skill Borrower\'s top library card and Territory Forge\'s exiled card', () => {
    expect(parseBorrowedActivatedClause('that card')).toMatchObject({ zone: 'top_library' });
    expect(parseBorrowedActivatedClause('the top card of your library')).toMatchObject({ zone: 'top_library' });
    expect(parseBorrowedActivatedClause('the exiled card')).toMatchObject({ zone: 'the_exiled_card' });
    const specs: any[] = [];
    pushBorrowedActivatedSelfSpecs(specs, { sourcePermanentId: 'sb', sourceController: P1, sourceName: 'Skill Borrower' } as any, SKILL);
    expect(specs.length).toBeGreaterThan(0);
    const borrower = perm({ id: 'sb', card: { name: 'Skill Borrower', oracle_text: SKILL } });
    const top = { name: 'Sol Ring', type_line: 'Artifact', oracle_text: '{T}: Add {C}{C}.' };
    const state: any = { battlefield: [borrower], zones: { [P1]: { library: [top] } } };
    expect(collectBorrowedActivatedAbilities(state, 'sb', { zone: 'top_library', owner: 'you', typeWords: [] }).some((t) => /add/i.test(t))).toBe(true);
    const forge = perm({ id: 'forge', card: { name: 'Territory Forge', oracle_text: FORGE }, exiledCards: [{ name: 'Tree of Tales', type_line: 'Artifact Land', oracle_text: '{T}: Add {G}.' }] });
    const forgeState: any = { battlefield: [forge] };
    expect(collectBorrowedActivatedAbilities(forgeState, 'forge', { zone: 'the_exiled_card', owner: 'all', typeWords: [] }).some((t) => /add \{g\}/i.test(t))).toBe(true);
  });
});

describe('B100 Primeval Spawn self-exile and Golden Throne', () => {
  it('exiles Primeval Spawn when it was not cast or no mana was spent', () => {
    expect(parsePrimevalSpawnSelfExile(PRIMEVAL)).toBe(true);
    const spawn = perm({
      id: 'spawn',
      owner: P1,
      controller: P1,
      card: { name: 'Primeval Spawn', type_line: 'Creature — Avatar', oracle_text: PRIMEVAL },
    });
    const flicker: any = { battlefield: [spawn], zones: { [P1]: { exile: [] } } };
    expect(wouldPrimevalSpawnExileEntry({ state: flicker, permanent: spawn, enteredFromZone: 'exile' })).toBe(true);
    expect(applyPrimevalSpawnExileIfNeeded({ state: flicker, permanent: spawn, enteredFromZone: 'exile' }).applied).toBe(true);
    expect(flicker.battlefield).toHaveLength(0);
    expect(flicker.zones[P1].exile).toHaveLength(1);

    const unpaid = perm({ id: 'spawn2', owner: P1, controller: P1, card: { name: 'Primeval Spawn', oracle_text: PRIMEVAL } });
    const free: any = { battlefield: [unpaid], zones: { [P1]: { exile: [] } } };
    expect(applyPrimevalSpawnExileIfNeeded({ state: free, permanent: unpaid, wasCast: true, manaSpentToCast: 0 }).applied).toBe(true);

    const paid = perm({ id: 'spawn3', owner: P1, controller: P1, card: { name: 'Primeval Spawn', oracle_text: PRIMEVAL } });
    const fromCast: any = { battlefield: [paid], zones: { [P1]: { exile: [] } } };
    expect(applyPrimevalSpawnExileIfNeeded({ state: fromCast, permanent: paid, wasCast: true, manaSpentToCast: 10 }).applied).toBe(false);
    expect(fromCast.battlefield).toHaveLength(1);
  });

  it('collects Primeval Spawn so census can mark it handled', () => {
    const spawn = perm({ id: 'spawn', card: { name: 'Primeval Spawn', oracle_text: PRIMEVAL } });
    const specs = collectReplacementEffectSpecsFromState({ battlefield: [spawn] });
    expect(specs.some((spec) => spec.effectId === 'self-uncast-or-no-mana-enter-exile')).toBe(true);
  });

  it('exiles The Golden Throne and sets life to 1, without breaking starting-life forms', () => {
    expect(parseBatch91LoseGameExileResetSentence(THRONE)).toBe(true);
    expect(parseBatch91LoseGameExileResetSentence(ARCHANGEL)).toBe(true);
    const throne = perm({
      id: 'throne',
      controller: P1,
      owner: P1,
      card: { name: 'The Golden Throne', oracle_text: THRONE },
    });
    const state: any = {
      battlefield: [throne],
      zones: { [P1]: { exile: [] } },
      life: { [P1]: 0 },
      startingLife: 40,
      players: [{ id: P1, life: 0, hasLost: true, startingLife: 40 }],
    };
    expect(tryApplyLoseGameExileAndResetLife(state, P1)).toBe(true);
    expect(state.battlefield).toHaveLength(0);
    expect(state.life[P1]).toBe(1);
    expect(state.players[0].life).toBe(1);
    expect(state.zones[P1].exile).toHaveLength(1);
  });
});

describe('B100 activate as though haste', () => {
  it('parses Tyvar and Thousand-Year Elixir', () => {
    expect(parseActivateAsThoughHaste(TYVAR)).toBe(true);
    expect(parseBatch100LongTailStaticKind(TYVAR)).toContain('activate-abilities-as-though-had-haste');
    expect(parseActivateAsThoughHaste('You may activate abilities of other creatures you control as though those creatures had haste.')).toBe(true);
  });
});
