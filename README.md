# MTGEDH - Magic: The Gathering Multiplayer Platform

A comprehensive web-based platform for playing Magic: The Gathering online with up to 8 players simultaneously.

## Features

- **Multiplayer Support**: Up to 8 concurrent players per game
- **Format Support**: Commander, Standard, Vintage, Modern, and custom formats
- **Deck Import**: Import decks from Scryfall and other popular sites
- **Rules Automation**: Automated game mechanics based on MTG Comprehensive Rules
- **Command Zone**: Visible command zone for Commander format
- **Counters & Tokens**: Automated counter and token management
- **Priority System**: Visual priority indicators with pass/respond options
- **Spectator Mode**: Watch games in real-time
- **Face-down Card Tracking**: Proper visibility for morphs, manifests, and exiled cards
- **Configurable Life Totals**: Set starting life for different formats
- **Loop Detection**: Handle infinite combos with iteration prompts

## Technology Stack

- **Backend**: Node.js with Express + Socket.IO
- **Frontend**: React with TypeScript
- **Database**: SQLite (lightweight, no external dependencies)
- **Card Data**: Scryfall API integration
- **Real-time**: WebSocket communication for instant updates

## Project Structure

```
/server          - Backend Node.js server
/client          - React frontend application  
/shared          - Shared TypeScript types
/rules-engine    - MTG rules automation engine
/docs            - Documentation
```

## Quick Start

### Prerequisites
- Node.js 18+ 
- npm or yarn

### Installation

1. Clone the repository:
```bash
git clone https://github.com/A2152225/MTGEDH.git
cd MTGEDH
```

2. Install dependencies:
```bash
npm install
```

3. Set up environment:
```bash
cp .env.example .env
```

4. Configure debug level (optional):
```bash
# Edit .env and set DEBUG_STATE:
# DEBUG_STATE=0  # No debug output (production, default)
# DEBUG_STATE=1  # Essential debugging (important state changes, errors)
# DEBUG_STATE=2  # Verbose debugging (detailed logs for investigation)
```

5. Start development server:
```bash
npm run dev
```

Server-only startup flags can be passed through the workspace script:
```bash
npm --workspace @mtgedh/server run dev -- --wipe-games
npm --workspace @mtgedh/server run dev -- --port 3002 --debug-state 1
npm --workspace @mtgedh/server run dev -- --skip-card-lookup-warmup
```

Deck imports now use a local SQLite card lookup table before Scryfall. By default the server warms that table at startup so the first real deck import does not pay the build cost. Set `LOCAL_CARD_LOOKUP_WARMUP=false` or pass `--skip-card-lookup-warmup` if you want to skip that prebuild step.

5. Open browser to `http://localhost:3000`

## Development Status

🚧 **Project in active development** 🚧

This platform is being built to provide a free, self-hosted solution for playing MTG online with friends.

### Recent Updates

- **Rules Engine Integration**: Unified rules engine adapter with event-driven architecture for all game actions
- **AI Engine**: 6 AI strategies (Random, Basic, Aggressive, Defensive, Control, Combo) for automated gameplay
- **Game Simulator**: Full-game simulation framework from mulligan to win condition with CLI tool
- **Hybrid Play**: Support for both AI and human-controlled players in the same game
- **Comprehensive Testing**: 951 automated tests covering rules engine, AI, and simulation
- **Modular Keyword Actions**: Refactored keyword actions (Rule 701) into modular, maintainable files
- **State-Based Actions**: Full implementation of Rule 704 state-based actions

### New Features

#### 🎮 Game Simulation

Run automated MTG games for testing and analysis:

```bash
# Run a single simulation
cd rules-engine
npm run simulate -- --players 2 --verbose

# Run 100 games for statistical analysis
npm run simulate -- --players 2 --iterations 100

# Test AI strategies
npm run simulate -- --strategy aggressive --iterations 50
```

See [Simulation Guide](./docs/simulation-guide.md) for detailed usage.

#### 🤖 AI Engine

Configure AI-controlled players with different strategies:

```typescript
import { aiEngine, AIStrategy } from '@mtgedh/rules-engine';

aiEngine.registerAI({
  playerId: 'ai1',
  strategy: AIStrategy.AGGRESSIVE,
  difficulty: 0.7,
});
```

