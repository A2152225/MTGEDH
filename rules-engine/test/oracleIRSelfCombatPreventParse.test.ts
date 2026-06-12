import { describe, expect, it } from 'vitest';

import { parseBareTriggerEffectFragmentSteps } from '../src/oracleIRParserPostprocess.js';
import { parseOracleTextToIR } from '../src/oracleIRParser.js';

const OKETRA_REWARD =
  'prevent all combat damage that would be dealt to it this turn.';

describe('oracle IR self combat damage prevention parse', () => {
  it('parses Oketra exert reward as grant_temporary_ability on this creature', () => {
    const bare = parseBareTriggerEffectFragmentSteps(OKETRA_REWARD);
    const ir = parseOracleTextToIR(OKETRA_REWARD, "Oketra's Avenger");
    const steps = (ir.abilities || []).flatMap((ability) => ability.steps || []);
    const candidate = bare?.[0] || steps[0];
    expect(candidate).toMatchObject({
      kind: 'grant_temporary_ability',
      duration: 'end_of_turn',
      effectText: ['prevent all combat damage that would be dealt to this creature this turn'],
    });
  });
});
