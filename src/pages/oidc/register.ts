import type { APIRoute } from "astro";
import { registeredClient } from "@/lib/oidc";

export const POST: APIRoute = async ({ request }) => {
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  return Response.json(registeredClient(body), { status: 201 });
};
