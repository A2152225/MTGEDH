import { applyMoveZoneStep } from '../../rules-engine/src/oracleIRExecutorMoveZoneStepHandlers.js';
import { parseMoveZoneSingleTargetFromYourGraveyard } from '../../rules-engine/src/oracleIRExecutorZoneOps.js';
import { buildAuditExecutionContext, buildAuditFixtureState, enrichAuditStateAndContextForTargets, collectStepsFromIrText } from './executor-coverage-audit.ts';
import { getCombinedOracleText, loadEffectIrParser } from './trigger-coverage-audit.ts';
import { parseTriggeredAbilitiesFromText } from '../../rules-engine/src/triggeredAbilitiesParsing.js';

await loadEffectIrParser();
const cards = JSON.parse(await import('node:fs').then((fs) => fs.readFileSync(new URL('../../oracle-cards.json', import.meta.url), 'utf8'))) as any[];
const card = cards.find((c: any) => c.name === 'Sword of Light and Shadow');
const oracle = getCombinedOracleText(card);
for (const trigger of parseTriggeredAbilitiesFromText(oracle, card.name)) {
  const effect = String(trigger.effect || '').trim();
  const steps = collectStepsFromIrText(effect, card.name);
  const move = steps[1];
  const parsed = parseMoveZoneSingleTargetFromYourGraveyard((move as any).what);
  let state = buildAuditFixtureState(card.name, card.type_line);
  let ctx = buildAuditExecutionContext(card.name);
  const enriched = enrichAuditStateAndContextForTargets(steps, state, ctx, { oracleText: oracle });
  const p1 = (enriched.state.players as any[]).find((p) => p.id === 'p1');
  const gyCreatures = (p1?.graveyard || []).filter((c: any) => /creature/i.test(c.type_line || ''));
  console.log('parsed your gy:', parsed);
  console.log('gy creature ids:', gyCreatures.map((c: any) => c.id).slice(0, 8));
  console.log('chosen has bf-creature-1:', enriched.ctx.selectorContext?.chosenObjectIds?.includes('bf-creature-1'));
  console.log('chosen has gy-creature-1:', enriched.ctx.selectorContext?.chosenObjectIds?.includes('gy-creature-1'));
  const result = applyMoveZoneStep(enriched.state, move as any, enriched.ctx);
  console.log('log:', result.log);
}
