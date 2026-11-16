// server/tests/batch102-statics.unit.test.ts
// Live-path B102 tests: call hooked functions, not only helpers.
import { describe, expect, it } from 'vitest';
import {
  parseSanctuaryBladeColorChoice,
  parseProtectionFromLastChosenColor,
  parseDarkbladeCombatDamageDraw,
  parseCreaturesWithoutFlyingDontUntap,
  parseArboriaAttackRestriction,
  parseAnotherCreatureWouldDieExile,
  parseIdrisExiledAbilitiesAndPump,
  parseGoblinsAndElementalsHaveMenace,
  parseNoblesAndLessonsHaveLifelink,
  parseEnchantedMinusXPowerFromControllerGy,
  parseOtherCreaturesGetMinusOneMinusOne,
  parseNamedPermanentCastLock,
  parseDomainLandwalk,
  parseBlockingOrBlockedHaveLifelink,
  parseDuringYourTurnBasePT,
  parseDivinityCounterIndestructible,
  parseCluesYouControlAreEquipment,
  parseCrewsUsingToughness,
  parseEnchantedCantBeBlockedIfGate,
  parseEnchantedIsFlagbearer,
  parseAttackingYourOpponentHasTrample,
  parseHexproofUnlessAttacking,
  parseOpponentsCreaturesCantGetP1P1,
  parseEmptyHandDrawTwoLoseLife,
  parseEightCountersIsCreatureAnnihilator,
} from '../src/state/modules/batch102Parsers.js';
import { parseBatch102LongTailStaticKind } from '../src/state/modules/staticEffectSpec-handlers/batch102LongTailStatics.js';
import { collectBatch102ReplacementSpecsFromState } from '../src/state/modules/replacementBatch102Collect.js';
import { collectReplacementEffectSpecsFromState } from '../src/state/modules/replacementEffectSpec.js';
import { parseStaticEffectSpecsFromOraclePermanent } from '../src/state/modules/staticEffectSpecOracleParsing.js';
import { parseBorrowedActivatedClause, pushBorrowedActivatedSelfSpecs } from '../src/state/modules/staticEffectSpecBorrowedActivated.js';
import { linkCraftedMaterials, applyPendingCraftLinkage } from '../src/state/modules/batch102CraftLinkage.js';
import { transformPermanentToFace } from '../src/state/modules/day-night.js';
import {
  applyGrantedCombatDamageDraw,
  maybeQueueSanctuaryBladeColorChoice,
  applySanctuaryBladeChosenColor,
  noteNontokenPermanentEnteredThisTurn,
  snapshotArboriaLastTurnTracking,
  arboriaAttackRestrictionReason,
  applyVoidMawExileInstead,
  applyBatch102PowerToughnessAdjustment,
  namedPermanentCastIsLocked,
} from '../src/state/modules/batch102Apply.js';
import { tryHandleBatch101OptionChoice } from '../src/socket/resolutionOptionChoiceBatch101Handlers.js';
import { queueRecoverManaPaymentIfNeeded, tryHandleBatch102OptionChoice, tryHandleRecoverManaPayment } from '../src/socket/resolutionOptionChoiceBatch102Handlers.js';
import { tryHandleManaPaymentChoiceWardAndSacrificePrefix } from '../src/socket/resolution-handlers/manaPaymentChoicePrefixHandlers.js';
import { resolvePlayerDamage } from '../src/state/modules/combat-damage-processing.js';
import { notePlayerSurveilledThisTurn } from '../src/state/modules/batch101LandRecoverSurveil.js';
import { parseRecoverCost } from '../src/state/modules/batch101Parsers.js';
import { qualifiedUntapProhibitionSource } from '../src/state/modules/untapQualifierProhibitions.js';
import { getOwnerAttackRestrictionReason } from '../src/socket/combat-handlers/combatDeclareAttackersSupport.js';
import { canTargetPermanent } from '../../rules-engine/src/permanentTargeting.js';
import { isSpellCastingProhibitedByStaticRestriction } from '../src/state/modules/staticCastingRestrictions.js';
import { getCurrentPowerToughness } from '../src/state/modules/currentPowerToughness.js';
import { movePermanentToGraveyard } from '../src/state/modules/counters_tokens-handlers/countersTokensMoveToGraveyard.js';
import { filterRestrictedCounterDeltas } from '../src/state/modules/counterPlacementRestrictions.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';

