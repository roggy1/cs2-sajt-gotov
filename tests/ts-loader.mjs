/**
 * Minimal resolver so `node --test` can load the app's TypeScript modules
 * directly, without a bundler or a test framework.
 *
 * Two things Vite does for us that bare Node does not:
 *   - extensionless relative imports ("./doppler" -> "./doppler.ts")
 *   - the "@/" alias that tsconfig maps to src/
 *
 * Kept deliberately tiny: it exists so the pure logic in src/lib can be
 * tested cheaply, not to reimplement module resolution.
 */
import { fileURLToPath, pathToFileURL } from "node:url";
import { existsSync } from "node:fs";
import path from "node:path";

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "src");

export function resolve(specifier, context, next) {
  if (specifier.startsWith("@/")) {
    const base = path.join(SRC, specifier.slice(2));
    for (const candidate of [`${base}.ts`, `${base}.tsx`, path.join(base, "index.ts")]) {
      if (existsSync(candidate)) return next(pathToFileURL(candidate).href, context);
    }
  }

  if (specifier.startsWith(".") && !/\.[mc]?[jt]sx?$/.test(specifier)) {
    const parentDir = context.parentURL
      ? path.dirname(fileURLToPath(context.parentURL))
      : process.cwd();
    const base = path.resolve(parentDir, specifier);
    for (const candidate of [`${base}.ts`, `${base}.tsx`, path.join(base, "index.ts")]) {
      if (existsSync(candidate)) return next(pathToFileURL(candidate).href, context);
    }
  }

  return next(specifier, context);
}
