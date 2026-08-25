/**
 * Origin parent: rules-engine/src/oracleIR.ts
 * Cluster: OracleEffectStep union alias (A | B | C)
 * Public: OracleEffectStep
 * Leaf must not import oracleIR.ts or oracleIR-handlers/index.ts.
 */

import type { OracleEffectStepA } from './oracleIREffectStepA';
import type { OracleEffectStepB } from './oracleIREffectStepB';
import type { OracleEffectStepC } from './oracleIREffectStepC';

export type OracleEffectStep = OracleEffectStepA | OracleEffectStepB | OracleEffectStepC;