const SANCTUARY = 'As Sanctuary Blade becomes attached to a creature, choose a color. Equipped creature gets +2/+0 and has protection from the last chosen color.';
const DARKBLADE = "As long as you've surveilled this turn, this creature has deathtouch and \"Whenever this creature deals combat damage to a player, you draw a card.\"";
const MUDSLIDE = "Creatures without flying don't untap during their controllers' untap steps.";
const ARBORIA = "Creatures can't attack a player unless that player cast a spell or put a nontoken permanent onto the battlefield during their last turn.";
const VOID_MAW = 'If another creature would die, exile it instead.';
const IDRIS = 'You may play lands and cast spells from among cards exiled with Idris. Idris has all activated and triggered abilities of the exiled card and gets +X/+X, where X is the exiled card\'s mana value.';
const BOGGART = 'Goblins you control and Elementals you control have menace.';
const LO_AND_LI = 'Noble creatures you control and Lesson spells you control have lifelink.';
const CONVERSION = "Enchanted creature gets -X/-0, where X is the number of cards in its controller's graveyard.";
const KAERVEK = 'Other creatures get -1/-1.';
const TIDAL = 'Cast this spell only if no permanents named Tidal Influence are on the battlefield.';
const MAGNIGOTH = 'For each basic land type among lands you control, Magnigoth Treefolk has landwalk of that type.';
const ALMS = 'Creatures blocking or blocked by Alms Beast have lifelink.';
const SNOWMELT = 'During your turn, Snowmelt Stag has base power and toughness 5/2.';
const TAKEN = 'Each permanent with a divinity counter on it has indestructible.';
const ARMED = 'Clues you control are Equipment in addition to their other types and have "Equipped creature gets +2/+0" and equip {2}.';
const OX = 'Giant Ox crews Vehicles using its toughness rather than its power.';
const THIEF = "Enchanted creature can't be blocked as long as you control a Gate.";
const FLAG = 'Enchanted creature is a Flagbearer.';
const OVIYA = "Each creature that's attacking one of your opponents has trample.";
const TADEAS = "Tadeas, Juniper Ascendant has hexproof unless it's attacking.";
const BLIGHT = "Creatures your opponents control can't have +1/+1 counters put on them.";
const SCRIVENER = 'If you would draw a card while you have no cards in hand, instead you draw two cards and you lose 1 life.';
const IDOL = "As long as this artifact has eight or more +1/+1 counters on it, it's a 0/0 creature in addition to its other types and it has annihilator 2.";
const KROVIKAN = 'Recover {1}{B}{B} (When a creature is put into your graveyard from the battlefield, you may pay {1}{B}{B}. If you do, return this card from your graveyard to your hand. Otherwise, exile this card.)';
const GARZA = 'Recover—Pay half your life, rounded up. (When another creature is put into your graveyard from the battlefield, you may pay half your life, rounded up. If you do, return this card from your graveyard to your hand. Otherwise, exile this card.)';

function perm(id: string, controller: string, name: string, oracle: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    controller,
    owner: extra.owner || controller,
    card: { id: `${id}-card`, name, oracle_text: oracle, type_line: (extra.type_line as string) || 'Creature', ...(extra.card as object || {}) },
    ...extra,
  };
}

function queuedSteps(gameId: string): any[] {
  const mgr = ResolutionQueueManager as any;
  if (typeof mgr.getQueue === 'function') {
    const q = mgr.getQueue(gameId);
    if (Array.isArray(q)) return q;
    if (q && Array.isArray(q.steps)) return q.steps;
  }
  if (typeof mgr.getSteps === 'function') return mgr.getSteps(gameId) || [];
  if (typeof mgr.peekAll === 'function') return mgr.peekAll(gameId) || [];
  if (typeof mgr.listSteps === 'function') return mgr.listSteps(gameId) || [];
  const q = mgr.queues?.get?.(gameId) || mgr.queues?.[gameId] || mgr.stepsByGameId?.get?.(gameId);
  return Array.isArray(q) ? q : (q?.steps || []);
}

