import { useMemo } from "react";

export function useGameSocket() {
  // Minimal stub; wire to real socket state if needed
  const state = useMemo(() => {
    return {
      playerId: undefined as string | undefined,
      gameId: undefined as string | undefined
    };
  }, []);
  return state;
}