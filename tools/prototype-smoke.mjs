import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { WebSocketClientTransport } from "@modelcontextprotocol/sdk/client/websocket.js";
import { WebSocketServer } from "ws";

const appBaseUrl = process.env.AGENTNEXUS_SMOKE_APP_URL ?? "http://127.0.0.1:4321";
const mcpUrl = process.env.AGENTNEXUS_SMOKE_MCP_URL ?? "ws://127.0.0.1:8787/mcp/postgres";
const startedProcesses = [];
const startedServers = [];

const mockMcpTools = [
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

function startProcess(command, args, readyText) {
  const child = spawn(command, args, {
    cwd: new URL("..", import.meta.url),
    env: { ...process.env, ASTRO_TELEMETRY_DISABLED: "1" },
    detached: process.platform !== "win32",
    stdio: ["ignore", "pipe", "pipe"]
  });
  let output = "";
  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${command} ${args.join(" ")} did not become ready. Last output: ${output.slice(-500)}`));
    }, 30000);

    const onData = (chunk) => {
      output += chunk.toString();
      if (output.includes(readyText)) {
        clearTimeout(timer);
        resolve(child);
      }
    };

    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      if (code !== 0 && !output.includes(readyText)) {
        reject(
          new Error(
            `${command} ${args.join(" ")} exited with ${code}${signal ? ` (${signal})` : ""}. Output: ${output.slice(
              -1000
            )}`
          )
        );
      }
    });
  });

  startedProcesses.push(child);
  return ready;
}

function jsonRpcResult(id, payload) {
  return JSON.stringify({ jsonrpc: "2.0", id, result: payload });
}

function jsonRpcError(id, code, message) {
  return JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } });
}

function startEmbeddedMockMcpServer() {
  const url = new URL(mcpUrl);
  const port = Number.parseInt(url.port || "80", 10);
  const host = url.hostname;
  const server = new WebSocketServer({ host, port, path: url.pathname, handleProtocols: () => "mcp" });

  server.on("connection", (socket) => {
    socket.on("message", (rawMessage) => {
      let message;
      try {
        message = JSON.parse(rawMessage.toString());
      } catch {
        socket.send(jsonRpcError(null, -32700, "Parse error"));
        return;
      }

      if (message.method === "initialize") {
        socket.send(
          jsonRpcResult(message.id, {
            protocolVersion: "2025-06-18",
            capabilities: { tools: { listChanged: false } },
            serverInfo: { name: "agentnexus-smoke-postgres", version: "0.1.0" },
            instructions: "Use this mock server for AgentNexus smoke verification."
          })
        );
        return;
      }

      if (message.method === "notifications/initialized") return;

      if (message.method === "tools/list") {
        socket.send(jsonRpcResult(message.id, { tools: mockMcpTools }));
        return;
      }

      if (message.method === "tools/call") {
        const toolName = message.params?.name;
        const query = message.params?.arguments?.query ?? "";
        if (!mockMcpTools.some((tool) => tool.name === toolName)) {
          socket.send(jsonRpcError(message.id, -32602, `Unknown tool: ${toolName}`));
          return;
        }
        socket.send(
          jsonRpcResult(message.id, {
            content: [{ type: "text", text: `${toolName} handled "${query}" on agentnexus-mock-postgres.` }]
          })
        );
        return;
      }

      socket.send(jsonRpcError(message.id, -32601, `Unsupported method: ${message.method}`));
    });
  });

  startedServers.push(server);
  return new Promise((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
}

async function json(url, options) {
  const response = await fetch(url, options);
  const text = await response.text();
  if (!response.ok) throw new Error(`${url} returned ${response.status}: ${text.slice(0, 200)}`);
  return JSON.parse(text);
}

async function appIsAvailable() {
  try {
    const discovery = await json(`${appBaseUrl}/.well-known/openid-configuration`);
    return discovery.authorization_endpoint === `${appBaseUrl}/oidc/authorize`;
  } catch {
    return false;
  }
}

async function mcpIsAvailable() {
  try {
    const client = new Client({ name: "agentnexus-prototype-smoke-probe", version: "0.1.0" });
    const transport = new WebSocketClientTransport(new URL(mcpUrl));
    await client.connect(transport);
    try {
      const tools = await client.listTools();
      return tools.tools.some((tool) => tool.name === "inspect_schema");
    } finally {
      await client.close();
    }
  } catch {
    return false;
  }
}

async function oidcSmoke() {
  const discovery = await json(`${appBaseUrl}/.well-known/openid-configuration`);
  if (discovery.authorization_endpoint !== `${appBaseUrl}/oidc/authorize`) {
    throw new Error("OIDC discovery returned an unexpected authorization endpoint.");
  }

  const registered = await json(`${appBaseUrl}/oidc/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_name: "AgentNexus Smoke MCP App",
      redirect_uris: [`${appBaseUrl}/callback`]
    })
  });
  if (!registered.client_id?.startsWith("anx_")) throw new Error("OIDC registration did not return an AgentNexus client id.");

  const authorizeUrl = new URL(`${appBaseUrl}/oidc/authorize`);
  authorizeUrl.searchParams.set("response_type", "code");
  authorizeUrl.searchParams.set("client_id", registered.client_id);
  authorizeUrl.searchParams.set("redirect_uri", `${appBaseUrl}/callback`);
  authorizeUrl.searchParams.set("scope", "openid profile email agentnexus.enterprise");
  authorizeUrl.searchParams.set("login_hint", "smoke@example.com");
  authorizeUrl.searchParams.set("tenant_id", "tenant_smoke");
  authorizeUrl.searchParams.set("app_id", "app_smoke");
  authorizeUrl.searchParams.set("app_url", "https://smoke.example/app");
  authorizeUrl.searchParams.set("role_id", "role_smoke");
  authorizeUrl.searchParams.set("role_name", "viewer");
  authorizeUrl.searchParams.set("state", "state_smoke");

  const authorizeResponse = await fetch(authorizeUrl, { redirect: "manual" });
  if (authorizeResponse.status !== 302) throw new Error(`OIDC authorize returned ${authorizeResponse.status}.`);
  const location = authorizeResponse.headers.get("location");
  const code = location ? new URL(location).searchParams.get("code") : null;
  if (!code) throw new Error("OIDC authorize redirect did not include a code.");

  const token = await json(`${appBaseUrl}/oidc/token`, {
    method: "POST",
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      client_id: registered.client_id,
      redirect_uri: `${appBaseUrl}/callback`
    })
  });
  if (token.token_type !== "Bearer" || !token.access_token || !token.id_token) {
    throw new Error("OIDC token endpoint did not return a bearer token set.");
  }

  const jwks = await json(`${appBaseUrl}/oidc/jwks.json`);
  if (!Array.isArray(jwks.keys) || jwks.keys.length !== 1) throw new Error("OIDC JWKS did not expose one signing key.");

  const userinfo = await json(`${appBaseUrl}/oidc/userinfo`, {
    headers: { Authorization: `Bearer ${token.access_token}` }
  });
  if (userinfo.email !== "smoke@example.com" || userinfo.tenant_id !== "tenant_smoke" || userinfo.role_name !== "viewer") {
    throw new Error("OIDC userinfo did not preserve identity and tenant claims.");
  }

  return {
    issuer: discovery.issuer,
    client_id_prefix_ok: registered.client_id.startsWith("anx_"),
    userinfo_email: userinfo.email,
    userinfo_tenant_id: userinfo.tenant_id,
    userinfo_role_name: userinfo.role_name
  };
}

