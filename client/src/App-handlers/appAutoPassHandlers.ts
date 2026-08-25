// Origin parent: client/src/App.tsx
// Cluster moved: auto-pass handlers (autoPassSteps through handleToggleAutoAdvance).
// Public entry symbols: useAppAutoPassHandlers.
// Leaf must not import App.tsx or App-handlers/index.ts.

import React, { useState } from "react";
import { socket } from "../socket";
import type { ClientGameView, PlayerID } from "../../../shared/src";
import { debug } from "../utils/debug";

export type AppAutoPassHandlerDeps = {
  safeView: ClientGameView | null | undefined;
  you: PlayerID | null | undefined;
};

export function useAppAutoPassHandlers(deps: AppAutoPassHandlerDeps) {
  const { safeView, you } = deps;
  // Auto-pass steps - which steps to automatically pass priority on
  const [autoPassSteps, setAutoPassSteps] = useState<Set<string>>(() => {
    try {
      const stored = localStorage.getItem('mtgedh:autoPassSteps');
      if (stored) {
        return new Set(JSON.parse(stored));
      }
    } catch {
      /* ignore */
    }
    return new Set();
  });
  
  // Toggle auto-pass for a specific step
  const handleToggleAutoPass = React.useCallback((step: string, enabled: boolean) => {
    setAutoPassSteps(prev => {
      const next = new Set(prev);
      if (enabled) {
        next.add(step);
      } else {
        next.delete(step);
      }

      try {
        localStorage.setItem('mtgedh:autoPassSteps', JSON.stringify([...next]));
      } catch {
        /* ignore */
      }

      // Sync with server: auto-pass is enabled if ANY step is enabled
      if (safeView?.id) {
        socket.emit('setAutoPass', {
          gameId: safeView.id,
          enabled: next.size > 0,
        });
      }

      return next;
    });
  }, [safeView?.id, socket]);
  
  // Clear all auto-pass settings
  const handleClearAllAutoPass = React.useCallback(() => {
    setAutoPassSteps(new Set());
    try {
      localStorage.removeItem('mtgedh:autoPassSteps');
    } catch {
      /* ignore */
    }

    // Sync with server: auto-pass is now disabled
    if (safeView?.id) {
      socket.emit('setAutoPass', {
        gameId: safeView.id,
        enabled: false,
      });
    }
  }, [safeView?.id, socket]);

  // Select all auto-pass settings
  const handleSelectAllAutoPass = React.useCallback(() => {
    const allSteps = new Set([
      'upkeep', 'draw', 'main1', 'begincombat', 'declareattackers',
      'declareblockers', 'damage', 'endcombat', 'main2', 'end'
    ]);
    setAutoPassSteps(allSteps);
    try {
      localStorage.setItem('mtgedh:autoPassSteps', JSON.stringify([...allSteps]));
    } catch {
      /* ignore */
    }

    // Sync with server: auto-pass is now enabled
    if (safeView?.id) {
      socket.emit('setAutoPass', {
        gameId: safeView.id,
        enabled: true,
      });
    }
  }, [safeView?.id, socket]);

  // Auto-pass for rest of turn setting
  // When enabled, forces auto-pass for all remaining priority windows this turn
  const [autoPassForTurn, setAutoPassForTurn] = useState(false);
  const [autoPassEmptyStackOnOpponentsTurn, setAutoPassEmptyStackOnOpponentsTurn] = useState(() => {
    try {
      return localStorage.getItem('mtgedh:autoPassEmptyStackOnOpponentsTurn') === '1';
    } catch {
      return false;
    }
  });

  const [autoYesOptional, setAutoYesOptional] = useState(() => {
    try {
      return localStorage.getItem('mtgedh:autoYesOptional') === '1';
    } catch {
      return false;
    }
  });

  const handleToggleAutoYesOptional = React.useCallback((enabled: boolean) => {
    setAutoYesOptional(enabled);
    try {
      if (enabled) {
        localStorage.setItem('mtgedh:autoYesOptional', '1');
      } else {
        localStorage.removeItem('mtgedh:autoYesOptional');
      }
    } catch {
      /* ignore */
    }

    if (safeView?.id) {
      socket.emit('setAutoYesOptional', {
        gameId: safeView.id,
        enabled,
      });
    }
  }, [safeView?.id, socket]);
  
  // Toggle auto-pass for rest of turn
  const handleToggleAutoPassForTurn = React.useCallback(() => {
    setAutoPassForTurn(prev => {
      const newValue = !prev;
      // Sync to server
      if (safeView?.id) {
        socket.emit('setAutoPassForTurn', {
          gameId: safeView.id,
          enabled: newValue,
        });
      }
      return newValue;
    });
  }, [safeView?.id, socket]);

  const handleToggleAutoPassEmptyStackOnOpponentsTurn = React.useCallback((enabled: boolean) => {
    setAutoPassEmptyStackOnOpponentsTurn(enabled);
    try {
      if (enabled) {
        localStorage.setItem('mtgedh:autoPassEmptyStackOnOpponentsTurn', '1');
      } else {
        localStorage.removeItem('mtgedh:autoPassEmptyStackOnOpponentsTurn');
      }
    } catch {
      /* ignore */
    }

    if (safeView?.id) {
      socket.emit('setAutoPassEmptyStackOnOpponentsTurn', {
        gameId: safeView.id,
        enabled,
      });
    }
  }, [safeView?.id, socket]);
  
  // Reset auto-pass for turn when turn changes
  React.useEffect(() => {
    if (safeView?.turnPlayer) {
      // Reset when turn player changes (new turn started)
      setAutoPassForTurn(false);
      // Also sync to server
      if (safeView?.id) {
        socket.emit('setAutoPassForTurn', {
          gameId: safeView.id,
          enabled: false,
        });
      }
    }
  }, [safeView?.turnPlayer, safeView?.id, socket]);
  
  // Sync auto-pass settings with server when joining/loading a game
  // We need a ref to capture the current autoPassSteps without adding it as a dependency
  const autoPassStepsRef = React.useRef(autoPassSteps);
  React.useEffect(() => {
    autoPassStepsRef.current = autoPassSteps;
  }, [autoPassSteps]);
  
  const syncAutoPassToServer = React.useCallback((gameId?: string) => {
    const targetGameId = gameId || safeView?.id;
    if (!targetGameId || !you || !socket.connected) return;
    const hasAutoPass = autoPassStepsRef.current.size > 0;
    socket.emit('setAutoPass', {
      gameId: targetGameId,
      enabled: hasAutoPass,
      syncOnly: true,
    } as any);
    socket.emit('setAutoYesOptional', {
      gameId: targetGameId,
      enabled: autoYesOptional,
      syncOnly: true,
    } as any);
    socket.emit('setAutoPassEmptyStackOnOpponentsTurn', {
      gameId: targetGameId,
      enabled: autoPassEmptyStackOnOpponentsTurn,
      syncOnly: true,
    } as any);
  }, [safeView?.id, you, socket, autoYesOptional, autoPassEmptyStackOnOpponentsTurn]);

  // Sync when game/player identity is ready and whenever step preferences change.
  React.useEffect(() => {
    syncAutoPassToServer();
  }, [syncAutoPassToServer, autoPassSteps]);

  // Re-sync after join completes (socket may not be in the room when safeView.id first appears).
  React.useEffect(() => {
    const onJoined = ({ gameId: joinedGameId }: { gameId: string }) => {
      window.setTimeout(() => syncAutoPassToServer(joinedGameId), 0);
    };
    socket.on('joined', onJoined);
    return () => {
      socket.off('joined', onJoined);
    };
  }, [socket, syncAutoPassToServer]);

  // Listen for auto-pass toggle confirmation from server
  // This updates the client UI when auto-pass is enabled/disabled
  React.useEffect(() => {
    const handleAutoPassToggled = (data: { 
      gameId: string; 
      playerId: string; 
      enabled: boolean; 
      success: boolean; 
    }) => {
      // Only update if it's for this game and this player
      if (data.gameId === safeView?.id && data.playerId === you && data.success) {
        debug(2, '[AutoPass] Server confirmed toggle:', data.enabled ? 'enabled' : 'disabled');
        // The UI state is already updated from the user action
        // This confirms the server processed it correctly
        // If the server state doesn't match, we could sync here
      }
    };

    socket.on('autoPassToggled', handleAutoPassToggled);
    return () => {
      socket.off('autoPassToggled', handleAutoPassToggled);
    };
  }, [safeView?.id, you]);

  // Auto-advance phases/steps setting
  // When enabled, automatically passes priority during untap, draw, and cleanup phases
  // if the player has nothing to do
  const [autoAdvancePhases, setAutoAdvancePhases] = useState(() => {
    try {
      const stored = localStorage.getItem('mtgedh:autoAdvancePhases');
      return stored === 'true';
    } catch {
      return false;
    }
  });
  
  // Toggle auto-advance and persist to localStorage
  const handleToggleAutoAdvance = React.useCallback(() => {
    setAutoAdvancePhases(prev => {
      const next = !prev;
      try {
        localStorage.setItem('mtgedh:autoAdvancePhases', String(next));
      } catch { /* ignore */ }
      return next;
    });
  }, []);

  return {
    autoPassSteps,
    handleToggleAutoPass,
    handleClearAllAutoPass,
    handleSelectAllAutoPass,
    autoPassForTurn,
    autoPassEmptyStackOnOpponentsTurn,
    autoYesOptional,
    handleToggleAutoYesOptional,
    handleToggleAutoPassForTurn,
    handleToggleAutoPassEmptyStackOnOpponentsTurn,
    autoAdvancePhases,
    handleToggleAutoAdvance,
  };
}
