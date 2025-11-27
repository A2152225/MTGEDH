// client/src/components/KeywordHighlighter.tsx
// Component that renders text with highlighted keywords that show tooltips on hover

import React, { useState, useMemo } from 'react';
import { getKeywordInfo, KEYWORD_GLOSSARY, type KeywordInfo } from '../utils/keywordGlossary';

interface KeywordHighlighterProps {
  text: string;
  fontSize?: number;
  baseColor?: string;
}

/**
 * Build a regex pattern to match all known keywords
 * Matches whole words only, case-insensitive
 */
function buildKeywordPattern(): RegExp {
  // Get all keyword terms from the glossary
  const terms: string[] = [];
  for (const key in KEYWORD_GLOSSARY) {
    const info = KEYWORD_GLOSSARY[key];
    terms.push(info.term);
    // Also add the key itself if different (e.g., "first_strike" vs "First Strike")
    if (key !== info.term.toLowerCase().replace(/\s+/g, '')) {
      terms.push(key.replace(/_/g, ' '));
    }
  }
  
  // Sort by length (longest first) to match "first strike" before "strike"
  terms.sort((a, b) => b.length - a.length);
  
  // Escape special regex characters and join with OR
  const escaped = terms.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  
  // Build pattern that matches whole words
  return new RegExp(`\\b(${escaped.join('|')})\\b`, 'gi');
}

// Pre-build the pattern once
const KEYWORD_PATTERN = buildKeywordPattern();

/**
 * Individual keyword span with hover tooltip
 */
function KeywordSpan({ 
  keyword, 
  info, 
  fontSize = 10,
}: { 
  keyword: string; 
  info: KeywordInfo; 
  fontSize?: number;
}) {
  const [isHovered, setIsHovered] = useState(false);
  
  return (
    <span
      style={{ position: 'relative', display: 'inline' }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <span
        style={{
          color: info.color,
          fontWeight: 600,
          textDecoration: 'underline',
          textDecorationStyle: 'dotted',
          textDecorationColor: `${info.color}80`,
          cursor: 'help',
        }}
      >
        {keyword}
      </span>
      
      {/* Tooltip popup */}
      {isHovered && (
        <span
          style={{
            position: 'absolute',
            bottom: '100%',
            left: '50%',
            transform: 'translateX(-50%)',
            marginBottom: 4,
            padding: '6px 10px',
            background: 'rgba(15, 23, 42, 0.98)',
            border: `1px solid ${info.color}`,
            borderRadius: 6,
            boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
            zIndex: 1000,
            whiteSpace: 'normal',
            width: 'max-content',
            maxWidth: 220,
            textAlign: 'left',
            pointerEvents: 'none',
          }}
        >
          <span
            style={{
              display: 'block',
              fontSize: fontSize + 1,
              fontWeight: 700,
              color: info.color,
              marginBottom: 3,
            }}
          >
            {info.icon && <span style={{ marginRight: 4 }}>{info.icon}</span>}
            {info.term}
          </span>
          <span
            style={{
              display: 'block',
              fontSize: fontSize,
              fontWeight: 400,
              color: '#e2e8f0',
              lineHeight: 1.4,
            }}
          >
            {info.reminderText}
          </span>
          {info.rulesReference && (
            <span
              style={{
                display: 'block',
                fontSize: fontSize - 1,
                color: '#94a3b8',
                marginTop: 3,
                fontStyle: 'italic',
              }}
            >
              {info.rulesReference}
            </span>
          )}
        </span>
      )}
    </span>
  );
}

/**
 * Renders text with keywords highlighted and showing tooltips on hover
 */
export function KeywordHighlighter({ 
  text, 
  fontSize = 10,
  baseColor = '#e2e8f0',
}: KeywordHighlighterProps) {
  const segments = useMemo(() => {
    const result: Array<{ type: 'text' | 'keyword'; content: string; info?: KeywordInfo }> = [];
    let lastIndex = 0;
    
    // Reset regex state
    KEYWORD_PATTERN.lastIndex = 0;
    
    let match;
    while ((match = KEYWORD_PATTERN.exec(text)) !== null) {
      // Add text before the match
      if (match.index > lastIndex) {
        result.push({
          type: 'text',
          content: text.slice(lastIndex, match.index),
        });
      }
      
      // Add the keyword
      const keyword = match[1];
      const info = getKeywordInfo(keyword);
      if (info) {
        result.push({
          type: 'keyword',
          content: keyword,
          info,
        });
      } else {
        // Fallback if somehow info not found
        result.push({
          type: 'text',
          content: keyword,
        });
      }
      
      lastIndex = match.index + match[0].length;
    }
    
    // Add remaining text
    if (lastIndex < text.length) {
      result.push({
        type: 'text',
        content: text.slice(lastIndex),
      });
    }
    
    return result;
  }, [text]);
  
  return (
    <span style={{ color: baseColor, fontSize }}>
      {segments.map((segment, i) => {
        if (segment.type === 'keyword' && segment.info) {
          return (
            <KeywordSpan
              key={i}
              keyword={segment.content}
              info={segment.info}
              fontSize={fontSize}
            />
          );
        }
        return <span key={i}>{segment.content}</span>;
      })}
    </span>
  );
}

export default KeywordHighlighter;
