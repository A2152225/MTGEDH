import { describe, expect, it } from 'vitest';
import { movePermanentToGraveyard } from '../src/state/modules/counters_tokens.js';
import { processFaceUpTriggers, processLTBTriggers, processMonstrousTriggers } from '../src/state/modules/triggerEmissionFamilyUtils.js';
import { turnReturnedPermanentFaceUp } from '../src/state/modules/triggerDelayedEffectUtils.js';
import {
  detectDeathTriggers,
  detectETBTriggers,
  detectLTBTriggers,
  detectMonstrousTriggers,
  getDeathTriggers,
} from '../src/state/modules/triggered-abilities.js';
import { detectTapTriggers, getTapTriggers } from '../src/state/modules/triggers/tap-untap.js';

const perm = { id: 'P1', controller: 'p1' };

function makeCtx(state: any) {
  return {
    state,
    gameId: 'enters_or_other_event',
    bumpSeq: () => {
      state.seq = Number(state.seq || 0) + 1;
    },
    isReplaying: false,
  } as any;
}

describe('D5 compound enters-or other-event detection', () => {
  it('detects enters-or-dies as a death trigger with the payoff as the effect', () => {
    const oracle = 'When this creature enters or dies, mill three cards.';
    const triggers = detectDeathTriggers(
      { name: "Stitcher's Supplier", oracle_text: oracle },
      perm,
    );
    const death = triggers.find((trigger) => trigger.triggerType === 'enters_or_dies');
    expect(death?.effect?.toLowerCase()).toContain('mill three cards');
    expect(death?.effect?.toLowerCase()).not.toMatch(/^or dies/);
  });

  it('detects artifact enters-or-graveyard as a self dies/GY trigger', () => {
    const oracle = 'When this artifact enters or is put into a graveyard from the battlefield, draw a card.';
    const triggers = detectDeathTriggers(
      { name: 'Ichor Wellspring', oracle_text: oracle },
      perm,
    );
    const gy = triggers.find((trigger) => trigger.triggerType === 'dies' || trigger.triggerType === 'enters_or_dies');
    expect(gy?.effect?.toLowerCase()).toContain('draw a card');
    expect(gy?.effect?.toLowerCase()).not.toMatch(/^or is put into a graveyard/);
  });

  it('detects artifact enters-or-leaves as an LTB trigger', () => {
    const oracle = 'When this artifact enters or leaves the battlefield, draw a card.';
    const triggers = detectLTBTriggers(
      { name: 'Cryogen Relic', oracle_text: oracle },
      perm,
    );
    const ltb = triggers.find((trigger) => trigger.triggerType === 'self_enters_or_leaves');
    expect(ltb?.effect?.toLowerCase()).toContain('draw a card');
    expect(ltb?.effect?.toLowerCase()).not.toMatch(/^or leaves/);
  });

  it('detects enters-or-becomes-monstrous as a monstrous trigger', () => {
    const oracle = 'When this creature enters or becomes monstrous, draw a card.';
    const triggers = detectMonstrousTriggers(
      { name: 'Monstrous Test', oracle_text: oracle },
      perm,
    );
    const monstrous = triggers.find((trigger) => trigger.triggerType === 'became_monstrous');
    expect(monstrous?.effect?.toLowerCase()).toContain('draw a card');
    expect(monstrous?.effect?.toLowerCase()).not.toMatch(/^or becomes monstrous/);
  });

  it('detects enters-or-becomes-tapped as a self tap trigger', () => {
    const oracle = 'Whenever this creature enters or becomes tapped, tap up to one target creature.';
    const triggers = detectTapTriggers(
      { name: 'Champions of the Shoal', oracle_text: oracle },
      perm,
    );
    const tap = triggers.find((trigger) => trigger.affectedType === 'self');
    expect(tap?.effect?.toLowerCase()).toContain('tap up to one target creature');
    expect(tap?.effect?.toLowerCase()).not.toMatch(/^or becomes tapped/);
  });

  it('detects enters-or-turned-face-up as a self face-up trigger', () => {
    const oracle = 'When this creature enters or is turned face up, draw a card.';
    const triggers = detectETBTriggers(
      { name: 'Willbender', oracle_text: oracle },
      perm,
    );
    const faceUp = triggers.find((trigger) => trigger.triggerType === 'face_up');
    expect(faceUp?.effect?.toLowerCase()).toContain('draw a card');
    expect(faceUp?.effect?.toLowerCase()).not.toMatch(/^or is turned face up/);
  });

  it('detects enters-or-haunts-dies with modern haunt wording', () => {
    const oracle = 'When this creature enters or the creature it haunts dies, target player discards a card.';
    const triggers = detectDeathTriggers(
      { name: 'Exhumer Thrull', oracle_text: oracle },
      perm,
    );
    const haunt = triggers.find((trigger) => trigger.triggerType === 'haunts_creature_dies');
    expect(haunt?.effect?.toLowerCase()).toContain('target player discards a card');
  });

  it('still detects reminder-style the-creature-this-card-haunts-dies', () => {
    const oracle = 'When the creature this card haunts dies, target player discards a card.';
    const triggers = detectDeathTriggers(
      { name: 'Cry of Contrition', oracle_text: oracle },
      perm,
    );
    expect(triggers.some((trigger) => trigger.triggerType === 'haunts_creature_dies')).toBe(true);
  });
});

