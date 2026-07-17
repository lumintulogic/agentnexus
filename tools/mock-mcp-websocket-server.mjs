import { WebSocketServer } from "ws";

const port = Number.parseInt(process.env.AGENTNEXUS_MOCK_MCP_PORT ?? "8787", 10);
const host = process.env.AGENTNEXUS_MOCK_MCP_HOST ?? "127.0.0.1";

const tools = [
  {
    name: "inspect_schema",
    description: "Inspect tables and columns exposed by the mock Postgres MCP server.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Schema object or table name to inspect."
        }
      },
      required: ["query"]
    }
  },
  {
    name: "run_read_query",
    description: "Run a read-only SQL query against the mock Postgres MCP server.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Read-only SQL query."
        }
      },
      required: ["query"]
    }
  },
  {
    name: "explain_query",
    description: "Return a mock query plan for a read-only SQL query.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Read-only SQL query to explain."
        }
      },
      required: ["query"]
    }
  }
];

function result(id, payload) {
  return JSON.stringify({ jsonrpc: "2.0", id, result: payload });
}

function error(id, code, message) {
  return JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } });
}

const server = new WebSocketServer({ host, port, path: "/mcp/postgres", handleProtocols: () => "mcp" });

server.on("connection", (socket) => {
  socket.on("message", (rawMessage) => {
    let message;

    try {
      message = JSON.parse(rawMessage.toString());
    } catch {
      socket.send(error(null, -32700, "Parse error"));
      return;
    }

    if (message.method === "initialize") {
      socket.send(
        result(message.id, {
          protocolVersion: "2025-06-18",
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: "agentnexus-mock-postgres", version: "0.1.0" },
          instructions: "Use this mock server for AgentNexus local MCP connection testing."
        })
      );
      return;
    }

    if (message.method === "notifications/initialized") {
      return;
    }

    if (message.method === "tools/list") {
      socket.send(result(message.id, { tools }));
      return;
    }

    if (message.method === "tools/call") {
      const toolName = message.params?.name;
      const query = message.params?.arguments?.query ?? "";
      const tool = tools.find((candidate) => candidate.name === toolName);

      if (!tool) {
        socket.send(error(message.id, -32602, `Unknown tool: ${toolName}`));
        return;
      }

      socket.send(
        result(message.id, {
          content: [
            {
              type: "text",
              text: `${toolName} handled "${query}" on agentnexus-mock-postgres.`
            }
          ]
        })
      );
      return;
    }

    socket.send(error(message.id, -32601, `Unsupported method: ${message.method}`));
  });
});

server.on("listening", () => {
  console.log(`AgentNexus mock MCP WebSocket server listening on ws://${host}:${port}/mcp/postgres`);
});

server.on("error", (serverError) => {
  console.error(`AgentNexus mock MCP WebSocket server failed: ${serverError.message}`);
  process.exitCode = 1;
});
