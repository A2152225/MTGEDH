// Origin parent: client/src/components/DeckManagerModal.tsx
// Cluster moved: nested precon/random import handlers and initial-action effect (~324-431).
// Public entry symbols: useDeckManagerModalRandomImportHandlers.
// Leaf must not import DeckManagerModal.tsx or DeckManagerModal-handlers/index.ts.

import React, { useEffect, useRef } from 'react';
import { socket } from '../../socket';
import type { SavedDeckSummary } from '../../../../shared/src/decks';
import type { GameID } from '../../../../shared/src/types';
import {
  describeRandomDeckSource,
  executeRandomDeckPick,
} from '../../utils/randomDeckSelection';

export type DeckManagerModalRandomImportHandlerDeps = {
  open: boolean;
  gameId?: GameID;
  cacheCards: boolean;
  onClose: () => void;
  onImportText: (text: string, name?: string, cacheCards?: boolean) => void;
  onUseSavedDeck?: (deckId: string) => void;
  canServer?: boolean;
  alsoSaveToServer: boolean;
  localList: { id: string; name: string; text: string; savedAt: number }[];
  serverDecks: SavedDeckSummary[];
  setLocalErr: React.Dispatch<React.SetStateAction<string | null>>;
  setPickingRandomDeck: React.Dispatch<React.SetStateAction<boolean>>;
  setRandomDeckMessage: React.Dispatch<React.SetStateAction<string | null>>;
  initialAction?: 'random' | null;
  onInitialActionConsumed?: () => void;
  saveVisibility?: 'public' | 'private';
};

export function useDeckManagerModalRandomImportHandlers(
  deps: DeckManagerModalRandomImportHandlerDeps,
) {
  const {
    open,
    gameId,
    cacheCards,
    onClose,
    onImportText,
    onUseSavedDeck,
    canServer,
    alsoSaveToServer,
    localList,
    serverDecks,
    setLocalErr,
    setPickingRandomDeck,
    setRandomDeckMessage,
    initialAction,
    onInitialActionConsumed,
    saveVisibility,
  } = deps;

  const initialActionHandledRef = useRef(false);

  const importPreconDeck = React.useCallback((
    commanders: string[],
    deckName: string,
    setName: string,
    year: number,
    setCode: string,
    colorIdentity: string,
  ) => {
    if (!gameId) {
      setLocalErr('Join a game to import precon decks.');
      return;
    }
    socket.emit('importPreconDeck', {
      gameId,
      commanders,
      deckName,
      setName,
      year,
      setCode,
      colorIdentity,
      cacheCards,
    });
    onClose();
  }, [cacheCards, gameId, onClose]);

  const handleRandomDeck = React.useCallback(() => {
    setPickingRandomDeck(true);
    setLocalErr(null);

    const result = executeRandomDeckPick({
      localDecks: localList,
      serverDecks,
      includeServer: !!canServer,
      includePrecons: !!gameId,
      handlers: {
        onImportLocal: (text, name) => {
          onImportText(text, name, cacheCards);
          if (alsoSaveToServer && canServer && gameId) {
            socket.emit('saveDeck', {
              gameId,
              name: name || 'Deck',
              list: text,
              cacheCards,
              visibility: saveVisibility || 'private',
            });
          }
        },
        onUseServerDeck: (deckId) => {
          if (onUseSavedDeck) {
            onUseSavedDeck(deckId);
          } else if (gameId) {
            socket.emit('useSavedDeck', { gameId, deckId });
          }
        },
        onImportPrecon: ({
          commanders,
          deckName,
          setName,
          year,
          setCode,
          colorIdentity,
        }) => {
          importPreconDeck(commanders, deckName, setName, year, setCode, colorIdentity);
        },
      },
    });

    if (!result.ok) {
      setRandomDeckMessage(null);
      setLocalErr(result.error);
      setPickingRandomDeck(false);
      return;
    }

    setRandomDeckMessage(`Random pick: ${result.choice.label} (${describeRandomDeckSource(result.choice)})`);

    if (result.choice.source !== 'precon') {
      onClose();
    }

    setPickingRandomDeck(false);
  }, [
    alsoSaveToServer,
    cacheCards,
    canServer,
    gameId,
    importPreconDeck,
    onClose,
    onImportText,
    onUseSavedDeck,
    localList,
    serverDecks,
  ]);

  useEffect(() => {
    if (!open) {
      initialActionHandledRef.current = false;
      return;
    }
    if (initialAction !== 'random' || initialActionHandledRef.current) return;
    initialActionHandledRef.current = true;
    const timer = window.setTimeout(() => {
      handleRandomDeck();
      onInitialActionConsumed?.();
    }, 200);
    return () => window.clearTimeout(timer);
  }, [open, initialAction, handleRandomDeck, onInitialActionConsumed]);

  return { importPreconDeck, handleRandomDeck };
}
