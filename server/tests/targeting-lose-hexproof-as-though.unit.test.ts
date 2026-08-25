import { describe, expect, it } from 'vitest';

import type { PlayerID } from '../../shared/src';
import {
  canPermanentBeTargetedByPlayer,
  canPlayerBeTargetedByPlayer,
  evaluateTargeting,
} from '../src/rules-engine/targeting.js';
import { syncDerivedContinuousEffects } from '../src/state/modules/staticEffectSpec.js';

// Quoted from mtg_data.db / oracle-cards (is_token = 0), 2026-08-25.
const BENTHIC_GIANT_ORACLE =
  "Hexproof (This creature can't be the target of spells or abilities your opponents control.)";
const ARCHETYPE_OF_ENDURANCE_ORACLE =
  "Creatures you control have hexproof.\nCreatures your opponents control lose hexproof and can't have or gain hexproof.";
const GLARING_SPOTLIGHT_ORACLE =
  "Creatures your opponents control with hexproof can be the targets of spells and abilities you control as though they didn't have hexproof.\n{3}, Sacrifice this artifact: Creatures you control gain hexproof until end of turn and can't be blocked this turn.";
const ARCANE_LIGHTHOUSE_ORACLE =
  "{T}: Add {C}.\n{1}, {T}: Until end of turn, creatures your opponents control lose hexproof and shroud and can't have hexproof or shroud.";
const HEXPROOF_LORD_ORACLE = 'Creatures you control have hexproof.';
const NOWHERE_TO_RUN_ORACLE =
  "Flash\nWhen this enchantment enters, target creature an opponent controls gets -3/-3 until end of turn.\nCreatures your opponents control can be the targets of spells and abilities as though they didn't have hexproof. Ward abilities of those creatures don't trigger.";
const KAYA_BANE_ORACLE =
  "Your opponents and permanents your opponents control with hexproof can be the targets of spells and abilities you control as though they didn't have hexproof.\n[−3]: Exile target creature.";
const DETECTION_TOWER_ORACLE =
  "{T}: Add {C}.\n{1}, {T}: Until end of turn, your opponents and creatures your opponents control with hexproof can be the targets of spells and abilities you control as though they didn't have hexproof.";
const LEYLINE_OF_SANCTITY_ORACLE =
  "If this card is in your opening hand, you may begin the game with it on the battlefield.\nYou have hexproof. (You can't be the target of spells or abilities your opponents control.)";
// True-Name Nemesis (mtg_data.db is_token=0) is protection from a chosen player, not player hexproof:
// "As this creature enters, choose a player.\nThis creature has protection from the chosen player."
const OPPONENTS_HAVE_HEXPROOF_ORACLE = 'Your opponents have hexproof.';

function makePlayers() {
  return {
    p1: 'p1' as PlayerID,
    p2: 'p2' as PlayerID,
    p3: 'p3' as PlayerID,
  };
}

function printedHexproofCreature(id: string, controller: string) {
  return {
    id,
    controller,
    card: {
      name: 'Benthic Giant',
      type_line: 'Creature — Giant',
      oracle_text: BENTHIC_GIANT_ORACLE,
      keywords: ['Hexproof'],
    },
  };
}

