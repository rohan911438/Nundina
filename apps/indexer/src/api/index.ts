import { db } from "ponder:api";
import schema from "ponder:schema";
import { Hono } from "hono";
import { graphql } from "ponder";

/** GraphQL over the raw event tables. Served on 127.0.0.1 only (see projector/run.ts). */
const app = new Hono();
app.use("/graphql", graphql({ db, schema }));
app.get("/", (c) => c.json({ ok: true, graphql: "/graphql" }));

export default app;