See [AI Strategies Guide](./docs/ai-strategies.md) for custom AI development.

#### ⚙️ Rules Engine Adapter

All game actions now flow through a unified rules engine:

```typescript
import { rulesEngine, RulesEngineEvent } from '@mtgedh/rules-engine';

// Initialize game
rulesEngine.initializeGame(gameId, gameState);

// Listen to events
rulesEngine.on(RulesEngineEvent.SPELL_CAST, (event) => {
  console.log(`${event.data.caster} cast ${event.data.spell.card.name}`);
});

// Validate and execute actions
const validation = rulesEngine.validateAction(gameId, action);
if (validation.legal) {
  rulesEngine.executeAction(gameId, action);
}
```

See [Rules Engine Integration](./docs/rules-engine-integration.md) for architecture details.

## Architecture

- **Client-Server Model**: Centralized server for game state authority
- **WebSocket Communication**: Real-time bidirectional updates
- **Rules Engine**: Event-driven architecture with validation and state management
- **AI System**: Pluggable strategies for automated decision-making
- **Simulation Framework**: Full-game testing from mulligan to win condition
- **Self-Hosted**: Run on your own hardware, no cloud costs
- **Modular Design**: Extensible rules engine for adding new cards/mechanics

## Documentation

### Debug Logging

The platform uses an environment-based debug system to control log verbosity:

**Debug Levels:**
- `DEBUG_STATE=0` - No debug output (production mode, default)
- `DEBUG_STATE=1` - Essential debugging (errors, warnings, important state changes)
- `DEBUG_STATE=2` - Verbose debugging (detailed logs for investigation)

**Usage:**

Server (set in `.env`):
```bash
DEBUG_STATE=1 npm run dev
```

Client (set in `.env.local`):
```bash
VITE_DEBUG_STATE=1 npm run dev:client
```

**In Code:**
```typescript
import { debug, debugWarn, debugError } from './utils/debug';

// Only shows when DEBUG_STATE >= 1
debug(1, '[module] Important state change');

// Only shows when DEBUG_STATE >= 2  
debug(2, '[module] Detailed investigation info');
```

This allows you to control the amount of logging without modifying code, making it easier to diagnose issues in development while keeping production logs clean.

### Server Startup Flags

The server now accepts these startup flags directly:

```bash
--port <number>
--cors-origin <origin>
--sqlite-file <path>
--debug-state <0|1|2>
--clear-planeswalker-cache
--wipe-games
--wipe-games-on-startup
--help
```

Examples:

```bash
npm --workspace @mtgedh/server run dev -- --wipe-games
npm --workspace @mtgedh/server run dev -- --sqlite-file ./data/dev.sqlite --wipe-games
npm --workspace @mtgedh/server run dev -- --port 3002 --cors-origin http://localhost:3000
```

`--wipe-games` only deletes persisted games and their event history, plus any in-memory games loaded at startup. It does not delete saved decks.

Environment variable equivalents remain available in `.env`:

```bash
PORT=3001
CORS_ORIGIN=http://localhost:3000
SQLITE_FILE=./data/mtgedh.sqlite
DEBUG_STATE=1
CLEAR_PLANESWALKER_CACHE=true
WIPE_GAMES_ON_STARTUP=true
```

### Other Documentation

- [Architecture Overview](./docs/architecture.md)
- [Rules Engine Integration](./docs/rules-engine-integration.md)
- [Merfolk Iteration Audit Summary](./docs/merfolk-iteration-audit-summary.md)
- [Oracle Automation Roadmap](./docs/oracle-automation-roadmap.md)
- [Game Simulation Guide](./docs/simulation-guide.md)
- [AI Strategy Development](./docs/ai-strategies.md)
- [Keyword Actions Guide](./docs/keyword-actions-guide.md)
- [IIS Setup Guide](./docs/iis-setup-guide.md) - Deploy with IIS on Windows

## Contributing

This is a community-driven project. Contributions welcome!

## License

MIT License - See LICENSE file for details

## Acknowledgments

- Card data provided by [Scryfall API](https://scryfall.com/docs/api)
- MTG Comprehensive Rules by Wizards of the Coast
- Built for the EDH/Commander community

---

**Note**: This is an unofficial fan project. Magic: The Gathering is © Wizards of the Coast.