// Origin parent: rules-engine/src/effectProgramOracleRunner.ts
// Cluster moved: normalizeChoiceResponseSelections, normalizeChoiceResponseSelection.
// Public entry symbols: normalizeChoiceResponseSelections, normalizeChoiceResponseSelection.
// Leaf must not import effectProgramOracleRunner.ts or effectProgramOracleRunner-handlers/index.ts.

import type { ChoiceResponse } from '../choiceEventsTypes';

export function normalizeChoiceResponseSelections(response: ChoiceResponse): readonly string[] {
  const selections = response.selections;
  if (Array.isArray(selections)) {
    return selections.map(selection => normalizeChoiceResponseSelection(selection)).filter(Boolean);
  }

  if (typeof selections === 'number' || typeof selections === 'boolean') {
    return [String(selections)];
  }

  return [];
}

export function normalizeChoiceResponseSelection(selection: unknown): string {
  if (selection === undefined || selection === null) {
    return '';
  }

  if (typeof selection === 'string' || typeof selection === 'number' || typeof selection === 'boolean') {
    return String(selection).trim();
  }

  if (typeof selection === 'object') {
    const record = selection as Record<string, unknown>;
    for (const key of ['id', 'value', 'selection', 'selectedId', 'selectedCardId', 'selectedTargetId', 'target']) {
      if (record[key] !== undefined && record[key] !== null) {
        return String(record[key]).trim();
      }
    }
    return '';
  }

  return String(selection).trim();
}
