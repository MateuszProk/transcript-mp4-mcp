// package.json musi mieć "type": "module"
import express from "express";
import cors from "cors";
import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

const app = express();
app.use(express.json());

// (opcjonalnie) proste Bearer auth
const AUTH_TOKEN = process.env.MCP_AUTH_TOKEN;
app.use((req, res, next) => {
  if (!AUTH_TOKEN) return next();
  const hdr = req.headers.authorization || "";
  if (hdr === `Bearer ${AUTH_TOKEN}`) return next();
  return res.status(401).send("Unauthorized");
});

// CORS (jeśli chcesz podłączać klientów w przeglądarce)
app.use(cors({
  origin: "*",
  exposedHeaders: ["Mcp-Session-Id"],
  allowedHeaders: ["Content-Type", "mcp-session-id", "Authorization"],
}));

// Mapujemy sesje transportu (stateful HTTP)
const transports = {};

// Fabryka serwera MCP z przykładowym narzędziem
function createMcpServer() {
  const server = new McpServer({ name: "railway-mcp", version: "1.0.0" });

  server.registerTool(
    "ping",
    {
      title: "Ping",
      description: "Zwraca 'pong'",
      inputSchema: { message: z.string().optional() }
    },
    async ({ message }) => ({
      content: [{ type: "text", text: `pong${message ? `: ${message}` : ""}` }]
    })
  );

  return server;
}

// POST /mcp — żądania klient→serwer
app.post("/mcp", async (req, res) => {
  const sessionId = req.headers["mcp-session-id"];
  let transport = sessionId && transports[sessionId];

  // Nowa sesja tylko dla prawidłowego initialize
  if (!transport) {
    transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (sid) => (transports[sid] = transport),
    });

    const server = createMcpServer();
    await server.connect(transport);

    // Sprzątanie
    transport.onclose = () => {
      if (transport.sessionId) delete transports[transport.sessionId];
      server.close();
    };
  }

  await transport.handleRequest(req, res, req.body);
});

// GET/DELETE /mcp — notyfikacje SSE i zamykanie sesji
const handleSession = async (req, res) => {
  const sid = req.headers["mcp-session-id"];
  const transport = sid && transports[sid];
  if (!transport) return res.status(400).send("Invalid or missing session ID");
  await transport.handleRequest(req, res);
};
app.get("/mcp", handleSession);
app.delete("/mcp", handleSession);

// Start
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`MCP server on :${PORT}`));
