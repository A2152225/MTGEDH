/**
 * P1-5 utility scorer / role policy tests.
 */

import { describe, expect, it } from 'vitest';
import type { Observation } from '../src/ai/observation.js';
import type { CardAIProfile } from '../src/ai/cardProfileTypes.js';
import {
  buildScoreContext,
  rankCandidates,
  type CandidateView,
  type ScoreContext,
} from '../src/ai/utilityScorer.js';
import { EMPTY_PROFILE } from '../src/ai/utilityScorer.js';

function baseObs(overrides?: Partial<Observation>): Observation {
  const obs: Observation = {
    seat: 'p1',
    turn: 4,
    phase: 'main',
    step: 'MAIN1',
    activeSeat: 'p1',
    priority: 'p1',
    self: {
      life: 36,
      hand: [{ id: 'h1' }, { id: 'h2' }, { id: 'h3' }],
      deckList: [],
      librarySize: 80,
      graveyard: [],
      exile: [],
      battlefield: [
        {
          id: 'land1',
          controller: 'p1',
          typeLine: 'Basic Land — Forest',
          types: ['land'],
          oracleText: '{T}: Add {G}.',
          isToken: false,
          isCommander: false,
          power: 0,
          toughness: 0,
          keywords: {
            flying: false,
            deathtouch: false,
            lifelink: false,
            trample: false,
            indestructible: false,
            doubleStrike: false,
            firstStrike: false,
            menace: false,
            haste: false,
            defender: false,
            vigilance: false,
          },
          tapped: false,
          summoningSick: false,
          counters: {},
          producesMana: true,
          faceDown: false,
        },
      ],
      commanders: [],
      manaPool: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    },
    opponents: [
      {
        id: 'p2',
        life: 40,
        handSize: 5,
        librarySize: 85,
        graveyard: [],
        exile: [],
        battlefield: [],
        commanders: [],
        eliminated: false,
      },
      {
        id: 'p3',
        life: 40,
        handSize: 4,
        librarySize: 90,
        graveyard: [],
        exile: [],
        battlefield: [],
        commanders: [],
        eliminated: false,
      },
    ],
    stack: [],
    commanderDamage: {},
  };
  return { ...obs, ...overrides, self: { ...obs.self, ...(overrides?.self || {}) } };
}

function creature(
  id: string,
  controller: string,
  power: number,
  toughness: number,
  keywords: Partial<Observation['self']['battlefield'][0]['keywords']> = {},
): Observation['self']['battlefield'][0] {
  return {
    id,
    controller: controller as any,
    name: id,
    typeLine: 'Creature — Beast',
    types: ['creature'],
    oracleText: '',
    isToken: false,
    isCommander: false,
    power,
    toughness,
    keywords: {
      flying: false,
      deathtouch: false,
      lifelink: false,
      trample: false,
      indestructible: false,
      doubleStrike: false,
      firstStrike: false,
      menace: false,
      haste: false,
      defender: false,
      vigilance: false,
      ...keywords,
    },
    tapped: false,
    summoningSick: false,
    counters: {},
    producesMana: false,
    faceDown: false,
  };
}

function profile(partial: Partial<CardAIProfile> & { name: string; roles: CardAIProfile['roles'] }): CardAIProfile {
  return {
    oracleId: 'oid',
    timing: 'sorcery_speed',
    needs: [],
    source: 'ir',
    ...partial,
  };
}

function cand(partial: Partial<CandidateView> & { index: number; kind: CandidateView['kind'] }): CandidateView {
  return {
    v0Priority: 100,
    ...partial,
  };
}

