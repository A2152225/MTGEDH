/**
 * Main App component
 */
import React from 'react';
import { GameFormat } from '@mtgedh/shared';

function App() {
  return (
    <div className="App">
      <header>
        <h1>MTGEDH - Magic: The Gathering Multiplayer Platform</h1>
      </header>
      <main>
        <p>Welcome to MTGEDH! Select a game format to begin:</p>
        <ul>
          <li>{GameFormat.COMMANDER}</li>
          <li>{GameFormat.STANDARD}</li>
          <li>{GameFormat.MODERN}</li>
        </ul>
      </main>
    </div>
  );
}

export default App;
