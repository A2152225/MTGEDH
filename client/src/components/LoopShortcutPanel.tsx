import React from 'react';
import type { LoopShortcutSequenceItem, SavedLoopShortcut } from '../utils/loopShortcuts';

interface LoopShortcutPanelProps {
  open: boolean;
  onClose: () => void;
  isRecording: boolean;
  isRunning: boolean;
  items: LoopShortcutSequenceItem[];
  shortcutName: string;
  savedShortcuts: SavedLoopShortcut[];
  iterationCount: number;
  onShortcutNameChange: (name: string) => void;
  onIterationCountChange: (count: number) => void;
  onStartRecording: () => void;
  onStopRecording: () => void;
  onRun: () => void;
  onClear: () => void;
  onSaveShortcut: () => void;
  onLoadShortcut: (shortcutId: string) => void;
  onDeleteShortcut: (shortcutId: string) => void;
  statusText?: string;
}

export function LoopShortcutPanel({
  open,
  onClose,
  isRecording,
  isRunning,
  items,
  shortcutName,
  savedShortcuts,
  iterationCount,
  onShortcutNameChange,
  onIterationCountChange,
  onStartRecording,
  onStopRecording,
  onRun,
  onClear,
  onSaveShortcut,
  onLoadShortcut,
  onDeleteShortcut,
  statusText,
}: LoopShortcutPanelProps) {
  if (!open) return null;

  return (
    <div
      style={{
        marginTop: 8,
        padding: 12,
        borderRadius: 8,
        border: '1px solid #444',
        backgroundColor: '#1f1f1f',
        color: '#fff',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <div style={{ fontWeight: 600, fontSize: 13 }}>Loop Shortcut Recorder</div>
        <button
          onClick={onClose}
          style={{
            border: 'none',
            background: 'transparent',
            color: '#999',
            cursor: 'pointer',
            fontSize: 16,
            lineHeight: 1,
          }}
          title="Close"
        >
          ×
        </button>
      </div>

      <div style={{ fontSize: 12, color: '#bbb', marginBottom: 10 }}>
        Record a manual line once, then replay it with current legal targets. Drafts restore automatically for the current game, and saved shortcuts stay available after reconnect.
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
        <input
          type="text"
          value={shortcutName}
          onChange={(event) => onShortcutNameChange(event.target.value)}
          placeholder="Shortcut name"
          disabled={isRunning}
          style={{
            flex: 1,
            padding: '6px 8px',
            borderRadius: 6,
            border: '1px solid #555',
            backgroundColor: '#111',
            color: '#fff',
          }}
        />
        <button
          onClick={onSaveShortcut}
          disabled={isRecording || isRunning || items.length === 0}
          style={{
            padding: '8px 10px',
            borderRadius: 6,
            border: '1px solid #14532d',
            backgroundColor: '#166534',
            color: '#fff',
            cursor: isRecording || isRunning || items.length === 0 ? 'not-allowed' : 'pointer',
          }}
        >
          Save
        </button>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
        {!isRecording ? (
          <button
            onClick={onStartRecording}
            disabled={isRunning}
            style={{
              flex: 1,
              padding: '8px 10px',
              borderRadius: 6,
              border: '1px solid #0f766e',
              backgroundColor: '#134e4a',
              color: '#fff',
              cursor: isRunning ? 'not-allowed' : 'pointer',
            }}
          >
            Record
          </button>
        ) : (
          <button
            onClick={onStopRecording}
            style={{
              flex: 1,
              padding: '8px 10px',
              borderRadius: 6,
              border: '1px solid #b91c1c',
              backgroundColor: '#7f1d1d',
              color: '#fff',
              cursor: 'pointer',
            }}
          >
            Stop Recording
          </button>
        )}

        <button
          onClick={onClear}
          disabled={isRecording || isRunning || items.length === 0}
          style={{
            padding: '8px 10px',
            borderRadius: 6,
            border: '1px solid #444',
            backgroundColor: '#2a2a2a',
            color: '#fff',
            cursor: isRecording || isRunning || items.length === 0 ? 'not-allowed' : 'pointer',
          }}
        >
          Clear
        </button>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <label style={{ fontSize: 12, color: '#bbb' }}>Iterations</label>
        <input
          type="number"
          min={1}
          max={50}
          value={iterationCount}
          onChange={(event) => onIterationCountChange(Number(event.target.value) || 1)}
          disabled={isRecording || isRunning}
          style={{
            width: 72,
            padding: '6px 8px',
            borderRadius: 6,
            border: '1px solid #555',
            backgroundColor: '#111',
            color: '#fff',
          }}
        />
        <button
          onClick={onRun}
          disabled={isRecording || isRunning || items.length === 0}
          style={{
            flex: 1,
            padding: '8px 10px',
            borderRadius: 6,
            border: '1px solid #1d4ed8',
            backgroundColor: '#1e3a8a',
            color: '#fff',
            cursor: isRecording || isRunning || items.length === 0 ? 'not-allowed' : 'pointer',
          }}
        >
          {isRunning ? 'Running…' : 'Run Loop'}
        </button>
      </div>

      <div style={{ fontSize: 12, color: isRecording ? '#5eead4' : '#aaa', marginBottom: 10 }}>
        {statusText || (isRecording ? 'Recording in progress.' : 'Idle.')}
      </div>

      <div
        style={{
          maxHeight: 180,
          overflowY: 'auto',
          borderRadius: 6,
          border: '1px solid #333',
          backgroundColor: '#121212',
        }}
      >
        {items.length === 0 ? (
          <div style={{ padding: 10, fontSize: 12, color: '#777' }}>
            No recorded actions yet.
          </div>
        ) : (
          items.map((item, index) => (
            <div
              key={`${item.kind}-${index}`}
              style={{
                padding: '8px 10px',
                borderBottom: index === items.length - 1 ? 'none' : '1px solid #222',
                fontSize: 12,
                color: '#ddd',
              }}
            >
              <div style={{ color: '#888', fontSize: 11, marginBottom: 2 }}>
                {index + 1}. {item.kind === 'emit' ? item.event : 'resolutionStepPrompt'}
              </div>
              <div>{item.label}</div>
            </div>
          ))
        )}
      </div>

      <div style={{ marginTop: 10, fontSize: 12, color: '#bbb' }}>Saved Shortcuts</div>
      <div
        style={{
          marginTop: 6,
          maxHeight: 160,
          overflowY: 'auto',
          borderRadius: 6,
          border: '1px solid #333',
          backgroundColor: '#121212',
        }}
      >
        {savedShortcuts.length === 0 ? (
          <div style={{ padding: 10, fontSize: 12, color: '#777' }}>
            No saved shortcuts for this game yet.
          </div>
        ) : (
          savedShortcuts.map((shortcut) => (
            <div
              key={shortcut.id}
              style={{
                padding: '8px 10px',
                borderBottom: '1px solid #222',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 8,
              }}
            >
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ color: '#ddd', fontSize: 12, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {shortcut.name}
                </div>
                <div style={{ color: '#777', fontSize: 11 }}>
                  {shortcut.items.length} step{shortcut.items.length === 1 ? '' : 's'} • {shortcut.iterationCount} iteration{shortcut.iterationCount === 1 ? '' : 's'}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button
                  onClick={() => onLoadShortcut(shortcut.id)}
                  disabled={isRecording || isRunning}
                  style={{
                    padding: '6px 8px',
                    borderRadius: 6,
                    border: '1px solid #1d4ed8',
                    backgroundColor: '#1e3a8a',
                    color: '#fff',
                    cursor: isRecording || isRunning ? 'not-allowed' : 'pointer',
                  }}
                >
                  Load
                </button>
                <button
                  onClick={() => onDeleteShortcut(shortcut.id)}
                  disabled={isRecording || isRunning}
                  style={{
                    padding: '6px 8px',
                    borderRadius: 6,
                    border: '1px solid #7f1d1d',
                    backgroundColor: '#450a0a',
                    color: '#fff',
                    cursor: isRecording || isRunning ? 'not-allowed' : 'pointer',
                  }}
                >
                  Delete
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export default LoopShortcutPanel;