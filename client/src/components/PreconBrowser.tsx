import React, { useState, useMemo } from 'react';
import { COMMANDER_PRECONS, formatColorIdentity, searchPrecons, type PreconDeck, type PreconSet, type PreconYear } from '../../../shared/src/precons';

interface PreconBrowserProps {
  onSelectDeck: (commanders: string[], deckName: string, setName: string, year: number, setCode: string, colorIdentity: string) => void;
  /** Load the baked list into the editor (and the clipboard) for editing. */
  onCopyDecklist?: (commanders: string[], deckName: string, setName: string, year: number, setCode: string, colorIdentity: string) => void;
  /** `${setCode}:${deckName}` while that deck's list is loading. */
  copyingDeckKey?: string | null;
  onClose?: () => void;
}

export function PreconBrowser({ onSelectDeck, onCopyDecklist, copyingDeckKey, onClose }: PreconBrowserProps) {
  const [expandedYears, setExpandedYears] = useState<Set<number>>(new Set());
  const [expandedSets, setExpandedSets] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');

  const toggleYear = (year: number) => {
    setExpandedYears(prev => {
      const next = new Set(prev);
      if (next.has(year)) {
        next.delete(year);
      } else {
        next.add(year);
      }
      return next;
    });
  };

  const toggleSet = (setKey: string) => {
    setExpandedSets(prev => {
      const next = new Set(prev);
      if (next.has(setKey)) {
        next.delete(setKey);
      } else {
        next.add(setKey);
      }
      return next;
    });
  };

  const searchResults = useMemo(() => {
    if (!searchQuery.trim()) return null;
    return searchPrecons(searchQuery.trim());
  }, [searchQuery]);

  const handleDeckSelect = (deck: PreconDeck, set: PreconSet, year: number) => {
    onSelectDeck(deck.commanders, deck.name, set.name, year, set.code, deck.colorIdentity);
  };

  const handleCopyDecklist = (deck: PreconDeck, set: PreconSet, year: number) => {
    onCopyDecklist?.(deck.commanders, deck.name, set.name, year, set.code, deck.colorIdentity);
  };

  const renderDeckActions = (deck: PreconDeck, set: PreconSet, year: number) => {
    const key = `${set.code}:${deck.name}`;
    const copying = copyingDeckKey === key;
    return (
      <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
        {onCopyDecklist && (
          <button
            type="button"
            onClick={() => handleCopyDecklist(deck, set, year)}
            disabled={!!copyingDeckKey}
            title="Copy this precon into the editor so you can edit and save your own version"
            style={{ fontSize: 11, whiteSpace: 'nowrap' }}
          >
            {copying ? 'Copying…' : 'Copy Decklist'}
          </button>
        )}
        <button
          type="button"
          onClick={() => handleDeckSelect(deck, set, year)}
          style={{ fontSize: 11, whiteSpace: 'nowrap' }}
        >
          Import
        </button>
      </div>
    );
  };

  return (
    <div style={containerStyle}>
      <div style={headerStyle}>
        <h4 style={{ margin: 0, fontSize: 14 }}>Commander Precon Decks</h4>
        {onClose && (
          <button type="button" onClick={onClose} style={{ fontSize: 11 }}>Close</button>
        )}
      </div>

      <div style={{ marginBottom: 10 }}>
        <input
          type="text"
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          placeholder="Search by deck name or commander..."
          style={{ width: '100%', padding: '6px 8px', fontSize: 12 }}
        />
      </div>

      {searchResults ? (
        <div style={listContainerStyle}>
          <div style={{ fontSize: 11, color: '#888', marginBottom: 6 }}>
            {searchResults.length} result(s) found
          </div>
          {searchResults.map(({ year, set, deck }) => (
            <div key={`${year}-${set.code}-${deck.name}`} style={searchResultStyle}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, color: '#eee', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span>{deck.name}</span>
                  <span style={{ fontSize: 11 }}>{formatColorIdentity(deck.colorIdentity)}</span>
                </div>
                <div style={{ fontSize: 10, color: '#999' }}>
                  {set.name} ({year}) • {deck.commanders.join(' & ')}
                </div>
              </div>
              {renderDeckActions(deck, set, year)}
            </div>
          ))}
        </div>
      ) : (
        <div style={listContainerStyle}>
          {COMMANDER_PRECONS.map(yearData => (
            <div key={yearData.year}>
              <div
                style={yearHeaderStyle}
                onClick={() => toggleYear(yearData.year)}
              >
                <span style={{ marginRight: 6 }}>{expandedYears.has(yearData.year) ? '▼' : '▶'}</span>
                <span style={{ fontWeight: 600 }}>{yearData.year}</span>
                <span style={{ marginLeft: 'auto', fontSize: 10, color: '#888' }}>
                  {yearData.sets.reduce((sum, s) => sum + s.decks.length, 0)} decks
                </span>
              </div>

              {expandedYears.has(yearData.year) && (
                <div style={{ marginLeft: 12 }}>
                  {yearData.sets.map(set => {
                    const setKey = `${yearData.year}-${set.code}`;
                    return (
                      <div key={setKey}>
                        <div
                          style={setHeaderStyle}
                          onClick={() => toggleSet(setKey)}
                        >
                          <span style={{ marginRight: 6 }}>{expandedSets.has(setKey) ? '▼' : '▶'}</span>
                          <span>{set.name}</span>
                          <span style={{ marginLeft: 6, fontSize: 10, color: '#666' }}>({set.code})</span>
                          <span style={{ marginLeft: 'auto', fontSize: 10, color: '#888' }}>
                            {set.decks.length} decks
                          </span>
                        </div>

                        {expandedSets.has(setKey) && (
                          <div style={{ marginLeft: 16 }}>
                            {set.decks.map(deck => (
                              <div key={deck.name} style={deckItemStyle}>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                  <div style={{ fontSize: 12, color: '#eee', display: 'flex', alignItems: 'center', gap: 6 }}>
                                    <span>{deck.name}</span>
                                    <span style={{ fontSize: 11 }}>{formatColorIdentity(deck.colorIdentity)}</span>
                                  </div>
                                  <div style={{ fontSize: 10, color: '#999' }}>
                                    {deck.commanders.join(' & ')}
                                  </div>
                                </div>
                                {renderDeckActions(deck, set, yearData.year)}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const containerStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  height: '100%',
  maxHeight: 500
};

const headerStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  marginBottom: 10
};

const listContainerStyle: React.CSSProperties = {
  flex: 1,
  overflowY: 'auto',
  border: '1px solid #333',
  borderRadius: 6,
  padding: 8,
  background: '#111'
};

const yearHeaderStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  padding: '8px 6px',
  cursor: 'pointer',
  borderBottom: '1px solid #333',
  fontSize: 13,
  color: '#fbbf24'
};

const setHeaderStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  padding: '6px 4px',
  cursor: 'pointer',
  fontSize: 12,
  color: '#ddd',
  borderBottom: '1px solid #222'
};

const deckItemStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  padding: '6px 4px',
  borderBottom: '1px solid #1a1a1a',
  gap: 8
};

const searchResultStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  padding: '8px 6px',
  borderBottom: '1px solid #222',
  gap: 8
};

export default PreconBrowser;
