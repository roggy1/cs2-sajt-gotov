import { createFileRoute } from "@tanstack/react-router";

// Steam OpenID 2.0 sign-in. We only ever receive the user's steamid64 —
// no password, no token, nothing else touches this app.
const STEAM_OPENID_URL = "https://steamcommunity.com/openid/login";

export const Route = createFileRoute("/api/steam-login")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const returnTo = `${url.origin}/api/steam-callback`;

        const params = new URLSearchParams({
          "openid.ns": "http://specs.openid.net/auth/2.0",
          "openid.mode": "checkid_setup",
          "openid.return_to": returnTo,
          "openid.realm": url.origin,
          // These two identifier constants tell Steam "we don't know who
          // this is yet, please identify them" — required by the spec.
          "openid.identity": "http://specs.openid.net/auth/2.0/identifier_select",
          "openid.claimed_id": "http://specs.openid.net/auth/2.0/identifier_select",
        });

        return Response.redirect(`${STEAM_OPENID_URL}?${params.toString()}`, 302);
      },
    },
  },
});
