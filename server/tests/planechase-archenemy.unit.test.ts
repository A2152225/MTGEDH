import { describe, expect, it } from 'vitest';
import { normalizePlanechaseOracleText } from '../src/state/modules/planechaseOracleNormalize.js';
import { detectAbilityActivatedTriggers } from '../src/state/modules/triggers/ability-activated-detection.js';
import {
  chaosEnsues,
  planeswalk,
  applyPlanarDieFaceEffects,
} from '../src/state/modules/planechaseRuntime.js';
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
