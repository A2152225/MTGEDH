/*
  Register Oracle IR smoke suites here.

  To add a soak:
  1. Create scripts/soak/suites/<name>.ts exporting a SoakSuite
     (id, title, run: () => SmokeSoakResult[]).
  2. Import and append it to SMOKE_SUITES below.
  3. Run: npm run oracle-ir:smoke -- --suite <id>

  Reuse soakCard / makeGame / applySteps / startEp / check from oracleIrSmokeCore.
  Keep card lists under ~30 per soak. Split by table setup (votes vs combat vs modal).
*/

import type { SoakSuite } from '../oracleIrSmokeCore.js';
import { edhReadinessSuite } from './edhReadiness.js';
import { replacementEffectsSuite } from './replacementEffects.js';

export const SMOKE_SUITES: readonly SoakSuite[] = [
  edhReadinessSuite,
  replacementEffectsSuite,
];

export function getSmokeSuite(id: string): SoakSuite | undefined {
  const needle = String(id || '').trim().toLowerCase();
  return SMOKE_SUITES.find((suite) => suite.id === needle);
}

export function listSmokeSuites(): Array<{ id: string; title: string; description?: string }> {
  return SMOKE_SUITES.map((suite) => ({
    id: suite.id,
    title: suite.title,
    description: suite.description,
  }));
}
