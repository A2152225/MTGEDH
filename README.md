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

4. Start development server:
```bash
npm run dev
```

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

- [Architecture Overview](./docs/architecture.md)
- [Rules Engine Integration](./docs/rules-engine-integration.md)
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