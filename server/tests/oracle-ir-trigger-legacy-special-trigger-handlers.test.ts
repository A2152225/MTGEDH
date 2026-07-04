import { describe, expect, it } from 'vitest';

describe('stackSpecialTriggerHandlers', () => {
  it('exports rebound and paradigm stack trigger handlers', async () => {
    const module = await import('../src/state/modules/stackSpecialTriggerHandlers.js');
    expect(typeof module.applyStackReboundTrigger).toBe('function');
    expect(typeof module.applyStackParadigmTrigger).toBe('function');
  });
});
