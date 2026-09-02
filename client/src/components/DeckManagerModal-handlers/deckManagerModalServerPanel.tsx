// Origin parent: client/src/components/DeckManagerModal.tsx
// Cluster moved: server source list + save-current-paste panel.
// Public entry symbols: renderDeckManagerModalServerPanel.

import React from 'react';
import { DeckListTextarea } from '../DeckListTextarea';
import { DeckResolvePreviewPanel } from '../DeckResolvePreviewPanel';
import { DeckVisibilitySelect, VisibilityBadge } from './deckManagerModalAccountUi';

export function renderDeckManagerModalServerPanel(p: Record<string, any>) {
  const {
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
  } = p;
  return (
            <div style={{ display: 'grid', gridTemplateColumns: stackColumns, gap: 16 }}>
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6, gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 12 }}>{serverScope === 'mine' ? 'My server decks' : 'Public decks'} ({filteredServer.length})</span>
                  <input value={serverFilter} onChange={e => setServerFilter(e.target.value)} placeholder="Filter" style={{ width: useSheet ? '100%' : 140 }} />
                </div>
                <div style={{ border: '1px solid #333', borderRadius: 6, padding: 6, maxHeight: useSheet ? 280 : 320, overflowY: 'auto', background: '#111' }}>
                  {filteredServer.length === 0 && (
                    <div style={{ fontSize: 12, color: '#9ca3af' }}>
                      {serverScope === 'mine' && !accountUser
                        ? 'Log in to see your server decks.'
                        : 'None'}
                    </div>
                  )}
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
                          <VisibilityBadge visibility={d.visibility} />
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
                        {canEditServerDeck(d) && !d.has_cached_cards && !useRestServer && (
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
                    placeholder="Paste list, switch name below"
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
                  <input id="cache-cards-server" type="checkbox" checked={cacheCards} onChange={e => setCacheCards(e.target.checked)} />
                  <label htmlFor="cache-cards-server" style={{ fontSize: 12, color: '#ddd' }}>Cache card data</label>
                </div>
                {accountUser ? (
                  <div>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8 }}>
                      <span style={{ fontSize: 12 }}>Visibility</span>
                      <DeckVisibilitySelect value={saveVisibility} onChange={setSaveVisibility} />
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
                ) : (
                  <div style={{ marginTop: 8, fontSize: 12, color: '#9ca3af' }}>Log in to save server decks.</div>
                )}
              </div>
            </div>
  );
}
