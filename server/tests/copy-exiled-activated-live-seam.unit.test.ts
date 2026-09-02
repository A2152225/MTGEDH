import { describe, expect, it } from 'vitest';

import { inferTriggeredAbilityTargetMetadata } from '../src/state/modules/inferTriggeredAbilityTargetMetadata.js';
import {
  stampCardExiledWithSource,
  resolveGraveyardExileSourcePermanentId,
} from '../src/state/modules/exileWithSourceStamp.js';
import { collectActivatedAbilitiesExiledWithSource } from '../src/state/modules/staticEffectSpecCopyExiledActivated.js';
import { getContinuousGrantedAbilitiesForPermanent } from '../src/state/modules/staticEffectSpec.js';
import { parseStaticEffectSpecsFromOraclePermanent } from '../src/state/modules/staticEffectSpecOracleParsing.js';
import { syncIrGraveyardExilesToSourcePermanentExiledCards } from '../src/state/modules/oracleIrServerZoneSync-handlers/oracleIrServerPostExecutionStateSync.js';
import { isConcreteTriggeredGraveyardZoneMove } from '../src/socket/resolutionGraveyardSelectionTriggerExecute.js';

/** Oracle from mtg_data.db (is_token = 0). */
const STEWARD =
  'When this creature enters, exile up to three target land cards from your graveyard.\nCreatures you control have all activated abilities of all land cards exiled with this creature.';
const HAZEL =
  'Whenever this creature enters or attacks, exile up to one target card from a graveyard and create a Food token.\nFoods you control have all activated abilities of all creature cards exiled with this creature.';
const FOREST_ORACLE = '{T}: Add {G}.';
const ELF_ORACLE = '{T}: Add {G}.';

function battlefieldPerm(
  id: string,
  name: string,
  typeLine: string,
  oracleText: string,
  extra?: Record<string, unknown>,
) {
  return {
    id,
    controller: 'p1',
    ...extra,
    card: {
      id: `${id}_card`,
      name,
      type_line: typeLine,
      oracle_text: oracleText,
    },
  };
}

