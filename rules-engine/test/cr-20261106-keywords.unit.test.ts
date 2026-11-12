import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { isCreatureTypeWord, isValidCreatureType } from '../../shared/src/creatureTypes';
import {
  beamMeUp,
  canCastWithBeamMeUpFromZone,
  canCreatureBeBeamedUp,
  castWithBeamMeUp,
  extractBeamMeUpCost,
  shouldExileAfterBeamMeUp,
} from '../src/keywordAbilities/beamMeUp';
import {
  assimilate,
  createAssimilateResult,
  isAssimilatedWithSource,
} from '../src/keywordActions/assimilate';
import {
  TRANSFORM_DOES_NOT_CREATE_NEW_OBJECT,
  asTransformsAbilityAppliesWhileChangingFaces,
  canTransform,
  entersBattlefieldTransformedWithInstantOrSorceryBackFace,
} from '../src/keywordActions/transform';
import {
  CONVERT_DOES_NOT_CREATE_NEW_OBJECT,
  canConvert,
  entersBattlefieldConvertedWithInstantOrSorceryBackFace,
} from '../src/keywordActions/convert';
import {
  MELD_CARDS_CANNOT_TRANSFORM_OR_CONVERT,
  MELD_CARDS_ARE_NOT_DOUBLE_FACED,
  OFFICIAL_MELD_PAIRS,
} from '../src/keywordActions/meld';
import { isMeldCardConsideredDoubleFaced } from '../src/doubleFacedCards';
import { getAbilityTooltip, getGlossaryEntry } from '../src/glossary';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

describe('CR 20261106 keyword and type mapping', () => {
  it('lists Beam me up and the new ability words in Keywords.json', () => {
    const catalog = JSON.parse(readFileSync(path.join(repoRoot, 'Keywords.json'), 'utf8'));
    expect(catalog.meta.date).toBe('2026-11-06');
    expect(catalog.data.keywordAbilities).toContain('Beam me up');
    expect(catalog.data.keywordActions).toContain('Assimilate');
    for (const word of ['Battlefront', 'Federation', 'Rulebreaker', 'Seek out', 'Strange new worlds']) {
      expect(catalog.data.abilityWords).toContain(word);
    }
  });

  it('recognizes creature type Q as distinct from Qu (205.3m)', () => {
    expect(isValidCreatureType('Q')).toBe(true);
    expect(isCreatureTypeWord('Q')).toBe(true);
    expect(isCreatureTypeWord('q')).toBe(true);
    expect(isCreatureTypeWord('Qu')).toBe(true);
    expect(isValidCreatureType('Qu')).toBe(true);
    expect(isCreatureTypeWord('Q') && isCreatureTypeWord('Qu')).toBe(true);
  });
});

describe('Rule 702.196: Beam me up', () => {
  it('parses a generic Beam me up cost from oracle text', () => {
    expect(extractBeamMeUpCost('Beam me up {4}{U} (You may...')).toBe('{4}{U}');
    expect(extractBeamMeUpCost('Flashback {2}')).toBeNull();
  });

  it('allows the alt cost only from the graveyard for instants and sorceries', () => {
    const ability = beamMeUp('card1', '{4}{U}');
    expect(canCastWithBeamMeUpFromZone(ability, 'graveyard', 'Instant')).toBe(true);
    expect(canCastWithBeamMeUpFromZone(ability, 'graveyard', 'Sorcery')).toBe(true);
    expect(canCastWithBeamMeUpFromZone(ability, 'hand', 'Instant')).toBe(false);
    expect(canCastWithBeamMeUpFromZone(ability, 'graveyard', 'Creature — Human')).toBe(false);
  });

  it('exiles the card when leaving the stack if the beam me up cost was paid', () => {
    const unpaid = beamMeUp('card1', '{2}');
    expect(shouldExileAfterBeamMeUp(unpaid)).toBe(false);
    expect(shouldExileAfterBeamMeUp(castWithBeamMeUp(unpaid))).toBe(true);
  });

  it('rejects creatures that cannot be beamed up, including auras (702.196b)', () => {
    expect(canCreatureBeBeamedUp('Haste')).toBe(true);
    expect(canCreatureBeBeamedUp("This creature can't be beamed up.")).toBe(false);
    expect(canCreatureBeBeamedUp('Vigilance', ["Enchanted creature can't be beamed up."])).toBe(false);
  });
});

