# MTGEDH Architecture Documentation

## Overview

MTGEDH is a web-based platform for playing Magic: The Gathering online with multiplayer support (2-8 players). The system uses a monorepo structure with TypeScript, following a client-server architecture with real-time WebSocket communication.

## System Architecture

### High-Level Architecture

```
┌─────────────┐         WebSocket/HTTP         ┌─────────────┐
│   Client    │◄──────────────────────────────►│   Server    │
│   (React)   │                                 │  (Node.js)  │
└─────────────┘                                 └─────────────┘
                                                       │
                                                       │
                                                       ▼
                                                ┌─────────────┐
                                                │  Database   │
                                                │  (SQLite)   │
                                                └─────────────┘
```

### Monorepo Structure

The project is organized as a monorepo with the following packages:

```
MTGEDH/
├── packages/
│   ├── client/         # React frontend application
│   ├── server/         # Node.js backend server
│   ├── shared/         # Shared types and utilities
│   └── rules-engine/   # MTG rules automation logic
├── docs/               # Documentation
├── tsconfig.base.json  # Shared TypeScript configuration
├── .env.example        # Environment variables template
└── package.json        # Root workspace configuration
```

## Package Details

### 1. @mtgedh/client

**Purpose**: Frontend React application for the game interface

**Technology Stack**:
- React 18 with TypeScript
- Vite for development and building
- Socket.IO client for real-time communication
- Vitest for testing

**Key Responsibilities**:
- Render game board and player interfaces
- Handle user interactions (card plays, attacks, etc.)
- Maintain WebSocket connection to server
- Display game state updates in real-time
- Provide deck import and management UI

**Main Components**:
- Game board renderer
- Player hand/zones display
- Command zone for Commander format
- Priority and phase indicators
- Deck builder/importer

### 2. @mtgedh/server

**Purpose**: Backend API server and game state authority

**Technology Stack**:
- Node.js with Express
- Socket.IO for WebSocket handling
- Better-SQLite3 for persistence
- TypeScript for type safety

**Key Responsibilities**:
- Maintain authoritative game state
- Process and validate player actions
- Broadcast state updates to all clients
- Handle game creation and player matchmaking
- Persist game history and player data
- Interface with Scryfall API for card data

**Main Modules**:
- Express REST API endpoints
- WebSocket event handlers
- Database access layer
- Game state manager
- Scryfall integration

### 3. @mtgedh/shared

**Purpose**: Shared types, interfaces, and utilities

**Key Responsibilities**:
- Define TypeScript interfaces for game entities
- Export shared constants (life totals, limits, etc.)
- Provide common utility functions
- Ensure type consistency across packages

**Exported Types**:
- `GameState`: Complete game state structure
- `Player`: Player information and life totals
- `Card`: Card data structure
- `Zone`: Game zones (library, hand, battlefield, etc.)
- `GameAction`: Player actions structure
- Enums for phases, formats, zone types

### 4. @mtgedh/rules-engine

**Purpose**: MTG rules automation and game logic

**Technology Stack**:
- Pure TypeScript logic
- Depends on @mtgedh/shared for types

**Key Responsibilities**:
- Implement MTG Comprehensive Rules
- Validate card plays and game actions
- Handle priority and phase transitions
- Process triggered and activated abilities
- Apply continuous effects
- Detect win/loss conditions
- Handle special mechanics (commander damage, poison counters, etc.)

**Main Components**:
- `RulesEngine`: Core game logic processor
- `GameValidator`: Action and state validators
- `EffectManager`: Card effects handler
- Phase/turn advancement logic
- Combat resolution system

## Data Flow

### Game Creation Flow

1. Client requests game creation via REST API
2. Server creates game state in database
3. Server returns game ID to client
4. Client joins game room via WebSocket
5. Server broadcasts initial game state

### Player Action Flow

1. Player performs action in client UI
2. Client validates action locally (basic checks)
3. Client sends action to server via WebSocket
4. Server validates action using rules-engine
5. If valid, server updates game state
6. Server broadcasts updated state to all clients in game
7. Clients update UI to reflect new state

### Real-Time Updates

All game state changes are broadcast via WebSocket to ensure all players see synchronized state:

- Priority changes
- Phase transitions
- Card plays
- Life total changes
- Zone movements
- Stack updates

## Communication Protocols

### REST API Endpoints

- `GET /health` - Health check
- `GET /api/v1/cards/search` - Search cards via Scryfall
- `POST /api/v1/games` - Create new game
- `GET /api/v1/games/:id` - Get game state

### WebSocket Events

**Client → Server**:
- `join-game` - Join a game room
- `game-action` - Perform game action
- `pass-priority` - Pass priority
- `declare-attackers` - Combat phase
- `declare-blockers` - Combat phase

**Server → Client**:
- `game-state-update` - Full state update
- `player-joined` - New player notification
- `player-left` - Player disconnect
- `priority-change` - Priority holder changed
- `phase-change` - Game phase changed

## Database Schema

SQLite database with the following main tables:

- `games` - Game metadata and current state
- `players` - Player information
- `game_actions` - Action history log
- `decks` - Saved deck lists

## Configuration

### Environment Variables

See `.env.example` for all configuration options:

- Server port and CORS settings
- Database path
- WebSocket configuration
- Scryfall API settings
- Logging level

### TypeScript Configuration

- `tsconfig.base.json` - Shared base configuration
- Package-specific tsconfigs extend base config
- Composite project references for proper dependency resolution

## Development Workflow

### Local Development

1. Install dependencies: `npm install`
2. Copy environment template: `cp .env.example .env`
3. Start all services: `npm run dev`
   - Client runs on port 3000 (Vite dev server)
   - Server runs on port 3001 (Express)
   - WebSocket runs on port 3002

### Building

- Build all packages: `npm run build`
- Build specific package: `npm run build --workspace=@mtgedh/server`

### Testing

- Run all tests: `npm run test`
- Test specific package: `npm run test --workspace=@mtgedh/client`

## Security Considerations

1. **Input Validation**: All client actions validated server-side
2. **Game State Authority**: Server is single source of truth
3. **Rate Limiting**: Prevent abuse of API endpoints
4. **Session Management**: Secure session tokens
5. **Environment Secrets**: Never commit `.env` files

## Scalability Considerations

Current architecture is designed for self-hosted deployment with moderate load:

- Single server instance
- SQLite for lightweight persistence
- WebSocket for real-time communication

Future scaling options:
- Redis for session management
- PostgreSQL for better concurrency
- Load balancing for multiple server instances
- Horizontal scaling with shared state

## Future Enhancements

- Spectator mode implementation
- Replay system
- Tournament bracket management
- Advanced deck statistics
- Card price integration
- Mobile responsive design
- Progressive Web App (PWA) support

## References

- [MTG Comprehensive Rules](https://magic.wizards.com/en/rules)
- [Scryfall API Documentation](https://scryfall.com/docs/api)
- [Socket.IO Documentation](https://socket.io/docs/)
- [TypeScript Handbook](https://www.typescriptlang.org/docs/)
