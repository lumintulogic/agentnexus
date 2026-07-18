import { expect, type Page, test } from "@playwright/test";

async function openApp(page: Page) {
  await page.goto("/");
  await expect(page.getByTestId("agentnexus-app")).toHaveAttribute("data-hydrated", "true");
  await page.getByRole("button", { name: "GitHub" }).click();
  await expect(page.getByLabel("Marketplace and server manager")).toBeVisible();
}

async function mockDirectus(page: Page) {
  const writes: Array<{ url: string; method: string; body: unknown }> = [];

  await page.route("http://localhost:8055/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const json = (data: unknown) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(data)
      });

    if (url.pathname === "/users/me") {
      await json({
        data: {
          id: "directus-user-1",
          email: "directus@example.com",
          first_name: "Directus",
          last_name: "User"
        }
      });
      return;
    }

    if (url.pathname === "/items/anx_user_profiles" && request.method() === "GET") {
      await json({ data: [{ id: "profile-1", email: "directus@example.com" }] });
      return;
    }

    if (url.pathname === "/items/anx_mcp_servers" && request.method() === "GET") {
      await json({
        data: [
          {
            id: "directus-postgres",
            name: "Directus Postgres",
            vendor: "Directus Registry",
            category: "Database",
            transport: "websocket",
            auth_mode: "bearer",
            status: "available",
            endpoint_url: "ws://localhost:8787/mcp/postgres",
            description: "Directus supplied MCP server.",
            tool_schema: [{ name: "inspect_schema" }, { name: "run_read_query" }]
          }
        ]
      });
      return;
    }

    if (url.pathname === "/items/anx_model_connections" && request.method() === "GET") {
      await json({ data: [] });
      return;
    }

    if (url.pathname === "/items/anx_model_connections" && request.method() === "POST") {
      writes.push({ url: request.url(), method: request.method(), body: request.postDataJSON() });
      await json({ data: { id: "model-connection-1" } });
      return;
    }

    await route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ errors: [] }) });
  });

  return writes;
}

