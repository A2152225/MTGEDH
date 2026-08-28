import { describe, expect, it } from 'vitest';

import { resolveResolutionPromptCause } from '../src/state/modules/resolutionPromptCause.js';
import { sanitizeStepForClient } from '../src/socket/resolution.js';
import { ResolutionStepType } from '../src/state/resolution/index.js';

describe('resolution prompt cause presentation', () => {
  it('uses the triggering spell when it is distinct from the watching source', () => {
    const cause = resolveResolutionPromptCause({
      sourceName: 'Judith, Carnage Connoisseur',
      triggerType: 'cast_creature_type',
      triggeringSpell: {
        name: 'Reckless Blaze',
        imageUrl: 'https://example.test/reckless.jpg',
      },
    });
    expect(cause).toEqual({
      causeName: 'Reckless Blaze',
      causeImage: 'https://example.test/reckless.jpg',
      causeLabel: 'You cast',
    });
  });

  it('does not repeat the source card as its own cause', () => {
    expect(resolveResolutionPromptCause({
      sourceName: 'Judith, Carnage Connoisseur',
      triggeringSpell: { name: 'Judith, Carnage Connoisseur' },
    })).toBeNull();
  });

  it('sanitizes cause fields for the client without leaking triggerData', () => {
    const sanitized = sanitizeStepForClient('missing-game', {
      id: 'step-1',
      type: ResolutionStepType.MODAL_CHOICE,
      playerId: 'p1',
      description: 'Judith, Carnage Connoisseur: Choose one',
      sourceName: 'Judith, Carnage Connoisseur',
      mandatory: true,
      options: [{ id: 'option_1', label: 'That spell gains deathtouch and lifelink.' }],
      triggerData: {
        triggerType: 'cast_creature_type',
        triggeringSpell: { name: 'Reckless Blaze', imageUrl: 'https://example.test/reckless.jpg' },
      },
    } as any);

    expect(sanitized.causeName).toBe('Reckless Blaze');
    expect(sanitized.causeLabel).toBe('You cast');
    expect(sanitized.causeImage).toBe('https://example.test/reckless.jpg');
    expect(sanitized.triggerData).toBeUndefined();
  });
});
