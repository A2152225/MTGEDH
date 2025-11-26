# IIS Setup Guide for MTGEDH

This guide explains how to configure IIS (Internet Information Services) on Windows to serve the MTGEDH application online.

## Prerequisites

Before starting, ensure you have installed the following IIS features:

1. **IIS Core Components**
2. **URL Rewrite Module** (from [iis.net](https://www.iis.net/downloads/microsoft/url-rewrite))
3. **Application Request Routing (ARR)** (from [iis.net](https://www.iis.net/downloads/microsoft/application-request-routing))
4. **WebSocket Protocol** (IIS Windows Feature)

## Installing Required IIS Features

### Install WebSocket Protocol

1. Open **Server Manager** (or **Turn Windows features on or off** on Windows 10/11)
2. Navigate to **Manage** → **Add Roles and Features**
3. Under **Web Server (IIS)** → **Web Server** → **Application Development**
4. Enable **WebSocket Protocol**
5. Complete the installation wizard

### Enable ARR Proxy

After installing ARR, you must enable the proxy functionality:

1. Open **IIS Manager**
2. Select your **server node** (top level)
3. Double-click **Application Request Routing Cache**
4. Click **Server Proxy Settings** in the right Actions pane
5. Check **Enable proxy**
6. Click **Apply**

## Deployment Steps

### 1. Build the Client

From the repository root:

```bash
npm install
npm run build --workspace=client
```

This creates the production build in `client/dist/`.

### 2. Configure IIS Site

1. Open **IIS Manager**
2. Right-click **Sites** → **Add Website**
3. Configure:
   - **Site name**: MTGEDH (or your preferred name)
   - **Physical path**: `<repository-path>/client/dist`
   - **Binding**: 
     - Type: http (or https with certificate)
     - IP address: All Unassigned
     - Port: 80 (or 443 for HTTPS)
     - Host name: `magic.A2Games.win`
4. Click **OK**

### 3. Verify web.config

The `client/public/web.config` file is automatically copied to `client/dist/` during the build. It contains the necessary rewrite rules:

- **`/api/*`** → Proxied to Node.js server at `http://127.0.0.1:3001`
- **`/socket.io/*`** → Proxied to Node.js server for WebSocket connections
- **SPA fallback** → All other routes serve `index.html` for React Router

### 4. Start the Node.js Server

The backend server must be running for the application to function. Start it with:

```bash
cd server
npm start
```

For production, use a process manager like PM2:

```bash
npm install -g pm2
cd server
pm2 start "npm start" --name mtgedh-server
pm2 save
pm2 startup  # Configure auto-start on boot
```

### 5. Configure Environment

Create a `.env` file in the server directory (or project root):

```env
PORT=3001
NODE_ENV=production
CORS_ORIGIN=http://magic.A2Games.win
SQLITE_FILE=./data/mtgedh.sqlite
```

Note: Update `CORS_ORIGIN` if using HTTPS: `https://magic.A2Games.win`

### 6. Firewall Configuration

Ensure port 80 (or 443) is open in Windows Firewall for inbound connections:

```powershell
# PowerShell (Run as Administrator)
New-NetFirewallRule -DisplayName "HTTP (80)" -Direction Inbound -Protocol TCP -LocalPort 80 -Action Allow
```

## Verification

1. Open a browser and navigate to `http://magic.A2Games.win`
2. Open browser Developer Tools (F12) → Console tab
3. You should see: `[client] connected: <socket-id>`
4. If you see connection errors, check:
   - Node.js server is running on port 3001
   - ARR proxy is enabled
   - WebSocket Protocol is installed

## Troubleshooting

### Connection Refused / Timeout

- Verify the Node.js server is running: `netstat -an | findstr 3001`
- Check server logs for errors

### 502 Bad Gateway

- ARR proxy may not be enabled (see "Enable ARR Proxy" section)
- Node.js server may have crashed

### WebSocket Upgrade Failed

- WebSocket Protocol feature may not be installed
- Check that `webSocket enabled="true"` is in web.config
- Ensure ARR is properly configured for WebSocket proxying

### CORS Errors

- Update `CORS_ORIGIN` in `.env` to match your exact domain
- Restart the Node.js server after changing environment variables

## HTTPS Configuration (Recommended)

For production, use HTTPS with a valid SSL certificate:

1. Obtain an SSL certificate (e.g., from Let's Encrypt using win-acme)
2. Add HTTPS binding in IIS with the certificate
3. Update `CORS_ORIGIN` to `https://magic.A2Games.win`
4. Update client Socket.IO URL if explicitly set

## Architecture Overview

```
                    ┌─────────────────────┐
                    │   Client Browser    │
                    └──────────┬──────────┘
                               │
                               ▼ Port 80/443
                    ┌─────────────────────┐
                    │        IIS          │
                    │   (URL Rewrite)     │
                    └──────────┬──────────┘
                               │
           ┌───────────────────┼───────────────────┐
           │                   │                   │
           ▼                   ▼                   ▼
    ┌─────────────┐    ┌─────────────┐    ┌─────────────┐
    │ Static Files│    │  /api/*     │    │/socket.io/* │
    │ (dist/)     │    │  → :3001    │    │  → :3001    │
    └─────────────┘    └──────┬──────┘    └──────┬──────┘
                              │                  │
                              ▼                  ▼
                    ┌─────────────────────────────────┐
                    │      Node.js Server (:3001)     │
                    │   Express + Socket.IO           │
                    └─────────────────────────────────┘
```