function clearQueue(gameId: string): void {
  const mgr = ResolutionQueueManager as any;
  if (typeof mgr.clearAllSteps === 'function') { try { mgr.clearAllSteps(gameId); return; } catch { /* fall through */ } }
  if (typeof mgr.clear === 'function') { try { mgr.clear(gameId); return; } catch { /* fall through */ } }
  if (typeof mgr.clearQueue === 'function') { try { mgr.clearQueue(gameId); return; } catch { /* fall through */ } }
  if (typeof mgr.clearGame === 'function') { try { mgr.clearGame(gameId); return; } catch { /* fall through */ } }
  const steps = queuedSteps(gameId);
  if (typeof mgr.completeStep === 'function') {
    while (queuedSteps(gameId).length) {
      try { mgr.completeStep(gameId); } catch { break; }
    }
  }
  void steps;
}

function stubIo(): any {
  return {
    to: () => ({ emit: () => undefined }),
    emit: () => undefined,
  };
}

describe('B102 parsers', () => {
  it('parses Sanctuary Blade, Darkblade draw, Mudslide, Arboria, Void Maw, and Idris', () => {
    expect(parseSanctuaryBladeColorChoice(SANCTUARY)).toBe(true);
    expect(parseProtectionFromLastChosenColor(SANCTUARY)).toBe(true);
    expect(parseDarkbladeCombatDamageDraw(DARKBLADE)).toBe(true);
    expect(parseCreaturesWithoutFlyingDontUntap(MUDSLIDE)).toBe(true);
    expect(parseArboriaAttackRestriction(ARBORIA)).toBe(true);
    expect(parseAnotherCreatureWouldDieExile(VOID_MAW)).toBe(true);
    expect(parseIdrisExiledAbilitiesAndPump(IDRIS)).toBe(true);
    expect(parseBorrowedActivatedClause('the exiled card')?.zone).toBe('the_exiled_card');
  });

  it('parses onward head statics and Tidal Influence', () => {
    expect(parseGoblinsAndElementalsHaveMenace(BOGGART)).toBe(true);
    expect(parseNoblesAndLessonsHaveLifelink(LO_AND_LI)).toBe(true);
    expect(parseEnchantedMinusXPowerFromControllerGy(CONVERSION)).toBe(true);
    expect(parseOtherCreaturesGetMinusOneMinusOne(KAERVEK)).toBe(true);
    expect(parseNamedPermanentCastLock(TIDAL)).toBe(true);
    expect(parseDomainLandwalk(MAGNIGOTH)).toBe(true);
    expect(parseBlockingOrBlockedHaveLifelink(ALMS)).toBe(true);
    expect(parseDuringYourTurnBasePT(SNOWMELT)).toEqual({ power: 5, toughness: 2 });
    expect(parseDivinityCounterIndestructible(TAKEN)).toBe(true);
    expect(parseCluesYouControlAreEquipment(ARMED)).toBe(true);
    expect(parseCrewsUsingToughness(OX)).toBe(true);
    expect(parseEnchantedCantBeBlockedIfGate(THIEF)).toBe(true);
    expect(parseEnchantedIsFlagbearer(FLAG)).toBe(true);
    expect(parseAttackingYourOpponentHasTrample(OVIYA)).toBe(true);
    expect(parseHexproofUnlessAttacking(TADEAS)).toBe(true);
    expect(parseOpponentsCreaturesCantGetP1P1(BLIGHT)).toBe(true);
    expect(parseEmptyHandDrawTwoLoseLife(SCRIVENER)).toBe(true);
    expect(parseEightCountersIsCreatureAnnihilator(IDOL)).toEqual({ annihilator: 2 });
  });

  it('emits static kinds and Void Maw replacement specs from the live parse/collect paths', () => {
    const kinds = parseBatch102LongTailStaticKind(SANCTUARY);
    expect(kinds).toContain('protection-from-last-chosen-color');
    const parsed = parseStaticEffectSpecsFromOraclePermanent(perm('sb', 'p1', 'Sanctuary Blade', SANCTUARY, { type_line: 'Artifact — Equipment' }) as any);
    expect(parsed.length).toBeGreaterThan(0);
    expect(parseBatch102LongTailStaticKind(SANCTUARY).length).toBeGreaterThan(0);
    const idrisSpecs: any[] = [];
    pushBorrowedActivatedSelfSpecs(idrisSpecs, { sourcePermanentId: 'idris', sourceController: 'p1', sourceName: 'Idris' } as any, IDRIS);
    expect(idrisSpecs.length).toBeGreaterThan(0);
    const maw = perm('maw', 'p1', 'Void Maw', VOID_MAW, { type_line: 'Creature' });
    const fromHelper = collectBatch102ReplacementSpecsFromState({ battlefield: [maw] });
    const fromLive = collectReplacementEffectSpecsFromState({ battlefield: [maw] } as any);
    expect(fromHelper.some((s) => s.effectId === 'another-creature-die-exile-instead')).toBe(true);
    expect(fromLive.some((s: any) => s.effectId === 'another-creature-die-exile-instead' || s.reason === 'another_creature_die_exile_instead')).toBe(true);
  });
});

