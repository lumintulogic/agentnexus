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
}

type McpTool = Awaited<ReturnType<Client["listTools"]>>["tools"][number];

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

export function executeMockToolCall(
  server: MarketplaceServer,
  toolName: string,
  query: string
): ToolExecutionResult {
  if (!server.tools.includes(toolName)) {
    throw new Error(`${toolName} is not exposed by ${server.name}.`);
  }

  return {
    toolName,
    serverName: server.name,
    content: `${toolName} accepted "${query}" through ${server.endpoint}.`
  };
}
