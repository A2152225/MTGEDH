import { describe, it, expect, vi } from 'vitest';
import { mergeGraveyardAbilityHints, getReturnToHandCostPresentation, isReturnToHandCostStep } from './beamMeUpUi';
import { getGraveyardAbilitiesForCard } from '../components/GraveyardViewModal';
import { dispatchZoneCardAbility } from '../components/TableLayout-handlers/tableLayoutZoneAbilityDispatch';

const beamHint = { id: 'beam-me-up', label: 'Beam me up', description: 'Cast from graveyard for {1}{U}', cost: '{1}{U}', requiresReturnToHandForCost: true } as any;
const card: any = { id: 'c1', name: 'Transporter Mishap', type_line: 'Instant', oracle_text: 'Beam me up {1}{U}', mana_cost: '{1}{U}' };

describe('UI41 beam me up graveyard entry', () => {
  it('adds the hint to the table graveyard menu, without duplicates, only in the graveyard', () => {
    const merged = mergeGraveyardAbilityHints([], 'graveyard', [beamHint, beamHint]);
    expect(merged).toEqual([{ id: 'beam-me-up', label: 'Beam me up', description: 'Cast from graveyard for {1}{U}', cost: '{1}{U}' }]);
    expect(mergeGraveyardAbilityHints([], 'hand', [beamHint])).toEqual([]);
    expect(mergeGraveyardAbilityHints([{ id: 'flashback', label: 'Flashback', description: '' }], 'graveyard', undefined)).toHaveLength(1);
  });
  it('shows in the graveyard view modal entries', () => {
    expect(getGraveyardAbilitiesForCard(card, { abilityHints: [beamHint] }).map((a) => a.id)).toContain('beam-me-up');
  });
  it('clicking it sends activateGraveyardAbility with abilityId beam-me-up', () => {
    const emit = vi.fn();
    expect(dispatchZoneCardAbility({ zone: 'graveyard', gameId: 'g1', cardId: 'c1', abilityId: 'beam-me-up', card, emit })).toBe(true);
    expect(emit).toHaveBeenCalledWith('activateGraveyardAbility', { gameId: 'g1', cardId: 'c1', abilityId: 'beam-me-up' });
  });
});

describe('UI41 return-to-hand cost prompt', () => {
  const step = { type: 'target_selection', sourceName: 'Transporter Mishap', returnToHandForCost: true, targetTypes: ['return_to_hand_cost'], targetDescription: 'creature you control',
    description: "Transporter Mishap: Return a creature you control to its owner's hand to cast it using beam me up." };
  it('relabels title and confirm button', () => {
    const ui = getReturnToHandCostPresentation(step)!;
    expect(ui.title).toBe('Transporter Mishap: Return a creature to hand');
    expect(ui.confirmLabel).toBe('Return to Hand');
    expect(ui.description).toMatch(/Return a creature/);
  });
  it('replaces sacrifice wording and ignores real sacrifice prompts', () => {
    expect(getReturnToHandCostPresentation({ ...step, description: 'Sacrifice a creature' })!.description).toBe("Choose creature you control to return to its owner's hand.");
    expect(isReturnToHandCostStep({ sacrificeSelection: true, targetTypes: ['sacrifice'] })).toBe(false);
    expect(getReturnToHandCostPresentation({ sacrificeSelection: true })).toBeUndefined();
  });
});