// Full DeckManagerModal.tsx — improved tether clamping and sizing, preserve previous functionality.
// Key changes: expose optional onUseSavedDeck prop so a parent (TableLayout) can intercept and confirm before executing.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { socket } from '../socket';
import type { SavedDeckSummary, SavedDeckDetail, DeckFolder } from '../../../shared/src/decks';
import type { GameID } from '../../../shared/src/types';
import { PreconBrowser } from './PreconBrowser';
import { useIsTouch } from '../hooks/useIsTouch';
import { colors, fontSize, radii, safeArea, spacing, touch, z } from '../theme';
import {
  deleteServerDeckViaApi,
  fetchServerDeckDetail,
  fetchServerDeckSummaries,
  renameServerDeckViaApi,
  saveServerDeckViaApi,
  updateServerDeckViaApi,
} from '../utils/serverDeckApi';
import {
  describeRandomDeckSource,
  executeRandomDeckPick,
} from '../utils/randomDeckSelection';
import {
  createLocalDeckId,
  loadLocalSavedDecks,
  saveLocalSavedDecks,
} from '../utils/localDeckStorage';

type SavedLocalDeck = { id: string; name: string; text: string; savedAt: number };

export interface DeckManagerModalProps {
  open: boolean;
  onClose: () => void;
  onImportText: (text: string, name?: string, cacheCards?: boolean) => void;
  gameId?: GameID;
  playerId?: string;
  playerName?: string;
  canServer?: boolean;
  anchorEl?: HTMLElement | null; // button to tether under
  wide?: boolean;
  // optional hook: when user clicks "Use" on a server deck, call this instead of emitting directly.
  // Parent can show a confirm modal first and then call socket.emit('useSavedDeck', ...) or onImportText accordingly.
  onUseSavedDeck?: (deckId: string) => void;
  /** When set, runs once after the modal opens (e.g. mobile "Random Deck" shortcut). */
  initialAction?: 'random' | null;
  onInitialActionConsumed?: () => void;
}

