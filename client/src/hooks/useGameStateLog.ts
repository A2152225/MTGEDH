import { useEffect, useRef, useState } from 'react';
import { buildGameStateLogEntries, mergeGameLogEntries, type GameLogEntry } from '../utils/gameStateLog';

export function useGameStateLog(
  view: any | null | undefined,
  resolvePlayerName: (playerId: string) => string,
): GameLogEntry[] {
  const [entries, setEntries] = useState<GameLogEntry[]>([]);
  const prevViewRef = useRef<any | null>(null);
  const viewId = String(view?.id || '');

  useEffect(() => {
    if (!viewId) {
      prevViewRef.current = null;
      setEntries([]);
      return;
    }

    const prev = prevViewRef.current;
    if (prev && prev.id === viewId) {
      const nextEntries = buildGameStateLogEntries(prev, view, resolvePlayerName);
      if (nextEntries.length > 0) {
        setEntries((current) => mergeGameLogEntries(current, nextEntries));
      }
    }

    prevViewRef.current = view;
  }, [view, viewId, resolvePlayerName]);

  return entries;
}
