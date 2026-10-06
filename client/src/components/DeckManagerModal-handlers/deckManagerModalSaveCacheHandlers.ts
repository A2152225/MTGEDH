// Origin parent: client/src/components/DeckManagerModal.tsx
// Cluster moved: nested local/server save, import, rename, delete, and cache handlers (~439-648).
// Public entry symbols: createDeckManagerModalSaveCacheHandlers.
// Leaf must not import DeckManagerModal.tsx or DeckManagerModal-handlers/index.ts.

import type { Dispatch, SetStateAction } from 'react';
import { socket } from '../../socket';
import { toast } from '../ToastHost';
import type { SavedDeckDetail, SavedDeckSummary } from '../../../../shared/src/decks';
import type { GameID } from '../../../../shared/src/types';
import {
  createLocalDeckId,
  saveLocalSavedDecks,
} from '../../utils/localDeckStorage';
import {
  deleteServerDeckViaApi,
  fetchServerDeckDetail,
  renameServerDeckViaApi,
  saveServerDeckViaApi,
  updateServerDeckViaApi,
} from '../../utils/serverDeckApi';

export type SavedLocalDeck = { id: string; name: string; text: string; savedAt: number };

export type DeckManagerModalTab = 'local' | 'server' | 'preview' | 'precons';

export type DeckManagerModalSaveCacheHandlerDeps = {
  localText: string;
  setLocalErr: Dispatch<SetStateAction<string | null>>;
  localName: string;
  editingLocalId: string | null;
  localList: SavedLocalDeck[];
  setLocalList: Dispatch<SetStateAction<SavedLocalDeck[]>>;
  clearEditMode: () => void;
  setLocalName: Dispatch<SetStateAction<string>>;
  setLocalText: Dispatch<SetStateAction<string>>;
  clearPreview: () => void;
  resolveAllFromText: (text: string) => void;
  setEditingLocalId: Dispatch<SetStateAction<string | null>>;
  setEditingServerDeckId: Dispatch<SetStateAction<string | null>>;
  setPendingServerEditId: Dispatch<SetStateAction<string | null>>;
  setTab: Dispatch<SetStateAction<DeckManagerModalTab>>;
  canServer?: boolean;
  gameId?: GameID;
  cacheCards: boolean;
  useRestServer: boolean;
  setSaving: Dispatch<SetStateAction<boolean>>;
  playerId?: string;
  playerName?: string;
  refreshRestServerDecks: () => Promise<void>;
  setServerErr: Dispatch<SetStateAction<string | null>>;
  onImportText: (text: string, name?: string, cacheCards?: boolean) => void;
  alsoSaveToServer: boolean;
  onUseSavedDeck?: (deckId: string) => void;
  applyServerDeckDetail: (deck: SavedDeckDetail) => void;
  setUpdatingServer: Dispatch<SetStateAction<boolean>>;
  editingServerDeckId: string | null;
  setServerDecks: Dispatch<SetStateAction<SavedDeckSummary[]>>;
  detail: SavedDeckDetail | null;
  setDetail: Dispatch<SetStateAction<SavedDeckDetail | null>>;
  setCachingDeckId: Dispatch<SetStateAction<string | null>>;
  saveVisibility?: 'public' | 'private';
  accountUserId?: string;
};

