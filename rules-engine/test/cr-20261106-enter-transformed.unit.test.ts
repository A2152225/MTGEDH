import { describe, expect, it } from 'vitest';

import {
  applyBackFaceCharacteristicsToCard,
  cardAlreadyShowsBackFace,
  dayboundWouldEnterTransformed,
  inspectCardForEnterFace,
  isMeldCardLike,
  resolveEnterBattlefieldTransformedOrConverted,
  resolveEnterFaceForCard,
} from '../src/enterBattlefieldTransformedOrConverted';
import {
  entersBattlefieldConvertedWithInstantOrSorceryBackFace,
} from '../src/keywordActions/convert';
import {
  TRANSFORM_DOES_NOT_CREATE_NEW_OBJECT,
  asTransformsAbilityAppliesWhileChangingFaces,
  entersBattlefieldTransformedWithInstantOrSorceryBackFace,
} from '../src/keywordActions/transform';

function tdfc(overrides: Record<string, unknown> = {}) {
  return {
    id: 'c1',
    name: 'Bird Admirer',
    layout: 'transform',
    type_line: 'Creature — Human Druid Werewolf',
    oracle_text: 'Daybound (If a player casts no spells during their own turn, it becomes night next turn.)',
    card_faces: [
      { name: 'Bird Admirer', type_line: 'Creature — Human Druid', oracle_text: 'Daybound', power: '1', toughness: '3' },
      { name: 'Winged Warmonger', type_line: 'Creature — Werewolf', oracle_text: 'Nightbound', power: '3', toughness: '5' },
    ],
    ...overrides,
  };
}

function siegeWithSorceryBack() {
  return {
    id: 'inv1',
    name: 'Invasion of Kylem',
    layout: 'transform',
    type_line: 'Battle — Siege',
    card_faces: [
      { name: 'Invasion of Kylem', type_line: 'Battle — Siege', oracle_text: 'When this Siege enters, ...', power: undefined, toughness: undefined },
      { name: 'Valor\'s Reach Tag Team', type_line: 'Sorcery', oracle_text: 'Create two 3/2 red and white Warrior creature tokens.' },
    ],
  };
}

describe('resolveEnterBattlefieldTransformedOrConverted (CR 20261106)', () => {
  it('keeps a resolving DFC spell on the same face that was up on the stack (712.10 / Disturb)', () => {
    const decision = resolveEnterFaceForCard(tdfc({ transformed: true, faceIndex: 1 }), { sourceZone: 'stack' });
    expect(decision.outcome).toBe('enter_back_face');
    expect(decision.reason).toBe('712.10');
  });

  it('sends a DFC spell that would enter transformed with an instant or sorcery back to the graveyard (701.27j)', () => {
    const decision = resolveEnterFaceForCard(siegeWithSorceryBack(), {
      sourceZone: 'stack',
      intent: 'transformed',
    });
    expect(decision.outcome).toBe('graveyard');
    expect(decision.reason).toBe('701.27j');
    expect(entersBattlefieldTransformedWithInstantOrSorceryBackFace(true)).toBe('graveyard');
    expect(entersBattlefieldConvertedWithInstantOrSorceryBackFace(true)).toBe('graveyard');
  });

  it('covers 701.27j when the representing card has a sorcery back but the copy has daybound', () => {
    const decision = resolveEnterFaceForCard(tdfc(), {
      sourceZone: 'stack',
      intent: 'transformed',
      representingCard: siegeWithSorceryBack(),
    });
    expect(decision.outcome).toBe('graveyard');
    expect(decision.reason).toBe('701.27j');
  });

  it('leaves a non-DFC card in its current zone when instructed to enter transformed from another zone (712.11a)', () => {
    const decision = resolveEnterFaceForCard({ id: 'x', name: 'Giant Growth', type_line: 'Instant' }, {
      sourceZone: 'other',
      intent: 'transformed',
    });
    expect(decision.outcome).toBe('stay_in_zone');
    expect(decision.reason).toBe('712.11a');
  });

  it('lets a resolving non-DFC spell enter untransformed rather than bouncing it off the stack (712.11a)', () => {
    const decision = resolveEnterFaceForCard({ id: 'clone', name: 'Clone', type_line: 'Creature — Shapeshifter', layout: 'normal' }, {
      sourceZone: 'stack',
      intent: 'transformed',
    });
    expect(decision.outcome).toBe('enter_default');
    expect(decision.face).toBe('front');
  });

  it('ignores enter-transformed instructions for meld cards (713.1c)', () => {
    const meld = { id: 'meld1', name: 'Bruna, the Fading Light', layout: 'meld', isMeldCard: true, type_line: 'Creature — Angel Horror' };
    expect(isMeldCardLike(meld)).toBe(true);
    expect(resolveEnterFaceForCard(meld, { sourceZone: 'other', intent: 'transformed' }).outcome).toBe('stay_in_zone');
    expect(resolveEnterFaceForCard(meld, { sourceZone: 'stack', intent: 'converted' }).outcome).toBe('enter_default');
  });

  it('puts a transforming DFC onto the battlefield with its back face up (712.11a)', () => {
    const decision = resolveEnterFaceForCard(tdfc(), { sourceZone: 'other', intent: 'transformed' });
    expect(decision.outcome).toBe('enter_back_face');
    expect(decision.reason).toBe('712.11a');
  });

  it('also puts an MDFC onto the battlefield with its back face up when instructed to enter transformed (712.11a)', () => {
    const mdfc = {
      id: 'm1',
      name: 'Boggart Trawler',
      layout: 'modal_dfc',
      type_line: 'Creature — Goblin',
      card_faces: [
        { name: 'Boggart Trawler', type_line: 'Creature — Goblin' },
        { name: 'Boggart Bog', type_line: 'Land' },
      ],
    };
    const decision = resolveEnterFaceForCard(mdfc, { sourceZone: 'other', intent: 'transformed' });
    expect(decision.outcome).toBe('enter_back_face');
    expect(inspectCardForEnterFace(mdfc).isModalDfc).toBe(true);
  });

  it('keeps a DFC in its current non-stack zone if the back face is an instant or sorcery (712.11b)', () => {
    const decision = resolveEnterFaceForCard(siegeWithSorceryBack(), { sourceZone: 'other', intent: 'converted' });
    expect(decision.outcome).toBe('stay_in_zone');
    expect(decision.reason).toBe('712.11b');
  });

  it('detects daybound would enter transformed when it is night', () => {
    expect(dayboundWouldEnterTransformed(tdfc(), 'night')).toBe(true);
    expect(dayboundWouldEnterTransformed(tdfc(), 'day')).toBe(false);
    const decision = resolveEnterFaceForCard(tdfc(), { sourceZone: 'stack', dayNight: 'night' });
    expect(decision.outcome).toBe('enter_back_face');
  });

  it('applies back-face characteristics without changing the card id (701.27c identity)', () => {
    const original = tdff();
    function tdff() { return tdfc({ id: 'same-id' }); }
    const next = applyBackFaceCharacteristicsToCard(original);
    expect(next.id).toBe('same-id');
    expect(next.name).toBe('Winged Warmonger');
    expect(next.type_line).toBe('Creature — Werewolf');
    expect(next.transformed).toBe(true);
    expect(next.faceIndex).toBe(1);
    expect(TRANSFORM_DOES_NOT_CREATE_NEW_OBJECT).toBe(true);
    expect(asTransformsAbilityAppliesWhileChangingFaces()).toBe(true);
    expect(cardAlreadyShowsBackFace(next)).toBe(true);
  });
});
