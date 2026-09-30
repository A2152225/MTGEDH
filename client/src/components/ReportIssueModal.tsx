/**
 * client/src/components/ReportIssueModal.tsx
 * Presentational modal: multiline description (required, max 2000), optional category, Submit / Cancel.
 */
import React, { useState } from 'react';
import {
  ISSUE_CATEGORIES,
  ISSUE_CATEGORY_LABELS,
  ISSUE_DESCRIPTION_MAX,
  type IssueCategory,
} from '../../../shared/src/issueReport';
import { validateIssueDescription } from '../utils/issueReportClient';

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

  if (!open) return null;

  const validation = validateIssueDescription(description);
  const showError = touched && validation;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Report an issue with ${cardName}`}
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.85)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 11000,
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && !submitting) onCancel();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && !submitting) onCancel();
      }}
    >
      <div
        style={{
          backgroundColor: '#1a1a2e',
          borderRadius: 12,
          padding: 24,
          maxWidth: 520,
          width: '92%',
          boxShadow: '0 12px 48px rgba(0,0,0,0.6)',
          color: '#fff',
        }}
      >
        <h2 style={{ margin: 0, fontSize: 20, fontWeight: 600, color: '#fca5a5' }}>{'\u26A0'} Report Issue</h2>
        <div style={{ marginTop: 4, fontSize: 14, color: '#9ca3af' }}>
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