describe('targeting lose-hexproof vs as-though leftover specs', () => {
  it('lets every player target printed hexproof after a true lose-keyword static', () => {
    const { p1, p2, p3 } = makePlayers();
    const enemyGiant = printedHexproofCreature('enemy_giant', p2);
    const allyBear = {
      id: 'ally_bear',
      controller: p1,
      card: { name: 'Grizzly Bears', type_line: 'Creature — Bear', oracle_text: '' },
    };
    const state = {
      players: [{ id: p1 }, { id: p2 }, { id: p3 }],
      battlefield: [
        {
          id: 'archetype_1',
          controller: p1,
          card: {
            name: 'Archetype of Endurance',
            type_line: 'Enchantment Creature — Boar',
            oracle_text: ARCHETYPE_OF_ENDURANCE_ORACLE,
          },
        },
        enemyGiant,
        allyBear,
      ],
    };
    syncDerivedContinuousEffects(state);

    expect(canPermanentBeTargetedByPlayer(enemyGiant as any, state as any, p1)).toBe(true);
    expect(canPermanentBeTargetedByPlayer(enemyGiant as any, state as any, p3)).toBe(true);
    expect(canPermanentBeTargetedByPlayer(allyBear as any, state as any, p2)).toBe(false);
  });

  it('lets only the source controller ignore hexproof for as-though leftover specs', () => {
    const { p1, p2, p3 } = makePlayers();
    const enemyGiant = printedHexproofCreature('enemy_giant', p2);
    const state = {
      players: [{ id: p1 }, { id: p2 }, { id: p3 }],
      battlefield: [
        {
          id: 'spotlight_1',
          controller: p1,
          card: {
            name: 'Glaring Spotlight',
            type_line: 'Artifact',
            oracle_text: GLARING_SPOTLIGHT_ORACLE,
          },
        },
        enemyGiant,
      ],
    };
    syncDerivedContinuousEffects(state);

    expect(canPermanentBeTargetedByPlayer(enemyGiant as any, state as any, p1)).toBe(true);
    expect(canPermanentBeTargetedByPlayer(enemyGiant as any, state as any, p3)).toBe(false);
    expect(canPermanentBeTargetedByPlayer(enemyGiant as any, state as any, p2)).toBe(true);
  });

  it('still blocks opponents when until-EOT lose text is not a continuous static', () => {
    const { p1, p2, p3 } = makePlayers();
    const enemyGiant = printedHexproofCreature('enemy_giant', p2);
    const state = {
      players: [{ id: p1 }, { id: p2 }, { id: p3 }],
      battlefield: [
        {
          id: 'lighthouse_1',
          controller: p1,
          card: {
            name: 'Arcane Lighthouse',
            type_line: 'Land',
            oracle_text: ARCANE_LIGHTHOUSE_ORACLE,
          },
        },
        enemyGiant,
      ],
    };
    syncDerivedContinuousEffects(state);

    expect(canPermanentBeTargetedByPlayer(enemyGiant as any, state as any, p1)).toBe(false);
    expect(canPermanentBeTargetedByPlayer(enemyGiant as any, state as any, p3)).toBe(false);
  });

  it('lets every player target printed hexproof after Arcane Lighthouse until-EOT lose stamp', () => {
    const { p1, p2, p3 } = makePlayers();
    const enemyGiant = printedHexproofCreature('enemy_giant', p2);
    const state = {
      players: [{ id: p1 }, { id: p2 }, { id: p3 }],
      battlefield: [
        {
          id: 'lighthouse_1',
          controller: p1,
          card: {
            name: 'Arcane Lighthouse',
            type_line: 'Land',
            oracle_text: ARCANE_LIGHTHOUSE_ORACLE,
          },
        },
        enemyGiant,
      ],
      lastingEffects: [{
        type: 'protectionKeywordOverride',
        duration: 'end_of_turn',
        sourceController: p1,
        mode: 'remove',
        abilities: ['hexproof', 'shroud'],
        scopes: ['opponent_creatures'],
      }],
    };
    syncDerivedContinuousEffects(state);

    expect(canPermanentBeTargetedByPlayer(enemyGiant as any, state as any, p1)).toBe(true);
    expect(canPermanentBeTargetedByPlayer(enemyGiant as any, state as any, p3)).toBe(true);
  });

  it('strips lord-granted hexproof for all players on true lose, but as-though stays controller-only', () => {
    const { p1, p2, p3 } = makePlayers();
    const enemyBear = {
      id: 'enemy_bear',
      controller: p2,
      card: { name: 'Goblin', type_line: 'Creature — Goblin', oracle_text: '' },
    };
    const loseState = {
      players: [{ id: p1 }, { id: p2 }, { id: p3 }],
      battlefield: [
        {
          id: 'archetype_1',
          controller: p1,
          card: {
            name: 'Archetype of Endurance',
            type_line: 'Enchantment Creature — Boar',
            oracle_text: ARCHETYPE_OF_ENDURANCE_ORACLE,
          },
        },
        {
          id: 'enemy_lord',
          controller: p2,
          card: {
            name: 'Hexproof Anthem',
            type_line: 'Enchantment',
            oracle_text: HEXPROOF_LORD_ORACLE,
          },
        },
        enemyBear,
      ],
    };
    syncDerivedContinuousEffects(loseState);
    expect(canPermanentBeTargetedByPlayer(enemyBear as any, loseState as any, p1)).toBe(true);
    expect(canPermanentBeTargetedByPlayer(enemyBear as any, loseState as any, p3)).toBe(true);

    const asThoughState = {
      players: [{ id: p1 }, { id: p2 }, { id: p3 }],
      battlefield: [
        {
          id: 'spotlight_1',
          controller: p1,
          card: {
            name: 'Glaring Spotlight',
            type_line: 'Artifact',
            oracle_text: GLARING_SPOTLIGHT_ORACLE,
          },
        },
        {
          id: 'enemy_lord',
          controller: p2,
          card: {
            name: 'Hexproof Anthem',
            type_line: 'Enchantment',
            oracle_text: HEXPROOF_LORD_ORACLE,
          },
        },
        enemyBear,
      ],
    };
    syncDerivedContinuousEffects(asThoughState);
    expect(canPermanentBeTargetedByPlayer(enemyBear as any, asThoughState as any, p1)).toBe(true);
    expect(canPermanentBeTargetedByPlayer(enemyBear as any, asThoughState as any, p3)).toBe(false);
  });

  it('lets every player ignore hexproof for global as-though leftover specs', () => {
    const { p1, p2, p3 } = makePlayers();
    const enemyGiant = printedHexproofCreature('enemy_giant', p2);
    const allyGiant = printedHexproofCreature('ally_giant', p1);
    const state = {
      players: [{ id: p1 }, { id: p2 }, { id: p3 }],
      battlefield: [
        {
          id: 'nowhere_1',
          controller: p1,
          card: {
            name: 'Nowhere to Run',
            type_line: 'Enchantment',
            oracle_text: NOWHERE_TO_RUN_ORACLE,
          },
        },
        enemyGiant,
        allyGiant,
      ],
    };
    syncDerivedContinuousEffects(state);

    expect(canPermanentBeTargetedByPlayer(enemyGiant as any, state as any, p1)).toBe(true);
    expect(canPermanentBeTargetedByPlayer(enemyGiant as any, state as any, p3)).toBe(true);
    expect(canPermanentBeTargetedByPlayer(allyGiant as any, state as any, p2)).toBe(false);
  });

  it('lets only the source controller ignore hexproof on opponent permanents, not just creatures', () => {
    const { p1, p2, p3 } = makePlayers();
    const enemyGiant = printedHexproofCreature('enemy_giant', p2);
    const enemyWalker = {
      id: 'enemy_walker',
      controller: p2,
      card: {
        name: 'Hexproof Walker',
        type_line: 'Legendary Planeswalker — Test',
        oracle_text: 'Hexproof',
        keywords: ['Hexproof'],
      },
    };
    const enemyRelic = {
      id: 'enemy_relic',
      controller: p2,
      card: {
        name: 'Hexproof Relic',
        type_line: 'Artifact',
        oracle_text: 'Hexproof',
        keywords: ['Hexproof'],
      },
    };
    const allyGiant = printedHexproofCreature('ally_giant', p1);
    const state = {
      players: [{ id: p1 }, { id: p2 }, { id: p3 }],
      battlefield: [
        {
          id: 'kaya_1',
          controller: p1,
          card: {
            name: 'Kaya, Bane of the Dead',
            type_line: 'Legendary Planeswalker — Kaya',
            oracle_text: KAYA_BANE_ORACLE,
          },
        },
        enemyGiant,
        enemyWalker,
        enemyRelic,
        allyGiant,
      ],
    };
    syncDerivedContinuousEffects(state);

    expect(canPermanentBeTargetedByPlayer(enemyGiant as any, state as any, p1)).toBe(true);
    expect(canPermanentBeTargetedByPlayer(enemyWalker as any, state as any, p1)).toBe(true);
    expect(canPermanentBeTargetedByPlayer(enemyRelic as any, state as any, p1)).toBe(true);
    expect(canPermanentBeTargetedByPlayer(enemyGiant as any, state as any, p3)).toBe(false);
    expect(canPermanentBeTargetedByPlayer(enemyWalker as any, state as any, p3)).toBe(false);
    expect(canPermanentBeTargetedByPlayer(enemyRelic as any, state as any, p3)).toBe(false);
    expect(canPermanentBeTargetedByPlayer(allyGiant as any, state as any, p2)).toBe(false);
  });

  it('still blocks opponents when until-EOT as-though text is not a continuous static', () => {
    const { p1, p2, p3 } = makePlayers();
    const enemyGiant = printedHexproofCreature('enemy_giant', p2);
    const state = {
      players: [{ id: p1 }, { id: p2 }, { id: p3 }],
      battlefield: [
        {
          id: 'tower_1',
          controller: p1,
          card: {
            name: 'Detection Tower',
            type_line: 'Land',
            oracle_text: DETECTION_TOWER_ORACLE,
          },
        },
        enemyGiant,
      ],
    };
    syncDerivedContinuousEffects(state);

    expect(canPermanentBeTargetedByPlayer(enemyGiant as any, state as any, p1)).toBe(false);
    expect(canPermanentBeTargetedByPlayer(enemyGiant as any, state as any, p3)).toBe(false);
  });

  it('lets only the activator ignore hexproof after Detection Tower until-EOT stamp', () => {
    const { p1, p2, p3 } = makePlayers();
    const enemyGiant = printedHexproofCreature('enemy_giant', p2);
    const state = {
      players: [{ id: p1 }, { id: p2 }, { id: p3 }],
      battlefield: [
        {
          id: 'tower_1',
          controller: p1,
          card: {
            name: 'Detection Tower',
            type_line: 'Land',
            oracle_text: DETECTION_TOWER_ORACLE,
          },
        },
        enemyGiant,
      ],
      lastingEffects: [{
        type: 'protectionKeywordOverride',
        duration: 'end_of_turn',
        sourceController: p1,
        mode: 'asThoughController',
        abilities: ['hexproof'],
        scopes: ['player_opponents', 'opponent_creatures'],
      }],
    };
    syncDerivedContinuousEffects(state);

    expect(canPermanentBeTargetedByPlayer(enemyGiant as any, state as any, p1)).toBe(true);
    expect(canPermanentBeTargetedByPlayer(enemyGiant as any, state as any, p3)).toBe(false);
    expect(canPermanentBeTargetedByPlayer(enemyGiant as any, state as any, p2)).toBe(true);
  });

  it('lets only the activator ignore player hexproof after Detection Tower until-EOT stamp', () => {
    const { p1, p2, p3 } = makePlayers();
    const state = {
      players: [{ id: p1 }, { id: p2 }, { id: p3 }],
      battlefield: [
        {
          id: 'tower_1',
          controller: p1,
          card: {
            name: 'Detection Tower',
            type_line: 'Land',
            oracle_text: DETECTION_TOWER_ORACLE,
          },
        },
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
      lastingEffects: [{
        type: 'protectionKeywordOverride',
        duration: 'end_of_turn',
        sourceController: p1,
        mode: 'asThoughController',
        abilities: ['hexproof'],
        scopes: ['player_opponents', 'opponent_creatures'],
      }],
    };
    syncDerivedContinuousEffects(state);

    expect(canPlayerBeTargetedByPlayer(p2, state as any, p1)).toBe(true);
    expect(canPlayerBeTargetedByPlayer(p2, state as any, p3)).toBe(false);
  });

  it('blocks hexproof again after until-EOT protectionKeywordOverride expires', () => {
    const { p1, p2, p3 } = makePlayers();
    const enemyGiant = printedHexproofCreature('enemy_giant', p2);
    const stamp = {
      type: 'protectionKeywordOverride',
      duration: 'end_of_turn',
      sourceController: p1,
      mode: 'asThoughController',
      abilities: ['hexproof'],
      scopes: ['player_opponents', 'opponent_creatures'],
    };
    const keep = { type: 'preventLifeGain', duration: 'game', targetPlayer: p2, source: 'Custom Rest-of-Game Lock' };
    const state = {
      players: [{ id: p1 }, { id: p2 }, { id: p3 }],
      battlefield: [enemyGiant],
      lastingEffects: [stamp, keep],
    };

    expect(canPermanentBeTargetedByPlayer(enemyGiant as any, state as any, p1)).toBe(true);

    const expiringDurations = new Set(['end_of_turn', 'until_end_of_turn', 'this_turn', 'eot']);
    state.lastingEffects = state.lastingEffects.filter((effect) => {
      const type = String(effect?.type || '');
      const duration = String((effect as { duration?: string }).duration || '').trim().toLowerCase();
      if (type === 'protectionKeywordOverride') {
        return !expiringDurations.has(duration);
      }
      if (type === 'preventLifeGain') {
        if (!duration || expiringDurations.has(duration)) return false;
        return true;
      }
      return true;
    });

    expect(state.lastingEffects).toEqual([keep]);
    expect(canPermanentBeTargetedByPlayer(enemyGiant as any, state as any, p1)).toBe(false);
    expect(canPermanentBeTargetedByPlayer(enemyGiant as any, state as any, p3)).toBe(false);
  });

  it('blocks opponent player targeting when a player has hexproof', () => {
    const { p1, p2, p3 } = makePlayers();
    const state = {
      players: [{ id: p1 }, { id: p2 }, { id: p3 }],
      battlefield: [
        {
          id: 'leyline_1',
          controller: p1,
          card: {
            name: 'Leyline of Sanctity',
            type_line: 'Enchantment',
            oracle_text: LEYLINE_OF_SANCTITY_ORACLE,
          },
        },
      ],
    };
    syncDerivedContinuousEffects(state);

    expect(canPlayerBeTargetedByPlayer(p1, state as any, p2)).toBe(false);
    expect(canPlayerBeTargetedByPlayer(p1, state as any, p3)).toBe(false);
    expect(canPlayerBeTargetedByPlayer(p1, state as any, p1)).toBe(true);
    expect(canPlayerBeTargetedByPlayer(p2, state as any, p1)).toBe(true);
    expect(canPlayerBeTargetedByPlayer(p2, state as any, p3)).toBe(true);

    const p2Targets = evaluateTargeting(state as any, p2, { op: 'TARGET_PLAYER' } as any);
    expect(p2Targets.map((target) => target.id).sort()).toEqual([p2, p3].sort());
  });

  it('lets only the source controller ignore player hexproof for Kaya-class as-though', () => {
    const { p1, p2, p3 } = makePlayers();
    const state = {
      players: [{ id: p1 }, { id: p2 }, { id: p3 }],
      battlefield: [
        {
          id: 'kaya_1',
          controller: p1,
          card: {
            name: 'Kaya, Bane of the Dead',
            type_line: 'Legendary Planeswalker — Kaya',
            oracle_text: KAYA_BANE_ORACLE,
          },
        },
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
    };
    syncDerivedContinuousEffects(state);

    expect(canPlayerBeTargetedByPlayer(p2, state as any, p1)).toBe(true);
    expect(canPlayerBeTargetedByPlayer(p2, state as any, p3)).toBe(false);
    expect(canPlayerBeTargetedByPlayer(p2, state as any, p2)).toBe(true);
    expect(canPlayerBeTargetedByPlayer(p1, state as any, p2)).toBe(true);
  });

  it('does not let Glaring Spotlight pierce player hexproof', () => {
    const { p1, p2, p3 } = makePlayers();
    const state = {
      players: [{ id: p1 }, { id: p2 }, { id: p3 }],
      battlefield: [
        {
          id: 'spotlight_1',
          controller: p1,
          card: {
            name: 'Glaring Spotlight',
            type_line: 'Artifact',
            oracle_text: GLARING_SPOTLIGHT_ORACLE,
          },
        },
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
    };
    syncDerivedContinuousEffects(state);

    expect(canPlayerBeTargetedByPlayer(p2, state as any, p1)).toBe(false);
    expect(canPlayerBeTargetedByPlayer(p2, state as any, p3)).toBe(false);
  });

  it('blocks targeting when leftover oracle grants opponents hexproof', () => {
    const { p1, p2, p3 } = makePlayers();
    const state = {
      players: [{ id: p1 }, { id: p2 }, { id: p3 }],
      battlefield: [
        {
          id: 'warding_1',
          controller: p1,
          card: {
            name: 'Hexproof Ward',
            type_line: 'Enchantment',
            oracle_text: OPPONENTS_HAVE_HEXPROOF_ORACLE,
          },
        },
      ],
    };
    syncDerivedContinuousEffects(state);

    expect(canPlayerBeTargetedByPlayer(p2, state as any, p1)).toBe(false);
    expect(canPlayerBeTargetedByPlayer(p3, state as any, p1)).toBe(false);
    expect(canPlayerBeTargetedByPlayer(p1, state as any, p2)).toBe(true);
    expect(canPlayerBeTargetedByPlayer(p2, state as any, p3)).toBe(false);
    expect(canPlayerBeTargetedByPlayer(p2, state as any, p2)).toBe(true);
  });
});
