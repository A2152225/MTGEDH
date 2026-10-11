/**
 * Dies-subject parser for the trigger condition IR.
 * Public: parseDiesSubjectClause.
 *
 * Input is the subject phrase in front of "dies". Returns null unless that
 * phrase is fully described by the shared subject parser.
 */

import { parseSubjectPhrase } from './parseSubjectPhrase.js';
import type { TriggerConditionIR } from './types.js';

export function parseDiesSubjectClause(clause: string): TriggerConditionIR | null {
  return parseSubjectPhrase(clause, 'dies');
}
