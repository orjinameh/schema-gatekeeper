/**
 * HTTP server wrapper for Schema Gatekeeper MCP proxy.
 * Provides a web UI and REST API for demo/evaluation.
 *
 * Usage: node --import tsx/esm src/server.ts
 * Env:   PORT=3000 DATAHUB_GMS_URL=http://localhost:8080
 */

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  StdioClientTransport,
} from "@modelcontextprotocol/sdk/client/stdio.js";

const PORT = parseInt(process.env.PORT || "3000", 10);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, "..", "public");

const PROJECT_ROOT = path.join(__dirname, "..");

async function createProxyClient(): Promise<Client> {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["--import", "tsx/esm", path.join(__dirname, "index.ts")],
    env: { ...process.env, GATEKEEPER_PROJECT_ROOT: PROJECT_ROOT },
  });
  const client = new Client({ name: "web-demo", version: "1.0.0" });
  await client.connect(transport);
  return client;
}

async function handleApi(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  body: string
) {
  const url = new URL(req.url!, `http://localhost:${PORT}`);

  try {
    if (url.pathname === "/api/discover") {
      const { category } = JSON.parse(body);
      const client = await createProxyClient();
      const result = await client.callTool({
        name: "request_skills",
        arguments: { category },
      });
      await client.close();
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(result));
    } else if (url.pathname === "/api/invoke") {
      const { tool, args } = JSON.parse(body);
      const client = await createProxyClient();
      const result = await client.callTool({
        name: "invoke_skill",
        arguments: { toolName: tool, payload: args },
      });
      await client.close();
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(result));
    } else if (url.pathname === "/api/search") {
      const { query } = JSON.parse(body);
      const client = await createProxyClient();
      const result = await client.callTool({
        name: "search_tools",
        arguments: { query },
      });
      await client.close();
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(result));
    } else if (url.pathname === "/api/tools") {
      const client = await createProxyClient();
      const result = await client.listTools();
      await client.close();
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(result));
    } else {
      res.writeHead(404);
      res.end("Not found");
    }
  } catch (err: any) {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: err.message }));
  }
}

function serveStatic(req: http.IncomingMessage, res: http.ServerResponse) {
  const url = new URL(req.url!, `http://localhost:${PORT}`);
  let filePath = path.join(PUBLIC_DIR, url.pathname === "/" ? "index.html" : url.pathname);

  if (!fs.existsSync(filePath)) {
    res.writeHead(404);
    res.end("Not found");
    return;
  }

  const ext = path.extname(filePath);
  const types: Record<string, string> = {
    ".html": "text/html",
    ".js": "application/javascript",
    ".css": "text/css",
    ".json": "application/json",
    ".png": "image/png",
    ".svg": "image/svg+xml",
  };
  res.writeHead(200, { "Content-Type": types[ext] || "text/plain" });
  fs.createReadStream(filePath).pipe(res);
}

const server = http.createServer(async (req, res) => {
  if (req.url?.startsWith("/api/")) {
    let body = "";
    for await (const chunk of req) body += chunk;
    return handleApi(req, res, body);
  }
  serveStatic(req, res);
});

server.listen(PORT, () => {
  console.log(`\n  Schema Gatekeeper demo server running at http://localhost:${PORT}\n`);
});
