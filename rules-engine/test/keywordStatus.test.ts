import { describe, expect, it } from 'vitest';
import {
  collectGameplayStatuses,
  collectKeywordStatuses,
  mapAutomationToImplementation,
} from '../src/reporting/keywordStatus';
import { AutomationStatus } from '../src/GameAutomationVerifier';

describe('keyword implementation status reporting', () => {
  it('collects keyword abilities and actions', () => {
    const rows = collectKeywordStatuses();

    expect(rows.length).toBeGreaterThan(200);
    expect(rows.some((row) => row.category === 'Keyword Ability')).toBe(true);
    expect(rows.some((row) => row.category === 'Keyword Action')).toBe(true);
    expect(
      rows.every((row) =>
        ['Fully Implemented', 'Partially Implemented', 'Not Yet Implemented'].includes(
          row.status,
        ),
      ),
    ).toBe(true);
  });

  it('maps automation status to implementation buckets', () => {
    expect(mapAutomationToImplementation(AutomationStatus.IMPLEMENTED)).toBe(
      'Fully Implemented',
    );
    expect(mapAutomationToImplementation(AutomationStatus.PARTIAL)).toBe(
      'Partially Implemented',
    );
    expect(mapAutomationToImplementation(AutomationStatus.MANUAL_REQUIRED)).toBe(
      'Partially Implemented',
    );
    expect(mapAutomationToImplementation(AutomationStatus.PENDING)).toBe(
      'Not Yet Implemented',
    );
    expect(mapAutomationToImplementation(AutomationStatus.NEEDS_FIX)).toBe(
      'Not Yet Implemented',
    );
  });

  it('collects gameplay automation statuses', () => {
    const rows = collectGameplayStatuses();

    expect(rows.length).toBeGreaterThan(0);
    expect(
      rows.every((row) =>
        ['Fully Implemented', 'Partially Implemented', 'Not Yet Implemented'].includes(
          row.status,
        ),
      ),
    ).toBe(true);
    expect(rows.some((row) => row.status !== 'Fully Implemented')).toBe(true);
  });
});
