import { expect, type Page, test } from "@playwright/test";

async function openApp(page: Page) {
  await page.goto("/");
  await expect(page.getByTestId("agentnexus-app")).toHaveAttribute("data-hydrated", "true");
  await page.getByRole("button", { name: "GitHub" }).click();
  await expect(page.getByLabel("Marketplace and server manager")).toBeVisible();
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
