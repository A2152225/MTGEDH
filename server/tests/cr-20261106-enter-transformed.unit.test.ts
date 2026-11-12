import { describe, expect, it } from 'vitest';

import { resolveStackItemEffectiveCard } from '../src/state/modules/stackResolveEffectiveCardUtils.js';
import { applyEnterBackFaceToPermanent, resolveAndApplyEnterFace } from '../src/state/modules/enterBattlefieldFaceApplication.js';
import { enterPermanentTransformed, transformPermanentToFace } from '../src/state/modules/day-night.js';

function tdfc() {
  return {
    id: 'c1',
    name: 'Bird Admirer',
    layout: 'transform',
    type_line: 'Creature — Human Druid Werewolf',
    oracle_text: 'Daybound',
    card_faces: [
      { name: 'Bird Admirer', type_line: 'Creature — Human Druid', oracle_text: 'Daybound', power: '1', toughness: '3' },
      { name: 'Winged Warmonger', type_line: 'Creature — Werewolf', oracle_text: 'Nightbound', power: '3', toughness: '5' },
    ],
  };
}

describe('stack and entry paths for enter transformed (20261106)', () => {
  it('keeps a Disturb stack spell on its back face instead of resetting to the front', () => {
    const card = { ...tdfc(), transformed: true, faceIndex: 1, name: 'Winged Warmonger', type_line: 'Creature — Werewolf' };
    const { effectiveCard, effectiveTypeLine } = resolveStackItemEffectiveCard({ castWithAbility: 'disturb', transformed: true }, card);
    expect(effectiveCard.transformed).toBe(true);
    expect(String(effectiveTypeLine)).toContain('Werewolf');
    expect(effectiveCard.name).toBe('Winged Warmonger');
  });

  it('applies back-face P/T when a permanent enters transformed and keeps the same permanent id', () => {
    const permanent: any = { id: 'perm-1', controller: 'p1', card: tdfc() };
    const decision = enterPermanentTransformed(permanent, 'other');
    expect(decision.outcome).toBe('enter_back_face');
    expect(permanent.id).toBe('perm-1');
    expect(permanent.transformed).toBe(true);
    expect(permanent.card.name).toBe('Winged Warmonger');
    expect(permanent.basePower).toBe(3);
    expect(permanent.baseToughness).toBe(5);
  });

  it('does not flip a meld card that is instructed to enter transformed from another zone', () => {
    const permanent: any = {
      id: 'perm-2',
      controller: 'p1',
      card: { id: 'meld1', name: 'Bruna, the Fading Light', layout: 'meld', isMeldCard: true, type_line: 'Creature — Angel Horror' },
    };
    const decision = resolveAndApplyEnterFace(permanent, { sourceZone: 'other', intent: 'transformed' });
    expect(decision.outcome).toBe('stay_in_zone');
    expect(permanent.card.name).toBe('Bruna, the Fading Light');
    expect(permanent.transformed).not.toBe(true);
  });

  it('is a no-op to apply the back face twice', () => {
    const permanent: any = { id: 'perm-3', card: tdfc() };
    applyEnterBackFaceToPermanent(permanent);
    applyEnterBackFaceToPermanent(permanent);
    expect(permanent.card.name).toBe('Winged Warmonger');
    expect(permanent.id).toBe('perm-3');
  });

  it('keeps the same permanent and its effects after it transforms (701.27c)', () => {
    const modifiers = [{ id: 'pump', power: 2, toughness: 2, until: 'end_of_turn' }];
    const permanent: any = {
      id: 'village1',
      controller: 'p1',
      modifiers: [...modifiers],
      card: {
        name: 'Village Ironsmith',
        type_line: 'Creature — Human Werewolf',
        power: '1',
        toughness: '2',
        card_faces: [
          { name: 'Village Ironsmith', type_line: 'Creature — Human Werewolf', power: '1', toughness: '2' },
          { name: 'Ironfang', type_line: 'Creature — Werewolf', power: '3', toughness: '1' },
        ],
      },
    };
    transformPermanentToFace(permanent, 1);
    expect(permanent.id).toBe('village1');
    expect(permanent.card.name).toBe('Ironfang');
    expect(permanent.modifiers).toEqual(modifiers);
  });

  it('applies as-this-transforms emblem text while the permanent is changing faces (701.27i)', () => {
    const ctx: any = { state: { emblems: [] } };
    const permanent: any = {
      id: 'nova1',
      controller: 'p1',
      card: {
        name: 'Front Face',
        card_faces: [
          { name: 'Front Face', oracle_text: 'Daybound' },
          {
            name: 'Super Nova',
            oracle_text: 'As this creature transforms into Super Nova, you get an emblem with "Permanents you control have hexproof."',
          },
        ],
      },
    };
    transformPermanentToFace(permanent, 1, ctx);
    expect(permanent.id).toBe('nova1');
    expect(permanent.card.name).toBe('Super Nova');
    expect(ctx.state.emblems).toHaveLength(1);
    expect(String(ctx.state.emblems[0].effect)).toMatch(/hexproof/i);
  });

  it('keeps the same permanent and its effects after it is converted (701.28c)', () => {
    const modifiers = [{ id: 'pump', power: 2, toughness: 2 }];
    const permanent: any = { id: 'perm-conv', controller: 'p1', modifiers: [...modifiers], card: tdfc() };
    const decision = resolveAndApplyEnterFace(permanent, { sourceZone: 'other', intent: 'converted' });
    expect(decision.outcome).toBe('enter_back_face');
    expect(permanent.id).toBe('perm-conv');
    expect(permanent.transformed).toBe(true);
    expect(permanent.modifiers).toEqual(modifiers);
  });

  it('puts a spell that would enter converted onto an instant/sorcery back into the graveyard (701.28h)', () => {
    const permanent: any = {
      id: 'stack_kylem',
      controller: 'p1',
      owner: 'p1',
      card: {
        name: 'Invasion of Kylem',
        layout: 'transform',
        type_line: 'Battle — Siege',
        card_faces: [
          { name: 'Invasion of Kylem', type_line: 'Battle — Siege' },
          { name: "Valor's Reach Tag Team", type_line: 'Sorcery', oracle_text: 'Create two 3/2 red and white Warrior creature tokens.' },
        ],
      },
    };
    const decision = resolveAndApplyEnterFace(permanent, { sourceZone: 'stack', intent: 'converted' });
    expect(decision.outcome).toBe('graveyard');
    expect(permanent.transformed).not.toBe(true);
  });
});
