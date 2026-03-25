#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ErrorCode, ListToolsRequestSchema, McpError, } from '@modelcontextprotocol/sdk/types.js';
import axios from 'axios';
import { config } from 'dotenv';
// Load environment variables
config();
const YAHOO_CLIENT_ID = process.env.YAHOO_CLIENT_ID || '';
const YAHOO_CLIENT_SECRET = process.env.YAHOO_CLIENT_SECRET || '';
const YAHOO_REFRESH_TOKEN = process.env.YAHOO_REFRESH_TOKEN || '';
let accessToken = process.env.YAHOO_ACCESS_TOKEN || '';
if (!YAHOO_CLIENT_ID || !YAHOO_CLIENT_SECRET || !YAHOO_REFRESH_TOKEN) {
    throw new Error('YAHOO_CLIENT_ID, YAHOO_CLIENT_SECRET, and YAHOO_REFRESH_TOKEN are required');
}
const LEAGUE_ID = '199298';
const GAME_KEY = '469';
const TEAM_ID = '6';
const LEAGUE_KEY = `${GAME_KEY}.l.${LEAGUE_ID}`;
async function refreshAccessToken() {
    const basicAuth = Buffer.from(`${YAHOO_CLIENT_ID}:${YAHOO_CLIENT_SECRET}`).toString('base64');
    const response = await axios.post('https://api.login.yahoo.com/oauth2/get_token', new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: YAHOO_REFRESH_TOKEN,
    }).toString(), {
        headers: {
            'Authorization': `Basic ${basicAuth}`,
            'Content-Type': 'application/x-www-form-urlencoded',
        },
    });
    accessToken = response.data.access_token;
    console.error('Access token refreshed successfully');
    return accessToken;
}
class YahooFantasyBaseballServer {
    server;
    axiosInstance;
    constructor() {
        this.server = new Server({
            name: 'yahoo-fantasy-baseball-server',
            version: '0.1.0',
        }, {
            capabilities: {
                tools: {},
            },
        });
        this.axiosInstance = axios.create({
            baseURL: 'https://fantasysports.yahooapis.com/fantasy/v2',
            headers: {
                'Content-Type': 'application/json',
            },
        });
        this.setupToolHandlers();
        // Error handling
        this.server.onerror = (error) => console.error('[MCP Error]', error);
        process.on('SIGINT', async () => {
            await this.server.close();
            process.exit(0);
        });
    }
    /**
     * Make an authenticated GET request to the Yahoo Fantasy API.
     * Automatically refreshes the access token on 401 and retries once.
     */
    async yahooGet(url, params) {
        try {
            return await this.axiosInstance.get(url, {
                headers: { 'Authorization': `Bearer ${accessToken}` },
                params: { format: 'json', ...params },
            });
        }
        catch (error) {
            if (axios.isAxiosError(error) && error.response?.status === 401) {
                await refreshAccessToken();
                return await this.axiosInstance.get(url, {
                    headers: { 'Authorization': `Bearer ${accessToken}` },
                    params: { format: 'json', ...params },
                });
            }
            throw error;
        }
    }
    async yahooPost(url, xmlBody) {
        const headers = { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/xml' };
        try {
            return await this.axiosInstance.post(url, xmlBody, { headers, params: { format: 'json' } });
        }
        catch (error) {
            if (axios.isAxiosError(error) && error.response?.status === 401) {
                await refreshAccessToken();
                headers['Authorization'] = `Bearer ${accessToken}`;
                return await this.axiosInstance.post(url, xmlBody, { headers, params: { format: 'json' } });
            }
            throw error;
        }
    }
    async yahooPut(url, xmlBody) {
        const headers = { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/xml' };
        try {
            return await this.axiosInstance.put(url, xmlBody, { headers, params: { format: 'json' } });
        }
        catch (error) {
            if (axios.isAxiosError(error) && error.response?.status === 401) {
                await refreshAccessToken();
                headers['Authorization'] = `Bearer ${accessToken}`;
                return await this.axiosInstance.put(url, xmlBody, { headers, params: { format: 'json' } });
            }
            throw error;
        }
    }
    setupToolHandlers() {
        this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
            tools: [
                {
                    name: 'get_team_roster',
                    description: 'Retrieve a team roster with player keys, names, positions, and teams',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            team_key: {
                                type: 'string',
                                description: 'Yahoo team key (e.g., 469.l.199298.t.6). Uses your team if not provided.',
                            },
                        },
                        additionalProperties: false,
                    },
                },
                {
                    name: 'get_league_settings',
                    description: 'Get league settings: scoring type, roster positions, stat categories, and stat modifiers',
                    inputSchema: {
                        type: 'object',
                        properties: {},
                        additionalProperties: false,
                    },
                },
                {
                    name: 'get_league_teams',
                    description: 'Get all teams in the league with team keys, names, and managers',
                    inputSchema: {
                        type: 'object',
                        properties: {},
                        additionalProperties: false,
                    },
                },
                {
                    name: 'get_draft_results',
                    description: 'Get draft results: picks made so far with round, pick number, team_key, and player_key',
                    inputSchema: {
                        type: 'object',
                        properties: {},
                        additionalProperties: false,
                    },
                },
                {
                    name: 'get_available_players',
                    description: 'Get available (undrafted) players with optional position filter, sorting, and pagination. Returns 25 per page.',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            start: {
                                type: 'number',
                                description: 'Pagination offset (default 0). Yahoo returns 25 players per page.',
                            },
                            count: {
                                type: 'number',
                                description: 'Number of players to return (default 25, max 25)',
                            },
                            position: {
                                type: 'string',
                                description: 'Filter by position: C, 1B, 2B, SS, 3B, OF, SP, RP, DH, Util',
                            },
                            sort: {
                                type: 'string',
                                description: 'Sort field: AR (avg rank), OR (overall rank), PTS (points), or a stat_id number',
                            },
                            sort_type: {
                                type: 'string',
                                description: 'Sort type: season, week, lastweek, lastmonth',
                            },
                            sort_season: {
                                type: 'string',
                                description: 'Season year for sort (e.g., 2025)',
                            },
                        },
                        additionalProperties: false,
                    },
                },
                {
                    name: 'search_players',
                    description: 'Search for players by name, optionally filtered by availability status',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            query: {
                                type: 'string',
                                description: 'Player name to search for',
                            },
                            status: {
                                type: 'string',
                                description: 'Filter: A (available), T (taken), W (waivers). Omit for all.',
                            },
                        },
                        required: ['query'],
                        additionalProperties: false,
                    },
                },
                {
                    name: 'get_player_stats',
                    description: 'Get detailed stats for a specific player by player_key',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            player_key: {
                                type: 'string',
                                description: 'Yahoo player key (e.g., 469.p.12345)',
                            },
                            stat_type: {
                                type: 'string',
                                description: 'Type of stats: season, date, week (default: season)',
                            },
                            season: {
                                type: 'string',
                                description: 'Season year (default: current)',
                            },
                        },
                        required: ['player_key'],
                        additionalProperties: false,
                    },
                },
                {
                    name: 'get_league_standings',
                    description: 'Get current league standings with rank, wins, losses, and points',
                    inputSchema: {
                        type: 'object',
                        properties: {},
                        additionalProperties: false,
                    },
                },
                {
                    name: 'get_league_transactions',
                    description: 'Get recent league transactions (adds, drops, trades, waivers)',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            type: {
                                type: 'string',
                                description: 'Filter by type: add, drop, trade, waiver. Omit for all.',
                            },
                            team_key: {
                                type: 'string',
                                description: 'Filter by team key. Omit for all teams.',
                            },
                            count: {
                                type: 'number',
                                description: 'Number of transactions to return (default 25)',
                            },
                        },
                        additionalProperties: false,
                    },
                },
                {
                    name: 'add_drop_player',
                    description: 'Add a free agent and/or drop a player from your team. Provide add_player_key, drop_player_key, or both.',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            add_player_key: {
                                type: 'string',
                                description: 'Player key to add (e.g., 469.p.12345)',
                            },
                            drop_player_key: {
                                type: 'string',
                                description: 'Player key to drop (e.g., 469.p.67890)',
                            },
                        },
                        additionalProperties: false,
                    },
                },
                {
                    name: 'set_lineup',
                    description: 'Set player positions in your lineup. Moves players between active roster slots and bench.',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            players: {
                                type: 'array',
                                description: 'Array of {player_key, position} objects. Position can be: C, 1B, 2B, 3B, SS, OF, Util, SP, RP, P, BN, IL',
                                items: {
                                    type: 'object',
                                    properties: {
                                        player_key: { type: 'string' },
                                        position: { type: 'string' },
                                    },
                                    required: ['player_key', 'position'],
                                },
                            },
                            date: {
                                type: 'string',
                                description: 'Date for daily leagues (YYYY-MM-DD). Omit for weekly.',
                            },
                            week: {
                                type: 'number',
                                description: 'Week number for weekly leagues. Omit for daily.',
                            },
                        },
                        required: ['players'],
                        additionalProperties: false,
                    },
                },
            ],
        }));
        this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
            try {
                switch (request.params.name) {
                    case 'get_team_roster':
                        return await this.getTeamRoster(request.params.arguments);
                    case 'get_league_settings':
                        return await this.getLeagueSettings();
                    case 'get_league_teams':
                        return await this.getLeagueTeams();
                    case 'get_draft_results':
                        return await this.getDraftResults();
                    case 'get_available_players':
                        return await this.getAvailablePlayers(request.params.arguments);
                    case 'search_players':
                        return await this.searchPlayers(request.params.arguments);
                    case 'get_player_stats':
                        return await this.getPlayerStats(request.params.arguments);
                    case 'get_league_standings':
                        return await this.getLeagueStandings();
                    case 'get_league_transactions':
                        return await this.getLeagueTransactions(request.params.arguments);
                    case 'add_drop_player':
                        return await this.addDropPlayer(request.params.arguments);
                    case 'set_lineup':
                        return await this.setLineup(request.params.arguments);
                    default:
                        throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${request.params.name}`);
                }
            }
            catch (error) {
                if (axios.isAxiosError(error)) {
                    return {
                        content: [
                            {
                                type: 'text',
                                text: `Yahoo API error: ${error.response?.data ? JSON.stringify(error.response.data, null, 2) : error.message}`,
                            },
                        ],
                        isError: true,
                    };
                }
                throw error;
            }
        });
    }
    /**
     * Flatten Yahoo's player info array (array of single-key objects) into one object.
     * e.g. [{player_key: "469.p.123"}, {name: {full: "..."}}, ...] => {player_key, name, ...}
     */
    flattenPlayerInfo(infoArray) {
        const flat = {};
        for (const item of infoArray) {
            if (item && typeof item === 'object' && !Array.isArray(item)) {
                Object.assign(flat, item);
            }
        }
        return flat;
    }
    parsePlayersFromResponse(playersObj) {
        return Object.values(playersObj)
            .filter((item) => typeof item === 'object' && item.player)
            .map((item) => {
            const infoArray = item.player[0]; // array of single-key objects
            const info = this.flattenPlayerInfo(infoArray);
            const statsSection = item.player[1]?.player_stats?.stats || item.player[1]?.player_advanced_stats?.stats || [];
            return {
                player_key: info.player_key,
                name: info.name?.full,
                team: info.editorial_team_abbr,
                positions: info.display_position,
                eligible_positions: (info.eligible_positions || []).map((p) => p.position),
                stats: Array.isArray(statsSection)
                    ? statsSection.map((s) => ({ stat_id: s.stat?.stat_id, value: s.stat?.value }))
                    : [],
            };
        });
    }
    jsonResponse(data) {
        return {
            content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
        };
    }
    async getTeamRoster(args) {
        const teamKey = args?.team_key || `${GAME_KEY}.l.${LEAGUE_ID}.t.${TEAM_ID}`;
        const response = await this.yahooGet(`/team/${teamKey}/roster/players`);
        const roster = response.data.fantasy_content.team[1].roster[0].players;
        const players = this.parsePlayersFromResponse(roster);
        return this.jsonResponse({ players });
    }
    async getLeagueSettings() {
        const response = await this.yahooGet(`/league/${LEAGUE_KEY}/settings`);
        const league = response.data.fantasy_content.league;
        const meta = league[0];
        const settings = league[1].settings[0];
        const roster_positions = (settings.roster_positions || []).map((rp) => ({
            position: rp.roster_position.position,
            count: rp.roster_position.count,
        }));
        const stat_categories = (settings.stat_categories?.stats || []).map((s) => ({
            stat_id: s.stat.stat_id,
            name: s.stat.name,
            display_name: s.stat.display_name,
            sort_order: s.stat.sort_order,
            position_type: s.stat.position_type,
            is_only_display_stat: s.stat.is_only_display_stat,
        }));
        const stat_modifiers = (settings.stat_modifiers?.stats || []).map((s) => ({
            stat_id: s.stat.stat_id,
            value: s.stat.value,
        }));
        return this.jsonResponse({
            league_key: meta.league_key,
            name: meta.name,
            num_teams: meta.num_teams,
            scoring_type: meta.scoring_type,
            draft_status: meta.draft_status,
            roster_positions,
            stat_categories,
            stat_modifiers,
        });
    }
    async getLeagueTeams() {
        const response = await this.yahooGet(`/league/${LEAGUE_KEY}/teams`);
        const teamsObj = response.data.fantasy_content.league[1].teams;
        const teams = Object.values(teamsObj)
            .filter((item) => typeof item === 'object' && item.team)
            .map((item) => {
            const info = this.flattenPlayerInfo(item.team[0]);
            return {
                team_key: info.team_key,
                team_id: info.team_id,
                name: info.name,
                manager: info.managers?.[0]?.manager?.nickname || 'Unknown',
            };
        });
        return this.jsonResponse({ teams });
    }
    async getDraftResults() {
        const response = await this.yahooGet(`/league/${LEAGUE_KEY}/draftresults`);
        const draftsObj = response.data.fantasy_content.league[1].draft_results;
        const draft_results = Object.values(draftsObj)
            .filter((item) => typeof item === 'object' && item.draft_result)
            .map((item) => ({
            pick: item.draft_result.pick,
            round: item.draft_result.round,
            team_key: item.draft_result.team_key,
            player_key: item.draft_result.player_key,
            cost: item.draft_result.cost,
        }));
        return this.jsonResponse({ draft_results, total_picks: draft_results.length });
    }
    async getAvailablePlayers(args) {
        let url = `/league/${LEAGUE_KEY}/players;status=A`;
        if (args?.position)
            url += `;position=${args.position}`;
        if (args?.sort)
            url += `;sort=${args.sort}`;
        if (args?.sort_type)
            url += `;sort_type=${args.sort_type}`;
        if (args?.sort_season)
            url += `;sort_season=${args.sort_season}`;
        const params = {};
        if (args?.start != null)
            params.start = String(args.start);
        if (args?.count != null)
            params.count = String(args.count);
        const response = await this.yahooGet(url, params);
        const playersObj = response.data.fantasy_content.league[1].players;
        const count = playersObj?.count ?? 0;
        const players = this.parsePlayersFromResponse(playersObj || {});
        return this.jsonResponse({ players, total_available: count, start: args?.start || 0 });
    }
    async searchPlayers(args) {
        let url = `/league/${LEAGUE_KEY}/players;search=${encodeURIComponent(args.query)}`;
        if (args?.status)
            url += `;status=${args.status}`;
        const response = await this.yahooGet(url);
        const playersObj = response.data.fantasy_content.league[1].players;
        const players = this.parsePlayersFromResponse(playersObj || {});
        return this.jsonResponse({ players });
    }
    async getPlayerStats(args) {
        let url = `/player/${args.player_key}/stats`;
        if (args?.stat_type)
            url += `;type=${args.stat_type}`;
        if (args?.season)
            url += `;season=${args.season}`;
        const response = await this.yahooGet(url);
        const player = response.data.fantasy_content.player;
        const info = this.flattenPlayerInfo(player[0]);
        const stats = (player[1]?.player_stats?.stats || []).map((s) => ({
            stat_id: s.stat?.stat_id,
            value: s.stat?.value,
        }));
        return this.jsonResponse({
            player_key: info.player_key,
            name: info.name?.full,
            team: info.editorial_team_abbr,
            positions: info.display_position,
            stats,
        });
    }
    async getLeagueStandings() {
        const response = await this.yahooGet(`/league/${LEAGUE_KEY}/standings`);
        const teamsObj = response.data.fantasy_content.league[1].standings[0].teams;
        const standings = Object.values(teamsObj)
            .filter((item) => typeof item === 'object' && item.team)
            .map((item) => {
            const info = this.flattenPlayerInfo(item.team[0]);
            const teamStandings = item.team[2]?.team_standings;
            return {
                team_key: info.team_key,
                team_name: info.name,
                rank: teamStandings?.rank,
                wins: teamStandings?.outcome_totals?.wins,
                losses: teamStandings?.outcome_totals?.losses,
                ties: teamStandings?.outcome_totals?.ties,
                points_for: teamStandings?.points_for,
                points_against: teamStandings?.points_against,
            };
        });
        return this.jsonResponse({ standings });
    }
    async getLeagueTransactions(args) {
        let url = `/league/${LEAGUE_KEY}/transactions`;
        const params = {};
        if (args?.type)
            params.type = args.type;
        if (args?.team_key)
            params.team_key = args.team_key;
        if (args?.count != null)
            params.count = String(args.count);
        const response = await this.yahooGet(url, params);
        const txObj = response.data.fantasy_content.league[1].transactions;
        const transactions = Object.values(txObj || {})
            .filter((item) => typeof item === 'object' && item.transaction)
            .map((item) => {
            const tx = item.transaction;
            const meta = tx[0];
            const playersObj = tx[1]?.players;
            const players = playersObj
                ? Object.values(playersObj)
                    .filter((p) => typeof p === 'object' && p.player)
                    .map((p) => {
                    const info = this.flattenPlayerInfo(p.player[0]);
                    const txData = p.player[1]?.transaction_data;
                    return {
                        player_key: info.player_key,
                        name: info.name?.full,
                        team: info.editorial_team_abbr,
                        positions: info.display_position,
                        transaction_data: txData ? (Array.isArray(txData) ? txData[0] : txData) : {},
                    };
                })
                : [];
            return {
                transaction_key: meta.transaction_key,
                type: meta.type,
                status: meta.status,
                timestamp: meta.timestamp,
                players,
            };
        });
        return this.jsonResponse({ transactions });
    }
    async addDropPlayer(args) {
        const addKey = args?.add_player_key;
        const dropKey = args?.drop_player_key;
        const teamKey = `${GAME_KEY}.l.${LEAGUE_ID}.t.${TEAM_ID}`;
        if (!addKey && !dropKey) {
            throw new McpError(ErrorCode.InvalidParams, 'Provide add_player_key, drop_player_key, or both');
        }
        let type;
        let playersXml;
        if (addKey && dropKey) {
            type = 'add/drop';
            playersXml = `
    <players>
      <player>
        <player_key>${addKey}</player_key>
        <transaction_data>
          <type>add</type>
          <destination_team_key>${teamKey}</destination_team_key>
        </transaction_data>
      </player>
      <player>
        <player_key>${dropKey}</player_key>
        <transaction_data>
          <type>drop</type>
          <source_team_key>${teamKey}</source_team_key>
        </transaction_data>
      </player>
    </players>`;
        }
        else if (addKey) {
            type = 'add';
            playersXml = `
    <player>
      <player_key>${addKey}</player_key>
      <transaction_data>
        <type>add</type>
        <destination_team_key>${teamKey}</destination_team_key>
      </transaction_data>
    </player>`;
        }
        else {
            type = 'drop';
            playersXml = `
    <player>
      <player_key>${dropKey}</player_key>
      <transaction_data>
        <type>drop</type>
        <source_team_key>${teamKey}</source_team_key>
      </transaction_data>
    </player>`;
        }
        const xml = `<?xml version="1.0" encoding="UTF-8"?>
<fantasy_content>
  <transaction>
    <type>${type}</type>${playersXml}
  </transaction>
</fantasy_content>`;
        const response = await this.yahooPost(`/league/${LEAGUE_KEY}/transactions`, xml);
        return this.jsonResponse({ success: true, data: response.data });
    }
    async setLineup(args) {
        const players = args?.players;
        if (!players || !Array.isArray(players) || players.length === 0) {
            throw new McpError(ErrorCode.InvalidParams, 'Provide a non-empty players array');
        }
        let coverageXml = '';
        if (args?.date) {
            coverageXml = `<coverage_type>date</coverage_type>\n    <date>${args.date}</date>`;
        }
        else if (args?.week) {
            coverageXml = `<coverage_type>week</coverage_type>\n    <week>${args.week}</week>`;
        }
        const playersXml = players
            .map((p) => `      <player>\n        <player_key>${p.player_key}</player_key>\n        <position>${p.position}</position>\n      </player>`)
            .join('\n');
        const xml = `<?xml version="1.0" encoding="UTF-8"?>
<fantasy_content>
  <roster>
    ${coverageXml}
    <players>
${playersXml}
    </players>
  </roster>
</fantasy_content>`;
        const teamKey = `${GAME_KEY}.l.${LEAGUE_ID}.t.${TEAM_ID}`;
        const response = await this.yahooPut(`/team/${teamKey}/roster`, xml);
        return this.jsonResponse({ success: true, data: response.data });
    }
    async run() {
        const transport = new StdioServerTransport();
        await this.server.connect(transport);
        console.error('Yahoo Fantasy Baseball MCP server running on stdio');
    }
}
const server = new YahooFantasyBaseballServer();
server.run().catch(console.error);
//# sourceMappingURL=index.js.map