import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import moment, { type unitOfTime } from "moment-timezone";

const unitOfTimeBase: unitOfTime.Base[] = [
	"year",
	"years",
	"y",

	"month",
	"months",
	"M",

	"week",
	"weeks",
	"w",

	"day",
	"days",
	"d",

	"hour",
	"hours",
	"h",

	"minute",
	"minutes",
	"m",

	"second",
	"seconds",
	"s",

	"millisecond",
	"milliseconds",
	"ms",
];

const relativeTime = new OpenAPIHono();

const route = createRoute({
	method: "get",
	path: "/",
	description: "Calculate the absolute time difference between a given date and now",
	request: {
		query: z.object({
			date: z.string().openapi({
				description: "Date in format YYYY-MM-DD or YYYY-MM-DD HH:mm or YYYY-MM-DD HH:mm:ss",
				examples: ["2026-01-01", "2026-01-01 14:30", "2026-01-01 14:30:45"],
			}),
			timezone: z
				.string()
				.optional()
				.openapi({
					description: "IANA timezone name (see https://en.wikipedia.org/wiki/List_of_tz_database_time_zones#List)",
					default: "Europe/Berlin",
					examples: ["Europe/Berlin", "America/New_York"],
				}),
			output: z.enum(unitOfTimeBase).openapi({
				description: "Unit of time for the result",
				example: "days",
			}),
		}),
	},
	responses: {
		200: {
			description: "Absolute time difference in the specified unit",
			content: {
				"text/plain": {
					schema: z.string().openapi({
						description: "Numeric value as plain text",
						example: "42",
					}),
				},
			},
		},
		400: {
			description: "Invalid date format or timezone",
			content: {
				"application/json": {
					schema: z.object({
						error: z.string().openapi({
							examples: ["Invalid date format. Use YYYY-MM-DD, YYYY-MM-DD HH:mm, or YYYY-MM-DD HH:mm:ss", "Invalid date format or timezone."],
						}),
					}),
				},
			},
		},
	},
});

relativeTime.openapi(route, (c) => {
	const { date, timezone = "Europe/Berlin", output } = c.req.valid("query");

	try {
		const formats = ["YYYY-MM-DD", "YYYY-MM-DD HH:mm", "YYYY-MM-DD HH:mm:ss"];
		const targetMoment = moment.tz(date, formats, true, timezone);

		if (!targetMoment.isValid()) {
			return c.json({ error: "Invalid date format. Use YYYY-MM-DD, YYYY-MM-DD HH:mm, or YYYY-MM-DD HH:mm:ss" }, 400);
		}

		return c.text(Math.abs(targetMoment.diff(moment.tz(timezone), output)).toString());
	} catch (error) {
		return c.json({ error: "Invalid date format or timezone." }, 400);
	}
});

export default relativeTime;
