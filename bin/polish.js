#!/usr/bin/env node
import { runPolish } from "../src/polish-cli.js";
await runPolish(process.argv.slice(2));