describe('Rule 701.72: Assimilate', () => {
  it('gains control, adds a +1/+1 counter, and makes a Borg artifact creature on the battlefield', () => {
    const result = createAssimilateResult(assimilate('p1', 'c1', 'battlefield', 'queen'));
    expect(result.gainedControl).toBe(true);
    expect(result.enteredBattlefield).toBe(false);
    expect(result.plusOnePlusOneCounters).toBe(1);
    expect(result.becomesBorgArtifactCreature).toBe(true);
    expect(result.assimilatedWithSourceId).toBe('queen');
  });

  it('puts a card from another zone onto the battlefield under you as a Borg artifact creature', () => {
    const result = createAssimilateResult(assimilate('p1', 'c2', 'other', 'cube'));
    expect(result.gainedControl).toBe(false);
    expect(result.enteredBattlefield).toBe(true);
    expect(result.plusOnePlusOneCounters).toBe(1);
    expect(result.becomesBorgArtifactCreature).toBe(true);
  });

  it('links "assimilated with [this]" to the assimilating source (701.72c)', () => {
    expect(isAssimilatedWithSource({ assimilatedBySourceId: 'queen' }, 'queen')).toBe(true);
    expect(isAssimilatedWithSource({ assimilated: { sourceId: 'queen' } }, 'queen')).toBe(true);
    expect(isAssimilatedWithSource({ assimilatedBySourceId: 'queen' }, 'cube')).toBe(false);
  });
});

describe('Rule 701.27 / 701.28 / 713.1 updates (20261106)', () => {
  it('keeps applying effects because transform and convert do not create a new object', () => {
    expect(TRANSFORM_DOES_NOT_CREATE_NEW_OBJECT).toBe(true);
    expect(CONVERT_DOES_NOT_CREATE_NEW_OBJECT).toBe(true);
    expect(asTransformsAbilityAppliesWhileChangingFaces()).toBe(true);
  });

  it('puts an enter-transformed or enter-converted instant/sorcery back face into the graveyard', () => {
    expect(entersBattlefieldTransformedWithInstantOrSorceryBackFace(true)).toBe('graveyard');
    expect(entersBattlefieldTransformedWithInstantOrSorceryBackFace(false)).toBe('battlefield');
    expect(entersBattlefieldConvertedWithInstantOrSorceryBackFace(true)).toBe('graveyard');
  });

  it('ignores instructions to transform or convert meld cards (713.1 / 713.1c)', () => {
    expect(MELD_CARDS_ARE_NOT_DOUBLE_FACED).toBe(true);
    expect(MELD_CARDS_CANNOT_TRANSFORM_OR_CONVERT).toBe(true);
    expect(isMeldCardConsideredDoubleFaced()).toBe(false);
    expect(canTransform({ isDoubleFaced: true, isMeldCard: true })).toBe(false);
    expect(canTransform({ isDoubleFaced: true, isMelded: true })).toBe(false);
    expect(canConvert({ isDoubleFaced: true, isMeldCard: true })).toBe(false);
    expect(canTransform({ isDoubleFaced: true })).toBe(true);
  });

  it('includes the 20261106 meld pair Fang and Vanille to Ragnarok', () => {
    expect(OFFICIAL_MELD_PAIRS).toHaveLength(7);
    expect(OFFICIAL_MELD_PAIRS.some((pair) => pair.meldedName === 'Ragnarok, Divine Deliverance')).toBe(true);
  });
});

describe('20261106 glossary tooltips', () => {
  it('exposes Beam me up and Assimilate tooltip text', () => {
    expect(getGlossaryEntry('Beam me up')?.rulesReference).toBe('Rule 702.196');
    expect(getAbilityTooltip('Assimilate')).toMatch(/Borg artifact creature/i);
  });
});
