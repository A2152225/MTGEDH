// server/tests/batch93-statics.unit.test.ts
import { describe, expect, it } from 'vitest';
import { classifyStaticCensusLine } from '../scripts/static-replacement-census-classify.js';
import { parseStaticEffectSpecsFromOraclePermanent } from '../src/state/modules/staticEffectSpecOracleParsing.js';
import { spellPaymentSatisfiesCreatureProducedManaRestriction } from '../src/state/modules/batch93ManaPayment.js';
import {
  isCardUnplayableUntilOwnersNextTurn,
  clearCantPlayUntilOwnersNextTurnForPlayer,
  manaMazeCastViolation,
  findBatch93CastRestrictionViolation,
} from '../src/state/modules/batch93CastRestrictions.js';
import { attackTargetPermanentIsIllegal, permanentCantBeAttacked } from '../src/state/modules/batch93CantBeAttacked.js';
import { overlaySpecsMatchCounterCause } from '../src/state/modules/batch93CounterCause.js';
import {
  collectBatch93DrawReplacementSpecs,
  applyQuantumRiddlerDrawBonus,
  applyArchmageAscensionSearchInstead,
  parseBatch93DrawSentence,
} from '../src/state/modules/replacementBatch93DrawReplacements.js';
import {
  shouldReplaceScryWithDraw,
  applyScryReplacedByDraw,
  collectBatch93ScryReplacementSpecs,
} from '../src/state/modules/replacementBatch93ScryReplacements.js';
import {
  applyBatch93DamageSideEffects,
  damageToPlayerIsDealtAsInfect,
  collectBatch93DamageReplacementSpecs,
} from '../src/state/modules/replacementBatch93DamageReplacements.js';
import { collectBatch93DiesReplacementSpecs } from '../src/state/modules/replacementBatch93DiesReplacements.js';
import {
  collectBatch93TokenReplacementSpecs,
  applyJinnieFayTokenChoice,
  parseBatch93TokenChoiceSentence,
} from '../src/state/modules/replacementBatch93TokenReplacements.js';
import { findInfiniteReflectionCopyTarget, applyNontokenEntersAsCopyOfEnchanted } from '../src/state/modules/batch93EtbCopy.js';
import {
  hallsOfMistPreventsAttack,
  rememberAttackersThisTurn,
  rotateAttackedLastTurnForController,
} from '../src/state/modules/batch93AttackRestrictions.js';
import { shouldSuppressOpponentEtbTriggers, parseLifeGainCausesAdditionalTrigger } from '../src/state/modules/batch93TriggerSuppression.js';

const SUPERION = 'Spend only mana produced by creatures to cast this spell.';
const PHOENIX = "If this creature would die, return it to its owner's hand instead. Until that player's next turn, that player plays with that card revealed in their hand and can't play it.";
const AETHERSPARK = "As long as The Aetherspark is attached to a creature, The Aetherspark can't be attacked and has \"Whenever equipped creature deals combat damage during your turn, put that many loyalty counters on The Aetherspark.\"";
const ZABAZ = 'Modular 1\nIf a modular triggered ability would put one or more +1/+1 counters on a creature you control, that many plus one +1/+1 counters are put on it instead.';
const ELESH = 'Vigilance\nIf a permanent entering the battlefield causes a triggered ability of a permanent you control to trigger, that ability triggers an additional time.\nPermanents entering the battlefield don\'t cause abilities of permanents your opponents control to trigger.';
const UNLIFE = "You don't lose the game for having 0 or less life.\nAs long as you have 0 or less life, all damage is dealt to you as though its source had infect.";
const BUBBLE = 'If damage would be dealt to you, put that many depletion counters on Force Bubble instead.';
const ARCHMAGE = 'At the beginning of each end step, if you drew two or more cards this turn, put a quest counter on this enchantment.\nAs long as this enchantment has six or more quest counters on it, if you would draw a card, you may instead search your library for a card, put that card into your hand, then shuffle.';
const REFLECTION = 'When this Aura enters, attach it to target creature you control.\nNontoken creatures you control enter as a copy of enchanted creature.';
const RIDDLER = 'Flying, ward {1}\nWhen Quantum Riddler enters, draw a card.\nAs long as you have one or fewer cards in hand, if you would draw one or more cards, you draw that many plus one instead.';
const ELIGETH = 'If you would scry a number of cards, draw that many cards instead.\nPartner';
const FLAMECALLER = 'If a Lizard, Mouse, Otter, or Raccoon you control would deal damage to a permanent or player, it deals that much damage plus 1 instead.';
const JINNIE = 'If you would create one or more tokens, you may instead create that many 2/2 green Cat creature tokens with haste or that many 3/1 green Dog creature tokens with vigilance.';
const CRYSTAL = 'Black spells you cast cost {1} less to cast.\nIf a nontoken creature an opponent controls would die, instead exile it and you gain 2 life.';
const MAZE = "Players can't cast spells that share a color with the spell most recently cast this turn.";
const HALLS = "Cumulative upkeep {1}\nCreatures that attacked during their controller's last turn can't attack.";
const CRUSHER = 'If you gaining life causes a triggered ability of a permanent you control to trigger, that ability triggers an additional time.\nWhenever you gain life, put a +1/+1 counter on this creature.';

