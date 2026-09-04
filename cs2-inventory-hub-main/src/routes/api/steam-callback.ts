import { createFileRoute } from "@tanstack/react-router";
import { createSessionCookie } from "@/lib/session.server";

const STEAM_OPENID_URL = "https://steamcommunity.com/openid/login";
const CLAIMED_ID_PREFIX = "https://steamcommunity.com/openid/id/";

export const Route = createFileRoute("/api/steam-callback")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);

        // Verifying the signature is the whole point of this step: without
        // it, anyone could hit this URL with a made-up claimed_id and be
        // logged in as any Steam user. We echo every openid.* parameter
        // back to Steam and ask it to confirm it really signed them.
        const params = new URLSearchParams();
        url.searchParams.forEach((value, key) => {
          if (key.startsWith("openid.")) params.set(key, value);
        });
        params.set("openid.mode", "check_authentication");

        const verifyRes = await fetch(STEAM_OPENID_URL, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: params.toString(),
        });
        const verifyBody = await verifyRes.text();

        if (!verifyRes.ok || !/is_valid\s*:\s*true/i.test(verifyBody)) {
          return Response.redirect(`${url.origin}/?steam_login=failed`, 302);
        }

        const claimedId = url.searchParams.get("openid.claimed_id") ?? "";
        if (!claimedId.startsWith(CLAIMED_ID_PREFIX)) {
          return Response.redirect(`${url.origin}/?steam_login=failed`, 302);
        }

        const steamId = claimedId.slice(CLAIMED_ID_PREFIX.length);
        if (!/^\d{17}$/.test(steamId)) {
          return Response.redirect(`${url.origin}/?steam_login=failed`, 302);
        }

        return new Response(null, {
          status: 302,
          headers: {
            Location: `${url.origin}/?steam_login=ok`,
            "Set-Cookie": createSessionCookie(steamId),
          },
        });
      },
    },
  },
});
