import { OpenAPIHono } from "@hono/zod-openapi";
import relativeTime from "./routes/relative-time";
import { Scalar } from "@scalar/hono-api-reference";

const app = new OpenAPIHono();

// === Base Routes ===

app.get("/", (c) => {
	return c.redirect("/scalar");
});

app.get("/health", (c) => {
	return c.text("OK", 200);
});

// === API Documentation ===

app.doc("/openapi.json", {
	openapi: "3.1.0",
	info: {
		version: "1.0.0",
		title: "BotUtils API",
		description: "GitHub Repository: https://github.com/DerBanko/BotUtils",
	},
});

app.get(
	"/scalar",
	Scalar((c) => {
		return {
			url: "/openapi.json",
			pageTitle: "BotUtils API Documentation",
			showDeveloperTools: "never",
			documentDownloadType: "both",
		};
	})
);

// === Routes ===

app.route("/relative-time", relativeTime);

export default app;
