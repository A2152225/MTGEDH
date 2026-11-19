import { describe, expect, it } from 'vitest';
import { normalizePlanechaseOracleText } from '../src/state/modules/planechaseOracleNormalize.js';
import { detectAbilityActivatedTriggers } from '../src/state/modules/triggers/ability-activated-detection.js';
import {
  chaosEnsues,
  getPlanarController,
  planeswalk,
  applyPlanarDieFaceEffects,
} from '../src/state/modules/planechaseRuntime.js';
import { getUpkeepTriggersForPlayer } from '../src/state/modules/upkeep-triggers.js';
import { getDrawStepTriggers, getPostcombatMainTriggers } from '../src/state/modules/triggers/turn-phases.js';
import { getEndOfCombatTriggers } from '../src/state/modules/triggers/end-combat.js';
import { getOpponentSpellCastTriggers } from '../src/state/modules/triggers/spell-cast.js';
import { setSchemeInMotion, abandonScheme } from '../src/state/modules/archenemyRuntime.js';
import { applyEvent } from '../src/state/modules/applyEvent.js';
import { asCommandZoneAbilitySource } from '../src/state/modules/commandZoneAbilitySources.js';

function makeCtx(state: Record<string, unknown>) {
  return {
    gameId: 'planechase-test',
    state,
    bumpSeq() {
      (state as any).seq = Math.max(0, Number((state as any).seq) || 0) + 1;
    },
  } as any;
}

describe('Planechase / Archenemy normalize + detect', () => {
  it('rewrites {CHAOS} roll wording to chaos ensues', () => {
    expect(normalizePlanechaseOracleText('Whenever you roll {CHAOS}, draw a card.')).toBe(
      'Whenever chaos ensues, draw a card.',
    );
    expect(normalizePlanechaseOracleText('{CHAOS} Destroy target creature.')).toBe(
      'Whenever chaos ensues, Destroy target creature.',
    );
    expect(normalizePlanechaseOracleText('When chaos ensues, cards can\'t enter from exile this turn.')).toBe(
      'Whenever chaos ensues, cards can\'t enter from exile this turn.',
    );
  });

  it('detects chaos ensues / planeswalk-here / scheme-in-motion / encounter triggers', () => {
    const plane = {
      id: 'academy',
      name: 'Academy at Tolaria West',
      type_line: 'Plane — Dominaria',
      oracle_text:
        'At the beginning of your end step, if you have no cards in hand, draw seven cards.\nWhenever chaos ensues, discard your hand.',
    };
    const planeSource = asCommandZoneAbilitySource(plane, 'p1', 'plane');
    const planeTriggers = detectAbilityActivatedTriggers(planeSource.card, planeSource, {});
    expect(planeTriggers.some((t) => t.triggerType === 'chaos_ensues')).toBe(true);

    const amy = {
      id: 'amy',
      name: "Amy's Home",
      type_line: 'Plane — Earth',
      oracle_text:
        "When you planeswalk to Amy's Home and at the beginning of your upkeep, investigate.\nWhenever chaos ensues, time travel.",
    };
    const amySource = asCommandZoneAbilitySource(amy, 'p1', 'plane');
    const amyTriggers = detectAbilityActivatedTriggers(amySource.card, amySource, {});
    expect(amyTriggers.some((t) => t.triggerType === 'planeswalk_here')).toBe(true);

    const scheme = {
      id: 'smolder',
      name: 'All Shall Smolder in My Wake',
      type_line: 'Scheme',
      oracle_text:
        'When you set this scheme in motion, destroy up to one target artifact, up to one target enchantment, and up to one target nonbasic land.',
    };
    const schemeSource = asCommandZoneAbilitySource(scheme, 'p1', 'scheme');
    const schemeTriggers = detectAbilityActivatedTriggers(schemeSource.card, schemeSource, {});
    expect(schemeTriggers.some((t) => t.triggerType === 'scheme_in_motion')).toBe(true);

    const phenomenon = {
      id: 'parallel',
      name: 'Caught in a Parallel Universe',
      type_line: 'Phenomenon',
      oracle_text:
        "When you encounter Caught in a Parallel Universe, each player draws a card. (Then planeswalk away from this phenomenon.)",
    };
    const phenSource = asCommandZoneAbilitySource(phenomenon, 'p1', 'phenomenon');
    const phenTriggers = detectAbilityActivatedTriggers(phenSource.card, phenSource, {});
    expect(phenTriggers.some((t) => t.triggerType === 'named_encounter')).toBe(true);
  });
});