export function createDeckManagerModalSaveCacheHandlers(
  deps: DeckManagerModalSaveCacheHandlerDeps,
) {
  const {
    localText,
    setLocalErr,
    localName,
    editingLocalId,
    localList,
    setLocalList,
    clearEditMode,
    setLocalName,
    setLocalText,
    clearPreview,
    resolveAllFromText,
    setEditingLocalId,
    setEditingServerDeckId,
    setPendingServerEditId,
    setTab,
    canServer,
    gameId,
    cacheCards,
    useRestServer,
    setSaving,
    playerId,
    playerName,
    refreshRestServerDecks,
    setServerErr,
    onImportText,
    alsoSaveToServer,
    onUseSavedDeck,
    applyServerDeckDetail,
    setUpdatingServer,
    editingServerDeckId,
    setServerDecks,
    detail,
    setDetail,
    setCachingDeckId,
    saveVisibility,
    accountUserId,
  } = deps;

  const saveLocal = () => {
    if (!localText.trim()) { setLocalErr('Empty list'); return; }
    if (!localName.trim()) { setLocalErr('Name required'); return; }
    if (editingLocalId) {
      const next = localList.map((entry) => (
        entry.id === editingLocalId
          ? { ...entry, name: localName.trim(), text: localText, savedAt: Date.now() }
          : entry
      ));
      saveLocalSavedDecks(next);
      setLocalList(next);
      clearEditMode();
      setLocalName('');
      setLocalText('');
      clearPreview();
      setLocalErr(null);
      return;
    }
    const deck: SavedLocalDeck = { id: createLocalDeckId('l'), name: localName.trim(), text: localText, savedAt: Date.now() };
    const next = [deck, ...localList].slice(0, 200);
    saveLocalSavedDecks(next);
    setLocalList(next);
    setLocalName('');
    setLocalText('');
    clearPreview();
    setLocalErr(null);
  };

  const beginEditLocal = (deck: SavedLocalDeck) => {
    setLocalName(deck.name);
    setLocalText(deck.text);
    void resolveAllFromText(deck.text);
    setEditingLocalId(deck.id);
    setEditingServerDeckId(null);
    setPendingServerEditId(null);
    setLocalErr(null);
    setTab('local');
  };

  const beginEditServer = (deckId: string) => {
    setPendingServerEditId(deckId);
    setEditingLocalId(null);
    setServerErr(null);
    requestDetail(deckId);
  };

  const saveLocalDeckToServer = async (name: string, text: string) => {
    if (!canServer) {
      setServerErr('Server deck saving is not available here.');
      toast.error('Server deck saving is not available here.');
      return;
    }
    if (!accountUserId) {
      const msg = 'Log in to save decks to the server.';
      setServerErr(msg);
      toast.error(msg);
      return;
    }
    if (gameId) {
      setSaving(true);
      socket.emit('saveDeck', { gameId, name, list: text, cacheCards, visibility: saveVisibility || 'private' });
      return;
    }
    if (!useRestServer) {
      const msg = 'Join a game or use localhost to save server decks.';
      setServerErr(msg);
      toast.error(msg);
      return;
    }
    setSaving(true);
    try {
      await saveServerDeckViaApi({
        name,
        text,
        playerId: accountUserId || playerId,
        playerName,
        cacheCards,
        visibility: saveVisibility || 'private',
      });
      await refreshRestServerDecks();
      setServerErr(null);
      toast.success(`Saved "${name}" to your server decks (${saveVisibility || 'private'}).`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to save deck';
      setServerErr(msg);
      toast.error(`Could not save deck: ${msg}`);
    } finally {
      setSaving(false);
    }
  };

  const importLocal = (d: SavedLocalDeck) => {
    onImportText(d.text, d.name, cacheCards);
    if (alsoSaveToServer && canServer) {
      void saveLocalDeckToServer(d.name || 'Deck', d.text);
    }
  };

  const importPastedText = () => {
    if (!localText.trim()) { setLocalErr('Paste a decklist first'); return; }
    setLocalErr(null);
    onImportText(localText, localName.trim() || undefined, cacheCards);
    if (alsoSaveToServer && canServer && localName.trim()) {
      void saveLocalDeckToServer(localName.trim(), localText);
    }
  };

  // Use server deck: if parent provided onUseSavedDeck, call it; otherwise emit directly.
  const importServer = (deckId: string) => {
    if (onUseSavedDeck) {
      onUseSavedDeck(deckId);
    } else {
      if (gameId) socket.emit('useSavedDeck', { gameId, deckId });
    }
  };
  const requestDetail = (deckId: string) => {
    if (gameId) {
      socket.emit('getSavedDeck', { gameId, deckId });
      return;
    }
    if (!useRestServer) return;
    void (async () => {
      try {
        const deck = await fetchServerDeckDetail(deckId);
        applyServerDeckDetail(deck);
        setServerErr(null);
      } catch (err) {
        setServerErr(err instanceof Error ? err.message : 'Failed to load deck');
        setPendingServerEditId(null);
      }
    })();
  };
  const saveServer = () => {
    if (!canServer) { setServerErr('Server deck saving is not available here.'); return; }
    if (!localText.trim() || !localName.trim()) { setServerErr('Name & text required'); return; }
    // saveLocalDeckToServer handles in-game (socket) and REST saves and reports every failure.
    void saveLocalDeckToServer(localName.trim(), localText);
  };
  const updateServerDeck = () => {
    if (!canServer || !editingServerDeckId) return;
    if (!localText.trim() || !localName.trim()) { setServerErr('Name & text required'); return; }
    if (gameId) {
      setUpdatingServer(true);
      socket.emit('updateSavedDeck', {
        gameId,
        deckId: editingServerDeckId,
        name: localName.trim(),
        list: localText,
        cacheCards,
      });
      return;
    }
    if (!useRestServer) {
      setServerErr('Join a game or use localhost to edit server decks.');
      return;
    }
    setUpdatingServer(true);
    void (async () => {
      try {
        await updateServerDeckViaApi(editingServerDeckId, {
          name: localName.trim(),
          text: localText,
          playerId: accountUserId || playerId,
          cacheCards,
          visibility: saveVisibility,
        });
        clearEditMode();
        setLocalName('');
        setLocalText('');
        clearPreview();
        await refreshRestServerDecks();
        setServerErr(null);
      } catch (err) {
        setServerErr(err instanceof Error ? err.message : 'Failed to update deck');
      } finally {
        setUpdatingServer(false);
      }
    })();
  };
  const renameServerDeck = (deck: SavedDeckSummary) => {
    const newName = prompt('Rename deck', deck.name) || deck.name;
    if (gameId) {
      socket.emit('renameSavedDeck', { gameId, deckId: deck.id, name: newName });
      return;
    }
    if (!useRestServer) return;
    void (async () => {
      try {
        const updated = await renameServerDeckViaApi(deck.id, newName, playerId);
        setServerDecks(prev => prev.map(d => (d.id === updated.id ? updated : d)));
        if (detail?.id === updated.id) {
          setDetail(prev => (prev ? { ...prev, name: updated.name } : prev));
        }
        setServerErr(null);
      } catch (err) {
        setServerErr(err instanceof Error ? err.message : 'Failed to rename deck');
      }
    })();
  };
  const deleteServerDeck = (deck: SavedDeckSummary) => {
    if (!confirm(`Delete server deck "${deck.name}"?`)) return;
    if (gameId) {
      socket.emit('deleteSavedDeck', { gameId, deckId: deck.id });
      return;
    }
    if (!useRestServer) return;
    void (async () => {
      try {
        await deleteServerDeckViaApi(deck.id, playerId);
        setServerDecks(prev => prev.filter(d => d.id !== deck.id));
        if (detail?.id === deck.id) setDetail(null);
        if (editingServerDeckId === deck.id) clearEditMode();
        setServerErr(null);
      } catch (err) {
        setServerErr(err instanceof Error ? err.message : 'Failed to delete deck');
      }
    })();
  };
  const cacheDeck = (deckId: string) => {
    if (!gameId) return;
    setCachingDeckId(deckId);
    socket.emit('cacheSavedDeck', { gameId, deckId });
  };

  return {
    saveLocal,
    beginEditLocal,
    beginEditServer,
    importLocal,
    importPastedText,
    importServer,
    requestDetail,
    saveServer,
    updateServerDeck,
    renameServerDeck,
    deleteServerDeck,
    cacheDeck,
  };
}
