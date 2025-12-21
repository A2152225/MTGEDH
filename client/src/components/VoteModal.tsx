import React, { useState } from 'react';

export interface VoteModalProps {
  open: boolean;
  sourceName: string;
  choices: string[];
  votesSubmitted: Array<{
    playerId: string;
    choice: string;
    voteCount: number;
  }>;
  playerNames?: Record<string, string>; // Map of playerId to player name
  onConfirm: (choice: string) => void;
}

export function VoteModal({
  open,
  sourceName,
  choices,
  votesSubmitted,
  playerNames = {},
  onConfirm,
}: VoteModalProps) {
  const [selectedChoice, setSelectedChoice] = useState<string | null>(null);

  if (!open) return null;

  // Count votes for each choice
  const voteCounts: Record<string, number> = {};
  for (const vote of votesSubmitted) {
    voteCounts[vote.choice] = (voteCounts[vote.choice] || 0) + vote.voteCount;
  }

  const handleConfirm = () => {
    if (selectedChoice) {
      onConfirm(selectedChoice);
    }
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 1000,
      display: 'flex', alignItems: 'center', justifyContent: 'center'
    }}>
      <div style={{ background: '#fff', borderRadius: 8, width: 500, maxWidth: '95vw', padding: 20 }}>
        <h3 style={{ margin: '0 0 16px 0' }}>Vote ({sourceName})</h3>
        
        <p style={{ margin: '0 0 16px 0', fontSize: 14, color: '#666' }}>
          Choose one of the options below:
        </p>
        
        {/* Voting options */}
        <div style={{ marginBottom: 16 }}>
          {choices.map((choice) => (
            <div
              key={choice}
              onClick={() => setSelectedChoice(choice)}
              style={{
                padding: 12,
                marginBottom: 8,
                border: `2px solid ${selectedChoice === choice ? '#4CAF50' : '#ccc'}`,
                borderRadius: 6,
                cursor: 'pointer',
                background: selectedChoice === choice ? '#e8f5e9' : '#fff',
                transition: 'all 0.2s',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <div>
                <div style={{ fontWeight: selectedChoice === choice ? 600 : 400, fontSize: 15 }}>
                  {choice}
                </div>
                {voteCounts[choice] > 0 && (
                  <div style={{ fontSize: 12, color: '#666', marginTop: 4 }}>
                    Current votes: {voteCounts[choice]}
                  </div>
                )}
              </div>
              {selectedChoice === choice && (
                <div style={{ color: '#4CAF50', fontSize: 20 }}>✓</div>
              )}
            </div>
          ))}
        </div>
        
        {/* Votes already submitted */}
        {votesSubmitted.length > 0 && (
          <div style={{ marginBottom: 16, padding: 12, background: '#f5f5f5', borderRadius: 6 }}>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Votes So Far:</div>
            <div style={{ fontSize: 12 }}>
              {votesSubmitted.map((vote, idx) => (
                <div key={idx} style={{ marginBottom: 4 }}>
                  <strong>{playerNames[vote.playerId] || `Player ${vote.playerId.slice(0, 6)}`}</strong>
                  {' voted for '}
                  <strong>{vote.choice}</strong>
                  {vote.voteCount > 1 && ` (${vote.voteCount} votes)`}
                </div>
              ))}
            </div>
          </div>
        )}
        
        <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
          <button 
            onClick={handleConfirm}
            disabled={!selectedChoice}
            style={{ 
              padding: '10px 24px', 
              fontSize: 14, 
              background: selectedChoice ? '#4CAF50' : '#ccc', 
              color: 'white', 
              border: 'none', 
              borderRadius: 6,
              cursor: selectedChoice ? 'pointer' : 'not-allowed',
              opacity: selectedChoice ? 1 : 0.6,
            }}
          >
            Submit Vote
          </button>
        </div>
      </div>
    </div>
  );
}

export default VoteModal;
