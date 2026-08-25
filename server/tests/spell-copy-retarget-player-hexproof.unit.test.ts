import { describe, expect, it } from 'vitest';

import type { PlayerID } from '../../shared/src/index.js';
import { buildSpellCopyRetargetValidTargetsFallback } from '../src/socket/game-actions-handlers/gameActionsSpellCopyHeroicTriggers.js';
import { buildActivatedAbilityValidTargets } from '../src/socket/resolutionActivatedAbilityTargetingUtils.js';
import { syncDerivedContinuousEffects } from '../src/state/modules/staticEffectSpec.js';

// Quoted from mtg_data.db / oracle-cards (is_token = 0), 2026-08-25.
const LEYLINE_OF_SANCTITY_ORACLE =
  "If this card is in your opening hand, you may begin the game with it on the battlefield.\nYou have hexproof. (You can't be the target of spells or abilities your opponents control.)";
const KAYA_BANE_ORACLE =
  "Your opponents and permanents your opponents control with hexproof can be the targets of spells and abilities you control as though they didn't have hexproof.\n[−3]: Exile target creature.";

function makeLeylineState() {
  const p1 = 'p1' as PlayerID;
  const p2 = 'p2' as PlayerID;
  const p3 = 'p3' as PlayerID;
  const state: any = {
    players: [
      { id: p1, name: 'P1' },
      { id: p2, name: 'P2' },
      { id: p3, name: 'P3' },
    ],
    battlefield: [
      {
        id: 'leyline_1',
        controller: p2,
        card: {
          name: 'Leyline of Sanctity',
          type_line: 'Enchantment',
          oracle_text: LEYLINE_OF_SANCTITY_ORACLE,
        },
      },
    ],
    stack: [],
    zones: {},
  };
  syncDerivedContinuousEffects(state);
  return { p1, p2, p3, state, game: { state } };
}

describe('copy-retarget and activation player lists honor player hexproof', () => {
  it('copy-retarget fallback omits a Leyline opponent unless Kaya-class as-though applies', () => {
    const { p1, p2, p3, state, game } = makeLeylineState();
    const submitted = [{ id: p1, kind: 'player' }];

    const withoutKaya = buildSpellCopyRetargetValidTargetsFallback(game, p1, submitted);
    expect(withoutKaya?.map((target) => target.id).sort()).toEqual([p1, p3].sort());
    expect(withoutKaya?.some((target) => target.id === p2)).toBe(false);

    const selfTargets = buildSpellCopyRetargetValidTargetsFallback(game, p2, submitted);
    expect(selfTargets?.map((target) => target.id).sort()).toEqual([p1, p2, p3].sort());

    state.battlefield.push({
      id: 'kaya_1',
      controller: p1,
      card: {
        name: 'Kaya, Bane of the Dead',
        type_line: 'Legendary Planeswalker — Kaya',
        oracle_text: KAYA_BANE_ORACLE,
      },
    });
    syncDerivedContinuousEffects(state);

    const withKaya = buildSpellCopyRetargetValidTargetsFallback(game, p1, submitted);
    expect(withKaya?.map((target) => target.id).sort()).toEqual([p1, p2, p3].sort());

    const p3Targets = buildSpellCopyRetargetValidTargetsFallback(game, p3, submitted);
    expect(p3Targets?.map((target) => target.id).sort()).toEqual([p1, p3].sort());
  });

  it('activation player lists omit a Leyline opponent unless Kaya-class as-though applies', () => {
    const { p1, p2, p3, state, game } = makeLeylineState();
    const playerReqs = { targetTypes: ['player'] } as any;

    const withoutKaya = buildActivatedAbilityValidTargets(game, p1, playerReqs);
    expect(withoutKaya.map((target) => target.id).sort()).toEqual([p1, p3].sort());
    expect(withoutKaya.some((target) => target.id === p2)).toBe(false);

    const selfTargets = buildActivatedAbilityValidTargets(game, p2, playerReqs);
    expect(selfTargets.map((target) => target.id).sort()).toEqual([p1, p2, p3].sort());

    state.battlefield.push({
      id: 'kaya_1',
      controller: p1,
      card: {
        name: 'Kaya, Bane of the Dead',
        type_line: 'Legendary Planeswalker — Kaya',
        oracle_text: KAYA_BANE_ORACLE,
      },
    });
    syncDerivedContinuousEffects(state);

    const withKaya = buildActivatedAbilityValidTargets(game, p1, playerReqs);
    expect(withKaya.map((target) => target.id).sort()).toEqual([p1, p2, p3].sort());

    const p3Targets = buildActivatedAbilityValidTargets(game, p3, playerReqs);
    expect(p3Targets.map((target) => target.id).sort()).toEqual([p1, p3].sort());
  });
});
