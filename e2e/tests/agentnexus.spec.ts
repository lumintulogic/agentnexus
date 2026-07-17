import { expect, type Page, test } from "@playwright/test";

async function openApp(page: Page) {
  await page.goto("/");
  await expect(page.getByTestId("agentnexus-app")).toHaveAttribute("data-hydrated", "true");
}

test.describe("AgentNexus scaffold", () => {
  test("renders the marketplace and chat workspace", async ({ page }) => {
    await openApp(page);
    const marketplace = page.getByLabel("Marketplace and server manager");

    await expect(page.getByRole("heading", { name: "AgentNexus" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Marketplace" })).toBeVisible();
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
    await expect(runtime.getByText("BEARER token stored in encrypted session scope")).toBeVisible();
  });

  test("installs and activates integrations from server toggles", async ({ page }) => {
    await openApp(page);
    const marketplace = page.getByLabel("Marketplace and server manager");
    const runtime = page.getByLabel("Runtime details");

    await page.getByLabel("Install or activate Postgres Tools").click();
    await expect(marketplace.locator("article", { hasText: "Postgres Tools" }).getByText("Installed")).toBeVisible();

    await page.getByLabel("Install or activate Postgres Tools").click();
    await expect(marketplace.locator("article", { hasText: "Postgres Tools" }).getByText("Active")).toBeVisible();
    await expect(runtime.getByText("Postgres Tools", { exact: true })).toBeVisible();

    await page.getByLabel("Deactivate Postgres Tools").click();
    await expect(marketplace.locator("article", { hasText: "Postgres Tools" }).getByText("Installed")).toBeVisible();
  });

  test("switches model provider menu selection", async ({ page }) => {
    await openApp(page);

    await page.getByRole("button", { name: "Selected model: OpenAI" }).hover();
    await page.getByRole("button", { name: "Select Anthropic" }).click();

    await expect(page.getByRole("button", { name: "Selected model: Anthropic" })).toBeVisible();
  });
});