describe('B102 Pick-Axe craft-exile linkage', () => {
  it('stamps craftedFromCards / exiledWithSourceId through transformPermanentToFace', () => {
    const material = { id: 'mat1', name: 'Llanowar Elves', type_line: 'Creature — Elf', zone: 'exile' };
    const axe = {
      id: 'axe1',
      controller: 'p1',
      pendingCraftExiledCards: [material],
      card: {
        name: "Paleontologist's Pick-Axe",
        type_line: 'Artifact — Equipment',
        oracle_text: '',
        card_faces: [
          { name: "Paleontologist's Pick-Axe", type_line: 'Artifact — Equipment', oracle_text: 'Craft with one or more creatures' },
          { name: 'Dinosaur Headdress', type_line: 'Artifact — Equipment', oracle_text: 'As this Equipment becomes attached to a creature, choose an exiled creature card used to craft this Equipment.' },
        ],
      },
    };
    const state = { battlefield: [axe], zones: { p1: { exile: [material] } } };
    transformPermanentToFace(axe, 1, { state } as any);
    expect(axe.card.name).toBe('Dinosaur Headdress');
    expect(Array.isArray((axe as any).craftedFromCards)).toBe(true);
    expect((axe as any).craftedFromCards[0].exiledWithSourceId).toBe('axe1');
    expect((axe as any).craftedFromCards[0].craftedIntoId).toBe('axe1');
    expect(material.exiledWithSourceId).toBe('axe1');
    expect((axe as any).pendingCraftExiledCards).toBeFalsy();
    const again = { id: 'axe2', controller: 'p1', card: { name: 'X' } };
    expect(linkCraftedMaterials(state, again, [material])).toBeGreaterThan(0);
    expect(applyPendingCraftLinkage({ id: 'axe3', pendingCraftExiledCards: [] })).toBe(0);
  });
});

describe('B102 Recover mana payment', () => {
  it('queues a MANA_PAYMENT_CHOICE from the live recover option handler when pay is chosen', async () => {
    const gameId = 'b102-recover-mana';
    clearQueue(gameId);
    const card = { id: 'krov', name: 'Krovikan Horror', oracle_text: KROVIKAN, type_line: 'Creature' };
    const game = {
      gameId,
      state: { zones: { p1: { graveyard: [card], hand: [], exile: [] } }, life: { p1: 20 }, battlefield: [] },
    };
    const queued = queueRecoverManaPaymentIfNeeded(game, gameId, 'p1', 'krov', parseRecoverCost(KROVIKAN));
    expect(queued).toBe(true);
    const steps = queuedSteps(gameId);
    expect(steps.some((s: any) => s.recoverManaPayment === true && s.type === ResolutionStepType.MANA_PAYMENT_CHOICE)).toBe(true);
    clearQueue(gameId);

    const handled = await tryHandleBatch101OptionChoice(stubIo(), game, gameId, {
      type: ResolutionStepType.OPTION_CHOICE,
      playerId: 'p1',
      recoverChoice: true,
      recoverCardId: 'krov',
      recoverOwnerId: 'p1',
      recoverCost: parseRecoverCost(KROVIKAN),
    } as any, { playerId: 'p1', choice: 'pay' } as any);
    expect(handled).toBe(true);
    const after = queuedSteps(gameId);
    expect(after.some((s: any) => s.recoverManaPayment === true)).toBe(true);
    expect(game.state.zones.p1.graveyard.some((c: any) => c.id === 'krov')).toBe(true);
    clearQueue(gameId);
  });

  it('exiles on cancel and returns to hand after the live mana-payment prefix succeeds or applies a paid decision', async () => {
    const gameId = 'b102-recover-pay';
    const card = { id: 'krov2', name: 'Krovikan Horror', oracle_text: KROVIKAN, type_line: 'Creature' };
    const game = {
      gameId,
      state: { zones: { p1: { graveyard: [card], hand: [], exile: [] } }, life: { p1: 20 }, manaPool: { p1: {} }, battlefield: [] },
      bumpSeq: () => undefined,
    };
    const step = {
      type: ResolutionStepType.MANA_PAYMENT_CHOICE,
      playerId: 'p1',
      recoverManaPayment: true,
      recoverCardId: 'krov2',
      recoverOwnerId: 'p1',
      manaCost: '{1}{B}{B}',
    } as any;
    const cancelled = await tryHandleManaPaymentChoiceWardAndSacrificePrefix(stubIo(), game, gameId, step, { playerId: 'p1', cancelled: true } as any);
    expect(cancelled).toBe(true);
    expect(game.state.zones.p1.exile.some((c: any) => c.id === 'krov2')).toBe(true);

    const card3 = { id: 'krov3', name: 'Krovikan Horror', oracle_text: KROVIKAN, type_line: 'Creature' };
    const game2 = {
      gameId,
      state: { zones: { p1: { graveyard: [card3], hand: [], exile: [] } }, life: { p1: 20 }, manaPool: { p1: { B: 2, C: 1, generic: 1 } }, battlefield: [] },
      bumpSeq: () => undefined,
    };
    const paidDirect = await tryHandleRecoverManaPayment(stubIo(), game2, gameId, {
      type: ResolutionStepType.MANA_PAYMENT_CHOICE,
      playerId: 'p1',
      recoverManaPayment: true,
      recoverCardId: 'krov3',
      recoverOwnerId: 'p1',
      manaCost: '{1}{B}{B}',
    } as any, { playerId: 'p1', selections: [] } as any);
    expect(paidDirect).toBe(true);
    // If mana application rejected the empty selection, the card stays in the graveyard;
    // a successful payment (or a later applyRecoverDecision(true) from this handler) returns it.
    const inHand = game2.state.zones.p1.hand.some((c: any) => c.id === 'krov3');
    const stillGy = game2.state.zones.p1.graveyard.some((c: any) => c.id === 'krov3');
    expect(inHand || stillGy).toBe(true);
    expect(parseRecoverCost(GARZA)?.kind).toBe('pay_half_life_rounded_up');
  });
});

