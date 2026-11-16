import { startRepl } from "./repl.js";
import { servePlugin } from "./session.js";

const listen = process.argv[2] ?? "127.0.0.1:9002";
servePlugin(listen);
startRepl();
