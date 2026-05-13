import { buildApp } from "./app.js";

const port = Number(process.env.PORT ?? 8000);
const host = process.env.HOST ?? "127.0.0.1";

const app = await buildApp();
await app.listen({ port, host });
// eslint-disable-next-line no-console
console.log(`API listening on http://${host}:${port}`);