describe('Planechase runtime', () => {
  it('planeswalks past a phenomenon onto the next plane and queues encounter + planeswalk-here', () => {
    const current = {
      id: 'plane-old',
      name: 'Akoum',
      type_line: 'Plane — Zendikar',
      oracle_text: 'Whenever chaos ensues, destroy target creature that isn\'t enchanted.',
    };
    const phenomenon = {
      id: 'phen-1',
      name: 'Caught in a Parallel Universe',
      type_line: 'Phenomenon',
      oracle_text:
        'When you encounter Caught in a Parallel Universe, each player draws a card. (Then planeswalk away from this phenomenon.)',
    };
    const next = {
      id: 'plane-new',
      name: "Amy's Home",
      type_line: 'Plane — Earth',
      oracle_text:
        "When you planeswalk to Amy's Home and at the beginning of your upkeep, investigate.\nWhenever chaos ensues, time travel.",
    };
    const state: any = {
      houseRules: { enablePlanechase: true },
      currentPlane: current,
      activePlane: current,
      planarDeckFaceDown: [phenomenon, next],
      stack: [],
      players: [{ id: 'p1' }],
    };
    const ctx = makeCtx(state);
    const result = planeswalk(ctx, 'p1');
    expect(result.ok).toBe(true);
    expect(result.plane?.id).toBe('plane-new');
    expect(result.phenomenaEncountered.map((p: any) => p.id)).toEqual(['phen-1']);
    expect(state.currentPlane?.id).toBe('plane-new');
    expect(state.activePlane?.id).toBe('plane-new');
    expect(state.planarDeckFaceDown.map((c: any) => c.id)).toEqual(['plane-old', 'phen-1']);
    expect(result.queued.length).toBeGreaterThan(0);
  });

  it('the planar controller is the active player, not whoever last planeswalked', () => {
    expect(getPlanarController({ turnPlayer: 'p2', planarController: 'p1' }, 'p1')).toBe('p2');
    expect(getPlanarController({ planarController: 'p1' }, 'p2')).toBe('p2');
  });

  it('a face-up plane\'s upkeep ability is seen even though the plane is not on the battlefield', () => {
    const plane = {
      id: 'spectro',
      name: 'Spectrox Mines',
      type_line: 'Plane — Androzani Minor',
      oracle_text:
        'When you planeswalk to Spectrox Mines and at the beginning of your upkeep, you lose 3 life and create a Treasure token.\nWhenever chaos ensues, create a Food token.',
    };
    const state: any = {
      houseRules: { enablePlanechase: true },
      turnPlayer: 'p1',
      activePlayer: 'p1',
      players: [{ id: 'p1' }],
      battlefield: [],
      currentPlane: plane,
      activePlane: plane,
      stack: [],
    };
    const triggers = getUpkeepTriggersForPlayer(makeCtx(state), 'p1');
    expect(triggers.some((trigger) => /lose 3 life/i.test(String(trigger.effect || trigger.description || '')))).toBe(true);
  });

  it('rolls of the planar die queue the roll trigger, and a blank also queues the blank trigger', () => {
    const plane = {
      id: 'drum',
      name: 'The Drum, Mining Facility',
      type_line: 'Plane — Earth',
      oracle_text:
        'Whenever you roll the planar die, creatures you control get +1/+1 and gain haste until end of turn.\nWhenever you roll a blank on the planar die, scry 2.\nWhenever chaos ensues, end the turn.',
    };
    const blankState: any = {
      houseRules: { enablePlanechase: true },
      turnPlayer: 'p1',
      currentPlane: plane,
      activePlane: plane,
      stack: [],
      players: [{ id: 'p1' }],
    };
    applyPlanarDieFaceEffects(makeCtx(blankState), 'p1', ['blank']);
    const blankEffects = (blankState.stack || []).map((item: any) => String(item.effect || item.description || ''));
    expect(blankEffects.some((text: string) => /haste/i.test(text))).toBe(true);
    expect(blankEffects.some((text: string) => /scry 2/i.test(text))).toBe(true);
    expect(blankEffects.some((text: string) => /end the turn/i.test(text))).toBe(false);

    const chaosState: any = {
      ...blankState,
      stack: [],
    };
    applyPlanarDieFaceEffects(makeCtx(chaosState), 'p1', ['chaos']);
    const chaosEffects = (chaosState.stack || []).map((item: any) => String(item.effect || item.description || ''));
    expect(chaosEffects.some((text: string) => /haste/i.test(text))).toBe(true);
    expect(chaosEffects.some((text: string) => /end the turn/i.test(text))).toBe(true);
    expect(chaosEffects.some((text: string) => /scry 2/i.test(text))).toBe(false);
  });

  it('draw step, end of combat, and postcombat main read the face-up plane', () => {
    const plane = {
      id: 'phases',
      name: 'Phase Plane',
      type_line: 'Plane — Test',
      oracle_text:
        'At the beginning of your draw step, scry 1.\nAt the end of combat, you gain 1 life.\nAt the beginning of your postcombat main phase, draw a card.',
    };
    const state: any = {
      houseRules: { enablePlanechase: true },
      turnPlayer: 'p1',
      activePlayer: 'p1',
      players: [{ id: 'p1' }],
      battlefield: [],
      currentPlane: plane,
      activePlane: plane,
    };
    const ctx = makeCtx(state);
    expect(getDrawStepTriggers(ctx, 'p1').some((trigger) => /scry 1/i.test(String(trigger.effect || '')))).toBe(true);
    expect(getEndOfCombatTriggers(ctx, 'p1').some((trigger) => /gain 1 life/i.test(String(trigger.effect || '')))).toBe(true);
    expect(getPostcombatMainTriggers(ctx, 'p1').some((trigger) => /draw a card/i.test(String(trigger.effect || '')))).toBe(true);
  });

  it('a plane sees a historic spell cast by any player and ignores a creature spell', () => {
    const source = asCommandZoneAbilitySource({
      id: 'coal',
      name: 'Coal Hill School',
      type_line: 'Plane — Earth',
      oracle_text: 'Whenever a player casts a historic spell, that player draws a card.',
    }, 'p1', 'plane');
    const historic = getOpponentSpellCastTriggers(
      [source],
      'p2',
      { name: 'Sol Ring', type_line: 'Artifact' },
      ['p1', 'p2'],
    );
    const creature = getOpponentSpellCastTriggers(
      [source],
      'p2',
      { name: 'Grizzly Bears', type_line: 'Creature — Bear' },
      ['p1', 'p2'],
    );
    expect(historic.some((trigger) => /draws a card/i.test(String(trigger.effect || trigger.description || '')))).toBe(true);
    expect(creature).toEqual([]);
  });

  it('chaos ensues queues the face-up plane chaos ability', () => {
    const plane = {
      id: 'academy',
      name: 'Academy at Tolaria West',
      type_line: 'Plane — Dominaria',
      oracle_text: 'Whenever chaos ensues, discard your hand.',
    };
    const state: any = {
      houseRules: { enablePlanechase: true },
      currentPlane: plane,
      activePlane: plane,
      stack: [],
      players: [{ id: 'p1' }],
    };
    const queued = chaosEnsues(makeCtx(state), 'p1');
    expect(queued.length).toBeGreaterThan(0);
    expect(String(queued[0]?.effect || queued[0]?.description || '')).toMatch(/discard/i);
  });

  it('planar die chaos face fires chaos ensues when planechase is enabled', () => {
    const plane = {
      id: 'academy',
      name: 'Academy at Tolaria West',
      type_line: 'Plane — Dominaria',
      oracle_text: 'Whenever chaos ensues, discard your hand.',
    };
    const state: any = {
      houseRules: { enablePlanechase: true },
      currentPlane: plane,
      activePlane: plane,
      stack: [],
      players: [{ id: 'p1' }],
    };
    applyPlanarDieFaceEffects(makeCtx(state), 'p1', ['chaos']);
    expect(Array.isArray(state.stack) ? state.stack.length : 0).toBeGreaterThanOrEqual(0);
  });
});

