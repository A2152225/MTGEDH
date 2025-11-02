# MTGEDH Setup Guide

## Prerequisites
- Node.js 18+ 
- npm 9+
- Git

## Initial Setup

### 1. Clone and Install
```bash
git clone https://github.com/A2152225/MTGEDH.git
cd MTGEDH
npm install
```

### 2. Create Directory Structure
```bash
mkdir -p server/src/{services,routes}
mkdir -p client/src/{components,hooks,store,services}
mkdir -p shared/src/types
mkdir -p rules-engine/src/{abilities,validators,parsers}
mkdir -p data docs
```

### 3. Install Workspace Dependencies
```bash
npm install --workspace=server
npm install --workspace=client
npm install --workspace=shared
npm install --workspace=rules-engine
```

### 4. Environment Configuration
Create `.env` in project root:
```env
PORT=3001
DATABASE_PATH=./data/mtgedh.sqlite
CORS_ORIGIN=http://localhost:3000
SCRYFALL_API_BASE=https://api.scryfall.com
MAX_PLAYERS_PER_GAME=8
```

### 5. Start Development
```bash
npm run dev
```

This will start:
- Backend server on http://localhost:3001
- Frontend client on http://localhost:3000

## Development Workflow

### Running Tests
```bash
npm test
```

### Building for Production
```bash
npm run build
```

### Running Production Build
```bash
cd server && npm start
```

## Next Steps

1. Import your first deck
2. Create a game
3. Invite friends via game link
4. Start playing!

## Troubleshooting

### Port Already in Use
Change PORT in `.env` file

### Database Errors
Delete `data/mtgedh.sqlite` and restart

### WebSocket Connection Issues
Check CORS_ORIGIN matches your client URL
```