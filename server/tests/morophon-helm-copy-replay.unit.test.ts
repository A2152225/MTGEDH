/**
 * Helm of the Host Morophon copy must keep chosenCreatureType across createToken replay.
 */
import { describe, expect, it } from 'vitest';
import { buildCreateTokenReplayMutations } from '../../rules-engine/src/oracleIRReplayMutations.js';
import { applyEvent } from '../src/state/modules/applyEvent.js';
import { createContext } from '../src/state/context.js';
import { calculateAllPTBonuses } from '../src/state/utils.js';

describe('Morophon Helm copy createToken replay', () => {
  it('restores chosenCreatureType and lord buff from createToken replay payload', () => {
    const liveState: any = {
      battlefield: [
        {
          id: 'morophon_original',
          controller: 'p1',
          owner: 'p1',
          chosenCreatureType: 'Merfolk',
          card: {
            name: 'Morophon, the Boundless',
            type_line: 'Legendary Creature — Shapeshifter',
            power: '6',
            toughness: '6',
            oracle_text:
              'Changeling As Morophon, the Boundless enters, choose a creature type. Spells you cast of the chosen type cost {W}{U}{B}{R}{G} less to cast. This effect reduces only the amount of colored mana you pay. Other creatures you control of the chosen type get +1/+1.',
            chosenCreatureType: 'Merfolk',
          },
        },
        {
          id: 'morophon_helm_copy',
          controller: 'p1',
          owner: 'p1',
          isToken: true,
          isCopyToken: true,
          copiedFromPermanentId: 'morophon_original',
          chosenCreatureType: 'Merfolk',
          basePower: 6,
          baseToughness: 6,
          card: {
            name: 'Morophon, the Boundless',
            type_line: 'Creature — Shapeshifter',
            power: '6',
            toughness: '6',
            oracle_text:
              'Changeling As Morophon, the Boundless enters, choose a creature type. Spells you cast of the chosen type cost {W}{U}{B}{R}{G} less to cast. This effect reduces only the amount of colored mana you pay. Other creatures you control of the chosen type get +1/+1.',
            chosenCreatureType: 'Merfolk',
            keywords: ['changeling'],
          },
        },
      ],
    };

    const mutations = buildCreateTokenReplayMutations(liveState, ['morophon_helm_copy']);
    expect(mutations).toHaveLength(1);
    expect((mutations[0] as any).tokenData.chosenCreatureType).toBe('Merfolk');
    expect((mutations[0] as any).tokenData.copiedFromPermanentId).toBe('morophon_original');
    expect((mutations[0] as any).tokenData.isCopyToken).toBe(true);

    const ctx = createContext('test_morophon_helm_replay');
    (ctx as any).isReplaying = true;
    ctx.state.players = [
      { id: 'p1', name: 'You' } as any,
      { id: 'p2', name: 'Opp' } as any,
    ];
    ctx.state.life = { p1: 40, p2: 40 } as any;
    ctx.state.battlefield = [
      {
        id: 'morophon_original',
        controller: 'p1',
        owner: 'p1',
        chosenCreatureType: 'Merfolk',
        card: {
          name: 'Morophon, the Boundless',
          type_line: 'Legendary Creature — Shapeshifter',
          power: '6',
          toughness: '6',
          oracle_text:
            'Changeling As Morophon, the Boundless enters, choose a creature type. Spells you cast of the chosen type cost {W}{U}{B}{R}{G} less to cast. This effect reduces only the amount of colored mana you pay. Other creatures you control of the chosen type get +1/+1.',
          chosenCreatureType: 'Merfolk',
        },
      },
      {
        id: 'merfolk_1',
        controller: 'p1',
        owner: 'p1',
        isToken: true,
        card: {
          name: 'Merfolk Token',
          type_line: 'Creature — Merfolk',
          power: '1',
          toughness: '1',
          oracle_text: '',
        },
      },
    ] as any;
    (ctx.state as any).morophonChosenType = { morophon_original: 'Merfolk' };

    applyEvent(ctx, {
      type: 'executeEffect',
      effectType: 'createToken',
      controllerId: 'p1',
      tokenData: (mutations[0] as any).tokenData,
      oracleIrReplayMutation: true,
    } as any);

    const copy = (ctx.state.battlefield as any[]).find((p: any) => p.id === 'morophon_helm_copy');
    expect(copy).toBeTruthy();
    expect(copy.chosenCreatureType).toBe('Merfolk');
    expect(copy.copiedFromPermanentId).toBe('morophon_original');
    expect((ctx.state as any).morophonChosenType?.morophon_helm_copy).toBe('Merfolk');

    const merfolk = (ctx.state.battlefield as any[]).find((p: any) => p.id === 'merfolk_1');
    const bonuses = calculateAllPTBonuses(merfolk, ctx.state);
    // Original Morophon (+1) + Helm copy (+1) = +2
    expect(bonuses.power).toBeGreaterThanOrEqual(2);
    expect(bonuses.toughness).toBeGreaterThanOrEqual(2);
  });
});
