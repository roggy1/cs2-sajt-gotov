import { createFileRoute } from "@tanstack/react-router";
import { clearSessionCookie } from "@/lib/session.server";

export const Route = createFileRoute("/api/steam-logout")({
  server: {
    handlers: {
      POST: async () =>
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            "Set-Cookie": clearSessionCookie(),
          },
        }),
    },
  },
});
