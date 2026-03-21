import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";

const personalBest = new OpenAPIHono();

const MCSRRANKED_MATCHES = "https://api.mcsrranked.com/users";

function normalizeUuid(s: string): string {
	return s.replace(/-/g, "").toLowerCase();
}

function looksLikeUuid(s: string): boolean {
	return /^[0-9a-f]{32}$/i.test(normalizeUuid(s.trim()));
}

function formatRtaMs(ms: number): string {
	const totalSeconds = ms / 1000;
	const h = Math.floor(totalSeconds / 3600);
	const m = Math.floor((totalSeconds % 3600) / 60);
	const s = totalSeconds - h * 3600 - m * 60;
	const secPart = s.toFixed(2).padStart(5, "0");
	if (h > 0) {
		return `${h}:${String(m).padStart(2, "0")}:${secPart}`;
	}
	return `${m}:${secPart}`;
}

type MatchRow = {
	category?: string;
	players?: { uuid: string; nickname?: string | null }[];
	result?: { uuid: string | null; time: number | null } | null;
};

type MatchesApiBody = {
	status?: string;
	data?: MatchRow[] | { error?: string };
};

function mcsrErrorMessage(data: unknown): string | undefined {
	if (data && typeof data === "object" && !Array.isArray(data) && "error" in data) {
		const err = (data as { error?: unknown }).error;
		return typeof err === "string" ? err : undefined;
	}
	return undefined;
}

function isMcsrPlayerNotExistError(message: string | undefined): boolean {
	if (!message) {
		return false;
	}
	return message === "This player is not exist." || message.toLowerCase().includes("not exist");
}

function resolvePlayerUuid(matches: MatchRow[], identifier: string): string | null {
	const idTrim = identifier.trim();
	const idNorm = normalizeUuid(idTrim);

	if (looksLikeUuid(idTrim)) {
		for (const row of matches) {
			for (const p of row.players ?? []) {
				if (normalizeUuid(p.uuid) === idNorm) {
					return normalizeUuid(p.uuid);
				}
			}
		}
		return idNorm;
	}

	for (const row of matches) {
		for (const p of row.players ?? []) {
			if (p.nickname?.toLowerCase() === idTrim.toLowerCase()) {
				return normalizeUuid(p.uuid);
			}
		}
	}
	return null;
}

function displayName(matches: MatchRow[], playerUuidNorm: string, identifier: string): string {
	for (const row of matches) {
		for (const p of row.players ?? []) {
			if (normalizeUuid(p.uuid) === playerUuidNorm && p.nickname) {
				return p.nickname;
			}
		}
	}
	return identifier.trim();
}

const route = createRoute({
	method: "get",
	path: "/",
	tags: ["MCSR Ranked"],
	description:
		"Best completed MCSR Ranked time (dragon kill) for a player, returned as formatted text.\n(Uses api.mcsrranked.com/users/{identifier}/matches.)",
	request: {
		query: z.object({
			identifier: z.string().min(1).openapi({
				description: "Minecraft username or UUID (with or without hyphens)",
				examples: ["doogile", "3c8757790ab0400b8b9e3936e0dd535b"],
			}),
		}),
	},
	responses: {
		200: {
			description: "Formatted summary line (nickname — MCSR Ranked PB: time (category))",
			content: {
				"text/plain": {
					schema: z.string().openapi({
						example: "doogile — MCSR Ranked PB: 14:32.10 (ANY)",
					}),
				},
			},
		},
		404: {
			description: "No qualifying match data for this identifier (empty history or no completed run)",
			content: {
				"text/plain": {
					schema: z.string().openapi({
						example: "No matches returned for this player.",
					}),
				},
			},
		},
		400: {
			description:
				"Minecraft account not known to MCSR Ranked.",
			content: {
				"text/plain": {
					schema: z.string().openapi({
						example: "Player not found on MCSR Ranked.",
					}),
				},
			},
		},
		500: {
			description:
				"Upstream MCSR Ranked failure, invalid or unexpected JSON, or any other API error.",
			content: {
				"text/plain": {
					schema: z.string().openapi({
						example: "MCSR Ranked API returned an unexpected payload.",
					}),
				},
			},
		},
	},
});

personalBest.openapi(route, async (c) => {
	const { identifier } = c.req.valid("query");
	const url = `${MCSRRANKED_MATCHES}/${encodeURIComponent(identifier.trim())}/matches`;

	let res: Response;
	try {
		res = await fetch(url, { headers: { Accept: "application/json" } });
	} catch {
		return c.text("MCSR Ranked API request failed.", 500);
	}

	const raw = await res.text();
	let body: MatchesApiBody | undefined;
	try {
		body = raw ? (JSON.parse(raw) as MatchesApiBody) : undefined;
	} catch {
		body = undefined;
	}

	// MCSR often returns HTTP 400/404 with JSON `{ status: "error", data: { error } }` — handle before `!res.ok`.
	if (body?.status === "error") {
		const upstream = mcsrErrorMessage(body.data);
		if (isMcsrPlayerNotExistError(upstream)) {
			return c.text("Player not found on MCSR Ranked.", 400);
		}
		const line = upstream ? `MCSR Ranked: ${upstream}` : "MCSR Ranked returned an error.";
		return c.text(line, 500);
	}

	if (!res.ok) {
		// Matches endpoint: 400/404 from MCSR are typically unknown player (body may be empty or non-JSON).
		if (res.status === 404 || res.status === 400) {
			return c.text("Player not found on MCSR Ranked.", 400);
		}
		return c.text(`MCSR Ranked API error (HTTP ${res.status}).`, 500);
	}

	if (body?.status !== "success" || !Array.isArray(body.data)) {
		return c.text("MCSR Ranked API returned an unexpected payload.", 500);
	}

	const matches = body.data;
	if (matches.length === 0) {
		return c.text("No matches returned for this player.", 404);
	}

	const playerUuidNorm = resolvePlayerUuid(matches, identifier);
	if (!playerUuidNorm) {
		return c.text("Could not resolve player UUID from match history.", 404);
	}

	let best: { time: number; category?: string } | null = null;
	for (const row of matches) {
		const ru = row.result?.uuid;
		const rt = row.result?.time;
		if (ru == null || rt == null) {
			continue;
		}
		if (normalizeUuid(ru) !== playerUuidNorm) {
			continue;
		}
		if (!best || rt < best.time) {
			best = { time: rt, category: row.category };
		}
	}

	if (!best) {
		return c.text("No completed ranked run (dragon kill) found for this player.", 404);
	}

	const name = displayName(matches, playerUuidNorm, identifier);
	const timeStr = formatRtaMs(best.time);
	const cat = best.category ? ` (${best.category})` : "";
	const line = `${name} — MCSR Ranked PB: ${timeStr}${cat}`;

	return c.text(line);
});

export default personalBest;
