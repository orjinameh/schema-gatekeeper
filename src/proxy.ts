/**
 * MCP Proxy — spawns and connects to real MCP servers via stdio.
 *
 * Maintains a pool of persistent connections, one per server config.
 * Lazily connects on first tool invocation per category.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  StdioClientTransport,
  type StdioServerParameters,
} from "@modelcontextprotocol/sdk/client/stdio.js";
import type { ToolSchema } from "./types.js";
import path from "node:path";
import fs from "node:fs";

// Find project root by walking up to find package.json
function findProjectRoot(): string {
  let dir = process.cwd();
  while (dir !== path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, "package.json"))) return dir;
    dir = path.dirname(dir);
  }
  return process.cwd();
}

const PROJECT_ROOT = findProjectRoot();

// ─── Server Config Mapping ──────────────────────────────────────────────────
//
// Maps tool names to the MCP server that provides those tools.
// Uses local node_modules for fast spawning.

export interface ServerConfig {
  command: string;
  args: string[];
  env?: Record<string, string>;
  allowedDirs?: string[];
}

const FILESYSTEM_SERVER = path.join(
  PROJECT_ROOT,
  "node_modules/@modelcontextprotocol/server-filesystem/dist/index.js"
);

// Map: toolName → server config
const TOOL_SERVER_MAP: Record<string, ServerConfig> = {
  // File operations → @modelcontextprotocol/server-filesystem
  read_file: {
    command: process.execPath,
    args: [FILESYSTEM_SERVER, "/tmp", "/home"],
  },
  write_file: {
    command: process.execPath,
    args: [FILESYSTEM_SERVER, "/tmp", "/home"],
  },
  list_directory: {
    command: process.execPath,
    args: [FILESYSTEM_SERVER, "/tmp", "/home"],
  },
  search_files: {
    command: process.execPath,
    args: [FILESYSTEM_SERVER, "/tmp", "/home"],
  },

  // Database → @modelcontextprotocol/server-sqlite (if available)
  // For now, these stay simulated — no real SQLite server installed yet

  // Web search → simulated (brave API needs API key)

  // Browser → simulated (puppeteer MCP needs setup)

  // Git → simulated (could wire to a git MCP server)

  // AI inference → simulated

  // System → simulated
};

// ─── Connection Pool ─────────────────────────────────────────────────────────

interface PooledConnection {
  client: Client;
  transport: StdioClientTransport;
  serverName: string;
  connected: boolean;
}

const connectionPool = new Map<string, PooledConnection>();

/**
 * Get or create a connection to the MCP server that handles a given tool.
 */
async function getConnection(
  toolName: string
): Promise<PooledConnection | null> {
  const config = TOOL_SERVER_MAP[toolName];
  if (!config) return null;

  // Use the command as the pool key (same server = same connection)
  const poolKey = `${config.command}:${config.args.join(" ")}`;

  const existing = connectionPool.get(poolKey);
  if (existing?.connected) return existing;

  // Spawn new connection
  const transport = new StdioClientTransport({
    command: config.command,
    args: config.args,
    env: config.env,
    stderr: "pipe",
  });

  const client = new Client(
    { name: "schema-gatekeeper", version: "1.0.0" },
    { capabilities: {} }
  );

  try {
    await client.connect(transport);
  } catch (err) {
    console.error(
      `[proxy] Failed to connect to server for tools: ${err instanceof Error ? err.message : String(err)}`
    );
    throw err;
  }

  const conn: PooledConnection = {
    client,
    transport,
    serverName: poolKey,
    connected: true,
  };

  connectionPool.set(poolKey, conn);
  return conn;
}

/**
 * Map our tool name to the actual tool name on the upstream MCP server.
 * The filesystem server exposes tools with different names than ours.
 */
function mapToolName(upstreamToolName: string): string {
  // Our names → filesystem server names
  const nameMap: Record<string, string> = {
    read_file: "read_file",
    write_file: "write_file",
    list_directory: "list_directory",
    search_files: "search_files",
  };
  return nameMap[upstreamToolName] ?? upstreamToolName;
}

// ─── Public API ──────────────────────────────────────────────────────────────

export interface ProxyResult {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}

/**
 * Forward a tool call to the real MCP server.
 * Returns null if no server is configured for this tool (use simulated fallback).
 */
export async function proxyToolCall(
  toolName: string,
  payload: Record<string, unknown>
): Promise<ProxyResult | null> {
  const conn = await getConnection(toolName);
  if (!conn) {
    console.error(`[proxy] No backend configured for "${toolName}"`);
    return null;
  }

  try {
    const upstreamName = mapToolName(toolName);
    console.error(
      `[proxy] Calling "${upstreamName}" on upstream server...`
    );
    const result = await conn.client.callTool({
      name: upstreamName,
      arguments: payload,
    });

    // Normalize the result to our format
    if (result && typeof result === "object" && "content" in result) {
      return {
        content: (result as { content: Array<{ type: string; text: string }> })
          .content as Array<{ type: "text"; text: string }>,
        isError: (result as { isError?: boolean }).isError,
      };
    }

    // Fallback: stringify whatever came back
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  } catch (err) {
    return {
      content: [
        {
          type: "text",
          text: `Proxy error calling "${toolName}": ${err instanceof Error ? err.message : String(err)}`,
        },
      ],
      isError: true,
    };
  }
}

/**
 * Check if a tool has a real backend server configured.
 */
export function hasRealBackend(toolName: string): boolean {
  return toolName in TOOL_SERVER_MAP;
}

/**
 * Get the list of tools that have real backends.
 */
export function getRealBackendTools(): string[] {
  return Object.keys(TOOL_SERVER_MAP);
}

/**
 * Gracefully close all pooled connections.
 */
export async function closeAllConnections(): Promise<void> {
  for (const [, conn] of connectionPool) {
    if (conn.connected) {
      try {
        await conn.transport.close();
        conn.connected = false;
      } catch {
        // Ignore close errors
      }
    }
  }
  connectionPool.clear();
}
