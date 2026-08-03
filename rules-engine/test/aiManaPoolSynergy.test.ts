import { describe, expect, it } from 'vitest';
import type { BattlefieldPermanent } from '../../shared/src';
import { evaluateActivatedAbilityValue } from '../src/aiEngineActivatedAbilitySupport';
import {
  evaluateAttackManaEngineReconfigureAttachValue,
  scoreAttackManaEngineReconfigureTarget,
} from '../src/aiEngineManaPoolSupport';
import { AIStrategy, type AIPlayerConfig } from '../src/AIEngine';
import { SynergyArchetype } from '../src/CardAnalyzer';

const deps = {
  getPrimaryArchetypes: () => [SynergyArchetype.LANDFALL] as const,
  hasPotentialManaSink: () => false,
};

function perm(partial: Partial<BattlefieldPermanent> & { id: string }): BattlefieldPermanent {
  return partial as BattlefieldPermanent;
}

describe('mana pool synergy activated abilities', () => {
  it('prioritizes Bighorner Rancher tap when Omnath retention is active and creatures are large', () => {
    const gameState = {
      turnPlayer: 'p1',
      phase: 'main1',
      step: 'precombat_main',
      players: [{ id: 'p1', manaPool: { green: 6 } }],
      manaPool: { p1: { green: 6 } },
      battlefield: [
        perm({
          id: 'omnath',
          controller: 'p1',
          effectivePower: 7,
          card: {
            name: 'Omnath, Locus of Mana',
            type_line: 'Legendary Creature — Elemental',
            oracle_text: "You don't lose unspent green mana as steps and phases end.\nOmnath gets +1/+1 for each unspent green mana you have.",
          },
        }),
        perm({
          id: 'rancher',
          controller: 'p1',
          tapped: false,
          card: {
            name: 'Bighorner Rancher',
            type_line: 'Creature — Human Ranger',
            oracle_text: '{T}: Add an amount of {G} equal to the greatest power among creatures you control.',
          },
        }),
      ],
      stack: [],
    } as any;

    const rancherValue = evaluateActivatedAbilityValue(
      gameState.battlefield[1],
      '{T}: Add an amount of {G} equal to the greatest power among creatures you control.',
      gameState,
      'p1',
      { strategy: AIStrategy.AGGRESSIVE, deckProfile: null } as AIPlayerConfig,
      {
        ...deps,
        getProcessedBattlefield: () => gameState.battlefield,
      },
    );

    const llanowarValue = evaluateActivatedAbilityValue(
      perm({
        id: 'elf',
        controller: 'p1',
        card: {
          name: 'Llanowar Elves',
          type_line: 'Creature — Elf Druid',
          oracle_text: '{T}: Add {G}.',
        },
      }),
      '{T}: Add {G}.',
      gameState,
      'p1',
      { strategy: AIStrategy.AGGRESSIVE, deckProfile: null } as AIPlayerConfig,
      {
        ...deps,
        getProcessedBattlefield: () => gameState.battlefield,
      },
    );

    expect(rancherValue).toBeGreaterThan(llanowarValue);
    expect(rancherValue).toBeGreaterThan(40);
  });

  it('prioritizes Tanuki reconfigure attach without requiring Omnath on the battlefield', () => {
    const gameState = {
      turnPlayer: 'p1',
      phase: 'main1',
      step: 'precombat_main',
      players: [{ id: 'p1' }],
      battlefield: [
        perm({
          id: 'omnath',
          controller: 'p1',
          isCommander: true,
          effectivePower: 10,
          card: {
            name: 'Omnath, Locus of Mana',
            type_line: 'Legendary Creature — Elemental',
            oracle_text: "You don't lose unspent green mana as steps and phases end.",
          },
        }),
        perm({
          id: 'tanuki',
          controller: 'p1',
          card: {
            name: 'Tanuki Transplanter',
            type_line: 'Artifact Creature — Equipment Dog',
            oracle_text: "Whenever this creature or equipped creature attacks, add an amount of {G} equal to its power. Until end of turn, you don't lose this mana as steps and phases end.\nReconfigure {3}",
          },
        }),
      ],
      stack: [],
    } as any;

    const withOmnath = evaluateActivatedAbilityValue(
      gameState.battlefield[1],
      'Reconfigure {3} attach',
      gameState,
      'p1',
      { strategy: AIStrategy.AGGRESSIVE, deckProfile: null } as AIPlayerConfig,
      {
        ...deps,
        getProcessedBattlefield: () => gameState.battlefield,
      },
    );

    const withoutOmnathState = {
      ...gameState,
      battlefield: [
        perm({
          id: 'beatstick',
          controller: 'p1',
          isCommander: true,
          effectivePower: 8,
          card: {
            name: 'Mossborn Hydra',
            type_line: 'Creature — Hydra',
            oracle_text: 'Trample',
          },
        }),
        gameState.battlefield[1],
      ],
    };

    const withoutOmnath = evaluateActivatedAbilityValue(
      withoutOmnathState.battlefield[1],
      'Reconfigure {3} attach',
      withoutOmnathState,
      'p1',
      { strategy: AIStrategy.AGGRESSIVE, deckProfile: null } as AIPlayerConfig,
      {
        ...deps,
        getProcessedBattlefield: () => withoutOmnathState.battlefield,
      },
    );

    expect(withoutOmnath).toBeGreaterThan(30);
    expect(withOmnath).toBeGreaterThan(withoutOmnath);
  });

  it('prefers Omnath for Tanuki unless another legal attacker has more power', () => {
    const baseBattlefield = [
      perm({
        id: 'omnath',
        controller: 'p1',
        isCommander: true,
        effectivePower: 12,
        tapped: false,
        summoningSickness: false,
        card: {
          name: 'Omnath, Locus of Mana',
          type_line: 'Legendary Creature — Elemental',
          oracle_text: "You don't lose unspent green mana as steps and phases end.",
        },
      }),
      perm({
        id: 'hydra',
        controller: 'p1',
        effectivePower: 6,
        tapped: false,
        summoningSickness: false,
        card: {
          name: 'Mossborn Hydra',
          type_line: 'Creature — Hydra',
          oracle_text: 'Trample',
        },
      }),
    ];

    const gameState = {
      turnPlayer: 'p1',
      phase: 'main1',
      step: 'precombat_main',
      players: [{ id: 'p1' }],
      battlefield: baseBattlefield,
      stack: [],
    } as any;

    const omnathScore = scoreAttackManaEngineReconfigureTarget(gameState, 'p1', gameState.battlefield[0]);
    const hydraScore = scoreAttackManaEngineReconfigureTarget(gameState, 'p1', gameState.battlefield[1]);
    expect(omnathScore).toBeGreaterThan(hydraScore);

    const biggerHydraState = {
      ...gameState,
      battlefield: [
        gameState.battlefield[0],
        { ...gameState.battlefield[1], effectivePower: 14 },
      ],
    };
    const biggerHydraScore = scoreAttackManaEngineReconfigureTarget(
      biggerHydraState,
      'p1',
      biggerHydraState.battlefield[1],
    );
    expect(biggerHydraScore).toBeGreaterThan(omnathScore);
  });

  it('values paying {3} to move Tanuki when a better attack-mana host is available', () => {
    const tanuki = perm({
      id: 'tanuki',
      controller: 'p1',
      attachedTo: 'hydra',
      card: {
        name: 'Tanuki Transplanter',
        type_line: 'Artifact Creature — Equipment Dog',
        oracle_text: "Whenever this creature or equipped creature attacks, add an amount of {G} equal to its power. Until end of turn, you don't lose this mana as steps and phases end.\nReconfigure {3}",
      },
    });

    const gameState = {
      turnPlayer: 'p1',
      phase: 'main1',
      step: 'precombat_main',
      players: [{ id: 'p1' }],
      battlefield: [
        perm({
          id: 'omnath',
          controller: 'p1',
          isCommander: true,
          effectivePower: 12,
          tapped: false,
          summoningSickness: false,
          card: {
            name: 'Omnath, Locus of Mana',
            type_line: 'Legendary Creature — Elemental',
            oracle_text: "You don't lose unspent green mana as steps and phases end.",
          },
        }),
        perm({
          id: 'hydra',
          controller: 'p1',
          effectivePower: 4,
          tapped: false,
          summoningSickness: false,
          card: {
            name: 'Mossborn Hydra',
            type_line: 'Creature — Hydra',
            oracle_text: 'Trample',
          },
        }),
        tanuki,
      ],
      stack: [],
    } as any;

    const switchValue = evaluateAttackManaEngineReconfigureAttachValue(gameState, 'p1', tanuki);
    const alreadyOptimal = evaluateAttackManaEngineReconfigureAttachValue(gameState, 'p1', {
      ...tanuki,
      attachedTo: 'omnath',
    } as any);

    const attachAbilityValue = evaluateActivatedAbilityValue(
      tanuki,
      'Reconfigure {3} attach',
      gameState,
      'p1',
      { strategy: AIStrategy.AGGRESSIVE, deckProfile: null } as AIPlayerConfig,
      {
        ...deps,
        getProcessedBattlefield: () => gameState.battlefield,
      },
    );

    const unattachAbilityValue = evaluateActivatedAbilityValue(
      tanuki,
      'Reconfigure {3} unattach',
      gameState,
      'p1',
      { strategy: AIStrategy.AGGRESSIVE, deckProfile: null } as AIPlayerConfig,
      {
        ...deps,
        getProcessedBattlefield: () => gameState.battlefield,
      },
    );

    expect(switchValue).toBeGreaterThan(40);
    expect(alreadyOptimal).toBe(0);
    expect(attachAbilityValue).toBeGreaterThan(unattachAbilityValue);
    expect(attachAbilityValue).toBeGreaterThan(35);
    expect(unattachAbilityValue).toBe(0);
  });

  it('scores pay-now charge-up abilities on mana-battery permanents when floating mana is available', () => {
    const gameState = {
      turnPlayer: 'p1',
      phase: 'main1',
      step: 'precombat_main',
      players: [{ id: 'p1' }],
      manaPool: { p1: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 3 } },
      battlefield: [
        perm({
          id: 'battery',
          controller: 'p1',
          counters: {},
          card: {
            name: 'Gemstone Array',
            type_line: 'Artifact',
            oracle_text:
              '{2}: Put a charge counter on this artifact.\nRemove a charge counter from this artifact: Add one mana of any color.',
          },
        }),
      ],
      stack: [],
    } as any;

    const chargeValue = evaluateActivatedAbilityValue(
      gameState.battlefield[0],
      '{2}: Put a charge counter on this artifact.',
      gameState,
      'p1',
      { strategy: AIStrategy.AGGRESSIVE, deckProfile: null } as AIPlayerConfig,
      {
        ...deps,
        getProcessedBattlefield: () => gameState.battlefield,
      },
    );

    const emptyPoolState = {
      ...gameState,
      manaPool: { p1: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 } },
    };
    const chargeValueNoMana = evaluateActivatedAbilityValue(
      gameState.battlefield[0],
      '{2}: Put a charge counter on this artifact.',
      emptyPoolState,
      'p1',
      { strategy: AIStrategy.AGGRESSIVE, deckProfile: null } as AIPlayerConfig,
      {
        ...deps,
        getProcessedBattlefield: () => gameState.battlefield,
      },
    );

    expect(chargeValue).toBeGreaterThan(10);
    expect(chargeValue).toBeGreaterThan(chargeValueNoMana);
  });

  it('scores mana-battery charge higher when spare colored mana can fix another color', () => {
    const batteryPerm = perm({
      id: 'battery',
      controller: 'p1',
      counters: {},
      card: {
        name: 'Gemstone Array',
        type_line: 'Artifact',
        oracle_text:
          '{2}: Put a charge counter on this artifact.\nRemove a charge counter from this artifact: Add one mana of any color.',
      },
    });

    const withGreen = {
      turnPlayer: 'p1',
      phase: 'main1',
      step: 'precombat_main',
      players: [{ id: 'p1' }],
      manaPool: { p1: { white: 0, blue: 0, black: 0, red: 0, green: 2, colorless: 0 } },
      battlefield: [batteryPerm],
      stack: [],
    } as any;

    const withColorless = {
      ...withGreen,
      manaPool: { p1: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 2 } },
    };

    const greenFixValue = evaluateActivatedAbilityValue(
      batteryPerm,
      '{2}: Put a charge counter on this artifact.',
      withGreen,
      'p1',
      { strategy: AIStrategy.AGGRESSIVE, deckProfile: null } as AIPlayerConfig,
      {
        ...deps,
        getProcessedBattlefield: () => withGreen.battlefield,
      },
    );

    const colorlessValue = evaluateActivatedAbilityValue(
      batteryPerm,
      '{2}: Put a charge counter on this artifact.',
      withColorless,
      'p1',
      { strategy: AIStrategy.AGGRESSIVE, deckProfile: null } as AIPlayerConfig,
      {
        ...deps,
        getProcessedBattlefield: () => withColorless.battlefield,
      },
    );

    expect(greenFixValue).toBeGreaterThan(colorlessValue);
  });
});
