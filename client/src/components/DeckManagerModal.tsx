// Full DeckManagerModal.tsx — improved tether clamping and sizing, preserve previous functionality.
// Key changes: expose optional onUseSavedDeck prop so a parent (TableLayout) can intercept and confirm before executing.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { socket } from '../socket';
import { toast } from './ToastHost';
import type { SavedDeckSummary, SavedDeckDetail, DeckFolder } from '../../../shared/src/decks';
import type { GameID } from '../../../shared/src/types';
import { PreconBrowser } from './PreconBrowser';
import { useIsTouch } from '../hooks/useIsTouch';
import { colors, fontSize, radii, safeArea, spacing, touch, z } from '../theme';
import { fetchMyServerDeckSummaries, fetchServerDeckSummaries } from '../utils/serverDeckApi';
import type { AuthUser } from '../utils/authApi';
import { canMutateDeck } from '../utils/deckAccess';
import { DeckVisibilitySelect, VisibilityBadge } from './DeckManagerModal-handlers/deckManagerModalAccountUi';
import {
  loadLocalSavedDecks,
  saveLocalSavedDecks,
} from '../utils/localDeckStorage';
import { DeckResolvePreviewPanel } from './DeckResolvePreviewPanel';
import { DeckListTextarea } from './DeckListTextarea';
import { useDeckResolvePreview } from '../hooks/useDeckResolvePreview';
import { useDeckManagerModalRandomImportHandlers } from './DeckManagerModal-handlers/deckManagerModalRandomImportHandlers';
import { createDeckManagerModalSaveCacheHandlers } from './DeckManagerModal-handlers/deckManagerModalSaveCacheHandlers';
import { renderDeckManagerModalServerPanel } from './DeckManagerModal-handlers/deckManagerModalServerPanel';

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
  accountUser?: AuthUser | null;
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
  accountUser,
}: DeckManagerModalProps) {
  const isTouch = useIsTouch();
  const useSheet = isTouch;
  const [tab, setTab] = useState<'local' | 'server' | 'preview' | 'precons'>('local');
  const [serverScope, setServerScope] = useState<'mine' | 'public'>('public');
  const [saveVisibility, setSaveVisibility] = useState<'public' | 'private'>('private');

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

  const {
    cards: resolvedPreviewCards,
    unresolvedLines: unresolvedPreviewLines,
    unresolvedLineNumbers: unresolvedPreviewLineNumbers,
    resolvedCopies: resolvedPreviewCopies,
    totalCopies: totalPreviewCopies,
    focusCardKey: resolvedFocusCardKey,
    focusToken: resolvedFocusToken,
    clearPreview,
    syncPreviewToText,
    resolveAllFromText,
    onTextareaKeyDown,
    onTextareaPaste,
  } = useDeckResolvePreview();

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

  const useRestServer = !!(canServer && !gameId);

  const canEditServerDeck = (deck: SavedDeckSummary) => canMutateDeck(deck, accountUser);

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
      if (serverScope === 'mine') {
        if (!accountUser) {
          setServerDecks([]);
          setServerErr(null);
          return;
        }
        const decks = await fetchMyServerDeckSummaries();
        setServerDecks(decks);
      } else {
        const decks = await fetchServerDeckSummaries();
        setServerDecks(decks);
      }
      setServerErr(null);
    } catch (err) {
      const raw = err instanceof Error ? err.message : 'Failed to load server decks';
      const isAuth = /log in|unauthorized|\b401\b/i.test(raw);
      setServerDecks([]);
      setServerErr(isAuth ? 'Log in to see your server decks.' : raw);
    }
  }, [accountUser, serverScope]);

  const applyServerDeckDetail = (deck: SavedDeckDetail) => {
    const pendingEditId = pendingServerEditIdRef.current;
    if (pendingEditId && deck.id === pendingEditId) {
      setLocalName(deck.name);
      setLocalText(deck.text);
      void resolveAllFromText(deck.text);
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
    if (!open) {
      clearPreview();
      return;
    }
    setRandomDeckMessage(null);
    setLocalList(loadLocalSavedDecks());
    if (canServer && gameId) socket.emit('listSavedDecks', { gameId });
    if (useRestServer) void refreshRestServerDecks();
  }, [open, canServer, gameId, useRestServer, refreshRestServerDecks, clearPreview, serverScope, accountUser]);

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
    const onSaved = () => {
      setSaving(false);
      setServerErr(null);
      toast.success('Deck saved to the server.');
      gameId && socket.emit('listSavedDecks', { gameId });
    };
    const onUpdated = () => {
      setUpdatingServer(false);
      toast.success('Deck updated on the server.');
      clearEditMode();
      setLocalName('');
      setLocalText('');
      clearPreview();
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
      // Clear busy states on error so buttons never stick on "Saving..."
      setSaving(false);
      setUpdatingServer(false);
      setCachingDeckId(null);
      toast.error(message || 'Deck request failed.');
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
    const hasPreview = resolvedPreviewCards.length > 0 || totalPreviewCopies > 0;
    const desired = wide
      ? (hasPreview ? 1100 : 960)
      : (hasPreview ? 1040 : 880);
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
  // Match the saved-decks list height so the paste editor fills the left column.
  const deckEditorHeight = useSheet ? 220 : 320;

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
    let list = serverDecks;
    if (serverScope === 'mine') {
      list = accountUser ? list.filter(d => d.created_by_id === accountUser.id) : [];
    } else if (!accountUser?.isAdmin) {
      list = list.filter(d => (d.visibility || 'public') !== 'private');
    }
    if (!q) return list;
    return list.filter(d => d.name.toLowerCase().includes(q));
  }, [serverDecks, serverFilter, serverScope, accountUser]);

  const { importPreconDeck, handleRandomDeck } = useDeckManagerModalRandomImportHandlers({
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
  });

  if (!open) return null;

  const stopBubble = (e: React.MouseEvent) => {
    e.stopPropagation();
  };

  const {
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
  } = createDeckManagerModalSaveCacheHandlers({
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
    accountUserId: accountUser?.id,
  });

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
              <>
                <button type="button" onClick={() => { setTab('server'); setServerScope('mine'); setDetail(null); }} disabled={tab === 'server' && serverScope === 'mine'} style={tabButtonStyle(tab === 'server' && serverScope === 'mine')}>
                  My server decks
                </button>
                <button type="button" onClick={() => { setTab('server'); setServerScope('public'); setDetail(null); }} disabled={tab === 'server' && serverScope === 'public'} style={tabButtonStyle(tab === 'server' && serverScope === 'public')}>
                  Public decks
                </button>
              </>
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
                        clearPreview();
                      }}
                      style={{ ...actionButtonStyle, marginLeft: 8 }}
                    >
                      Cancel edit
                    </button>
                  </div>
                )}
                <div style={{ fontSize: 12, marginBottom: 6 }}>
                  Paste decklist
                  <span style={{ opacity: 0.65, marginLeft: 6 }}>(Enter resolves the finished line)</span>
                </div>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: useSheet
                      ? '1fr'
                      : (resolvedPreviewCards.length > 0 || totalPreviewCopies > 0
                        ? 'minmax(0, 1fr) 200px'
                        : '1fr'),
                    gap: 10,
                    alignItems: 'stretch',
                    height: useSheet ? undefined : deckEditorHeight,
                    minHeight: useSheet ? undefined : deckEditorHeight,
                  }}
                >
                  <DeckListTextarea
                    value={localText}
                    onChange={(next) => {
                      setLocalText(next);
                      syncPreviewToText(next);
                    }}
                    onKeyDown={(e) => onTextareaKeyDown(e, localText)}
                    onPaste={(e) => onTextareaPaste(e, localText)}
                    placeholder="e.g. 1 Sol Ring"
                    unresolvedLineNumbers={unresolvedPreviewLineNumbers}
                    style={{
                      height: useSheet ? 180 : '100%',
                      minHeight: useSheet ? 180 : 0,
                      resize: useSheet ? 'vertical' : 'none',
                    }}
                  />
                  <DeckResolvePreviewPanel
                    cards={resolvedPreviewCards}
                    compact={useSheet}
                    fillHeight={!useSheet}
                    focusCardKey={resolvedFocusCardKey}
                    focusToken={resolvedFocusToken}
                    resolvedCopies={resolvedPreviewCopies}
                    totalCopies={totalPreviewCopies}
                  />
                </div>
                {unresolvedPreviewLines.length > 0 && (
                  <div
                    style={{
                      marginTop: 8,
                      padding: '8px 10px',
                      borderRadius: 6,
                      border: '1px solid rgba(248, 113, 113, 0.45)',
                      background: 'rgba(127, 29, 29, 0.25)',
                      color: '#fecaca',
                      fontSize: 12,
                      lineHeight: 1.4,
                    }}
                  >
                    <div style={{ fontWeight: 600, marginBottom: 4 }}>
                      Could not resolve {unresolvedPreviewLines.length} line
                      {unresolvedPreviewLines.length === 1 ? '' : 's'}
                    </div>
                    <div style={{ maxHeight: 72, overflowY: 'auto' }}>
                      {unresolvedPreviewLines.slice(0, 12).map((line) => (
                        <div key={`${line.lineNumber}-${line.name}`}>
                          Line {line.lineNumber}: {line.name}
                        </div>
                      ))}
                      {unresolvedPreviewLines.length > 12 && (
                        <div>…and {unresolvedPreviewLines.length - 12} more</div>
                      )}
                    </div>
                  </div>
                )}
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
                      void resolveAllFromText(content);
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
                  {canServer && !editingServerDeckId && accountUser && (
                    <>
                      <DeckVisibilitySelect value={saveVisibility} onChange={setSaveVisibility} />
                    <button type="button" onClick={saveServer} disabled={!localText.trim() || !localName.trim() || saving} style={actionButtonStyle}>
                      {saving ? 'Saving…' : 'Save to Server'}
                    </button>
                    </>
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
                    {accountUser ? (
                      <>
                        <input id="save-to-server" type="checkbox" checked={alsoSaveToServer} onChange={e => setAlsoSaveToServer(e.target.checked)} />
                        <label htmlFor="save-to-server" style={{ fontSize: 12, color: '#ddd' }}>Also save to server when importing</label>
                        <DeckVisibilitySelect value={saveVisibility} onChange={setSaveVisibility} />
                      </>
                    ) : (
                      <span style={{ fontSize: 12, color: '#9ca3af' }}>Log in to save server decks</span>
                    )}
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

          {tab === 'server' && renderDeckManagerModalServerPanel({
            stackColumns,
            serverScope,
            filteredServer,
            useSheet,
            serverFilter,
            setServerFilter,
            requestDetail,
            importServer,
            canEditServerDeck,
            beginEditServer,
            cacheDeck,
            cachingDeckId,
            useRestServer,
            renameServerDeck,
            deleteServerDeck,
            serverErr,
            localName,
            setLocalName,
            localText,
            setLocalText,
            syncPreviewToText,
            onTextareaKeyDown,
            onTextareaPaste,
            unresolvedPreviewLineNumbers,
            resolvedPreviewCards,
            totalPreviewCopies,
            deckEditorHeight,
            resolvedFocusCardKey,
            resolvedFocusToken,
            resolvedPreviewCopies,
            unresolvedPreviewLines,
            cacheCards,
            setCacheCards,
            accountUser,
            saveVisibility,
            setSaveVisibility,
            saveServer,
            saving,
            actionButtonStyle,
          })}
          {tab === 'preview' && detail && (
            <div>
              <h5 style={{ margin: '4px 0', fontSize: 14 }}>
                {detail.name}
                <VisibilityBadge visibility={detail.visibility} />
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