function perm(partial: Record<string, unknown>) {
  return {
    id: String(partial.id || 'p1'),
    controller: String(partial.controller || 'p1'),
    card: partial.card || { name: 'Card', oracle_text: '', type_line: 'Creature' },
    ...partial,
  };
}

function stateWith(bf: any[], extras: Record<string, any> = {}) {
  return { battlefield: bf, zones: extras.zones || {}, players: extras.players || [{ id: 'p1', life: 40 }, { id: 'p2', life: 40 }], life: extras.life || { p1: 40, p2: 40 }, ...extras };
}

function classify(line: string, name: string) {
  return classifyStaticCensusLine(line, name);
}

describe('batch93 statics', () => {
  it('Myr Superion rejects non-creature payment sources and accepts creature sources', () => {
    const card = { name: 'Myr Superion', oracle_text: SUPERION, type_line: 'Artifact Creature — Myr' };
    const state = stateWith([
      perm({ id: 'bear', controller: 'p1', card: { name: 'Bear', type_line: 'Creature — Bear', oracle_text: '' } }),
      perm({ id: 'land', controller: 'p1', card: { name: 'Forest', type_line: 'Basic Land — Forest', oracle_text: '' } }),
    ]);
    expect(spellPaymentSatisfiesCreatureProducedManaRestriction(card, [{ permanentId: 'bear' }], state)).toBe(true);
    expect(spellPaymentSatisfiesCreatureProducedManaRestriction(card, [{ permanentId: 'land' }], state)).toBe(false);
    expect(spellPaymentSatisfiesCreatureProducedManaRestriction(card, [{ producedByCreature: true }], state)).toBe(true);
  });

  it("Firestorm Phoenix can't be played while the until-next-turn flag is set, and is cleared at the owner's turn", () => {
    const card: any = { name: 'Firestorm Phoenix', oracle_text: PHOENIX, cantPlayUntilOwnersNextTurn: true, cantPlayOwnerId: 'p1', owner: 'p1' };
    expect(isCardUnplayableUntilOwnersNextTurn(card, {}, 'p1').prohibited).toBe(true);
    const st = stateWith([], { zones: { p1: { hand: [card] } } });
    clearCantPlayUntilOwnersNextTurnForPlayer(st, 'p1');
    expect(card.cantPlayUntilOwnersNextTurn).toBe(false);
    expect(isCardUnplayableUntilOwnersNextTurn(card, st, 'p1').prohibited).toBe(false);
  });

  it("The Aetherspark can't be attacked while attached to a creature", () => {
    const host = perm({ id: 'host', controller: 'p1', card: { name: 'Bear', type_line: 'Creature — Bear', oracle_text: '' } });
    const spark = perm({ id: 'spark', controller: 'p1', attachedTo: 'host', card: { name: 'The Aetherspark', type_line: 'Legendary Artifact Planeswalker — Equipment', oracle_text: AETHERSPARK } });
    const st = stateWith([host, spark]);
    expect(permanentCantBeAttacked(spark, st)).toBe(true);
    expect(attackTargetPermanentIsIllegal(st, 'spark').illegal).toBe(true);
    const loose = perm({ id: 'spark', controller: 'p1', card: { name: 'The Aetherspark', type_line: 'Legendary Artifact Planeswalker — Equipment', oracle_text: AETHERSPARK } });
    expect(permanentCantBeAttacked(loose, stateWith([loose]))).toBe(false);
  });

  it("Zabaz's modular-only overlay matches a modular cause and fails closed without one", () => {
    const spec = { metadata: { modularOnly: true, causeIsTriggeredAbility: true } };
    expect(overlaySpecsMatchCounterCause(spec, { cause: { isModularTriggeredAbility: true } })).toBe(true);
    expect(overlaySpecsMatchCounterCause(spec, { isModularTriggeredAbility: true })).toBe(true);
    expect(overlaySpecsMatchCounterCause(spec, { cause: 'modular triggered ability' })).toBe(true);
    expect(overlaySpecsMatchCounterCause(spec, {})).toBe(false);
    expect(overlaySpecsMatchCounterCause({ metadata: {} }, {})).toBe(true);
  });

  it('Elesh Norn suppresses ETB triggers of permanents opponents control', () => {
    const elesh = perm({ id: 'en', controller: 'p1', card: { name: 'Elesh Norn, Mother of Machines', type_line: 'Legendary Creature — Phyrexian Praetor', oracle_text: ELESH } });
    const opp = perm({ id: 'opp', controller: 'p2', card: { name: 'Soul Warden', type_line: 'Creature — Human Cleric', oracle_text: 'Whenever another creature enters, you gain 1 life.' } });
    const yours = perm({ id: 'mine', controller: 'p1', card: { name: 'Soul Warden', type_line: 'Creature — Human Cleric', oracle_text: 'Whenever another creature enters, you gain 1 life.' } });
    const st = stateWith([elesh, opp, yours]);
    expect(shouldSuppressOpponentEtbTriggers(st, 'etb', opp)).toBe(true);
    expect(shouldSuppressOpponentEtbTriggers(st, 'etb', yours)).toBe(false);
    const specs = parseStaticEffectSpecsFromOraclePermanent(elesh as any);
    expect((specs || []).some((s: any) => String(s.effectId || s.id).includes('etb-suppress-opponent-triggers'))).toBe(true);
  });

  it('Phyrexian Unlife deals damage as infect only while life is 0 or less', () => {
    const unlife = perm({ id: 'u', controller: 'p1', card: { name: 'Phyrexian Unlife', type_line: 'Enchantment', oracle_text: UNLIFE } });
    expect(damageToPlayerIsDealtAsInfect(stateWith([unlife], { life: { p1: 5 } }), 'p1')).toBe(false);
    expect(damageToPlayerIsDealtAsInfect(stateWith([unlife], { life: { p1: 0 } }), 'p1')).toBe(true);
    expect(damageToPlayerIsDealtAsInfect(stateWith([unlife], { life: { p1: -3 } }), 'p1')).toBe(true);
  });

  it('Force Bubble turns damage to you into depletion counters on the enchantment', () => {
    const bubble = perm({ id: 'fb', controller: 'p1', card: { name: 'Force Bubble', type_line: 'Enchantment', oracle_text: BUBBLE }, counters: {} });
    const st = stateWith([bubble]);
    const result = applyBatch93DamageSideEffects({ state: st } as any, 3, 'p2', 'p1', undefined, undefined, false);
    expect(result?.amount).toBe(0);
    expect((bubble as any).counters.depletion).toBe(3);
  });

  it('Archmage Ascension parses an optional search-instead-of-draw and applies it when chosen', () => {
    expect(parseBatch93DrawSentence(ARCHMAGE).some((e) => e.kind === 'optional-search-instead' && e.minQuest === 6)).toBe(true);
    const arch = perm({ id: 'aa', controller: 'p1', card: { name: 'Archmage Ascension', type_line: 'Enchantment', oracle_text: ARCHMAGE }, counters: { quest: 6 } });
    const wanted = { id: 'ans', name: 'Ancestral Recall', type_line: 'Instant' };
    const other = { id: 'swamp', name: 'Swamp', type_line: 'Basic Land — Swamp' };
    const st = stateWith([arch], { zones: { p1: { library: [other, wanted], hand: [] } } });
    const applied = applyArchmageAscensionSearchInstead(st, 'p1', 'ans');
    expect(applied.applied).toBe(true);
    expect(st.zones.p1.hand.map((c: any) => c.id)).toEqual(['ans']);
    expect(st.zones.p1.libraryNeedsShuffle || applied.libraryNeedsShuffle).toBeTruthy();
  });

  it('Infinite Reflection stamps an entering nontoken as a copy of the enchanted creature', () => {
    const host = perm({ id: 'host', controller: 'p1', card: { name: 'Serra Angel', type_line: 'Creature — Angel', oracle_text: 'Flying, vigilance', power: 4, toughness: 4 } });
    const aura = perm({ id: 'ir', controller: 'p1', attachedTo: 'host', card: { name: 'Infinite Reflection', type_line: 'Enchantment — Aura', oracle_text: REFLECTION } });
    const st = stateWith([host, aura]);
    expect(findInfiniteReflectionCopyTarget(st, 'p1')?.id).toBe('host');
    const entering: any = perm({ id: 'bear', controller: 'p1', card: { name: 'Bear', type_line: 'Creature — Bear', oracle_text: '', isToken: false } });
    const result = applyNontokenEntersAsCopyOfEnchanted(st, entering);
    expect(result.applied).toBe(true);
    expect(entering.copyOf).toBe('Serra Angel');
  });

  it('Quantum Riddler adds one to the whole draw event when the hand has one or fewer cards', () => {
    const riddler = perm({ id: 'qr', controller: 'p1', card: { name: 'Quantum Riddler', type_line: 'Creature — Weird', oracle_text: RIDDLER } });
    const empty = stateWith([riddler], { zones: { p1: { hand: [] } } });
    expect(applyQuantumRiddlerDrawBonus(empty, 'p1', 3)).toBe(4);
    const full = stateWith([riddler], { zones: { p1: { hand: [{ id: 'a' }, { id: 'b' }] } } });
    expect(applyQuantumRiddlerDrawBonus(full, 'p1', 3)).toBe(3);
    expect(collectBatch93DrawReplacementSpecs(RIDDLER, { sourcePermanentId: 'qr', sourceController: 'p1', sourceName: 'Quantum Riddler' }).some((s) => s.effectId === 'draw-plus-while-hand-at-most')).toBe(true);
  });

  it('Eligeth replaces a scry with drawing that many cards', () => {
    const eligeth = perm({ id: 'el', controller: 'p1', card: { name: 'Eligeth, Crossroads Augur', type_line: 'Legendary Creature — Sphinx', oracle_text: ELIGETH } });
    const a = { id: 'a', name: 'A' };
    const b = { id: 'b', name: 'B' };
    const st = stateWith([eligeth], { zones: { p1: { library: [a, b], hand: [] } } });
    expect(shouldReplaceScryWithDraw(st, 'p1')).toBe(true);
    const drawn = applyScryReplacedByDraw(st, 'p1', 2);
    expect(drawn.map((c: any) => c.id)).toEqual(['a', 'b']);
    expect(st.zones.p1.hand.map((c: any) => c.id)).toEqual(['a', 'b']);
    expect(collectBatch93ScryReplacementSpecs(ELIGETH, { sourcePermanentId: 'el', sourceController: 'p1', sourceName: 'Eligeth' }).some((s) => s.effectId === 'scry-becomes-draw')).toBe(true);
  });

  it('Valley Flamecaller adds 1 to damage from listed creature types you control', () => {
    const flame = perm({ id: 'vf', controller: 'p1', card: { name: 'Valley Flamecaller', type_line: 'Creature — Lizard Warlock', oracle_text: FLAMECALLER } });
    const otter = perm({ id: 'ot', controller: 'p1', card: { name: 'Otter', type_line: 'Creature — Otter', oracle_text: '' } });
    const bear = perm({ id: 'bear', controller: 'p1', card: { name: 'Bear', type_line: 'Creature — Bear', oracle_text: '' } });
    expect(collectBatch93DamageReplacementSpecs(FLAMECALLER, { sourcePermanentId: 'vf', sourceController: 'p1', sourceName: 'Valley Flamecaller' }).some((s) => s.effectId === 'typed-source-damage-plus-n')).toBe(true);
    const hit = applyBatch93DamageSideEffects({ state: stateWith([flame, otter]) } as any, 2, 'p1', 'p2', 'ot');
    expect(hit?.amount).toBe(3);
    const miss = applyBatch93DamageSideEffects({ state: stateWith([flame, bear]) } as any, 2, 'p1', 'p2', 'bear');
    expect(miss).toBeNull();
  });

  it('Jinnie Fay offers Cat or Dog token faces and applies the chosen identity', () => {
    const parsed = parseBatch93TokenChoiceSentence(JINNIE);
    expect(parsed?.faces[0]).toMatchObject({ power: 2, toughness: 2, name: 'Cat', keyword: 'haste' });
    expect(parsed?.faces[1]).toMatchObject({ power: 3, toughness: 1, name: 'Dog', keyword: 'vigilance' });
    const cat = applyJinnieFayTokenChoice(parsed!.faces, 0, 3);
    expect(cat).toMatchObject({ name: 'Cat', count: 3, keywords: ['haste'] });
    const dog = applyJinnieFayTokenChoice(parsed!.faces, 1, 2);
    expect(dog).toMatchObject({ name: 'Dog', count: 2, keywords: ['vigilance'] });
    expect(collectBatch93TokenReplacementSpecs(JINNIE, { sourcePermanentId: 'jf', sourceController: 'p1', sourceName: 'Jinnie Fay' }).some((s) => s.effectId === 'optional-token-identity-choice')).toBe(true);
  });

  it("The Darkness Crystal collects a nontoken-opponent-creature dies-to-exile-and-gain-life replacement", () => {
    const specs = collectBatch93DiesReplacementSpecs(CRYSTAL, { sourcePermanentId: 'dc', sourceController: 'p1', sourceName: 'The Darkness Crystal' });
    expect(specs.some((s) => s.effectId === 'opponent-creature-die-exile-gain-life' && (s.metadata as any)?.gainLife === 2 && (s.metadata as any)?.nontokenOnly === true)).toBe(true);
  });

  it('Mana Maze prohibits a spell that shares a color with the most recently cast spell this turn', () => {
    const maze = perm({ id: 'mm', controller: 'p1', card: { name: 'Mana Maze', type_line: 'Enchantment', oracle_text: MAZE } });
    const st = stateWith([maze], { spellsCastThisTurn: [{ name: 'Lightning Bolt', colors: ['R'], mana_cost: '{R}' }] });
    expect(manaMazeCastViolation(st, { name: 'Shock', colors: ['R'], mana_cost: '{R}' })).toBeTruthy();
    expect(manaMazeCastViolation(st, { name: 'Ancestral Recall', colors: ['U'], mana_cost: '{U}' })).toBeNull();
    expect(findBatch93CastRestrictionViolation(st, 'p2', { name: 'Shock', colors: ['R'] }).prohibited).toBe(true);
  });

  it("Halls of Mist prevents creatures that attacked during their controller's last turn from attacking", () => {
    const halls = perm({ id: 'hm', controller: 'p1', card: { name: 'Halls of Mist', type_line: 'World Enchantment', oracle_text: HALLS } });
    const cre = perm({ id: 'at', controller: 'p2', card: { name: 'Bear', type_line: 'Creature — Bear', oracle_text: '' } });
    const st = stateWith([halls, cre]);
    rememberAttackersThisTurn(st, ['at']);
    rotateAttackedLastTurnForController(st, 'p2');
    expect(hallsOfMistPreventsAttack(st, 'at')).toBe(true);
    expect(hallsOfMistPreventsAttack(st, 'missing')).toBe(false);
  });

  it('Dr. Beverly Crusher parses a life-gain additional-time static', () => {
    expect(parseLifeGainCausesAdditionalTrigger(CRUSHER)).toBe(true);
    const crusher = perm({ id: 'bc', controller: 'p1', card: { name: 'Dr. Beverly Crusher', type_line: 'Legendary Creature — Human Scientist', oracle_text: CRUSHER } });
    const specs = parseStaticEffectSpecsFromOraclePermanent(crusher as any);
    expect((specs || []).some((s: any) => String(s.effectId || s.id).includes('life-gain-causes-additional-trigger'))).toBe(true);
  });

  it('census lines for B93 cards are not owned_but_unhandled', () => {
    const rows: Array<[string, string]> = [
      [SUPERION, 'Myr Superion'],
      ["Until that player's next turn, that player plays with that card revealed in their hand and can't play it.", 'Firestorm Phoenix'],
      ["As long as The Aetherspark is attached to a creature, The Aetherspark can't be attacked.", 'The Aetherspark'],
      ['If a modular triggered ability would put one or more +1/+1 counters on a creature you control, that many plus one +1/+1 counters are put on it instead.', 'Zabaz, the Glimmerwasp'],
      ["Permanents entering the battlefield don't cause abilities of permanents your opponents control to trigger.", 'Elesh Norn, Mother of Machines'],
      ['If a permanent entering the battlefield causes a triggered ability of a permanent you control to trigger, that ability triggers an additional time.', 'Elesh Norn, Mother of Machines'],
      ['As long as you have 0 or less life, all damage is dealt to you as though its source had infect.', 'Phyrexian Unlife'],
      ['If damage would be dealt to you, put that many depletion counters on Force Bubble instead.', 'Force Bubble'],
      ['As long as this enchantment has six or more quest counters on it, if you would draw a card, you may instead search your library for a card, put that card into your hand, then shuffle.', 'Archmage Ascension'],
      ['Nontoken creatures you control enter as a copy of enchanted creature.', 'Infinite Reflection'],
      ['As long as you have one or fewer cards in hand, if you would draw one or more cards, you draw that many plus one instead.', 'Quantum Riddler'],
      ['If you would scry a number of cards, draw that many cards instead.', 'Eligeth, Crossroads Augur'],
      ['If a Lizard, Mouse, Otter, or Raccoon you control would deal damage to a permanent or player, it deals that much damage plus 1 instead.', 'Valley Flamecaller'],
      ['If you would create one or more tokens, you may instead create that many 2/2 green Cat creature tokens with haste or that many 3/1 green Dog creature tokens with vigilance.', "Jinnie Fay, Jetmir's Second"],
      ['If a nontoken creature an opponent controls would die, instead exile it and you gain 2 life.', 'The Darkness Crystal'],
      ["Players can't cast spells that share a color with the spell most recently cast this turn.", 'Mana Maze'],
      ["Creatures that attacked during their controller's last turn can't attack.", 'Halls of Mist'],
      ['If you gaining life causes a triggered ability of a permanent you control to trigger, that ability triggers an additional time.', 'Dr. Beverly Crusher'],
    ];
    for (const [line, name] of rows) {
      const result = classify(line, name);
      expect(result?.kind, `${name}: ${line}`).not.toBe('owned_but_unhandled');
    }
  });
});
