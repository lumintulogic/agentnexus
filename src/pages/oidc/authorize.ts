import type { APIRoute } from "astro";
import { createAuthorizationCode } from "@/lib/oidc";

export const GET: APIRoute = ({ request }) => {
  const url = new URL(request.url);
  const redirectUri = url.searchParams.get("redirect_uri");
  if (!redirectUri) {
    return Response.json({ error: "invalid_request", error_description: "redirect_uri is required" }, { status: 400 });
  }

  const redirect = new URL(redirectUri);
  redirect.searchParams.set("code", createAuthorizationCode(url));
  const state = url.searchParams.get("state");
  if (state) redirect.searchParams.set("state", state);
  return Response.redirect(redirect.toString(), 302);
};
