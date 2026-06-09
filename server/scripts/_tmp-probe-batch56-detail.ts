import { applyOracleIRStepsToGameState } from '../../rules-engine/src/oracleIRExecutor.js';
import { parseTriggeredAbilitiesFromText } from '../../rules-engine/src/triggeredAbilitiesParsing.js';
import {
  buildAuditExecutionContext,
  buildAuditFixtureState,
  collectAutoSelectedModeIds,
  collectStepsFromIrText,
  enrichAuditStateAndContextForCopySteps,
  enrichAuditStateAndContextForTargets,
  shouldDeclineOptionalStepsForAudit,
} from './executor-coverage-audit.ts';
import { getCombinedOracleText, loadEffectIrParser } from './trigger-coverage-audit.ts';
import fs from 'node:fs';

await loadEffectIrParser();
const cards = JSON.parse(fs.readFileSync(new URL('../../oracle-cards.json', import.meta.url), 'utf8')) as any[];

function probe(cardName: string, effectFilter?: RegExp) {
  const card = cards.find((c: any) => c.name === cardName);
  const oracle = getCombinedOracleText(card);
  for (const trigger of parseTriggeredAbilitiesFromText(oracle, card.name)) {
    const effect = String(trigger.effect || '').trim();
    if (effectFilter && !effectFilter.test(effect)) continue;
    const steps = collectStepsFromIrText(effect, card.name);
    let state = buildAuditFixtureState(card.name, card.type_line);
    let ctx = buildAuditExecutionContext(card.name);
    const enriched = enrichAuditStateAndContextForCopySteps(
      { name: card.name, type_line: card.type_line, oracle_text: oracle },
      steps,
      state,
      ctx
    );
    const targetEnriched = enrichAuditStateAndContextForTargets(steps, enriched.state, enriched.ctx, {
      oracleText: oracle,
    });
    const decline = shouldDeclineOptionalStepsForAudit(steps);
    const result = applyOracleIRStepsToGameState(targetEnriched.state, steps, targetEnriched.ctx, {
      allowOptional: !decline,
      ...(collectAutoSelectedModeIds(steps).length > 0
        ? { selectedModeIds: collectAutoSelectedModeIds(steps) }
        : {}),
    });
    console.log('\n===', cardName, '===');
    console.log('effect:', effect.slice(0, 150));
    console.log('steps:', JSON.stringify(steps, null, 2));
    console.log('decline:', decline);
    for (const s of result.stepResults || []) {
      console.log(s.applied ? 'APPLIED' : 'SKIP', (s as any).stepKind, String(s.message || ''), (s as any).reason || '');
    }
  }
}

probe('Maulfist Squad', /servo/i);
probe('Risen Reef', /look at the top/i);
probe('Molderhulk', /graveyard/i);
probe('Wooden Stake', /destroy that creature/i);