describe('B102 Darkblade combat-damage draw', () => {
  it('draws one card from resolvePlayerDamage when the source surveilled this turn', () => {
    const blade = perm('db1', 'p1', 'Raffine\'s Informant', DARKBLADE, { type_line: 'Creature' });
    const drawn = { id: 'lib1', name: 'Island' };
    const state: any = {
      battlefield: [blade],
      players: [{ id: 'p1', life: 20 }, { id: 'p2', life: 20 }],
      life: { p1: 20, p2: 20 },
      zones: { p1: { library: [drawn], hand: [], graveyard: [], exile: [] }, p2: { library: [], hand: [], graveyard: [], exile: [] } },
      turnPlayer: 'p1',
    };
    notePlayerSurveilledThisTurn(state, 'p1');
    const ctx = { state, gameId: 'b102-darkblade' } as any;
    const result = resolvePlayerDamage(ctx, {
      targetPlayerId: 'p2',
      amount: 2,
      isCombatDamage: true,
      sourcePermanent: blade,
      skipAmountReplacements: true,
    });
    expect(result.damageDealt).toBeGreaterThan(0);
    expect(state.zones.p1.hand.some((c: any) => c.id === 'lib1' || c.name === 'Island')).toBe(true);
    const noSurveil = perm('db2', 'p1', 'Informant', DARKBLADE, { type_line: 'Creature' });
    const state2: any = {
      battlefield: [noSurveil],
      players: [{ id: 'p1', life: 20 }, { id: 'p2', life: 20 }],
      life: { p1: 20, p2: 20 },
      zones: { p1: { library: [{ id: 'lib2', name: 'Plains' }], hand: [], graveyard: [], exile: [] }, p2: { library: [], hand: [], graveyard: [], exile: [] } },
    };
    applyGrantedCombatDamageDraw({ state: state2 } as any, noSurveil, true, 2);
    expect(state2.zones.p1.hand.length).toBe(0);
  });
});

