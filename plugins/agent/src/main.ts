import { startCommandLoop } from "./command-loop.js";
import { servePlugin } from "./link.js";

const listen = process.argv[2] ?? "127.0.0.1:9002";
servePlugin(listen);
startCommandLoop();
