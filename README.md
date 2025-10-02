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

## Architecture

- **Client-Server Model**: Centralized server for game state authority
- **WebSocket Communication**: Real-time bidirectional updates
- **Self-Hosted**: Run on your own hardware, no cloud costs
- **Modular Design**: Extensible rules engine for adding new cards/mechanics

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