import { useEffect, useRef } from 'react';
import { setReportIssueContext } from '../utils/reportIssueStore';

/** Registers the active game id and recent log lines for the Report Issue modal. */
export function useReportIssueContext(
  gameId: string | null | undefined,
  logEntries: ReadonlyArray<{ message: string }> | undefined,
): void {
  const entriesRef = useRef(logEntries);
  entriesRef.current = logEntries;
  useEffect(() => {
    setReportIssueContext({
      gameId: gameId || null,
      getRecentLog: () =>
        (entriesRef.current || [])
          .slice(-20)
          .map((entry) => String(entry?.message ?? ''))
          .filter(Boolean),
    });
    return () => setReportIssueContext({ gameId: null, getRecentLog: () => [] });
  }, [gameId]);
}