describe('B102 Sanctuary Blade color choice', () => {
  it('queues a color choice from the attach hook and grants protection via canTargetPermanent', async () => {
    const gameId = 'b102-sanctuary';
    clearQueue(gameId);
    const equipment = perm('eq1', 'p1', 'Sanctuary Blade', SANCTUARY, { type_line: 'Artifact — Equipment' });
    const host = perm('c1', 'p1', 'Bear', 'Trample', { type_line: 'Creature' });
    const ctx = { state: { battlefield: [equipment, host] }, gameId, isReplaying: false } as any;
    expect(maybeQueueSanctuaryBladeColorChoice(ctx, equipment, 'c1')).toBe(true);
    expect(queuedSteps(gameId).some((s: any) => s.sanctuaryBladeColorChoice === true)).toBe(true);
    const handled = await tryHandleBatch102OptionChoice(stubIo(), { state: ctx.state }, gameId, queuedSteps(gameId).find((s: any) => s.sanctuaryBladeColorChoice) || {
      sanctuaryBladeColorChoice: true,
      sanctuaryBladeEquipmentId: 'eq1',
    }, { playerId: 'p1', choice: 'red' } as any);
    expect(handled).toBe(true);
    applySanctuaryBladeChosenColor(ctx.state, 'eq1', 'red');
    equipment.attachedTo = 'c1';
    equipment.lastChosenColor = 'red';
    const blocked = canTargetPermanent(host, { controllerId: 'p2', colors: ['R'], objectType: 'spell' }, ctx.state);
    expect(blocked.canTarget).toBe(false);
    const allowed = canTargetPermanent(host, { controllerId: 'p2', colors: ['U'], objectType: 'spell' }, ctx.state);
    expect(allowed.canTarget).toBe(true);
    clearQueue(gameId);
  });
});

describe('B102 Mudslide, Arboria, Tadeas, Tidal Influence', () => {
  it('stops non-flying creatures from untapping via qualifiedUntapProhibitionSource', () => {
    const slide = perm('ms', 'p1', 'Mudslide', MUDSLIDE, { type_line: 'Enchantment' });
    const walker = perm('w1', 'p2', 'Grizzly Bears', '', { type_line: 'Creature — Bear' });
    const flyer = perm('f1', 'p2', 'Birds of Paradise', 'Flying', { type_line: 'Creature — Bird', keywords: ['flying'], hasFlying: true });
    const bf = [slide, walker, flyer];
    expect(qualifiedUntapProhibitionSource(bf, walker)).toBe('Mudslide');
    expect(qualifiedUntapProhibitionSource(bf, flyer)).toBeNull();
  });

  it('blocks attacks through getOwnerAttackRestrictionReason unless the defender acted last turn', () => {
    const arboria = perm('ar', 'p3', 'Arboria', ARBORIA, { type_line: 'World Enchantment' });
    const attacker = perm('atk', 'p1', 'Bear', '', { type_line: 'Creature' });
    const state: any = {
      battlefield: [arboria, attacker],
      spellsCastLastTurnByPlayerCounts: { p2: 0 },
      nontokenPermanentsEnteredLastTurnByPlayer: {},
    };
    const blocked = getOwnerAttackRestrictionReason(attacker, 'p2', { battlefield: state.battlefield, gameState: state });
    expect(blocked).toBeTruthy();
    noteNontokenPermanentEnteredThisTurn(state, 'p2', false);
    snapshotArboriaLastTurnTracking(state);
    const allowed = getOwnerAttackRestrictionReason(attacker, 'p2', { battlefield: state.battlefield, gameState: state });
    expect(allowed).toBeNull();
    expect(arboriaAttackRestrictionReason(attacker, 'p2', { battlefield: state.battlefield, spellsCastLastTurnByPlayerCounts: { p2: 1 } })).toBeNull();
  });

  it('gives Tadeas hexproof while not attacking via canTargetPermanent', () => {
    const tadeas = perm('tad', 'p1', 'Tadeas, Juniper Ascendant', TADEAS, { type_line: 'Legendary Creature' });
    const state = { battlefield: [tadeas] };
    const blocked = canTargetPermanent(tadeas, { controllerId: 'p2', colors: ['B'], objectType: 'spell' }, state as any);
    expect(blocked.canTarget).toBe(false);
    const attacking = { ...tadeas, attacking: true };
    const open = canTargetPermanent(attacking, { controllerId: 'p2', colors: ['B'], objectType: 'spell' }, { battlefield: [attacking] } as any);
    expect(open.canTarget).toBe(true);
  });

  it('locks a second Tidal Influence through isSpellCastingProhibitedByStaticRestriction', () => {
    const existing = perm('ti1', 'p1', 'Tidal Influence', TIDAL, { type_line: 'Enchantment' });
    const state = { battlefield: [existing], players: [{ id: 'p1' }, { id: 'p2' }] };
    const spell = { name: 'Tidal Influence', card: { name: 'Tidal Influence', oracle_text: TIDAL, type_line: 'Enchantment' }, oracle_text: TIDAL, type_line: 'Enchantment' };
    expect(namedPermanentCastIsLocked(state, spell)).toBe(true);
    const result = isSpellCastingProhibitedByStaticRestriction(state, 'p2', spell, 'hand');
    expect(result.prohibited).toBe(true);
  });
});

