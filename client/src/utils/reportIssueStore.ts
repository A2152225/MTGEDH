/**
 * client/src/utils/reportIssueStore.ts
 *
 * Tiny module-level store so any card right-click menu can open the "Report Issue" modal
 * (rendered once by ReportIssueHost) without prop-threading through the table layout.
 * The App registers the current game id + a recent-log getter via useReportIssueContext.
 */
import type { IssueZone } from '../../../shared/src/issueReport';

export type ReportIssueTarget = {
  cardId: string;
  /** Battlefield permanent id, when the card is a permanent. */
  permanentId?: string;
  cardName: string;
  zone: IssueZone;
};

export type ReportIssueContext = {
  gameId: string | null;
  getRecentLog: () => string[];
};

export type ReportIssueUiState =
  | { kind: 'closed' }
  | { kind: 'menu'; target: ReportIssueTarget; x: number; y: number }
  | { kind: 'modal'; target: ReportIssueTarget };

let context: ReportIssueContext = { gameId: null, getRecentLog: () => [] };
let uiState: ReportIssueUiState = { kind: 'closed' };
const listeners = new Set<(state: ReportIssueUiState) => void>();

function emit(next: ReportIssueUiState) {
  uiState = next;
  for (const fn of listeners) fn(next);
}

export function setReportIssueContext(next: ReportIssueContext): void {
  context = next;
}

export function getReportIssueContext(): ReportIssueContext {
  return context;
}

export function getReportIssueUiState(): ReportIssueUiState {
  return uiState;
}

export function subscribeReportIssue(fn: (state: ReportIssueUiState) => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** Opens the Report Issue modal for a card. Call from a context-menu item's click handler. */
export function openReportIssue(target: ReportIssueTarget): void {
  emit({ kind: 'modal', target });
}

/** Opens a one-item "Report Issue" right-click menu at (x, y) for elements that have no menu of their own. */
export function openReportIssueMenu(target: ReportIssueTarget, x: number, y: number): void {
  emit({ kind: 'menu', target, x, y });
}

export function closeReportIssue(): void {
  emit({ kind: 'closed' });
}