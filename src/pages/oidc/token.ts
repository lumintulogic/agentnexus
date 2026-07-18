import type { APIRoute } from "astro";
import { issueTokenSet, issuerFromRequest } from "@/lib/oidc";

export const POST: APIRoute = async ({ request }) => {
  const form = await request.formData();
  const grantType = form.get("grant_type");
  const code = form.get("code");

  if (grantType !== "authorization_code" || typeof code !== "string") {
    return Response.json({ error: "unsupported_grant_type" }, { status: 400 });
  }

  try {
    return Response.json(
      await issueTokenSet({
        issuer: issuerFromRequest(request),
        code,
        clientId: form.get("client_id")?.toString(),
        redirectUri: form.get("redirect_uri")?.toString()
      }),
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    return Response.json(
      { error: "invalid_grant", error_description: error instanceof Error ? error.message : "Invalid code" },
      { status: 400 }
    );
  }
};
