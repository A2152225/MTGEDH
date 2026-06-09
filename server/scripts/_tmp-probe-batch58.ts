import { parseTriggeredAbilitiesFromText } from '../../rules-engine/src/triggeredAbilitiesParsing.js';
import {
  collectStepsFromIrText,
  buildAuditFixtureState,
  buildAuditExecutionContext,
  enrichAuditStateAndContextForCopySteps,
  enrichAuditStateAndContextForTargets,
  shouldDeclineOptionalStepsForAudit,
} from './executor-coverage-audit.ts';
import { applyOracleIRStepsToGameState } from '../../rules-engine/src/oracleIRExecutor.js';
import { loadEffectIrParser } from './trigger-coverage-audit.ts';

await loadEffectIrParser();

const probes = [
  {
    name: 'Brain Gorgers',
    oracle: 'Madness {1}{R}\nWhenever you discard a card, you may cast it for its madness cost or put it into your graveyard.',
  },
  {
    name: 'Mirkwood Elk',
    oracle: 'Whenever you exile a creature card from your graveyard, you gain life equal to that card\'s power.',
  },
  {
    name: 'Deathgorge Scavenger',
    oracle: 'When Deathgorge Scavenger enters the battlefield, exile target card from a graveyard. If a creature card is exiled this way, put a +1/+1 counter on Deathgorge Scavenger.\nWhenever a creature dies, if a noncreature card is exiled this way, Deathgorge Scavenger gets +1/+1 until end of turn.',
  },
];

for (const probe of probes) {
  for (const trigger of parseTriggeredAbilitiesFromText(probe.oracle, probe.name)) {
    const steps = collectStepsFromIrText(trigger.effect, probe.name);
    let state = buildAuditFixtureState(probe.name);
    let ctx = buildAuditExecutionContext(probe.name);
    const enriched = enrichAuditStateAndContextForCopySteps(
      { name: probe.name, oracle_text: probe.oracle },
      steps,
      state,
      ctx
    );
    const targetEnriched = enrichAuditStateAndContextForTargets(steps, enriched.state, enriched.ctx, {
      cardName: probe.name,
      oracleText: probe.oracle,
    });
    const declineOptional = shouldDeclineOptionalStepsForAudit(steps);
    const result = applyOracleIRStepsToGameState(targetEnriched.state, steps, targetEnriched.ctx, {
      allowOptional: true,
      declineOptionalSteps: declineOptional,
    });
    console.log('\n===', probe.name, '===');
    console.log('effect:', trigger.effect.slice(0, 120));
    console.log('steps:', steps.map((s) => `${s.kind}${(s as any).optional ? ' (opt)' : ''}`).join(' -> '));
    console.log(
      'gaps:',
      result.automationGaps?.map((g) => `${g.reasonCode}:${g.stepKind}:${String(g.message || '').slice(0, 60)}`)
    );
    console.log('applied', result.appliedSteps?.length, 'skipped', result.skippedSteps?.length);
  }
}
