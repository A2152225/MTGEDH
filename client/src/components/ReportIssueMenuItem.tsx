/**
 * client/src/components/ReportIssueMenuItem.tsx
 * The "Report Issue" row shared by every card right-click menu.
 */
import React from 'react';
import { openReportIssue, type ReportIssueTarget } from '../utils/reportIssueStore';

export const REPORT_ISSUE_LABEL = 'Report Issue';

export function ReportIssueMenuItem(props: {
  target: ReportIssueTarget;
  onClose: () => void;
  style?: React.CSSProperties;
  /** Optional separator above the item (used by menus that group actions). */
  separator?: boolean;
}): React.ReactElement {
  const { target, onClose, style, separator } = props;
  return (
    <>
      {separator && <div style={{ height: 1, backgroundColor: '#444', margin: '4px 0' }} />}
      <div
        role="menuitem"
        data-testid="report-issue-menu-item"
        style={{
          padding: '8px 16px',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          fontSize: 13,
          color: '#fca5a5',
          ...style,
        }}
        title="Report a problem with this card (missing effect, wrong outcome, UI bug...)"
        onClick={() => {
          onClose();
          openReportIssue(target);
        }}
        onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'rgba(239,68,68,0.15)')}
        onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
      >
        <span style={{ width: 20, textAlign: 'center' }}>{'\u26A0'}</span>
        <span>{REPORT_ISSUE_LABEL}</span>
      </div>
    </>
  );
}