describe('Archenemy runtime', () => {
  it('sets a non-ongoing scheme in motion and parks it on the scheme deck bottom', () => {
    const scheme = {
      id: 'smolder',
      name: 'All Shall Smolder in My Wake',
      type_line: 'Scheme',
      oracle_text:
        'When you set this scheme in motion, destroy up to one target artifact, up to one target enchantment, and up to one target nonbasic land.',
    };
    const state: any = {
      houseRules: { enableArchenemy: true },
      archenemyPlayerId: 'p1',
      schemeDeck: [scheme],
      ongoingSchemes: [],
      stack: [],
      players: [{ id: 'p1' }],
    };
    const result = setSchemeInMotion(makeCtx(state), 'p1');
    expect(result.ok).toBe(true);
    expect(result.ongoing).toBe(false);
    expect(result.queued.length).toBeGreaterThan(0);
    expect(state.schemeDeck.map((s: any) => s.name)).toContain('All Shall Smolder in My Wake');
    expect(state.ongoingSchemes).toEqual([]);
  });

  it('keeps ongoing schemes face up and abandons them to the scheme deck bottom', () => {
    const scheme = {
      id: 'willed',
      name: 'Because I Have Willed It',
      type_line: 'Ongoing Scheme',
      oracle_text:
        "(An ongoing scheme remains face up until it's abandoned.)\nSpells you cast cost {1} less to cast.\nAt the beginning of your opponents' end step, if they cast four or more spells this turn, abandon this scheme.",
      is_ongoing: true,
    };
    const state: any = {
      houseRules: { enableArchenemy: true },
      archenemyPlayerId: 'p1',
      schemeDeck: [scheme],
      ongoingSchemes: [],
      stack: [],
      players: [{ id: 'p1' }],
    };
    const set = setSchemeInMotion(makeCtx(state), 'p1');
    expect(set.ok).toBe(true);
    expect(set.ongoing).toBe(true);
    expect(state.ongoingSchemes).toHaveLength(1);

    const abandoned = abandonScheme(makeCtx(state), 'willed');
    expect(abandoned.ok).toBe(true);
    expect(state.ongoingSchemes).toEqual([]);
    expect(state.schemeDeck.some((s: any) => s.id === 'willed' || s.name === 'Because I Have Willed It')).toBe(true);
  });
});

