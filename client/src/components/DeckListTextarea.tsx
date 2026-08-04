import React, { useEffect, useMemo, useRef } from 'react';

const LINE_HEIGHT_PX = 18;
const FONT = '12px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';

export function DeckListTextarea({
  value,
  onChange,
  onKeyDown,
  onPaste,
  placeholder,
  unresolvedLineNumbers,
  style,
}: {
  value: string;
  onChange: (value: string) => void;
  onKeyDown?: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  onPaste?: (e: React.ClipboardEvent<HTMLTextAreaElement>) => void;
  placeholder?: string;
  unresolvedLineNumbers?: ReadonlySet<number>;
  style?: React.CSSProperties;
}) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const gutterRef = useRef<HTMLDivElement | null>(null);

  const lineCount = useMemo(() => {
    if (!value) return 1;
    let count = 1;
    for (let i = 0; i < value.length; i += 1) {
      if (value.charCodeAt(i) === 10) count += 1;
    }
    return count;
  }, [value]);

  const syncGutterScroll = () => {
    const ta = textareaRef.current;
    const gutter = gutterRef.current;
    if (!ta || !gutter) return;
    gutter.scrollTop = ta.scrollTop;
  };

  useEffect(() => {
    syncGutterScroll();
  }, [value, lineCount]);

  const unresolved = unresolvedLineNumbers;

  return (
    <div
      style={{
        display: 'flex',
        width: '100%',
        height: style?.height ?? '100%',
        minHeight: style?.minHeight,
        border: '1px solid #444',
        borderRadius: 4,
        overflow: 'hidden',
        background: '#111',
        boxSizing: 'border-box',
      }}
    >
      <div
        ref={gutterRef}
        aria-hidden="true"
        style={{
          flexShrink: 0,
          width: Math.max(28, String(lineCount).length * 8 + 16),
          overflow: 'hidden',
          background: '#16181a',
          borderRight: '1px solid #333',
          paddingTop: 8,
          paddingBottom: 8,
          userSelect: 'none',
        }}
      >
        {Array.from({ length: lineCount }, (_, index) => {
          const lineNumber = index + 1;
          const bad = unresolved?.has(lineNumber);
          return (
            <div
              key={lineNumber}
              style={{
                height: LINE_HEIGHT_PX,
                lineHeight: `${LINE_HEIGHT_PX}px`,
                font: FONT,
                textAlign: 'right',
                paddingRight: 8,
                color: bad ? '#f87171' : '#6b7280',
                fontWeight: bad ? 700 : 400,
              }}
            >
              {lineNumber}
            </div>
          );
        })}
      </div>
      <textarea
        ref={textareaRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        onPaste={onPaste}
        onScroll={syncGutterScroll}
        placeholder={placeholder}
        spellCheck={false}
        style={{
          ...style,
          width: '100%',
          height: '100%',
          minHeight: 0,
          border: 'none',
          outline: 'none',
          resize: style?.resize ?? 'none',
          background: 'transparent',
          color: '#eee',
          font: FONT,
          lineHeight: `${LINE_HEIGHT_PX}px`,
          padding: '8px 8px 8px 10px',
          boxSizing: 'border-box',
          whiteSpace: 'pre',
          overflowWrap: 'normal',
          overflowX: 'auto',
        }}
      />
    </div>
  );
}
