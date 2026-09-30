import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import React from 'react';
import { ReportIssueModal } from '../src/components/ReportIssueModal';
import { ReportIssueMenuItem, REPORT_ISSUE_LABEL } from '../src/components/ReportIssueMenuItem';
import { ZoneCardContextMenu } from '../src/components/ZoneCardContextMenu';
import { HandCardContextMenu } from '../src/components/HandCardContextMenu';
import { CardContextMenu } from '../src/components/CardContextMenu';
import {
  buildIssueReportPayload,
  submitIssueReport,
  validateIssueDescription,
} from '../src/utils/issueReportClient';
import {
  closeReportIssue,
  getReportIssueUiState,
  openReportIssue,
  openReportIssueMenu,
} from '../src/utils/reportIssueStore';
import { ISSUE_CATEGORIES, ISSUE_DESCRIPTION_MAX, validateIssueReportRequest } from '../../shared/src/issueReport';
import { readFileSync } from 'node:fs';

const target = { cardId: 'c1', permanentId: 'p1', cardName: 'Grizzly Bears', zone: 'battlefield' as const };

describe('Report Issue menu option', () => {
  it('ReportIssueMenuItem renders the label', () => {
    const html = renderToStaticMarkup(React.createElement(ReportIssueMenuItem, { target, onClose: () => {} }));
    expect(html).toContain(REPORT_ISSUE_LABEL);
    expect(html).toContain('report-issue-menu-item');
  });

  it('the item click closes the menu then opens the modal store for that card', () => {
    const onClose = vi.fn();
    const el: any = ReportIssueMenuItem({ target, onClose });
    const row = el.props.children[1];
    row.props.onClick();
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(getReportIssueUiState()).toEqual({ kind: 'modal', target });
    closeReportIssue();
    openReportIssueMenu(target, 10, 20);
    expect(getReportIssueUiState()).toEqual({ kind: 'menu', target, x: 10, y: 20 });
    closeReportIssue();
    expect(getReportIssueUiState().kind).toBe('closed');
    openReportIssue(target);
    closeReportIssue();
  });

  // Menus that use effects/portals cannot be fully rendered without a DOM, so verify the wiring in source for those,
  // and by rendering for the ones that are plain function components.
  it('is wired into every card context menu', () => {
    const files = [
      '../src/components/CardContextMenu.tsx',
      '../src/components/ZoneCardContextMenu.tsx',
      '../src/components/HandCardContextMenu.tsx',
      '../src/components/GraveyardViewModal.tsx',
      '../src/components/ExileViewModal.tsx',
      '../src/components/CentralStack.tsx',
    ];
    for (const f of files) {
      const src = readFileSync(new URL(f, import.meta.url), 'utf8');
      expect(src, f).toMatch(/ReportIssueMenuItem|openReportIssueMenu/);
    }
    const zoneSrc = readFileSync(new URL('../src/components/ZoneCardContextMenu.tsx', import.meta.url), 'utf8');
    expect(zoneSrc).toContain("zone }}");
    expect(typeof ZoneCardContextMenu).toBe('function');
    expect(typeof HandCardContextMenu).toBe('function');
    expect(typeof CardContextMenu).toBe('function');
  });
});

describe('ReportIssueModal', () => {
  it('shows the card name, all categories and Submit/Cancel', () => {
    const html = renderToStaticMarkup(
      React.createElement(ReportIssueModal, { open: true, cardName: 'Grizzly Bears', zoneLabel: 'Battlefield', onSubmit: () => {}, onCancel: () => {} }),
    );
    expect(html).toContain('Grizzly Bears');
    expect(html).toContain('Describe the issue');
    expect(html).toContain('Submit');
    expect(html).toContain('Cancel');
    expect(html).toContain(`maxLength="${ISSUE_DESCRIPTION_MAX}"`);
    for (const label of ['Rules / Wrong outcome', 'Missing effect', 'UI problem', 'Crash / Error', 'Other']) {
      expect(html).toContain(label);
    }
    expect(ISSUE_CATEGORIES).toHaveLength(5);
  });

  it('renders nothing when closed', () => {
    expect(renderToStaticMarkup(React.createElement(ReportIssueModal, { open: false, cardName: 'X', onSubmit: () => {}, onCancel: () => {} }))).toBe('');
  });
});

describe('submit payload', () => {
  it('validates description (required, max)', () => {
    expect(validateIssueDescription('   ')).toMatch(/describe/i);
    expect(validateIssueDescription('ok')).toBeNull();
    expect(validateIssueDescription('a'.repeat(ISSUE_DESCRIPTION_MAX + 1))).toMatch(/too long/i);
  });

  it('builds a payload the server-side validator accepts', () => {
    const payload = buildIssueReportPayload({
      gameId: 'g1', target, description: '  It did not untap.  ', category: 'missing_effect', recentLog: ['a', 'b'],
    });
    expect(payload).toEqual({
      gameId: 'g1', cardId: 'c1', permanentId: 'p1', cardName: 'Grizzly Bears', zone: 'battlefield',
      category: 'missing_effect', description: 'It did not untap.', recentLog: ['a', 'b'],
    });
    expect(validateIssueReportRequest(payload).ok).toBe(true);
    expect(buildIssueReportPayload({ gameId: 'g1', target, description: 'x', category: '' })).not.toHaveProperty('category');
  });

  it('emits reportIssue and resolves with the ack; times out gracefully', async () => {
    const emit = vi.fn((_e: string, _p: any, ack: (r: any) => void) => ack({ ok: true, id: 7 }));
    const payload = buildIssueReportPayload({ gameId: 'g1', target, description: 'bug' });
    await expect(submitIssueReport({ emit } as any, payload)).resolves.toEqual({ ok: true, id: 7 });
    expect(emit).toHaveBeenCalledWith('reportIssue', payload, expect.any(Function));

    const never = { emit: () => {} } as any;
    await expect(submitIssueReport(never, payload, 10)).resolves.toMatchObject({ ok: false, code: 'TIMEOUT' });
    const throwing = { emit: () => { throw new Error('x'); } } as any;
    await expect(submitIssueReport(throwing, payload)).resolves.toMatchObject({ ok: false, code: 'EMIT_FAILED' });
  });
});