test.describe("AgentNexus scaffold", () => {
  test("protects the dashboard behind authentication", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("agentnexus-app")).toHaveAttribute("data-hydrated", "true");

    await expect(page.getByRole("region", { name: "Authentication" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Log in to your dashboard" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Keycloak" })).toBeVisible();
    await expect(page.getByLabel("Marketplace and server manager")).toHaveCount(0);

    await page.getByRole("button", { name: "Google" }).click();
    await expect(page.getByLabel("Marketplace and server manager")).toBeVisible();
    await expect(page.getByText("Google SSO")).toBeVisible();

    await page.getByLabel("Sign out").click();
    await expect(page.getByRole("region", { name: "Authentication" })).toBeVisible();
    await expect(page.getByLabel("Marketplace and server manager")).toHaveCount(0);
  });

  test("creates an account with the email sign-up form", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("agentnexus-app")).toHaveAttribute("data-hydrated", "true");

    await page.getByRole("button", { name: "Sign up" }).click();
    await page.getByLabel("Name").fill("Ada Lovelace");
    await page.getByLabel("Email").fill("ada@example.com");
    await page.getByLabel("Password").fill("agentnexus");
    await page.getByRole("button", { name: "Create account" }).click();

    await expect(page.getByLabel("Marketplace and server manager")).toBeVisible();
    await expect(page.getByText("Ada Lovelace")).toBeVisible();
    await expect(page.getByText("Email sign-up")).toBeVisible();
  });

  test("renders the marketplace and chat workspace", async ({ page }) => {
    await openApp(page);
    const marketplace = page.getByLabel("Marketplace and server manager");

    await expect(page.getByRole("heading", { name: "AgentNexus" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Marketplace" })).toBeVisible();
    await expect(marketplace.getByText("Prototype registry")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Model-agnostic Chat Playground" })).toBeVisible();
    await expect(page.getByText("Capability handshake ready")).toBeVisible();
    await expect(marketplace.getByText("GitHub Workspace", { exact: true })).toBeVisible();
    await expect(marketplace.getByText("Google Drive", { exact: true })).toBeVisible();
    await expect(marketplace.getByText("Postgres Tools", { exact: true })).toBeVisible();
  });

  test("filters marketplace entries and focuses a server capability handshake", async ({ page }) => {
    await openApp(page);
    const marketplace = page.getByLabel("Marketplace and server manager");
    const runtime = page.getByLabel("Runtime details");

    await page.getByLabel("Search MCP servers").fill("postgres");

    await expect(marketplace.locator("article", { hasText: "Postgres Tools" })).toBeVisible();
    await expect(marketplace.locator("article", { hasText: "GitHub Workspace" })).toHaveCount(0);

    await marketplace.getByRole("button", { name: "Postgres Tools Available" }).click();

    await expect(runtime.getByText("inspect_schema")).toBeVisible();
    await expect(runtime.getByText("run_read_query")).toBeVisible();
    await expect(runtime.getByText("BEARER token required")).toBeVisible();
  });

  test("installs and activates integrations from server toggles", async ({ page }) => {
    await openApp(page);
    const marketplace = page.getByLabel("Marketplace and server manager");
    const runtime = page.getByLabel("Runtime details");

    await page.getByLabel("Install or activate Postgres Tools").click();
    const authDialog = page.getByRole("dialog", { name: "Connect Postgres Tools" });
    await expect(authDialog).toBeVisible();
    await authDialog.getByLabel("Bearer token").fill("postgres-test-token");
    await authDialog.getByRole("button", { name: "Store token" }).click();

    await expect(marketplace.locator("article", { hasText: "Postgres Tools" }).getByText("Installed")).toBeVisible();
    await expect(runtime.getByText("Bearer token post... stored for this session")).toBeVisible();
    await expect(runtime.getByText("Using session-only install state")).toBeVisible();
    const serializedSessionStorage = await page.evaluate(() => JSON.stringify(sessionStorage));
    expect(serializedSessionStorage).not.toContain("postgres-test-token");
    expect(serializedSessionStorage).toContain("ciphertext");

    await page.getByLabel("Install or activate Postgres Tools").click();
    await expect(marketplace.locator("article", { hasText: "Postgres Tools" }).getByText("Active")).toBeVisible();
    await expect(runtime.getByText("Postgres Tools", { exact: true })).toBeVisible();

    await page.getByLabel("Deactivate Postgres Tools").click();
    await expect(marketplace.locator("article", { hasText: "Postgres Tools" }).getByText("Installed")).toBeVisible();
  });

  test("connects a model from the model dialog", async ({ page }) => {
    await openApp(page);

    await page.getByRole("button", { name: "Selected model: OpenAI" }).click();

    const dialog = page.getByRole("dialog", { name: "Connect a Model" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Connect model" })).toBeDisabled();

    await dialog.getByRole("button", { name: "Anthropic" }).click();
    await expect(dialog.getByLabel("Model ID")).toHaveValue("claude-3-5-sonnet-latest");
    await dialog.getByLabel("API key").fill("sk-ant-test");
    await dialog.getByRole("button", { name: "Connect model" }).click();

    await expect(page.getByRole("button", { name: "Selected model: Anthropic" })).toBeVisible();
    await expect(page.getByText("Anthropic token reference stored for this session")).toBeVisible();
    await expect(page.getByText("Using session-only model connection")).toBeVisible();
    await expect(dialog).toHaveCount(0);
  });

  test("hydrates Directus session-cookie SSO and syncs model metadata", async ({ page }) => {
    const directusWrites = await mockDirectus(page);
    await page.context().addCookies([
      {
        name: "agentnexus_session_token",
        value: "directus-cookie-session",
        domain: "localhost",
        path: "/",
        httpOnly: true,
        sameSite: "Lax"
      }
    ]);
    await page.goto("/");
    await expect(page.getByTestId("agentnexus-app")).toHaveAttribute("data-hydrated", "true");

    const marketplace = page.getByLabel("Marketplace and server manager");
    await expect(marketplace).toBeVisible();
    await expect(page.getByText("Directus User")).toBeVisible();
    await expect(page.getByText("Keycloak via Directus")).toBeVisible();
    await expect(marketplace.getByText("Directus registry")).toBeVisible();
    await expect(marketplace.getByText("Directus Postgres", { exact: true })).toBeVisible();

    const serializedSessionStorage = await page.evaluate(() => JSON.stringify(sessionStorage));
    expect(serializedSessionStorage).not.toContain("directus-cookie-session");

    await page.getByRole("button", { name: "Selected model: OpenAI" }).click();
    const dialog = page.getByRole("dialog", { name: "Connect a Model" });
    await dialog.getByRole("button", { name: "Anthropic" }).click();
    await dialog.getByLabel("API key").fill("sk-ant-test");
    await dialog.getByRole("button", { name: "Connect model" }).click();

    await expect(page.getByText("Model connection synced to Directus")).toBeVisible();
    expect(directusWrites).toHaveLength(1);
    expect(directusWrites[0].body).toMatchObject({
      profile: "profile-1",
      provider: "Anthropic",
      model_id: "claude-3-5-sonnet-latest",
      status: "connected"
    });
  });

  test("registers an enterprise private MCP server with tenant OIDC context", async ({ page }) => {
    await openApp(page);
    const marketplace = page.getByLabel("Marketplace and server manager");
    const runtime = page.getByLabel("Runtime details");

    await page.getByRole("button", { name: "Register private MCP" }).click();
    const dialog = page.getByRole("dialog", { name: "Register Private MCP" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel("Tenant name")).toHaveValue("Acme Premium");
    await expect(dialog.getByLabel("Role name")).toHaveValue("analyst");
    await dialog.getByRole("button", { name: "Register private server" }).click();

    await expect(marketplace.getByText("Acme Private Reports", { exact: true })).toBeVisible();
    await expect(marketplace.locator("article", { hasText: "Acme Private Reports" }).getByText("Private", { exact: true })).toBeVisible();
    await expect(runtime.getByRole("heading", { name: "Enterprise Context" })).toBeVisible();
    await expect(runtime.getByText("analyst", { exact: true })).toBeVisible();
    await expect(runtime.getByText("/oidc/authorize")).toBeVisible();
    await expect(runtime.getByText("tenant_id=tenant%3A")).toBeVisible();
    await expect(runtime.getByText("app_id=app%3A")).toBeVisible();
    await expect(runtime.getByText("role_name=analyst")).toBeVisible();
    await expect(runtime.getByText("Private MCP registered for this session")).toBeVisible();
  });

  test("executes a mock MCP tool call from the composer", async ({ page }) => {
    await openApp(page);
    const marketplace = page.getByLabel("Marketplace and server manager");

    await marketplace.getByRole("button", { name: "Postgres Tools Available" }).click();
    await page.getByLabel("Chat prompt").fill("/tool inspect_schema users");
    await page.getByLabel("Send prompt").click();

    const authDialog = page.getByRole("dialog", { name: "Connect Postgres Tools" });
    await expect(authDialog).toBeVisible();
    await expect(page.getByText("Tool call needs authorization")).toBeVisible();
    await authDialog.getByLabel("Bearer token").fill("postgres-test-token");
    await authDialog.getByRole("button", { name: "Store token" }).click();

    await page.getByLabel("Chat prompt").fill("/tool inspect_schema users");
    await page.getByLabel("Send prompt").click();

    await expect(page.getByText("inspect_schema result")).toBeVisible();
    await expect(page.getByText('inspect_schema accepted "users" through ws://localhost:8787/mcp/postgres.')).toBeVisible();
    await expect(page.getByText("Authorization attached")).toBeVisible();
  });
});
