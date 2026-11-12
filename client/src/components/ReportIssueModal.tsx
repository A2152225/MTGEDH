/**
 * client/src/components/ReportIssueModal.tsx
 * Floating, non-modal report panel: multiline description (required, max 2000),
 * optional category, Submit / Cancel. Draggable by the title bar, minimizable,
 * and it does not close on outside click, backdrop, or Escape.
 */
import React, { useState } from 'react';
import {
  ISSUE_CATEGORIES,
  ISSUE_CATEGORY_LABELS,
  ISSUE_DESCRIPTION_MAX,
  type IssueCategory,
} from '../../../shared/src/issueReport';
import { useDraggablePanel } from '../hooks/useDraggablePanel';
import { validateIssueDescription } from '../utils/issueReportClient';

const REPORT_ISSUE_PANEL_STORAGE_KEY = 'mtgedh.reportIssuePanel.position';

const headerIconButtonStyle: React.CSSProperties = {
  width: 32,
  height: 32,
  padding: 0,
  borderRadius: 6,
  border: '1px solid transparent',
  background: 'transparent',
  color: '#e5e7eb',
  cursor: 'pointer',
  fontSize: 16,
  lineHeight: 1,
  flexShrink: 0,
};

export interface ReportIssueModalProps {
  open: boolean;
  cardName: string;
  zoneLabel?: string;
  submitting?: boolean;
  /** Server/network error to show inline after a failed submit. */
  errorMessage?: string | null;
  onSubmit: (description: string, category: IssueCategory | '') => void;
  onCancel: () => void;
}

export function ReportIssueModal(props: ReportIssueModalProps): React.ReactElement | null {
  const { open, cardName, zoneLabel, submitting, errorMessage, onSubmit, onCancel } = props;
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState<IssueCategory | ''>('');
  const [touched, setTouched] = useState(false);
  const { panelRef, minimized, toggleMinimized, panelStyle, handleProps } = useDraggablePanel({
    storageKey: REPORT_ISSUE_PANEL_STORAGE_KEY,
  });

  if (!open) return null;

  const validation = validateIssueDescription(description);
  const showError = touched && validation;

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-modal="false"
      aria-label={`Report an issue with ${cardName}`}
      data-testid="report-issue-panel"
      style={{
        ...panelStyle,
        zIndex: 11000,
        backgroundColor: '#1a1a2e',
        borderRadius: 12,
        width: minimized ? 'auto' : 'min(520px, 92vw)',
        maxWidth: '92vw',
        maxHeight: minimized ? undefined : 'calc(100vh - 16px)',
        boxShadow: '0 12px 48px rgba(0,0,0,0.6)',
        color: '#fff',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        boxSizing: 'border-box',
      }}
    >
      <div
        {...handleProps}
        data-testid="report-issue-title-bar"
        style={{
          ...handleProps.style,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
          padding: minimized ? '8px 8px 8px 12px' : '10px 8px 10px 16px',
          backgroundColor: '#121228',
          borderBottom: minimized ? 'none' : '1px solid #2a2a44',
          flexShrink: 0,
        }}
      >
        <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: '#fca5a5', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {'\u26A0'} Report Issue
        </h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: 2, flexShrink: 0 }} data-no-drag>
          <button
            type="button"
            aria-label={minimized ? 'Restore report issue panel' : 'Minimize report issue panel'}
            title={minimized ? 'Restore' : 'Minimize'}
            data-testid="report-issue-minimize"
            onClick={toggleMinimized}
            style={headerIconButtonStyle}
          >
            {minimized ? '\u25A1' : '\u2013'}
          </button>
          <button
            type="button"
            aria-label="Close report issue panel"
            title="Close"
            data-testid="report-issue-close"
            onClick={onCancel}
            disabled={submitting}
            style={{ ...headerIconButtonStyle, cursor: submitting ? 'not-allowed' : 'pointer', opacity: submitting ? 0.5 : 1 }}
          >
            {'\u00D7'}
          </button>
        </div>
      </div>

      <div
        style={{
          display: minimized ? 'none' : 'flex',
          flexDirection: 'column',
          padding: 24,
          overflow: 'auto',
          minHeight: 0,
        }}
        aria-hidden={minimized}
      >
        <div style={{ fontSize: 14, color: '#9ca3af' }}>
          <strong style={{ color: '#fff' }} data-testid="report-issue-card-name">{cardName}</strong>
          {zoneLabel ? <span> {'\u00B7'} {zoneLabel}</span> : null}
        </div>

        <label style={{ display: 'block', marginTop: 16, fontSize: 13, color: '#d1d5db' }} htmlFor="report-issue-category">
          Category (optional)
        </label>
        <select
          id="report-issue-category"
          value={category}
          disabled={submitting}
          onChange={(e) => setCategory(e.target.value as IssueCategory | '')}
          style={{ width: '100%', marginTop: 4, padding: 8, borderRadius: 6, background: '#0f0f1e', color: '#fff', border: '1px solid #444' }}
        >
          <option value="">-- Select a category --</option>
          {ISSUE_CATEGORIES.map((c) => (
            <option key={c} value={c}>{ISSUE_CATEGORY_LABELS[c]}</option>
          ))}
        </select>

        <label style={{ display: 'block', marginTop: 12, fontSize: 13, color: '#d1d5db' }} htmlFor="report-issue-description">
          Describe the issue
        </label>
        <textarea
          id="report-issue-description"
          value={description}
          disabled={submitting}
          maxLength={ISSUE_DESCRIPTION_MAX}
          rows={7}
          autoFocus
          placeholder="What happened, and what did you expect to happen?"
          onChange={(e) => setDescription(e.target.value)}
          onBlur={() => setTouched(true)}
          style={{ width: '100%', marginTop: 4, padding: 8, borderRadius: 6, background: '#0f0f1e', color: '#fff', border: '1px solid #444', resize: 'vertical', boxSizing: 'border-box' }}
        />
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#9ca3af', marginTop: 2 }}>
          <span style={{ color: '#f87171' }}>{showError ? validation : errorMessage || ''}</span>
          <span>{description.length}/{ISSUE_DESCRIPTION_MAX}</span>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
          <button type="button" onClick={onCancel} disabled={submitting} style={{ padding: '8px 16px', borderRadius: 6, border: '1px solid #4b5563', background: 'transparent', color: '#e5e7eb', cursor: 'pointer' }}>
            Cancel
          </button>
          <button
            type="button"
            disabled={submitting}
            onClick={() => {
              setTouched(true);
              if (validateIssueDescription(description)) return;
              onSubmit(description, category);
            }}
            style={{ padding: '8px 16px', borderRadius: 6, border: 'none', background: '#dc2626', color: '#fff', fontWeight: 600, cursor: submitting ? 'wait' : 'pointer', opacity: submitting ? 0.7 : 1 }}
          >
            {submitting ? 'Submitting...' : 'Submit'}
          </button>
        </div>
      </div>
    </div>
  );
}
