import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { WebSocketClientTransport } from "@modelcontextprotocol/sdk/client/websocket.js";

const appBaseUrl = process.env.AGENTNEXUS_SMOKE_APP_URL ?? "http://127.0.0.1:4321";
const mcpUrl = process.env.AGENTNEXUS_SMOKE_MCP_URL ?? "ws://127.0.0.1:8787/mcp/postgres";
const startedProcesses = [];

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
    child.on("exit", (code) => {
      clearTimeout(timer);
      if (code !== 0 && !output.includes(readyText)) {
        reject(new Error(`${command} ${args.join(" ")} exited with ${code}. Output: ${output.slice(-500)}`));
      }
    });
  });

  startedProcesses.push(child);
  return ready;
}

async function json(url, options) {
  const response = await fetch(url, options);
  const text = await response.text();
  if (!response.ok) throw new Error(`${url} returned ${response.status}: ${text.slice(0, 200)}`);
  return JSON.parse(text);
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
  await Promise.all([
    startProcess("npm", ["run", "dev", "--", "--host", "127.0.0.1"], "Local    http://127.0.0.1:4321/"),
    startProcess("npm", ["run", "mock:mcp"], "AgentNexus mock MCP WebSocket server listening")
  ]);

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
    for (const child of startedProcesses) {
      if (child.killed) continue;
      if (process.platform === "win32") {
        child.kill("SIGTERM");
      } else {
        process.kill(-child.pid, "SIGTERM");
      }
    }
  });
