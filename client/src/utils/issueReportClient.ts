/**
 * client/src/utils/issueReportClient.ts
 * Builds the reportIssue socket payload and submits it, resolving with the server's ack.
 */
import {
  ISSUE_DESCRIPTION_MAX,
  isIssueCategory,
  type IssueCategory,
  type IssueReportRequest,
  type IssueReportResult,
} from '../../../shared/src/issueReport';
import type { ReportIssueTarget } from './reportIssueStore';

export const ISSUE_REPORT_ACK_TIMEOUT_MS = 8000;

export function validateIssueDescription(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) return 'Please describe the issue.';
  if (trimmed.length > ISSUE_DESCRIPTION_MAX) {
    return `Description is too long (max ${ISSUE_DESCRIPTION_MAX} characters).`;
  }
  return null;
}

export function buildIssueReportPayload(args: {
  gameId: string;
  target: ReportIssueTarget;
  description: string;
  category?: IssueCategory | '' | null;
  recentLog?: string[];
}): IssueReportRequest {
  const { gameId, target, description, category, recentLog } = args;
  return {
    gameId,
    cardId: target.cardId,
    ...(target.permanentId ? { permanentId: target.permanentId } : {}),
    cardName: target.cardName,
    zone: target.zone,
    ...(category && isIssueCategory(category) ? { category } : {}),
    description: description.trim(),
    ...(recentLog && recentLog.length ? { recentLog: recentLog.slice(-20) } : {}),
  };
}

type EmitterLike = {
  emit: (event: 'reportIssue', payload: IssueReportRequest, ack: (result: IssueReportResult) => void) => unknown;
};

/** Emits reportIssue and resolves with the ack (or a failure result on timeout). Never rejects. */
export function submitIssueReport(
  socketLike: EmitterLike,
  payload: IssueReportRequest,
  timeoutMs: number = ISSUE_REPORT_ACK_TIMEOUT_MS,
): Promise<IssueReportResult> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: IssueReportResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(
      () => finish({ ok: false, code: 'TIMEOUT', error: 'The server did not respond. Please try again.' }),
      timeoutMs,
    );
    try {
      socketLike.emit('reportIssue', payload, (result) => finish(result));
    } catch {
      finish({ ok: false, code: 'EMIT_FAILED', error: 'Could not send the report.' });
    }
  });
}