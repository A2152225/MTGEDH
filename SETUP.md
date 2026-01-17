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
mkdir -p data docs logs
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

### Type Checking
```bash
npm run typecheck
```

### Running Tests
```bash
npm test
```

To run the server Vitest suite (socket/state integration tests):
```bash
npm run test:server
```

### Building for Production
```bash
npm run build
```

### Linting
Linting is not currently configured; `npm run lint` intentionally fails with a helpful message.

### Running Production Build
```bash
cd server && npm start
```

## Production Deployment with PM2 and IIS

This section covers deploying the MTGEDH server using PM2 for process management and IIS as a reverse proxy.

### Prerequisites for Production

1. **Node.js 18+** installed on the server
2. **PM2** installed globally:
   ```bash
   npm install -g pm2
   ```
3. **IIS** with the following features:
   - URL Rewrite module
   - Application Request Routing (ARR)
   - WebSocket Protocol support

### Installing IIS Modules

1. **URL Rewrite Module**:
   - Download from: https://www.iis.net/downloads/microsoft/url-rewrite
   - Or via Web Platform Installer

2. **Application Request Routing (ARR)**:
   - Download from: https://www.iis.net/downloads/microsoft/application-request-routing
   - Or via Web Platform Installer

3. **Enable WebSocket Protocol**:
   - Open Server Manager
   - Add Roles and Features
   - Navigate to: Web Server (IIS) > Web Server > Application Development
   - Check "WebSocket Protocol"

### PM2 Setup

1. **Start the server with PM2**:
   ```bash
   # Development mode
   pm2 start ecosystem.config.cjs

   # Production mode
   pm2 start ecosystem.config.cjs --env production
   ```

2. **PM2 Commands**:
   ```bash
   # View logs
   pm2 logs mtgedh-server

   # Monitor processes
   pm2 monit

   # Restart server
   pm2 restart mtgedh-server

   # Stop server
   pm2 stop mtgedh-server

   # Delete from PM2
   pm2 delete mtgedh-server
   ```

3. **Set PM2 to start on boot**:
   ```bash
   pm2 startup
   pm2 save
   ```

### IIS Configuration

1. **Enable ARR Proxy**:
   - Open IIS Manager
   - Select the server node
   - Double-click "Application Request Routing Cache"
   - Click "Server Proxy Settings"
   - Check "Enable proxy"
   - Click "Apply"

2. **Create IIS Site**:
   - Add a new website in IIS Manager
   - Set the physical path to your MTGEDH project directory (where `web.config` is located)
   - Bind to your desired port/hostname

3. **Copy Client Build**:
   ```bash
   # Build the client
   npm run build --workspace=client

   # The build output is in client/dist/
   # Copy contents to your IIS site root if serving static files from IIS
   ```

4. **Verify Configuration**:
   - The included `web.config` handles:
     - WebSocket connections for Socket.IO
     - API request proxying to the Node.js server
     - SPA fallback routing for client-side navigation
     - Static file serving with proper MIME types
     - CORS headers

### Testing the Deployment

1. **Start PM2**:
   ```bash
   pm2 start ecosystem.config.cjs --env production
   ```

2. **Verify PM2 is running**:
   ```bash
   pm2 status
   ```

3. **Check IIS site is accessible**:
   - Navigate to your IIS site URL
   - The client should load
   - WebSocket connections should work

4. **Check logs if issues occur**:
   ```bash
   pm2 logs mtgedh-server
   ```

### Troubleshooting Production

#### WebSocket Connection Issues
- Ensure WebSocket Protocol is enabled in IIS features
- Verify ARR proxy is enabled
- Check that the `web.config` URL Rewrite rules are correct
- Confirm the Node.js server is running on port 3001

#### 502 Bad Gateway Errors
- Verify PM2 is running: `pm2 status`
- Check if the server started: `pm2 logs mtgedh-server`
- Ensure the port in `web.config` matches the PM2 configuration

#### CORS Issues
- Update `CORS_ORIGIN` in `.env` to match your production domain
- The `web.config` includes permissive CORS headers for development

#### ARR Proxy Not Working
- Ensure ARR is installed and enabled
- Check Server Proxy Settings in IIS Manager
- Verify the proxy is enabled at the server level

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