describe('copy activated abilities of cards exiled with source', () => {
  it('infers GY exile destination and up-to counts from Steward / Hazel ETB text', () => {
    const steward = inferTriggeredAbilityTargetMetadata(
      'When this creature enters, exile up to three target land cards from your graveyard.',
    );
    expect(steward.targetZone).toBe('graveyard');
    expect(steward.targetDestination).toBe('exile');
    expect(steward.targetFilterTypes).toEqual(['land']);
    expect(steward.minTargets).toBe(0);
    expect(steward.maxTargets).toBe(3);

    const hazel = inferTriggeredAbilityTargetMetadata(
      'Whenever this creature enters or attacks, exile up to one target card from a graveyard and create a Food token.',
    );
    expect(hazel.targetZone).toBe('graveyard');
    expect(hazel.targetDestination).toBe('exile');
    expect(hazel.minTargets).toBe(0);
    expect(hazel.maxTargets).toBe(1);
  });

  it('does not treat triggered GY→exile as a concrete zone move when effect text remains', () => {
    expect(isConcreteTriggeredGraveyardZoneMove({
      destination: 'exile',
      triggeredAbilityEffectText: 'exile up to one target card from a graveyard and create a Food token.',
    })).toBe(false);
    expect(isConcreteTriggeredGraveyardZoneMove({ destination: 'exile' })).toBe(true);
    expect(isConcreteTriggeredGraveyardZoneMove({ destination: 'battlefield' })).toBe(true);
  });

  it('stamps permanent id, not stack-item effectId', () => {
    const stamped = stampCardExiledWithSource(
      { id: 'forest_1', name: 'Forest', type_line: 'Basic Land — Forest', oracle_text: FOREST_ORACLE },
      resolveGraveyardExileSourcePermanentId({
        triggeredAbilitySourcePermanentId: 'steward_1',
        sourceId: 'trigger_abc',
        effectId: 'stack_item_xyz',
      }),
    );
    expect(stamped.exiledWithSourceId).toBe('steward_1');
    expect(stamped.exiledWith).toBe('steward_1');
    expect(stamped.zone).toBe('exile');
  });

  it('grants Forest {T}: Add {G} to creatures you control after a stamped GY exile', () => {
    const steward = battlefieldPerm(
      'steward_1',
      'Steward of the Harvest',
      'Creature — Human Druid',
      STEWARD,
    );
    const bear = battlefieldPerm('bear_1', 'Grizzly Bears', 'Creature — Bear', '');
    const forest = stampCardExiledWithSource({
      id: 'forest_1',
      name: 'Forest',
      type_line: 'Basic Land — Forest',
      oracle_text: FOREST_ORACLE,
    }, 'steward_1');
    const state = {
      battlefield: [steward, bear],
      zones: { p1: { exile: [forest], graveyard: [] } },
    };

    expect(parseStaticEffectSpecsFromOraclePermanent(steward as any).some(
      (spec) => spec.grant.copyActivatedFromExiledWithCardType === 'land',
    )).toBe(true);
    expect(collectActivatedAbilitiesExiledWithSource(state, 'steward_1', 'land')).toEqual(
      expect.arrayContaining([FOREST_ORACLE.replace(/\.$/, '')]),
    );
    expect(getContinuousGrantedAbilitiesForPermanent(bear as any, state)).toEqual(
      expect.arrayContaining(['{t}: add {g}']),
    );
    expect(getContinuousGrantedAbilitiesForPermanent(steward as any, state)).toEqual(
      expect.arrayContaining(['{t}: add {g}']),
    );
  });

  it('reads the source permanent exiledCards bag when zone cards are unstamped', () => {
    const steward = {
      ...battlefieldPerm(
        'steward_1',
        'Steward of the Harvest',
        'Creature — Human Druid',
        STEWARD,
      ),
      exiledCards: [{
        id: 'forest_1',
        name: 'Forest',
        type_line: 'Basic Land — Forest',
        oracle_text: FOREST_ORACLE,
        zone: 'exile',
        exiledWith: 'steward_1',
      }],
    };
    const bear = battlefieldPerm('bear_1', 'Grizzly Bears', 'Creature — Bear', '');
    const state = {
      battlefield: [steward, bear],
      zones: {
        p1: {
          exile: [{
            id: 'forest_1',
            name: 'Forest',
            type_line: 'Basic Land — Forest',
            oracle_text: FOREST_ORACLE,
            zone: 'exile',
          }],
        },
      },
    };

    expect(getContinuousGrantedAbilitiesForPermanent(bear as any, state)).toEqual(
      expect.arrayContaining(['{t}: add {g}']),
    );
  });

  it('grants an exiled creature tap ability to Foods you control', () => {
    const hazel = battlefieldPerm(
      'hazel_1',
      "Hazel's Brewmaster",
      'Creature — Squirrel Warlock',
      HAZEL,
    );
    const food = battlefieldPerm('food_1', 'Food Token', 'Token Artifact — Food', '{2}, {T}, Sacrifice this token: You gain 3 life.');
    const elf = stampCardExiledWithSource({
      id: 'elf_1',
      name: 'Llanowar Elves',
      type_line: 'Creature — Elf Druid',
      oracle_text: ELF_ORACLE,
    }, 'hazel_1');
    const state = {
      battlefield: [hazel, food],
      zones: { p1: { exile: [elf], graveyard: [] } },
    };

    expect(parseStaticEffectSpecsFromOraclePermanent(hazel as any).some(
      (spec) => spec.grant.copyActivatedFromExiledWithCardType === 'creature'
        && spec.condition?.kind === 'target_has_type'
        && spec.condition?.cardType === 'food',
    )).toBe(true);
    expect(getContinuousGrantedAbilitiesForPermanent(food as any, state)).toEqual(
      expect.arrayContaining(['{t}: add {g}']),
    );
    expect(getContinuousGrantedAbilitiesForPermanent(hazel as any, state)).not.toEqual(
      expect.arrayContaining(['{t}: add {g}']),
    );
  });

  it('IR GY-exile sync stamps live zone cards and the source bag with exiledWithSourceId', () => {
    const forest = {
      id: 'forest_1',
      name: 'Forest',
      type_line: 'Basic Land — Forest',
      oracle_text: FOREST_ORACLE,
      zone: 'exile',
    };
    const steward = battlefieldPerm(
      'steward_1',
      'Steward of the Harvest',
      'Creature — Human Druid',
      STEWARD,
    );
    const state = {
      players: [{ id: 'p1', exile: [forest] }],
      zones: { p1: { exile: [forest], graveyard: [] } },
      battlefield: [steward],
    };
    const graveyardBefore = new Map([['p1', new Set(['forest_1'])]]);
    const exileBefore = new Map([['p1', new Set<string>()]]);

    syncIrGraveyardExilesToSourcePermanentExiledCards(
      state,
      { appliedSteps: [{ kind: 'move_zone', from: 'graveyard', to: 'exile' }] } as any,
      graveyardBefore,
      exileBefore,
      { sourceId: 'steward_1' } as any,
    );

    expect(forest.exiledWithSourceId).toBe('steward_1');
    expect((steward as any).exiledCards?.[0]?.exiledWithSourceId).toBe('steward_1');
    expect(getContinuousGrantedAbilitiesForPermanent(steward as any, state)).toEqual(
      expect.arrayContaining(['{t}: add {g}']),
    );
  });
});
