import { createFileRoute } from "@tanstack/react-router";
import { readSession } from "@/lib/session.server";

const SUMMARIES_URL = "https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/";
const OWNED_GAMES_URL = "https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/";
const CS2_APP_ID = 730;

// Profiles change rarely; playtime moves slowly. A short cache keeps the
// avatar dropdown instant without hammering the Web API.
const CACHE_TTL_MS = 10 * 60 * 1000;
type Cached = { data: unknown; fetchedAt: number };
const cache = new Map<string, Cached>();

interface PlayerSummary {
  steamid: string;
  personaname?: string;
  avatarfull?: string;
  profileurl?: string;
  timecreated?: number;
}

interface OwnedGame {
  appid: number;
  playtime_forever?: number;
}

export const Route = createFileRoute("/api/steam-profile")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const steamId = readSession(request);
        if (!steamId) {
          return Response.json({ authenticated: false }, { status: 200 });
        }

        const cached = cache.get(steamId);
        if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
          return Response.json(cached.data);
        }

        const key = process.env.STEAM_API_KEY;
        if (!key) {
          return Response.json(
            { authenticated: true, steamId, error: "STEAM_API_KEY is not configured" },
            { status: 500 },
          );
        }

        try {
          const [summaryRes, gamesRes] = await Promise.all([
            fetch(`${SUMMARIES_URL}?key=${key}&steamids=${steamId}`),
            // include_played_free_games is required — CS2 is free-to-play,
            // so without it the response omits it entirely for most users.
            fetch(
              `${OWNED_GAMES_URL}?key=${key}&steamid=${steamId}&include_played_free_games=1&format=json`,
            ),
          ]);

          const summaryBody = summaryRes.ok
            ? ((await summaryRes.json()) as { response?: { players?: PlayerSummary[] } })
            : null;
          const player = summaryBody?.response?.players?.[0];

          const gamesBody = gamesRes.ok
            ? ((await gamesRes.json()) as { response?: { games?: OwnedGame[] } })
            : null;
          const cs2 = gamesBody?.response?.games?.find((g) => g.appid === CS2_APP_ID);

          const data = {
            authenticated: true,
            steamId,
            personaName: player?.personaname ?? null,
            avatar: player?.avatarfull ?? null,
            profileUrl: player?.profileurl ?? null,
            // Steam gives a unix timestamp; the client formats it per locale.
            memberSince: player?.timecreated ?? null,
            cs2Hours:
              typeof cs2?.playtime_forever === "number"
                ? Math.round(cs2.playtime_forever / 60)
                : null,
          };

          cache.set(steamId, { data, fetchedAt: Date.now() });
          return Response.json(data);
        } catch {
          if (cached) return Response.json(cached.data);
          return Response.json({ authenticated: true, steamId, error: "steam_unreachable" });
        }
      },
    },
  },
});
