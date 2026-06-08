import { parseMoveZoneSingleTargetFromAGraveyard } from '../../rules-engine/src/oracleIRExecutorZoneOps.js';
import { applyMoveZoneStep } from '../../rules-engine/src/oracleIRExecutorMoveZoneStepHandlers.js';
import { buildAuditExecutionContext, buildAuditFixtureState } from './executor-coverage-audit.ts';

const what = { kind: 'raw', text: 'up to one target card from a graveyard' };
console.log('parsed:', parseMoveZoneSingleTargetFromAGraveyard(what));

const step = {
  kind: 'move_zone',
  what,
  to: 'exile',
  toRaw: 'exile',
  raw: 'exile up to one target card from a graveyard',
} as any;

const state = buildAuditFixtureState('Test', 'Creature');
const ctx = buildAuditExecutionContext('Test');
const result = applyMoveZoneStep(state, step, ctx);
console.log('result:', JSON.stringify(result, null, 2));