export function DeckManagerModal({
  open,
  onClose,
  onImportText,
  gameId,
  playerId,
  playerName,
  canServer,
  anchorEl,
  wide,
  onUseSavedDeck,
  initialAction,
  onInitialActionConsumed,
}: DeckManagerModalProps) {
  const isTouch = useIsTouch();
  const useSheet = isTouch;
  const [tab, setTab] = useState<'local' | 'server' | 'preview' | 'precons'>('local');

  // Local input
  const [localList, setLocalList] = useState<SavedLocalDeck[]>([]);
  const [localName, setLocalName] = useState('');
  const [localText, setLocalText] = useState('');
  const [localFilter, setLocalFilter] = useState('');
  const [localErr, setLocalErr] = useState<string | null>(null);
  const [alsoSaveToServer, setAlsoSaveToServer] = useState(false);
  const [cacheCards, setCacheCards] = useState(true);
  const [cachingDeckId, setCachingDeckId] = useState<string | null>(null);
  const [randomDeckMessage, setRandomDeckMessage] = useState<string | null>(null);
  const [pickingRandomDeck, setPickingRandomDeck] = useState(false);

  // Server decks
  const [serverDecks, setServerDecks] = useState<SavedDeckSummary[]>([]);
  const [serverFilter, setServerFilter] = useState('');
  const [detail, setDetail] = useState<SavedDeckDetail | null>(null);
  const [serverErr, setServerErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [updatingServer, setUpdatingServer] = useState(false);
  const [editingLocalId, setEditingLocalId] = useState<string | null>(null);
  const [editingServerDeckId, setEditingServerDeckId] = useState<string | null>(null);
  const [pendingServerEditId, setPendingServerEditId] = useState<string | null>(null);
  const pendingServerEditIdRef = useRef<string | null>(null);
  pendingServerEditIdRef.current = pendingServerEditId;

  const isLocalClient = typeof window !== 'undefined'
    && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');

  const useRestServer = !!(canServer && !gameId);

  const canEditServerDeck = (deck: SavedDeckSummary) =>
    isLocalClient || (!!playerId && deck.created_by_id === playerId);

  const clearEditMode = () => {
    setEditingLocalId(null);
    setEditingServerDeckId(null);
    setPendingServerEditId(null);
  };

  // Folder navigation
  const [folders, setFolders] = useState<DeckFolder[]>([]);
  const [currentFolder, setCurrentFolder] = useState<string>('');
  const [newFolderName, setNewFolderName] = useState('');
  const [showFolderInput, setShowFolderInput] = useState(false);
  const [selectedFolder, setSelectedFolder] = useState<string>('');

  // Tether position
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const rafRef = useRef<number | null>(null);

  const refreshRestServerDecks = React.useCallback(async () => {
    try {
      const decks = await fetchServerDeckSummaries();
      setServerDecks(decks);
      setServerErr(null);
    } catch (err) {
      setServerErr(err instanceof Error ? err.message : 'Failed to load server decks');
    }
  }, []);

  const applyServerDeckDetail = (deck: SavedDeckDetail) => {
    const pendingEditId = pendingServerEditIdRef.current;
    if (pendingEditId && deck.id === pendingEditId) {
      setLocalName(deck.name);
      setLocalText(deck.text);
      setEditingServerDeckId(deck.id);
      setEditingLocalId(null);
      setPendingServerEditId(null);
      setLocalErr(null);
      setServerErr(null);
      setTab('local');
      setDetail(deck);
      return;
    }
    setDetail(deck);
    setTab('preview');
  };

  // Init
  useEffect(() => {
    if (!open) return;
    setRandomDeckMessage(null);
    setLocalList(loadLocalSavedDecks());
    if (canServer && gameId) socket.emit('listSavedDecks', { gameId });
    if (useRestServer) void refreshRestServerDecks();
  }, [open, canServer, gameId, useRestServer, refreshRestServerDecks]);

  // Socket listeners
  useEffect(() => {
    if (!open) return;
    const onList = ({ decks, folders: folderTree }: { decks: SavedDeckSummary[]; folders?: DeckFolder[] }) => {
      setServerDecks(decks);
      if (folderTree) setFolders(folderTree);
    };
    const onDetail = ({ deck }: { deck: SavedDeckDetail }) => {
      applyServerDeckDetail(deck);
    };
    const onSaved = () => { setSaving(false); gameId && socket.emit('listSavedDecks', { gameId }); };
    const onUpdated = () => {
      setUpdatingServer(false);
      clearEditMode();
      setLocalName('');
      setLocalText('');
      gameId && socket.emit('listSavedDecks', { gameId });
    };
    const onRenamed = ({ deck }: { deck: SavedDeckSummary }) =>
      setServerDecks(prev => prev.map(d => (d.id === deck.id ? deck : d)));
    const onDeleted = ({ deckId }: { deckId: string }) => {
      setServerDecks(prev => prev.filter(d => d.id !== deckId));
      if (detail?.id === deckId) setDetail(null);
    };
    const onError = ({ message }: { message: string }) => {
      setServerErr(message);
      // Clear caching state on error
      setCachingDeckId(null);
    };
    const onCached = ({ deckId }: { deckId: string }) => {
      setCachingDeckId(null);
      // Refresh the deck list to show updated cache status
      if (gameId) socket.emit('listSavedDecks', { gameId });
    };
    const onMoved = () => {
      // Refresh the deck list after moving
      if (gameId) socket.emit('listSavedDecks', { gameId });
    };

    socket.on('savedDecksList', onList);
    socket.on('savedDeckDetail', onDetail);
    socket.on('deckSaved', onSaved);
    socket.on('deckUpdated', onUpdated);
    socket.on('deckRenamed', onRenamed);
    socket.on('deckDeleted', onDeleted);
    socket.on('deckError', onError);
    socket.on('deckCached', onCached);
    socket.on('deckMoved', onMoved);

    return () => {
      socket.off('savedDecksList', onList);
      socket.off('savedDeckDetail', onDetail);
      socket.off('deckSaved', onSaved);
      socket.off('deckUpdated', onUpdated);
      socket.off('deckRenamed', onRenamed);
      socket.off('deckDeleted', onDeleted);
      socket.off('deckError', onError);
      socket.off('deckCached', onCached);
      socket.off('deckMoved', onMoved);
    };
  }, [open, gameId, detail]);

  // compute modal width clamped to viewport with a min width to avoid "skinny" layout
  const calcWidth = () => {
    const desired = wide ? 960 : 880;
    const max = Math.max(480, window.innerWidth - 32);
    return Math.min(desired, max);
  };
  const modalWidth = calcWidth();

  // Follow anchor element each frame and clamp to viewport (consider modalWidth so it doesn't go off-screen).
  // On touch devices we use a full-width bottom sheet instead of tethering.
  useEffect(() => {
    if (!open || !anchorEl || useSheet) {
      setPos(null);
      if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
      return;
    }
    const update = () => {
      try {
        const r = anchorEl.getBoundingClientRect();
        const leftRaw = r.left + r.width / 2;
        // place just below anchor; clamp so modal doesn't escape viewport (consider modal width)
        let topRaw = r.bottom + 8;
        const margin = 12;
        const halfModal = modalWidth / 2;
        const left = Math.min(Math.max(leftRaw, margin + halfModal), window.innerWidth - margin - halfModal);
        const top = Math.min(Math.max(topRaw, margin), window.innerHeight - margin);
        setPos({ left, top });
      } finally {
        rafRef.current = requestAnimationFrame(update);
      }
    };
    rafRef.current = requestAnimationFrame(update);
    const onResize = () => {
      const r = anchorEl.getBoundingClientRect();
      const leftRaw = r.left + r.width / 2;
      let topRaw = r.bottom + 8;
      const margin = 12;
      const halfModal = modalWidth / 2;
      const left = Math.min(Math.max(leftRaw, margin + halfModal), window.innerWidth - margin - halfModal);
      const top = Math.min(Math.max(topRaw, margin), window.innerHeight - margin);
      setPos({ left, top });
    };
    window.addEventListener('resize', onResize);
    return () => {
      if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
      window.removeEventListener('resize', onResize);
    };
  }, [open, anchorEl, modalWidth, useSheet]);

  const stackColumns = useSheet ? '1fr' : '1fr 1fr';

  const tabButtonStyle = (active: boolean, accent?: string): React.CSSProperties => ({
    flex: useSheet ? 1 : undefined,
    minHeight: useSheet ? touch.minHitTarget : undefined,
    padding: useSheet ? `${spacing.sm}px ${spacing.md}px` : '4px 10px',
    fontSize: fontSize.sm,
    fontWeight: active ? 600 : 500,
    borderRadius: radii.md,
    border: `1px solid ${active ? (accent || colors.accent) : colors.borderSubtle}`,
    background: active ? (accent ? `${accent}33` : colors.accentSoft) : colors.surfaceTransparent,
    color: active ? colors.textPrimary : colors.textSecondary,
    cursor: active ? 'default' : 'pointer',
  });

  const actionButtonStyle: React.CSSProperties = useSheet
    ? { minHeight: touch.minHitTarget, padding: `${spacing.sm}px ${spacing.md}px`, fontSize: fontSize.sm }
    : { fontSize: 11 };

  const filteredLocal = useMemo(() => {
    const q = localFilter.trim().toLowerCase();
    if (!q) return localList.slice().sort((a, b) => b.savedAt - a.savedAt);
    return localList.filter(d => d.name.toLowerCase().includes(q)).sort((a, b) => b.savedAt - a.savedAt);
  }, [localList, localFilter]);

  const filteredServer = useMemo(() => {
    const q = serverFilter.trim().toLowerCase();
    if (!q) return serverDecks;
    return serverDecks.filter(d => d.name.toLowerCase().includes(q));
  }, [serverDecks, serverFilter]);

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

  if (!open) return null;

  const stopBubble = (e: React.MouseEvent) => {
    e.stopPropagation();
  };

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
      setLocalErr(null);
      return;
    }
    const deck: SavedLocalDeck = { id: createLocalDeckId('l'), name: localName.trim(), text: localText, savedAt: Date.now() };
    const next = [deck, ...localList].slice(0, 200);
    saveLocalSavedDecks(next);
    setLocalList(next);
    setLocalName('');
    setLocalText('');
    setLocalErr(null);
  };

  const beginEditLocal = (deck: SavedLocalDeck) => {
    setLocalName(deck.name);
    setLocalText(deck.text);
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
    if (!canServer) return;
    if (gameId) {
      socket.emit('saveDeck', { gameId, name, list: text, cacheCards });
      return;
    }
    if (!useRestServer) return;
    setSaving(true);
    try {
      await saveServerDeckViaApi({
        name,
        text,
        playerId,
        playerName,
        cacheCards,
      });
      await refreshRestServerDecks();
      setServerErr(null);
    } catch (err) {
      setServerErr(err instanceof Error ? err.message : 'Failed to save deck');
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
    if (!canServer) return;
    if (!localText.trim() || !localName.trim()) { setServerErr('Name & text required'); return; }
    if (gameId) {
      setSaving(true);
      socket.emit('saveDeck', { gameId, name: localName.trim(), list: localText, cacheCards });
      return;
    }
    if (!useRestServer) {
      setServerErr('Join a game or use localhost to save server decks.');
      return;
    }
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
          playerId,
          cacheCards,
        });
        clearEditMode();
        setLocalName('');
        setLocalText('');
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

  const backdropStyle: React.CSSProperties = {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0,0,0,0.55)',
    zIndex: z.modalBackdrop,
    display: useSheet ? 'flex' : 'block',
    alignItems: useSheet ? 'flex-end' : undefined,
    justifyContent: useSheet ? 'center' : undefined,
  };

  const wrapperStyle: React.CSSProperties = useSheet
    ? {
        position: 'relative',
        width: '100%',
        zIndex: z.modal,
        pointerEvents: 'auto',
      }
    : pos
      ? {
          position: 'fixed',
          left: pos.left,
          top: pos.top,
          transform: 'translate(-50%, 8px)',
          zIndex: z.modal,
          pointerEvents: 'auto',
        }
      : {
          position: 'fixed',
          left: '50%',
          top: '50%',
          transform: 'translate(-50%, -50%)',
          zIndex: z.modal,
        };

  const modalStyle: React.CSSProperties = useSheet
    ? {
        background: colors.surfaceRaised,
        borderTop: `1px solid ${colors.border}`,
        borderTopLeftRadius: radii.xl,
        borderTopRightRadius: radii.xl,
        padding: `${spacing.md}px ${spacing.lg}px`,
        paddingBottom: `calc(${spacing.md}px + ${safeArea.bottom})`,
        width: '100%',
        maxHeight: '92vh',
        overflow: 'auto',
        boxShadow: '0 -8px 32px rgba(0,0,0,0.55)',
        color: colors.textPrimary,
        display: 'flex',
        flexDirection: 'column',
      }
    : {
        background: '#202225',
        border: '1px solid #444',
        borderRadius: 8,
        padding: '14px 16px',
        width: modalWidth,
        minWidth: 480,
        maxWidth: '96vw',
        maxHeight: '80vh',
        overflow: 'auto',
        boxShadow: '0 4px 18px rgba(0,0,0,0.65)',
        color: '#eee',
      };

  const content = (
    <div
      style={backdropStyle}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        style={wrapperStyle}
        onClick={stopBubble}
      >
        <div
          style={modalStyle}
          onClick={stopBubble}
        >
          {useSheet && (
            <div
              aria-hidden="true"
              style={{
                alignSelf: 'center',
                width: 36,
                height: 4,
                borderRadius: radii.pill,
                background: colors.borderStrong,
                marginBottom: spacing.sm,
              }}
            />
          )}

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, gap: 8, flexWrap: 'wrap' }}>
            <h4 style={{ margin: 0, fontSize: useSheet ? fontSize.xl : 15 }}>Deck Manager</h4>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button
                type="button"
                onClick={handleRandomDeck}
                disabled={pickingRandomDeck}
                style={{
                  ...actionButtonStyle,
                  border: '1px solid #a78bfa',
                  background: 'rgba(124, 58, 237, 0.18)',
                  color: '#ede9fe',
                  fontWeight: 600,
                }}
                title="Pick a random deck from local saves, server decks, or precons"
              >
                {pickingRandomDeck ? 'Rolling…' : '🎲 Random Deck'}
              </button>
              <button type="button" onClick={onClose} style={actionButtonStyle}>Close</button>
            </div>
          </div>

          {randomDeckMessage && (
            <div style={{ marginBottom: 8, fontSize: 12, color: '#c4b5fd' }}>{randomDeckMessage}</div>
          )}

          <div style={{ display: 'flex', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
            <button type="button" onClick={() => { setTab('local'); setDetail(null); }} disabled={tab === 'local'} style={tabButtonStyle(tab === 'local')}>Local</button>
            {canServer && (
              <button type="button" onClick={() => { setTab('server'); setDetail(null); }} disabled={tab === 'server'} style={tabButtonStyle(tab === 'server')}>
                Server
              </button>
            )}
            <button type="button" onClick={() => { setTab('precons'); setDetail(null); }} disabled={tab === 'precons'} style={tabButtonStyle(tab === 'precons', '#22c55e')}>
              📦 Precons
            </button>
            {detail && (
              <button type="button" onClick={() => setTab('preview')} disabled={tab === 'preview'} style={tabButtonStyle(tab === 'preview')}>
                Preview
              </button>
            )}
          </div>

          {tab === 'local' && (
            <div style={{ display: 'grid', gridTemplateColumns: stackColumns, gap: 16 }}>
              <div>
                {(editingLocalId || editingServerDeckId) && (
                  <div style={{ fontSize: 12, marginBottom: 6, color: '#fbbf24' }}>
                    Editing {editingServerDeckId ? 'server' : 'local'} deck
                    <button
                      type="button"
                      onClick={() => {
                        clearEditMode();
                        setLocalName('');
                        setLocalText('');
                      }}
                      style={{ ...actionButtonStyle, marginLeft: 8 }}
                    >
                      Cancel edit
                    </button>
                  </div>
                )}
                <div style={{ fontSize: 12, marginBottom: 6 }}>Paste decklist</div>
                <textarea
                  value={localText}
                  onChange={e => setLocalText(e.target.value)}
                  placeholder="e.g. 4 Lightning Bolt"
                  style={{ width: '100%', height: 180, resize: 'vertical', fontSize: 12 }}
                />
                <input
                  value={localName}
                  onChange={e => setLocalName(e.target.value)}
                  placeholder="Name"
                  style={{ width: '100%', marginTop: 8 }}
                />
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
                  <input id="cache-cards" type="checkbox" checked={cacheCards} onChange={e => setCacheCards(e.target.checked)} />
                  <label htmlFor="cache-cards" style={{ fontSize: 12, color: '#ddd' }}>Cache card data (faster loading next time)</label>
                </div>
                <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                  <input
                    type="file"
                    accept=".txt,text/plain"
                    onChange={async e => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      const content = await file.text();
                      setLocalText(content);
                    }}
                  />
                  <button type="button" onClick={importPastedText} disabled={!localText.trim()} style={actionButtonStyle}>
                    Import Deck
                  </button>
                  <button type="button" onClick={saveLocal} disabled={!localText.trim() || !localName.trim()} style={actionButtonStyle}>
                    {editingLocalId ? 'Save Changes' : 'Save Locally'}
                  </button>
                  {canServer && editingServerDeckId && (
                    <button
                      type="button"
                      onClick={updateServerDeck}
                      disabled={!localText.trim() || !localName.trim() || updatingServer}
                      style={actionButtonStyle}
                    >
                      {updatingServer ? 'Saving…' : 'Save Server Changes'}
                    </button>
                  )}
                  {canServer && !editingServerDeckId && (
                    <button type="button" onClick={saveServer} disabled={!localText.trim() || !localName.trim() || saving} style={actionButtonStyle}>
                      {saving ? 'Saving…' : 'Save to Server'}
                    </button>
                  )}
                </div>
                {localErr && <div style={{ marginTop: 6, fontSize: 11, color: '#f87171' }}>{localErr}</div>}
              </div>
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                  <span style={{ fontSize: 12 }}>Local Decks ({localList.length})</span>
                  <input value={localFilter} onChange={e => setLocalFilter(e.target.value)} placeholder="Filter" style={{ width: 140 }} />
                </div>
                <div style={{ border: '1px solid #333', borderRadius: 6, padding: 6, maxHeight: 320, overflowY: 'auto', background: '#111' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                    <input id="save-to-server" type="checkbox" checked={alsoSaveToServer} onChange={e => setAlsoSaveToServer(e.target.checked)} />
                    <label htmlFor="save-to-server" style={{ fontSize: 12, color: '#ddd' }}>Also save to server when importing</label>
                  </div>
                  {filteredLocal.length === 0 && <div style={{ fontSize: 12, color: '#888' }}>No decks</div>}
                  {filteredLocal.map(d => (
                    <div key={d.id} style={{ borderBottom: '1px solid #222', padding: '6px 4px', display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
                      <div style={{ minWidth: 0, flex: '1 1 140px' }}>
                        <div style={{ fontSize: 12, color: '#eee', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{d.name}</div>
                        <div style={{ fontSize: 10, color: '#999' }}>{new Date(d.savedAt).toLocaleString()}</div>
                      </div>
                      <button type="button" onClick={() => importLocal(d)} style={actionButtonStyle}>Import</button>
                      <button type="button" onClick={() => beginEditLocal(d)} style={actionButtonStyle}>Edit</button>
                      <button
                        type="button"
                        onClick={() => {
                          if (!confirm(`Delete local deck "${d.name}"?`)) return;
                          const next = localList.filter(x => x.id !== d.id);
                          saveLocalSavedDecks(next);
                          setLocalList(next);
                          if (editingLocalId === d.id) clearEditMode();
                        }}
                        style={{ ...actionButtonStyle, color: '#f87171' }}
                      >
                        Delete
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {tab === 'server' && (
            <div style={{ display: 'grid', gridTemplateColumns: stackColumns, gap: 16 }}>
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6, gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 12 }}>Server Decks ({serverDecks.length})</span>
                  <input value={serverFilter} onChange={e => setServerFilter(e.target.value)} placeholder="Filter" style={{ width: useSheet ? '100%' : 140 }} />
                </div>
                <div style={{ border: '1px solid #333', borderRadius: 6, padding: 6, maxHeight: useSheet ? 280 : 320, overflowY: 'auto', background: '#111' }}>
                  {filteredServer.length === 0 && <div style={{ fontSize: 12, color: '#888' }}>None</div>}
                  {filteredServer.map(d => (
                    <div
                      key={d.id}
                      style={{
                        borderBottom: '1px solid #222',
                        padding: '8px 4px',
                        display: useSheet ? 'flex' : 'grid',
                        flexDirection: useSheet ? 'column' : undefined,
                        gridTemplateColumns: useSheet ? undefined : '1fr auto auto auto auto auto',
                        gap: useSheet ? 8 : 6,
                        alignItems: useSheet ? 'stretch' : 'center',
                      }}
                    >
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 12, color: '#eee', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', display: 'flex', alignItems: 'center', gap: 4 }}>
                          {d.name}
                          {d.has_cached_cards && (
                            <span title="Card data cached - faster loading" style={{ fontSize: 10, color: '#4ade80', marginLeft: 4 }}>⚡</span>
                          )}
                        </div>
                        <div style={{ fontSize: 10, color: '#999' }}>
                          {new Date(d.created_at).toLocaleDateString()} • {d.created_by_name} • {d.card_count} cards
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        <button type="button" onClick={() => requestDetail(d.id)} style={actionButtonStyle}>View</button>
                        <button type="button" onClick={() => importServer(d.id)} style={actionButtonStyle}>Use</button>
                        {canEditServerDeck(d) && (
                          <button type="button" onClick={() => beginEditServer(d.id)} style={actionButtonStyle}>Edit</button>
                        )}
                        {!d.has_cached_cards && !useRestServer && (
                          <button
                            type="button"
                            onClick={() => cacheDeck(d.id)}
                            disabled={cachingDeckId === d.id}
                            style={{ ...actionButtonStyle, color: '#fbbf24' }}
                            title="Cache card data for faster loading"
                          >
                            {cachingDeckId === d.id ? '…' : 'Cache'}
                          </button>
                        )}
                        {canEditServerDeck(d) && (
                          <>
                            <button
                              type="button"
                              onClick={() => renameServerDeck(d)}
                              style={actionButtonStyle}
                            >
                              Rename
                            </button>
                            <button
                              type="button"
                              onClick={() => deleteServerDeck(d)}
                              style={{ ...actionButtonStyle, color: '#f87171' }}
                            >
                              Delete
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
                {serverErr && <div style={{ marginTop: 8, fontSize: 11, color: '#f87171' }}>{serverErr}</div>}
              </div>
              <div>
                <div style={{ fontSize: 12, marginBottom: 6 }}>Save current pasted deck (from Local tab)</div>
                <textarea
                  value={localText}
                  onChange={e => setLocalText(e.target.value)}
                  placeholder="Paste list, switch name below"
                  style={{ width: '100%', height: 180, resize: 'vertical', fontSize: 12 }}
                />
                <input
                  value={localName}
                  onChange={e => setLocalName(e.target.value)}
                  placeholder="Name"
                  style={{ width: '100%', marginTop: 8 }}
                />
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
                  <input id="cache-cards-server" type="checkbox" checked={cacheCards} onChange={e => setCacheCards(e.target.checked)} />
                  <label htmlFor="cache-cards-server" style={{ fontSize: 12, color: '#ddd' }}>Cache card data</label>
                </div>
                <button
                  type="button"
                  onClick={saveServer}
                  disabled={!localText.trim() || !localName.trim() || saving}
                  style={{ marginTop: 8, ...actionButtonStyle }}
                >
                  {saving ? 'Saving…' : 'Save to Server'}
                </button>
              </div>
            </div>
          )}

          {tab === 'preview' && detail && (
            <div>
              <h5 style={{ margin: '4px 0', fontSize: 14 }}>
                {detail.name}
                {detail.has_cached_cards && (
                  <span title="Card data cached" style={{ fontSize: 10, color: '#4ade80', marginLeft: 6 }}>⚡ Cached</span>
                )}
              </h5>
              <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 6 }}>
                By {detail.created_by_name} • {new Date(detail.created_at).toLocaleString()} • {detail.card_count} cards
              </div>
              <div style={{ maxHeight: 360, overflowY: 'auto', border: '1px solid #333', padding: 8, borderRadius: 6, background: '#111' }}>
                <pre style={{ fontSize: 11, lineHeight: '14px', whiteSpace: 'pre-wrap' }}>{detail.text}</pre>
              </div>
              <div style={{ marginTop: 8, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button type="button" onClick={() => importServer(detail.id)} style={actionButtonStyle}>Use This Deck</button>
                {canEditServerDeck(detail) && (
                  <button type="button" onClick={() => beginEditServer(detail.id)} style={actionButtonStyle}>Edit Deck</button>
                )}
                <button type="button" onClick={() => setTab('server')} style={actionButtonStyle}>Back</button>
              </div>
            </div>
          )}

          {tab === 'precons' && (
            <PreconBrowser
              onSelectDeck={(commanders, deckName, setName, year, setCode, colorIdentity) => {
                importPreconDeck(commanders, deckName, setName, year, setCode, colorIdentity);
              }}
            />
          )}
        </div>
      </div>
    </div>
  );

  return createPortal(content, document.body);
}

export default DeckManagerModal;