describe('rankCandidates', () => {
  it('scores ramp higher on turn 2 than turn 9', () => {
    const early = baseObs({ turn: 2 });
    const late = baseObs({ turn: 9 });
    const profiles = () => profile({ name: 'Sol Ring', roles: ['ramp'] });
    const c = [cand({ index: 0, kind: 'cast_spell', name: 'Sol Ring', v0Priority: 50 })];
    const sEarly = rankCandidates(early, c, profiles)[0].score;
    const sLate = rankCandidates(late, c, profiles)[0].score;
    expect(sEarly).toBeGreaterThan(sLate);
  });

  it('scores draw higher with a small hand than a full hand', () => {
    const small = baseObs({ self: { ...baseObs().self, hand: [{ id: 'h1' }] } });
    const full = baseObs({
      self: {
        ...baseObs().self,
        hand: Array.from({ length: 7 }, (_, i) => ({ id: `h${i}` })),
      },
    });
    const profiles = () => profile({ name: 'Harmonize', roles: ['draw'] });
    const c = [cand({ index: 0, kind: 'cast_spell', name: 'Harmonize', v0Priority: 40 })];
    expect(rankCandidates(small, c, profiles)[0].score).toBeGreaterThan(
      rankCandidates(full, c, profiles)[0].score,
    );
  });

  it('drops removal when no worthwhile opposing creature exists', () => {
    const obs = baseObs({
      opponents: [
        {
          id: 'p2',
          life: 40,
          handSize: 5,
          librarySize: 80,
          graveyard: [],
          exile: [],
          battlefield: [creature('tiny', 'p2', 1, 1)],
          commanders: [],
          eliminated: false,
        },
      ],
    });
    const profiles = () =>
      profile({
        name: 'Swords to Plowshares',
        roles: ['removal'],
        timing: 'instant',
        needs: ['target_creature'],
      });
    const ranked = rankCandidates(
      obs,
      [cand({ index: 0, kind: 'cast_spell', name: 'Swords to Plowshares', v0Priority: 200 })],
      profiles,
    );
    expect(ranked[0].dropped).toBe(true);
  });

  it('keeps removal and boosts it against a big threat', () => {
    const obs = baseObs({
      opponents: [
        {
          id: 'p2',
          life: 40,
          handSize: 5,
          librarySize: 80,
          graveyard: [],
          exile: [],
          battlefield: [creature('beast', 'p2', 8, 8)],
          commanders: [],
          eliminated: false,
        },
      ],
    });
    const profiles = () =>
      profile({
        name: 'Swords to Plowshares',
        roles: ['removal'],
        timing: 'instant',
        needs: ['target_creature'],
      });
    const ranked = rankCandidates(
      obs,
      [cand({ index: 0, kind: 'cast_spell', name: 'Swords to Plowshares', v0Priority: 50 })],
      profiles,
    );
    expect(ranked[0].dropped).toBe(false);
    expect(ranked[0].score).toBeGreaterThan(50);
  });

  it('drops a high-v0 sweeper when ahead on board (gate)', () => {
    const obs = baseObs({
      self: {
        ...baseObs().self,
        battlefield: [
          ...baseObs().self.battlefield,
          creature('c1', 'p1', 5, 5),
          creature('c2', 'p1', 4, 4),
          creature('c3', 'p1', 3, 3),
        ],
      },
      opponents: [
        {
          id: 'p2',
          life: 40,
          handSize: 4,
          librarySize: 80,
          graveyard: [],
          exile: [],
          battlefield: [creature('opp1', 'p2', 1, 1)],
          commanders: [],
          eliminated: false,
        },
      ],
    });
    const profiles = () => profile({ name: 'Wrath of God', roles: ['sweeper'] });
    const candidates = [
      cand({ index: 0, kind: 'cast_spell', name: 'Wrath of God', v0Priority: 999 }),
      cand({ index: 1, kind: 'cast_spell', name: 'Other', v0Priority: 10 }),
    ];
    const ranked = rankCandidates(obs, candidates, (name) =>
      name === 'Wrath of God' ? profiles() : undefined,
    );
    expect(ranked[0].dropped).toBe(true);
    expect(ranked[1].dropped).toBe(false);
    expect(ranked[1].score).toBe(10);
  });

  it('keeps sweeper when behind on board', () => {
    const obs = baseObs({
      opponents: [
        {
          id: 'p2',
          life: 40,
          handSize: 4,
          librarySize: 80,
          graveyard: [],
          exile: [],
          battlefield: [
            creature('o1', 'p2', 5, 5),
            creature('o2', 'p2', 5, 5),
            creature('o3', 'p2', 5, 5),
            creature('o4', 'p2', 4, 4),
          ],
          commanders: [],
          eliminated: false,
        },
      ],
    });
    const profiles = () => profile({ name: 'Wrath of God', roles: ['sweeper'] });
    const ranked = rankCandidates(
      obs,
      [cand({ index: 0, kind: 'cast_spell', name: 'Wrath of God', v0Priority: 80 })],
      profiles,
    );
    expect(ranked[0].dropped).toBe(false);
  });

  it('drops counterspell in main and vs own stack; scores higher vs big enemy spell', () => {
    const main = baseObs();
    const ownStack = baseObs({
      stack: [{ id: 's1', controller: 'p1', name: 'My Spell', cmc: 6, type: 'spell' }],
    });
    const enemySmall = baseObs({
      stack: [{ id: 's1', controller: 'p2', name: 'Shock', cmc: 1, type: 'spell' }],
    });
    const enemyBig = baseObs({
      stack: [{ id: 's1', controller: 'p2', name: 'Expropriate', cmc: 7, type: 'spell' }],
    });
    const profiles = () =>
      profile({ name: 'Counterspell', roles: ['counterspell'], timing: 'instant' });
    const c = [cand({ index: 0, kind: 'cast_spell', name: 'Counterspell', v0Priority: 60 })];
    expect(rankCandidates(main, c, profiles)[0].dropped).toBe(true);
    expect(rankCandidates(ownStack, c, profiles)[0].dropped).toBe(true);
    expect(rankCandidates(enemySmall, c, profiles)[0].dropped).toBe(false);
    expect(rankCandidates(enemyBig, c, profiles)[0].score).toBeGreaterThan(
      rankCandidates(enemySmall, c, profiles)[0].score,
    );
  });

  it('passes through cards with no profile at exact v0Priority', () => {
    const obs = baseObs();
    const ranked = rankCandidates(
      obs,
      [cand({ index: 0, kind: 'cast_spell', name: 'Unknown Card', v0Priority: 123 })],
      () => undefined,
    );
    expect(ranked[0]).toEqual({
      index: 0,
      score: 123,
      parts: {},
      dropped: false,
    });
  });

  it('is deterministic for the same input', () => {
    const obs = baseObs({ turn: 3 });
    const c = [cand({ index: 0, kind: 'cast_spell', name: 'Sol Ring', v0Priority: 70 })];
    const profiles = () => profile({ name: 'Sol Ring', roles: ['ramp'] });
    expect(rankCandidates(obs, c, profiles)).toEqual(rankCandidates(obs, c, profiles));
  });

  it('buildScoreContext exposes public win probs', () => {
    const ctx = buildScoreContext(baseObs());
    const sum = Object.values(ctx.p).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1, 8);
    expect(ctx.mode).toBe('main');
  });
});

// Touch EMPTY_PROFILE so the import is used if tree-shaken oddly in some runners.
void EMPTY_PROFILE;
void (0 as unknown as ScoreContext);
