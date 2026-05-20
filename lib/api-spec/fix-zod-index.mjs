import { writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const indexPath = resolve(__dirname, "..", "api-zod", "src", "index.ts");

// orval generates both Zod schemas (./generated/api) and TypeScript interface
// types (./generated/types) that share the same exported names (e.g. LoginResponse).
// Re-exporting both in index.ts causes TS2308 "already exported" errors.
// Since callers use the Zod schemas directly (and can derive TS types via
// z.infer<typeof X>), we only re-export from ./generated/api.
const fixed = `export * from "./generated/api";\n`;

writeFileSync(indexPath, fixed, "utf8");
console.log("Fixed lib/api-zod/src/index.ts — only Zod schemas exported to avoid name conflicts.");
