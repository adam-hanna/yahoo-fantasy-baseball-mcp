# Yahoo Fantasy Baseball MCP Server

MCP server for the Yahoo Fantasy Sports API. Provides 11 tools for Claude Code to read league data, search players, and execute transactions (add/drop players, set lineups).

## Features

- OAuth 2.0 authentication with automatic token refresh
- Token persistence across restarts (`.tokens.json`)
- Clear re-auth instructions when refresh tokens expire
- 8 read tools + 3 write tools

## Available Tools

### Read

| Tool | Description |
|------|-------------|
| `get_team_roster` | Player keys, names, positions for any team |
| `get_league_settings` | Scoring type, roster positions, stat categories |
| `get_league_teams` | All teams with keys, names, managers |
| `get_draft_results` | Draft picks with round, pick, team, player |
| `get_available_players` | Free agents with position/sort/pagination filters |
| `search_players` | Find players by name, filter by availability |
| `get_player_stats` | Detailed stats for a specific player |
| `get_league_standings` | Rankings, wins, losses, points |
| `get_league_transactions` | Recent adds, drops, trades, waivers |

### Write

| Tool | Description |
|------|-------------|
| `add_drop_player` | Add a free agent, drop a player, or both |
| `set_lineup` | Move players between active roster and bench |

## Setup

### 1. Yahoo API credentials

1. Go to [Yahoo Developer Network](https://developer.yahoo.com/) and create an app
2. Set the redirect URI to `https://localhost`
3. Note your Client ID and Client Secret

### 2. Get OAuth tokens

Generate self-signed certs for the local HTTPS callback server:

```bash
openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
  -keyout /tmp/yahoo_oauth_key.pem -out /tmp/yahoo_oauth_cert.pem \
  -subj "/CN=localhost"
```

Run the token script (needs root for port 443):

```bash
npm run build
sudo YAHOO_CLIENT_ID=your_id YAHOO_CLIENT_SECRET=your_secret node build/get-oauth2-token.js
```

Open the printed URL in your browser, authorize, and copy the tokens from the terminal output.

### 3. Configure MCP

Add to your `.mcp.json`:

```json
{
  "mcpServers": {
    "yahoo-fantasy-baseball": {
      "command": "node",
      "args": ["/path/to/yahoo-fantasy-baseball-mcp/build/index.js"],
      "env": {
        "YAHOO_CLIENT_ID": "your_client_id",
        "YAHOO_CLIENT_SECRET": "your_client_secret",
        "YAHOO_ACCESS_TOKEN": "your_access_token",
        "YAHOO_REFRESH_TOKEN": "your_refresh_token"
      },
      "timeout": 60,
      "transportType": "stdio"
    }
  }
}
```

### 4. Configure league

Edit the constants in `src/index.ts`:

```typescript
const LEAGUE_ID = '199298';  // Your league ID
const GAME_KEY = '469';      // MLB 2026 game key
const TEAM_ID = '6';         // Your team number
```

Build and reconnect:

```bash
npm run build
# Then /mcp in Claude Code to reconnect
```

## Token management

The server handles tokens automatically:

- **Access tokens** expire every ~60 minutes. The server refreshes them automatically on 401 responses.
- **Refresh tokens** are persisted to `.tokens.json` on every refresh. If Yahoo rotates the refresh token, the new one is saved automatically.
- **Expired refresh tokens** produce a clear error with step-by-step re-auth instructions (see below).

### Re-authenticating when your refresh token expires

Yahoo refresh tokens expire after ~2 weeks of inactivity. When this happens, the server logs:

```
========================================
REFRESH TOKEN EXPIRED OR REVOKED
========================================
To re-authenticate:
  1. cd to the MCP server directory
  2. openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
       -keyout /tmp/yahoo_oauth_key.pem -out /tmp/yahoo_oauth_cert.pem \
       -subj "/CN=localhost"
  3. sudo node build/get-oauth2-token.js
  4. Open the URL in your browser and authorize
  5. Copy the new tokens into .mcp.json env vars
  6. Reconnect with /mcp
```

## License

MIT
