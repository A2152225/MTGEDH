import { useCallback, useState } from 'react';
import { socket } from '../socket';
import { loadLocalSavedDecks } from '../utils/localDeckStorage';
import {
  describeRandomDeckSource,
  executeRandomDeckPick,
} from '../utils/randomDeckSelection';
import { fetchServerDeckSummaries } from '../utils/serverDeckApi';

type UseRandomDeckPickerOptions = {
  gameId?: string;
  canServer?: boolean;
  cacheCards?: boolean;
  onImportText: (text: string, name?: string) => void;
  onUseSavedDeck: (deckId: string) => void;
};

export function useRandomDeckPicker({
  gameId,
  canServer = false,
  cacheCards = true,
  onImportText,
  onUseSavedDeck,
}: UseRandomDeckPickerOptions) {
  const [pickingRandomDeck, setPickingRandomDeck] = useState(false);
  const [randomDeckMessage, setRandomDeckMessage] = useState<string | null>(null);
  const [randomDeckError, setRandomDeckError] = useState<string | null>(null);

  const pickRandomDeck = useCallback(async () => {
    if (!gameId) {
      setRandomDeckError('Join a game before picking a random deck.');
      return;
    }

    setPickingRandomDeck(true);
    setRandomDeckError(null);

    try {
      let serverDecks: Awaited<ReturnType<typeof fetchServerDeckSummaries>> = [];
      if (canServer) {
        try {
          serverDecks = await fetchServerDeckSummaries();
        } catch {
          serverDecks = [];
        }
      }

      const result = executeRandomDeckPick({
        localDecks: loadLocalSavedDecks(),
        serverDecks,
        includeServer: canServer,
        includePrecons: true,
        handlers: {
          onImportLocal: (text, name) => onImportText(text, name),
          onUseServerDeck: (deckId) => onUseSavedDeck(deckId),
          onImportPrecon: ({
            commanders,
            deckName,
            setName,
            year,
            setCode,
            colorIdentity,
          }) => {
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
          },
        },
      });

      if (!result.ok) {
        setRandomDeckMessage(null);
        setRandomDeckError(result.error);
        return;
      }

      setRandomDeckMessage(
        `Random pick: ${result.choice.label} (${describeRandomDeckSource(result.choice)})`,
      );
    } finally {
      setPickingRandomDeck(false);
    }
  }, [cacheCards, canServer, gameId, onImportText, onUseSavedDeck]);

  const clearRandomDeckFeedback = useCallback(() => {
    setRandomDeckMessage(null);
    setRandomDeckError(null);
  }, []);

  return {
    pickRandomDeck,
    pickingRandomDeck,
    randomDeckMessage,
    randomDeckError,
    clearRandomDeckFeedback,
  };
}