async function mcpSmoke() {
  const client = new Client({ name: "agentnexus-prototype-smoke", version: "0.1.0" });
  const transport = new WebSocketClientTransport(new URL(mcpUrl));
  await client.connect(transport);
  try {
    const tools = await client.listTools();
    if (!tools.tools.some((tool) => tool.name === "inspect_schema")) {
      throw new Error("MCP tools/list did not include inspect_schema.");
    }

    const result = await client.callTool({ name: "inspect_schema", arguments: { query: "users" } });
    const text = Array.isArray(result.content) && result.content[0]?.type === "text" ? result.content[0].text : "";
    if (!text.includes('inspect_schema handled "users"')) {
      throw new Error("MCP tools/call returned an unexpected response.");
    }

    return {
      tools: tools.tools.map((tool) => tool.name),
      call_text: text
    };
  } finally {
    await client.close();
  }
}

async function main() {
  const startup = [];
  const [appAvailable, mcpAvailable] = await Promise.all([appIsAvailable(), mcpIsAvailable()]);
  if (!appAvailable) {
    startup.push(startProcess("npm", ["run", "dev", "--", "--host", "127.0.0.1"], "Local    http://127.0.0.1:4321/"));
  }
  if (!mcpAvailable) {
    startup.push(startEmbeddedMockMcpServer());
  }
  await Promise.all(startup);

  await delay(250);
  const [oidc, mcp] = await Promise.all([oidcSmoke(), mcpSmoke()]);
  console.log(JSON.stringify({ oidc, mcp }, null, 2));
}

main()
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(() => {
    for (const server of startedServers) {
      server.close();
    }
    for (const child of startedProcesses) {
      if (child.killed) continue;
      try {
        if (process.platform === "win32") {
          child.kill("SIGTERM");
        } else {
          process.kill(-child.pid, "SIGTERM");
        }
      } catch (error) {
        if (error?.code !== "ESRCH") throw error;
      }
    }
  });
