import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";

const personalBest = new OpenAPIHono();

const MCSRRANKED_USERS = "https://api.mcsrranked.com/users";

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

type McsrUserProfile = {
	nickname?: string;
	statistics?: {
		season?: { bestTime?: { ranked?: number | null } };
		total?: { bestTime?: { ranked?: number | null } };
	};
};

type UserApiBody = {
	status?: string;
	data?: McsrUserProfile | { error?: string };
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

const route = createRoute({
	method: "get",
	path: "/",
	tags: ["MCSR Ranked"],
	description:
		"Best completed MCSR Ranked time (dragon kill) for a player, returned as formatted text.\n(Uses api.mcsrranked.com/users/{identifier} — ranked PB from profile statistics, not match history minima.)",
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
			description: "Formatted summary line (nickname — MCSR Ranked PB: time (Ranked))",
			content: {
				"text/plain": {
					schema: z.string().openapi({
						example: "doogile — MCSR Ranked PB: 14:32.10 (Ranked)",
					}),
				},
			},
		},
		404: {
			description: "No ranked PB in profile statistics for this player.",
			content: {
				"text/plain": {
					schema: z.string().openapi({
						example: "No ranked personal best found for this player.",
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
	const url = `${MCSRRANKED_USERS}/${encodeURIComponent(identifier.trim())}`;

	let res: Response;
	try {
		res = await fetch(url, { headers: { Accept: "application/json" } });
	} catch {
		return c.text("MCSR Ranked API request failed.", 500);
	}

	const raw = await res.text();
	let body: UserApiBody | undefined;
	try {
		body = raw ? (JSON.parse(raw) as UserApiBody) : undefined;
	} catch {
		body = undefined;
	}

	if (body?.status === "error") {
		const upstream = mcsrErrorMessage(body.data);
		if (isMcsrPlayerNotExistError(upstream)) {
			return c.text("Player not found on MCSR Ranked.", 400);
		}
		const line = upstream ? `MCSR Ranked: ${upstream}` : "MCSR Ranked returned an error.";
		return c.text(line, 500);
	}

	if (!res.ok) {
		if (res.status === 404 || res.status === 400) {
			return c.text("Player not found on MCSR Ranked.", 400);
		}
		return c.text(`MCSR Ranked API error (HTTP ${res.status}).`, 500);
	}

	if (body?.status !== "success" || !body.data || typeof body.data !== "object" || "error" in body.data) {
		return c.text("MCSR Ranked API returned an unexpected payload.", 500);
	}

	const data = body.data as McsrUserProfile;
	const rankedMs =
		data.statistics?.season?.bestTime?.ranked ?? data.statistics?.total?.bestTime?.ranked;

	if (rankedMs == null || rankedMs <= 0) {
		return c.text("No ranked personal best found for this player.", 404);
	}

	const name = (typeof data.nickname === "string" && data.nickname.trim()) || identifier.trim();
	const timeStr = formatRtaMs(rankedMs);
	const line = `${name} — MCSR Ranked PB: ${timeStr} (Ranked)`;

	return c.text(line);
});

export default personalBest;
