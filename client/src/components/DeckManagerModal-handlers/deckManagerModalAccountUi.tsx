import React from 'react';

export function VisibilityBadge({ visibility }: { visibility?: string | null }) {
  const isPublic = visibility !== 'private';
  return (
    <span
      style={{
        fontSize: 10,
        padding: '1px 6px',
        borderRadius: 999,
        background: isPublic ? 'rgba(34,197,94,0.18)' : 'rgba(148,163,184,0.18)',
        color: isPublic ? '#86efac' : '#cbd5e1',
        border: `1px solid ${isPublic ? 'rgba(34,197,94,0.4)' : 'rgba(148,163,184,0.35)'}`,
        whiteSpace: 'nowrap',
      }}
    >
      {isPublic ? 'Public' : 'Private'}
    </span>
  );
}

export function DeckVisibilitySelect(props: {
  id?: string;
  value: 'public' | 'private';
  onChange: (value: 'public' | 'private') => void;
}) {
  return (
    <select
      id={props.id}
      value={props.value}
      onChange={(e) => props.onChange(e.target.value === 'public' ? 'public' : 'private')}
      style={{ fontSize: 12, background: '#111', color: '#eee', border: '1px solid #444', borderRadius: 4, padding: '2px 6px' }}
    >
      <option value="private">Private</option>
      <option value="public">Public</option>
    </select>
  );
}
