import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const distDir = resolve("dist");

await mkdir(distDir, { recursive: true });
await writeFile(resolve(distDir, ".assetsignore"), "_worker.js\n", "utf8");