describe('D5 compound enters-or other-event fire paths', () => {
  it('queues LTB when an artifact with enters-or-leaves leaves', () => {
    const relic = {
      id: 'relic',
      controller: 'p1',
      card: {
        name: 'Cryogen Relic',
        type_line: 'Artifact',
        oracle_text: 'When this artifact enters or leaves the battlefield, draw a card.',
      },
    };
    const state: any = {
      seq: 1,
      stack: [],
      battlefield: [],
      players: [{ id: 'p1' }],
    };
    const queued = processLTBTriggers(makeCtx(state), relic, { cause: 'exile' });
    expect(queued.length).toBeGreaterThan(0);
    expect(state.stack.some((item: any) => item.triggerType === 'self_enters_or_leaves')).toBe(true);
    expect(String(state.stack[0]?.effect || '').toLowerCase()).toContain('draw a card');
  });

  it('queues monstrous when a compound enters-or-monstrous creature becomes monstrous', () => {
    const permanent = {
      id: 'hydra',
      controller: 'p1',
      isMonstrous: true,
      card: {
        name: 'Monstrous Test',
        type_line: 'Creature — Hydra',
        oracle_text: 'When this creature enters or becomes monstrous, draw a card.',
      },
    };
    const state: any = {
      seq: 1,
      stack: [],
      battlefield: [permanent],
      players: [{ id: 'p1' }],
    };
    const queued = processMonstrousTriggers(makeCtx(state), permanent);
    expect(queued.length).toBeGreaterThan(0);
    expect(state.stack.some((item: any) => item.triggerType === 'became_monstrous')).toBe(true);
  });

  it('fires self tap triggers for enters-or-becomes-tapped', () => {
    const creature = {
      id: 'shoal',
      controller: 'p1',
      card: {
        name: 'Champions of the Shoal',
        type_line: 'Creature — Merfolk Soldier',
        oracle_text: 'Whenever this creature enters or becomes tapped, tap up to one target creature.',
      },
    };
    const ctx = makeCtx({
      seq: 1,
      stack: [],
      battlefield: [creature],
      players: [{ id: 'p1' }],
    });
    const triggers = getTapTriggers(ctx, creature, 'p1');
    expect(triggers.some((trigger) => trigger.affectedType === 'self')).toBe(true);
    expect(triggers[0]?.effect?.toLowerCase()).toContain('tap up to one target creature');
  });

  it('getDeathTriggers fires enters-or-dies for the dying creature', () => {
    const stitcher = {
      id: 'stitcher',
      controller: 'p1',
      card: {
        name: "Stitcher's Supplier",
        type_line: 'Creature — Zombie',
        oracle_text: 'When this creature enters or dies, mill three cards.',
      },
    };
    const triggers = getDeathTriggers(makeCtx({
      battlefield: [],
      stack: [],
      players: [{ id: 'p1' }],
      zones: { p1: { exile: [] } },
    }), stitcher, 'p1');
    expect(triggers.some((trigger) => /mill three cards/i.test(String(trigger.effect || '')))).toBe(true);
  });

  it('getDeathTriggers fires artifact enters-or-graveyard without treating it as a creature', () => {
    const wellspring = {
      id: 'ichor',
      controller: 'p1',
      card: {
        name: 'Ichor Wellspring',
        type_line: 'Artifact',
        oracle_text: 'When this artifact enters or is put into a graveyard from the battlefield, draw a card.',
      },
    };
    const triggers = getDeathTriggers(makeCtx({
      battlefield: [],
      stack: [],
      players: [{ id: 'p1' }],
      zones: { p1: { exile: [] } },
    }), wellspring, 'p1');
    expect(triggers).toEqual(expect.arrayContaining([
      expect.objectContaining({
        source: expect.objectContaining({ permanentId: 'ichor' }),
        effect: expect.stringMatching(/draw a card/i),
      }),
    ]));
  });

  it('does not double-queue a plain self-dies trigger', () => {
    const creature = {
      id: 'bearer',
      controller: 'p1',
      card: {
        name: 'Elvish Visionary',
        type_line: 'Creature — Elf Shaman',
        oracle_text: 'When this creature dies, draw a card.',
      },
    };
    const triggers = getDeathTriggers(makeCtx({
      battlefield: [],
      stack: [],
      players: [{ id: 'p1' }],
      zones: { p1: { exile: [] } },
    }), creature, 'p1');
    const draws = triggers.filter((trigger) => /draw a card/i.test(String(trigger.effect || '')));
    expect(draws).toHaveLength(1);
  });

  it('fires haunt leave from exile when the haunted creature dies', () => {
    const haunted = {
      id: 'bear',
      controller: 'p1',
      card: {
        name: 'Grizzly Bears',
        type_line: 'Creature — Bear',
        oracle_text: '',
      },
    };
    const hauntCard = {
      id: 'thrull',
      owner: 'p1',
      hauntingPermanentId: 'bear',
      name: 'Exhumer Thrull',
      type_line: 'Creature — Spirit',
      oracle_text: 'When this creature enters or the creature it haunts dies, return target creature card from your graveyard to your hand.',
    };
    const triggers = getDeathTriggers(makeCtx({
      battlefield: [],
      stack: [],
      players: [{ id: 'p1' }],
      zones: { p1: { exile: [hauntCard] } },
    }), haunted, 'p1');
    expect(triggers.some((trigger) => (
      trigger.source.permanentId === 'thrull'
      && /return target creature card/i.test(String(trigger.effect || ''))
    ))).toBe(true);
  });

  it('processFaceUpTriggers queues self face-up for enters-or-turned-face-up', () => {
    const willbender = {
      id: 'willbender',
      controller: 'p1',
      card: {
        name: 'Willbender',
        type_line: 'Creature — Human Wizard',
        oracle_text: 'When this creature enters or is turned face up, draw a card.',
      },
    };
    const state: any = {
      seq: 1,
      stack: [],
      battlefield: [willbender],
      players: [{ id: 'p1' }],
    };
    const queued = processFaceUpTriggers(makeCtx(state), willbender);
    expect(queued.length).toBeGreaterThan(0);
    expect(state.stack.some((item: any) => item.triggerType === 'face_up')).toBe(true);
    expect(String(state.stack[0]?.effect || '').toLowerCase()).toContain('draw a card');
  });

  it('processFaceUpTriggers queues a watcher when another permanent is turned face up', () => {
    const ambushers = {
      id: 'ambushers',
      controller: 'p1',
      card: {
        name: 'Salt Road Ambushers',
        type_line: 'Creature — Human Warrior',
        oracle_text: 'Whenever another permanent you control is turned face up, put two +1/+1 counters on it.',
      },
    };
    const morph = {
      id: 'morph',
      controller: 'p1',
      card: {
        name: 'Willbender',
        type_line: 'Creature — Human Wizard',
        oracle_text: 'Morph {1}{U}',
      },
    };
    const state: any = {
      seq: 1,
      stack: [],
      battlefield: [ambushers, morph],
      players: [{ id: 'p1' }],
    };
    const queued = processFaceUpTriggers(makeCtx(state), morph);
    expect(queued.length).toBeGreaterThan(0);
    expect(state.stack.some((item: any) => (
      item.triggerType === 'another_permanent_face_up'
      && /put two \+1\/\+1 counters/i.test(String(item.effect || item.description || ''))
    ))).toBe(true);
  });

  it('turnReturnedPermanentFaceUp emits face-up triggers and applies megamorph', () => {
    const morph = {
      id: 'returned',
      controller: 'p1',
      isFaceDown: true,
      faceUpCard: {
        name: 'Ainok Survivalist',
        type_line: 'Creature — Dog Shaman',
        oracle_text: 'Megamorph {2}{G}\nWhen this creature is turned face up, draw a card.',
        power: '2',
        toughness: '1',
      },
      card: {
        name: 'Face-down Creature',
        type_line: 'Creature',
      },
      counters: {},
    };
    const state: any = {
      seq: 1,
      stack: [],
      battlefield: [morph],
      players: [{ id: 'p1' }],
    };
    turnReturnedPermanentFaceUp(morph, makeCtx(state));
    expect(morph.isFaceDown).toBe(false);
    expect(morph.counters['+1/+1']).toBe(1);
    expect(state.stack.some((item: any) => item.triggerType === 'face_up')).toBe(true);
  });

  it('movePermanentToGraveyard stacks Ichor Wellspring draw when the artifact dies', () => {
    const wellspring = {
      id: 'ichor',
      controller: 'p1',
      owner: 'p1',
      card: {
        id: 'ichor_card',
        name: 'Ichor Wellspring',
        type_line: 'Artifact',
        oracle_text: 'When this artifact enters or is put into a graveyard from the battlefield, draw a card.',
      },
    };
    const state: any = {
      seq: 1,
      stack: [],
      battlefield: [wellspring],
      players: [{ id: 'p1' }],
      zones: { p1: { hand: [], graveyard: [], exile: [], handCount: 0, graveyardCount: 0 } },
    };
    movePermanentToGraveyard(makeCtx(state), 'ichor');
    expect(state.stack.some((item: any) => /draw a card/i.test(String(item.effect || item.description || '')))).toBe(true);
  });
});
