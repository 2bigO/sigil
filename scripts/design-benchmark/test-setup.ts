/** Preloaded by `bunfig.toml` for every test run; see `removeTempDirs`. */
import { afterAll } from "bun:test";
import { removeTempDirs } from "./testing.ts";

afterAll(removeTempDirs);
