import React, { useState } from 'react';
import { useGameSocket } from '../hooks/useGameSocket';
import { AutomationErrorReport } from '@mtgedh/shared';

interface Props {
  gameId: string;
  playerId: string;
  lastAction?: any;
}

export function AutomationErrorReporter({ gameId, playerId, lastAction }: Props) {
  const [isOpen, setIsOpen] = useState(false);
  const [description, setDescription] = useState('');
  const [expectedBehavior, setExpectedBehavior] = useState('');
  const { reportError } = useGameSocket();

  const handleSubmit = () => {
    const report: Omit<AutomationErrorReport, 'id' | 'reportedAt' | 'status'> = {
      gameId,
      playerId,
      actionType: lastAction?.type,
      cardInvolved: lastAction?.cardName,
      description,
      expectedBehavior,
      gameState: {}, // Captured automatically by server
      rulesReferences: []
    };

    reportError(report);
    setIsOpen(false);
    setDescription('');
    setExpectedBehavior('');
  };

  return (
    <>
      <button
        onClick={() => setIsOpen(true)}
        className="bg-red-500 text-white px-3 py-1 rounded hover:bg-red-600"
      >
        🚨 Report Issue
      </button>

      {isOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-lg w-full">
            <h2 className="text-2xl font-bold mb-4">Report Automation Error</h2>
            
            <div className="mb-4">
              <label className="block text-sm font-medium mb-2">
                What happened incorrectly?
              </label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="w-full border rounded p-2 h-24"
                placeholder="Describe what the automation did wrong..."
              />
            </div>

            <div className="mb-4">
              <label className="block text-sm font-medium mb-2">
                What should have happened?
              </label>
              <textarea
                value={expectedBehavior}
                onChange={(e) => setExpectedBehavior(e.target.value)}
                className="w-full border rounded p-2 h-24"
                placeholder="Explain the correct behavior according to rules..."
              />
            </div>

            <div className="flex gap-2">
              <button
                onClick={handleSubmit}
                className="bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600"
              >
                Submit Report
              </button>
              <button
                onClick={() => setIsOpen(false)}
                className="bg-gray-300 px-4 py-2 rounded hover:bg-gray-400"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}