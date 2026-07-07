import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ChatMsg } from '../../../shared/src';
import { dedupeGameLogEntries, type GameLogEntry } from '../utils/gameStateLog';

export type GameCommunicationsPanelProps = {
  chatMessages: ChatMsg[];
  gameLogEntries: GameLogEntry[];
  onSendChat: (text: string) => void;
  resolvePlayerName: (playerId: string) => string;
  bottomInset?: number;
  disabled?: boolean;
};

type PanelTab = 'chat' | 'log';
type PanelSize = 'small' | 'medium' | 'large';

const SIZE_CONFIG: Record<PanelSize, { width: number; height: number }> = {
  small: { width: 260, height: 180 },
  medium: { width: 340, height: 260 },
  large: { width: 460, height: 340 },
};

export function GameCommunicationsPanel({
  chatMessages,
  gameLogEntries,
  onSendChat,
  resolvePlayerName,
  bottomInset = 0,
  disabled = false,
}: GameCommunicationsPanelProps) {
  const [collapsed, setCollapsed] = useState(true);
  const [tab, setTab] = useState<PanelTab>('log');
  const [size, setSize] = useState<PanelSize>('medium');
  const [chatText, setChatText] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const [userScrolledUp, setUserScrolledUp] = useState(false);

  const combinedLog = useMemo(() => {
    const chatAsLog: GameLogEntry[] = chatMessages
      .filter((m) => m.from === 'system')
      .map((m) => ({
        id: `chat_${m.id}`,
        ts: m.ts,
        kind: 'chat' as const,
        message: m.message,
      }));

    const playerChat: GameLogEntry[] = chatMessages
      .filter((m) => m.from !== 'system')
      .map((m) => ({
        id: `chat_${m.id}`,
        ts: m.ts,
        kind: 'chat' as const,
        message: `${resolvePlayerName(String(m.from))}: ${m.message}`,
      }));

    return dedupeGameLogEntries([...gameLogEntries, ...chatAsLog, ...playerChat])
      .sort((a, b) => a.ts - b.ts)
      .slice(-300);
  }, [chatMessages, gameLogEntries, resolvePlayerName]);

  const scrollItems = tab === 'chat' ? chatMessages : combinedLog;

  useEffect(() => {
    const container = scrollRef.current;
    if (!container || userScrolledUp) return;
    container.scrollTop = container.scrollHeight;
  }, [scrollItems, userScrolledUp, tab, collapsed]);

  const handleScroll = () => {
    const container = scrollRef.current;
    if (!container) return;
    const isAtBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 12;
    if (isAtBottom && userScrolledUp) setUserScrolledUp(false);
    else if (!isAtBottom && !userScrolledUp) setUserScrolledUp(true);
  };

  const handleSend = () => {
    const text = chatText.trim();
    if (!text) return;
    onSendChat(text);
    setChatText('');
    setTab('chat');
    setCollapsed(false);
  };

  if (disabled || typeof document === 'undefined') return null;

  const dimensions = SIZE_CONFIG[size];
  const bottom = 12 + Math.max(0, bottomInset);

  return createPortal(
    <div
      style={{
        position: 'fixed',
        left: 12,
        bottom,
        zIndex: 9200,
        width: collapsed ? 'auto' : dimensions.width,
        height: collapsed ? 'auto' : dimensions.height,
        maxWidth: 'min(96vw, 520px)',
        background: 'rgba(8, 10, 16, 0.92)',
        borderRadius: 10,
        border: '1px solid rgba(255,255,255,0.16)',
        boxShadow: '0 8px 28px rgba(0,0,0,0.45)',
        color: '#f3f4f6',
        fontSize: 12,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        backdropFilter: 'blur(10px)',
        pointerEvents: 'auto',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
          padding: '8px 10px',
          borderBottom: collapsed ? 'none' : '1px solid rgba(255,255,255,0.08)',
          background: 'rgba(255,255,255,0.03)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button
            type="button"
            onClick={() => setCollapsed((value) => !value)}
            style={iconButtonStyle}
            title={collapsed ? 'Expand panel' : 'Minimize panel'}
          >
            {collapsed ? '▶' : '▼'}
          </button>
          {!collapsed && (
            <div style={{ display: 'flex', gap: 4 }}>
              <TabButton active={tab === 'log'} onClick={() => setTab('log')}>
                Log ({combinedLog.length})
              </TabButton>
              <TabButton active={tab === 'chat'} onClick={() => setTab('chat')}>
                Chat ({chatMessages.length})
              </TabButton>
            </div>
          )}
          {collapsed && (
            <span style={{ fontWeight: 600, fontSize: 12 }}>
              Game Log / Chat
            </span>
          )}
        </div>

        {!collapsed && (
          <div style={{ display: 'flex', gap: 4 }}>
            {(['small', 'medium', 'large'] as PanelSize[]).map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setSize(option)}
                style={{
                  ...iconButtonStyle,
                  background: size === option ? 'rgba(255,255,255,0.14)' : 'transparent',
                  fontSize: 10,
                  padding: '2px 6px',
                }}
                title={`${option} panel`}
              >
                {option[0]!.toUpperCase()}
              </button>
            ))}
          </div>
        )}
      </div>

      {!collapsed && (
        <>
          <div
            ref={scrollRef}
            onScroll={handleScroll}
            style={{
              flex: 1,
              overflowY: 'auto',
              padding: '8px 10px',
              minHeight: 0,
              lineHeight: 1.35,
            }}
          >
            {tab === 'chat' ? (
              chatMessages.length === 0 ? (
                <EmptyState text="No chat messages yet." />
              ) : (
                chatMessages.map((message) => (
                  <div key={message.id} style={{ marginBottom: 6 }}>
                    <span style={{ fontWeight: 600, color: message.from === 'system' ? '#93c5fd' : '#e5e7eb' }}>
                      {message.from === 'system' ? 'system' : resolvePlayerName(String(message.from))}:
                    </span>{' '}
                    <span>{message.message}</span>
                  </div>
                ))
              )
            ) : combinedLog.length === 0 ? (
              <EmptyState text="Game log will appear here as the battlefield changes." />
            ) : (
              combinedLog.map((entry) => (
                <div
                  key={entry.id}
                  style={{
                    marginBottom: 5,
                    color: entry.kind === 'state' ? '#d1fae5' : '#e5e7eb',
                  }}
                >
                  <span style={{ opacity: 0.55, fontSize: 10, marginRight: 6 }}>
                    {formatTime(entry.ts)}
                  </span>
                  {entry.message}
                </div>
              ))
            )}
          </div>

          {tab === 'chat' && (
            <div style={{ display: 'flex', gap: 6, padding: '8px 10px', borderTop: '1px solid rgba(255,255,255,0.08)' }}>
              <input
                value={chatText}
                onChange={(event) => setChatText(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') handleSend();
                }}
                placeholder="Type a message..."
                style={{
                  flex: 1,
                  fontSize: 12,
                  padding: '6px 8px',
                  borderRadius: 6,
                  border: '1px solid rgba(255,255,255,0.14)',
                  background: 'rgba(0,0,0,0.35)',
                  color: '#f9fafb',
                }}
              />
              <button type="button" onClick={handleSend} style={sendButtonStyle}>
                Send
              </button>
            </div>
          )}
        </>
      )}
    </div>,
    document.body,
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        border: '1px solid rgba(255,255,255,0.12)',
        borderRadius: 6,
        padding: '3px 8px',
        background: active ? 'rgba(167,139,250,0.22)' : 'transparent',
        color: '#f9fafb',
        cursor: 'pointer',
        fontSize: 11,
        fontWeight: active ? 600 : 500,
      }}
    >
      {children}
    </button>
  );
}

function EmptyState({ text }: { text: string }) {
  return <div style={{ color: '#9ca3af', fontStyle: 'italic' }}>{text}</div>;
}

function formatTime(ts: number): string {
  try {
    return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch {
    return '';
  }
}

const iconButtonStyle: React.CSSProperties = {
  background: 'transparent',
  border: 'none',
  color: '#f9fafb',
  cursor: 'pointer',
  padding: 0,
  fontSize: 11,
};

const sendButtonStyle: React.CSSProperties = {
  fontSize: 12,
  padding: '6px 10px',
  borderRadius: 6,
  border: '1px solid rgba(74,222,128,0.45)',
  background: '#166534',
  color: '#f9fafb',
  cursor: 'pointer',
};

export default GameCommunicationsPanel;
