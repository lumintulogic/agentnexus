import type { MarketplaceServer } from "@/data/registry";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { WebSocketClientTransport } from "@modelcontextprotocol/sdk/client/websocket.js";

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, { type: string; description: string }>;
    required: string[];
  };
}

export interface CapabilityHandshake {
  serverId: string;
  endpoint: string;
  tools: ToolDefinition[];
  promptFragment: string;
  source: "mock" | "sdk";
}

export interface ToolExecutionResult {
  toolName: string;
  serverName: string;
  content: string;
  source: "mock" | "sdk";
  authAttached: boolean;
}

type McpTool = Awaited<ReturnType<Client["listTools"]>>["tools"][number];

export interface ToolAuthContext {
  tokenRef?: string | null;
  authorizationHeader?: string | null;
}

function mapMcpTool(tool: McpTool, server: MarketplaceServer): ToolDefinition {
  const inputSchema =
    tool.inputSchema && tool.inputSchema.type === "object"
      ? tool.inputSchema
      : {
          type: "object" as const,
          properties: {},
          required: []
        };

  return {
    name: tool.name,
    description: tool.description ?? `${server.name} capability exposed through MCP.`,
    inputSchema: {
      type: "object",
      properties: Object.fromEntries(
        Object.entries(inputSchema.properties ?? {}).map(([key, value]) => {
          const property = value as { type?: string; description?: string };
          return [
            key,
            {
              type: property.type ?? "string",
              description: property.description ?? `${key} argument.`
            }
          ];
        })
      ),
      required: inputSchema.required ?? []
    }
  };
}

export function createMockCapabilityHandshake(server: MarketplaceServer): CapabilityHandshake {
  const tools = server.tools.map((tool) => ({
    name: tool,
    description: `${server.name} capability exposed through the AgentNexus MCP bridge.`,
    inputSchema: {
      type: "object" as const,
      properties: {
        query: {
          type: "string",
          description: "Natural language instruction or lookup term."
        }
      },
      required: ["query"]
    }
  }));

  return {
    serverId: server.id,
    endpoint: server.endpoint,
    tools,
    source: "mock",
    promptFragment: `Use ${server.name} for ${server.category.toLowerCase()} tasks. Available tools: ${tools
      .map((tool) => tool.name)
      .join(", ")}.`
  };
}

export async function createSdkCapabilityHandshake(server: MarketplaceServer): Promise<CapabilityHandshake> {
  if (server.transport !== "WebSocket") {
    return createMockCapabilityHandshake(server);
  }

  const client = new Client({ name: "agentnexus-browser", version: "0.1.0" });
  const transport = new WebSocketClientTransport(new URL(server.endpoint));

  try {
    await client.connect(transport);
    const { tools } = await client.listTools();
    const mappedTools = tools.map((tool) => mapMcpTool(tool, server));

    return {
      serverId: server.id,
      endpoint: server.endpoint,
      tools: mappedTools,
      source: "sdk",
      promptFragment: `Use ${server.name} for ${server.category.toLowerCase()} tasks. Available tools discovered from MCP: ${mappedTools
        .map((tool) => tool.name)
        .join(", ")}.`
    };
  } finally {
    await client.close();
  }
}

function textFromToolResult(result: Awaited<ReturnType<Client["callTool"]>>): string {
  const content = (result as { content?: unknown }).content;
  if (!Array.isArray(content)) return "Tool returned no displayable content.";

  return content
    .map((part) => {
      if (!part || typeof part !== "object" || !("type" in part)) return "[unknown result]";
      const typedPart = part as { type: string; text?: string; resource?: { text?: string } };
      if (typedPart.type === "text") return typedPart.text ?? "";
      if (typedPart.type === "resource" && typedPart.resource?.text) return typedPart.resource.text;
      return `[${typedPart.type} result]`;
    })
    .join("\n");
}

export async function executeSdkToolCall(
  server: MarketplaceServer,
  toolName: string,
  query: string,
  authContext: ToolAuthContext = {}
): Promise<ToolExecutionResult> {
  if (server.transport !== "WebSocket") {
    return executeMockToolCall(server, toolName, query, authContext);
  }

  const client = new Client({ name: "agentnexus-browser", version: "0.1.0" });
  const transport = new WebSocketClientTransport(new URL(server.endpoint));

  try {
    await client.connect(transport);
    const result = await client.callTool({
      name: toolName,
      arguments: { query },
      _meta: authContext.authorizationHeader
        ? {
            agentnexus: {
              authHeaders: {
                Authorization: authContext.authorizationHeader
              },
              tokenRef: authContext.tokenRef ?? null
            }
          }
        : undefined
    });

    return {
      toolName,
      serverName: server.name,
      content: textFromToolResult(result),
      source: "sdk",
      authAttached: Boolean(authContext.authorizationHeader)
    };
  } finally {
    await client.close();
  }
}

export function executeMockToolCall(
  server: MarketplaceServer,
  toolName: string,
  query: string,
  authContext: ToolAuthContext = {}
): ToolExecutionResult {
  if (!server.tools.includes(toolName)) {
    throw new Error(`${toolName} is not exposed by ${server.name}.`);
  }

  return {
    toolName,
    serverName: server.name,
    content: `${toolName} accepted "${query}" through ${server.endpoint}.`,
    source: "mock",
    authAttached: Boolean(authContext.authorizationHeader)
  };
}
