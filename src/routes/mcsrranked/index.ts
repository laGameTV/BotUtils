import { OpenAPIHono } from "@hono/zod-openapi";
import personalBest from "./personal-best";

const mcsrranked = new OpenAPIHono();

mcsrranked.route("/personal-best", personalBest);

export default mcsrranked;
