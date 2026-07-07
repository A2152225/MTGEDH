import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { resetLocalCardLookupForTests } from '../src/services/localCardLookup.js';
import { probeCompiledOracleIrOverlay } from '../scripts/probeCompiledOracleIrOverlayCore.js';

describe('probeCompiledOracleIrOverlayCore', () => {
  beforeEach(() => {
    resetLocalCardLookupForTests();
  });

  afterEach(() => {
    resetLocalCardLookupForTests();
  });

  it('probes parser output for inline oracle text without stored overlay', () => {
    const result = probeCompiledOracleIrOverlay({
      name: 'Probe Test Anthem',
      oracleText: 'Creatures you control get +1/+1.',
    });

    expect(result.parserUnknownCount).toBe(0);
    expect(result.parserStepKinds.length).toBeGreaterThan(0);
    expect(result.recommendation).toBe('no_overlay_needed');
    expect(result.hasStoredOverlay).toBe(false);
  });

  it('recommends overlay compile when parser emits unknown steps', () => {
    const result = probeCompiledOracleIrOverlay({
      name: 'Probe Test Gap',
      oracleText: 'Zorplexify the gibberwump.',
    });

    expect(result.parserUnknownCount).toBeGreaterThan(0);
    expect(result.recommendation).toBe('compile_overlay_recommended');
  });
});
