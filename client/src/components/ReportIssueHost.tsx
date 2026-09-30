/**
 * client/src/components/ReportIssueHost.tsx
 * Mounted once (main.tsx). Renders the one-item "Report Issue" menu and the modal, submits over the
 * socket, and shows success/failure toasts.
 */
import React, { useEffect, useState } from 'react';
import { socket } from '../socket';
import { toast } from './ToastHost';
import { ReportIssueModal } from './ReportIssueModal';
import { ReportIssueMenuItem } from './ReportIssueMenuItem';
import {
  closeReportIssue,
  getReportIssueContext,
  getReportIssueUiState,
  subscribeReportIssue,
  type ReportIssueUiState,
} from '../utils/reportIssueStore';
import { buildIssueReportPayload, submitIssueReport } from '../utils/issueReportClient';

const ZONE_LABELS: Record<string, string> = {
  battlefield: 'Battlefield',
  hand: 'Hand',
  graveyard: 'Graveyard',
  exile: 'Exile',
  library: 'Library',
  commander: 'Command zone',
  stack: 'Stack',
};

export const ReportIssueHost: React.FC = () => {
  const [ui, setUi] = useState<ReportIssueUiState>(getReportIssueUiState());
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => subscribeReportIssue((next) => { setUi(next); setError(null); }), []);

  useEffect(() => {
    if (ui.kind !== 'menu') return;
    const close = () => closeReportIssue();
    window.addEventListener('click', close);
    window.addEventListener('keydown', close);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('keydown', close);
    };
  }, [ui.kind]);

  if (ui.kind === 'closed') return null;

  if (ui.kind === 'menu') {
    return (
      <div
        style={{
          position: 'fixed',
          left: Math.min(ui.x, window.innerWidth - 200),
          top: Math.min(ui.y, window.innerHeight - 80),
          zIndex: 100000,
          backgroundColor: '#1e1e2e',
          border: '1px solid #444',
          borderRadius: 8,
          boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
          minWidth: 180,
          overflow: 'hidden',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ padding: '8px 16px', borderBottom: '1px solid #444', fontWeight: 600, color: '#fff', fontSize: 13 }}>
          {ui.target.cardName}
        </div>
        <ReportIssueMenuItem target={ui.target} onClose={() => { /* modal replaces the menu */ }} />
      </div>
    );
  }

  const { target } = ui;
  return (
    <ReportIssueModal
      open
      cardName={target.cardName}
      zoneLabel={ZONE_LABELS[target.zone] || target.zone}
      submitting={submitting}
      errorMessage={error}
      onCancel={() => closeReportIssue()}
      onSubmit={async (description, category) => {
        const ctx = getReportIssueContext();
        if (!ctx.gameId) {
          setError('You are not in a game.');
          toast.error('Could not send the report: you are not in a game.');
          return;
        }
        setSubmitting(true);
        setError(null);
        const result = await submitIssueReport(
          socket as any,
          buildIssueReportPayload({ gameId: ctx.gameId, target, description, category, recentLog: ctx.getRecentLog() }),
        );
        setSubmitting(false);
        if (result.ok) {
          toast.success(`Issue #${result.id} reported. Thank you!`);
          closeReportIssue();
        } else {
          setError(result.error);
          toast.error(`Report failed: ${result.error}`);
        }
      }}
    />
  );
};