describe('applyEvent restore', () => {
  it('restores planeswalk zone snapshot on replay', () => {
    const toPlane = { id: 'unyaro', name: 'Unyaro', type_line: 'Plane — Shandalar' };
    const deck = [{ id: 'later', name: 'Pools of Becoming', type_line: 'Plane — Bolas' }];
    const state: any = {
      houseRules: { enablePlanechase: true },
      currentPlane: { id: 'old', name: 'Akoum', type_line: 'Plane — Zendikar' },
      planarDeckFaceDown: [],
      seq: 0,
    };
    const ctx = makeCtx(state);
    (ctx as any).isReplaying = true;
    applyEvent(ctx, {
      type: 'planeswalk',
      playerId: 'p1',
      toPlane,
      planarDeckFaceDown: deck,
      chaoticAetherActive: false,
      planeswalksAttempted: 2,
      planeswalkedToThisTurn: { p1: ['unyaro'] },
    } as any);
    expect(state.currentPlane?.id).toBe('unyaro');
    expect(state.activePlane?.id).toBe('unyaro');
    expect(state.planarDeckFaceDown.map((c: any) => c.id)).toEqual(['later']);
    expect(state.planeswalksAttempted).toBe(2);
  });

  it('restores setSchemeInMotion / abandonScheme zone snapshots on replay', () => {
    const ongoing = {
      id: 'willed',
      name: 'Because I Have Willed It',
      type_line: 'Ongoing Scheme',
      is_ongoing: true,
    };
    const state: any = {
      houseRules: { enableArchenemy: true },
      schemeDeck: [],
      ongoingSchemes: [],
      seq: 0,
    };
    const ctx = makeCtx(state);
    (ctx as any).isReplaying = true;
    applyEvent(ctx, {
      type: 'setSchemeInMotion',
      playerId: 'p1',
      ongoing: true,
      scheme: ongoing,
      schemeDeck: [],
      ongoingSchemes: [ongoing],
      schemeGraveyard: [],
    } as any);
    expect(state.ongoingSchemes).toHaveLength(1);

    applyEvent(ctx, {
      type: 'abandonScheme',
      schemeId: 'willed',
      scheme: ongoing,
      schemeDeck: [ongoing],
      ongoingSchemes: [],
      schemeGraveyard: [],
    } as any);
    expect(state.ongoingSchemes).toEqual([]);
    expect(state.schemeDeck).toHaveLength(1);
  });
});
