#!/usr/bin/env bun
import { Command } from "commander";
import pkg from "../package.json";

import start from "./start";

const cli = new Command();

// TODO(@fuxingloh): add description
cli.name("openxyz").version(pkg.version);
cli.addCommand(start);

// TODO(?): to work on, to generate a single binary.js to basically do this: "bun binary.js"
// cli.addCommand(build);

await cli.parseAsync();