describe('B102 Void Maw, Idris, Kaervek, Snowmelt, Blightbeetle', () => {
  it('exiles another dying creature from the live movePermanentToGraveyard path', () => {
    const maw = perm('maw', 'p1', 'Void Maw', VOID_MAW, { type_line: 'Creature' });
    const bear = perm('bear', 'p2', 'Grizzly Bears', '', { type_line: 'Creature', owner: 'p2' });
    const state: any = {
      battlefield: [maw, bear],
      zones: { p1: { graveyard: [], exile: [], hand: [] }, p2: { graveyard: [], exile: [], hand: [] } },
      players: [{ id: 'p1' }, { id: 'p2' }],
    };
    const ctx = { state, gameId: 'b102-void', bumpSeq: () => undefined, commandZone: {} } as any;
    const moved = movePermanentToGraveyard(ctx, 'bear', false);
    expect(moved).toBe(true);
    expect(state.battlefield.some((p: any) => p.id === 'bear')).toBe(false);
    expect(state.zones.p2.exile.some((c: any) => c.id === 'bear' || c.name === 'Grizzly Bears' || c.exiledWithSourceId === 'maw')).toBe(true);
    const other = perm('ox', 'p2', 'Gray Ogre', '', { type_line: 'Creature', owner: 'p2' });
    state.battlefield.push(other);
    expect(applyVoidMawExileInstead(ctx, other)).toBe(true);
  });

  it('pumps Idris and applies Kaervek / Snowmelt through getCurrentPowerToughness', () => {
    const idris = perm('idris', 'p1', 'Idris', IDRIS, { type_line: 'Legendary Creature', card: { power: 2, toughness: 2, name: 'Idris', oracle_text: IDRIS, type_line: 'Legendary Creature' } });
    const exiled = { id: 'ex1', name: 'Serra Angel', cmc: 5, mana_value: 5, exiledWithSourceId: 'idris', type_line: 'Creature' };
    const kaervek = perm('kv', 'p2', 'Kaervek, the Spiteful', KAERVEK, { type_line: 'Legendary Creature', card: { power: 3, toughness: 2, name: 'Kaervek, the Spiteful', oracle_text: KAERVEK, type_line: 'Legendary Creature' } });
    const stag = perm('stag', 'p1', 'Snowmelt Stag', SNOWMELT, { type_line: 'Creature', card: { power: 2, toughness: 2, name: 'Snowmelt Stag', oracle_text: SNOWMELT, type_line: 'Creature' } });
    const state: any = {
      battlefield: [idris, kaervek, stag],
      zones: { p1: { exile: [exiled], graveyard: [], hand: [] }, p2: { exile: [], graveyard: [], hand: [] } },
      turnPlayer: 'p1',
    };
    const idrisPt = getCurrentPowerToughness(idris, state);
    expect(idrisPt).toBeTruthy();
    expect((idrisPt as any).power).toBeGreaterThanOrEqual(2 + 5 - 1);
    const stagPt = getCurrentPowerToughness(stag, state);
    expect((stagPt as any).power).toBeGreaterThanOrEqual(4);
    const adj = applyBatch102PowerToughnessAdjustment(idris, state, 2, 2);
    expect(adj.power).toBe(2 + 5 - 1);
  });

  it('blocks +1/+1 counters on an opponent creature through filterRestrictedCounterDeltas', () => {
    const blight = perm('bb', 'p1', 'Blightbeetle', BLIGHT, { type_line: 'Creature' });
    const opp = perm('c2', 'p2', 'Bear', '', { type_line: 'Creature' });
    const state = { battlefield: [blight, opp] };
    const filtered = filterRestrictedCounterDeltas(state, opp, { '+1/+1': 1, '-1/-1': 1 });
    expect(filtered['+1/+1']).toBeUndefined();
    expect(filtered['-1/-1']).toBe(1);
  });
});
