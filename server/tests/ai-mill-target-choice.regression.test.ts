import { describe, expect, it } from 'vitest';
import type { PlayerID } from '../../shared/src';
import { chooseAITargetSelectionsForChoiceStep } from '../src/socket/ai.js';
import { aiHasGraveyardSynergy, isTargetPlayerMillText } from '../src/socket/ai-handlers/aiMillTargetChoice.js';
import { evaluateActivatedAbilityValue } from '../../rules-engine/src/aiEngineActivatedAbilitySupport.js';

const AI = 'ai1' as PlayerID;
const DROWNER_ORACLE = 'Tap an untapped Merfolk you control: Target player mills a card.';

function perm(id: string, controller: string, card: any) {
  return { id, controller, owner: controller, tapped: false, summoningSickness: false, counters: {}, card } as any;
}

function lib(n: number) {
  return Array.from({ length: n }, (_, i) => ({ id: `c${i}`, name: 'Card' }));
}

function buildGame(opts: { aiLibrary?: number; aiExtra?: any[]; aiHand?: any[]; oppLibraries?: Record<string, number> } = {}) {
  const oppLibraries = opts.oppLibraries || { opp1: 60, opp2: 60 };
  const libraries = new Map<string, any[]>();
  libraries.set(AI, lib(opts.aiLibrary ?? 60));
  for (const [id, n] of Object.entries(oppLibraries)) libraries.set(id, lib(n));
  const battlefield = [
    perm('drowner', AI, { name: 'Drowner of Secrets', type_line: 'Creature — Merfolk Wizard', oracle_text: DROWNER_ORACLE, power: '1', toughness: '3' }),
    ...(opts.aiExtra || []),
  ];
  return {
    libraries,
    state: {
      players: [{ id: AI, name: 'AI', life: 40 }, ...Object.keys(oppLibraries).map((id) => ({ id, name: id, life: 40 }))],
      battlefield,
      stack: [],
      zones: { [AI]: { hand: opts.aiHand || [], graveyard: [] } },
    },
  } as any;
}

function drownerStep(game: any) {
  return {
    type: 'target_selection',
    sourceId: 'drowner',
    sourceName: 'Drowner of Secrets',
    description: 'Choose target player for Drowner of Secrets',
    battlefieldAbilityTargetSelection: true,
    abilityText: DROWNER_ORACLE,
    minTargets: 1,
    maxTargets: 1,
    validTargets: game.state.players.map((p: any) => ({ id: p.id, label: p.name, type: 'player' })),
  };
}

describe('AI mill target-player choice (Drowner of Secrets)', () => {
  it('recognises target-player mill wordings', () => {
    expect(isTargetPlayerMillText(DROWNER_ORACLE)).toBe(true);
    expect(isTargetPlayerMillText('Target player puts the top two cards of their library into their graveyard.')).toBe(true);
    expect(isTargetPlayerMillText('Target opponent mills three cards.')).toBe(true);
    expect(isTargetPlayerMillText('You mill two cards.')).toBe(false);
  });

  it('with no graveyard synergy, mills an opponent (the one closest to decking)', () => {
    const game = buildGame({ oppLibraries: { opp1: 55, opp2: 20 } });
    expect(chooseAITargetSelectionsForChoiceStep(game, AI, drownerStep(game))).toEqual(['opp2']);
  });

  it('with a reanimation payoff on board, may mill itself', () => {
    const game = buildGame({
      aiExtra: [perm('reanimator', AI, {
        name: 'Reanimation Engine', type_line: 'Enchantment',
        oracle_text: 'At the beginning of your upkeep, return target creature card from your graveyard to the battlefield.',
      })],
    });
    expect(aiHasGraveyardSynergy(game, AI)).toBe(true);
    expect(chooseAITargetSelectionsForChoiceStep(game, AI, drownerStep(game))).toEqual([AI]);
  });

  it('with a flashback card in hand, may mill itself', () => {
    const game = buildGame({
      aiHand: [{ id: 'fb', name: 'Think Twice', type_line: 'Instant', oracle_text: 'Draw a card.\nFlashback {2}{U}' }],
    });
    expect(chooseAITargetSelectionsForChoiceStep(game, AI, drownerStep(game))).toEqual([AI]);
  });

  it('never mills itself with a small library, even with synergy', () => {
    const game = buildGame({
      aiLibrary: 8,
      aiExtra: [perm('reanimator', AI, {
        name: 'Reanimation Engine', type_line: 'Enchantment',
        oracle_text: 'Return target creature card from your graveyard to the battlefield.',
      })],
    });
    const picked = chooseAITargetSelectionsForChoiceStep(game, AI, drownerStep(game));
    expect(picked).toHaveLength(1);
    expect(picked[0]).not.toBe(AI);
  });

  it('mill-the-opponent cards (no self payoff) do not count as graveyard synergy', () => {
    const game = buildGame({
      aiExtra: [perm('crystal', AI, {
        name: 'The Water Crystal', type_line: 'Legendary Artifact',
        oracle_text: 'If an opponent would mill one or more cards, they mill that many cards plus four instead.',
      })],
    });
    expect(chooseAITargetSelectionsForChoiceStep(game, AI, drownerStep(game))).not.toEqual([AI]);
  });
});

describe('AI Drowner activation timing', () => {
  const deps = {
    getPrimaryArchetypes: () => [] as any[],
    hasPotentialManaSink: () => false,
    getProcessedBattlefield: (gs: any) => gs.battlefield,
  } as any;
  const drowner = perm('drowner', AI, { name: 'Drowner of Secrets', type_line: 'Creature — Merfolk Wizard', oracle_text: DROWNER_ORACLE });
  const value = (state: any) => evaluateActivatedAbilityValue(drowner, DROWNER_ORACLE, { battlefield: [drowner], players: [], ...state } as any, AI, {} as any, deps);

  it('does not tap its Merfolk on its own upkeep / precombat main (the "untapped" text no longer scores as untap)', () => {
    expect(value({ turnPlayer: AI, phase: 'beginning', step: 'UPKEEP' })).toBe(0);
    expect(value({ turnPlayer: AI, phase: 'precombatMain', step: 'MAIN1' })).toBe(0);
    expect(value({ turnPlayer: 'opp1', phase: 'combat', step: 'DECLARE_ATTACKERS' })).toBe(0);
  });

  it('still activates at an opponent\'s end step', () => {
    expect(value({ turnPlayer: 'opp1', phase: 'ending', step: 'END' })).toBeGreaterThan(0);
  });
});

