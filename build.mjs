import * as esbuild from "esbuild";
import { cpSync, mkdirSync, rmSync } from "node:fs";

// Produces dist/ — the folder you upload with `wrangler pages deploy dist`.
rmSync("dist", { recursive: true, force: true });
mkdirSync("dist", { recursive: true });

await esbuild.build({
  entryPoints: ["src/ui/main.jsx"],
  bundle: true,
  outfile: "dist/app.js",
  format: "iife",
  jsx: "automatic",
  loader: { ".jsx": "jsx", ".json": "json" },
  minify: true,
  sourcemap: true,
  define: { "process.env.NODE_ENV": '"production"' },
  logLevel: "info",
});

// Static assets: the HTML shell and the jigs (served at /jigs/<id>.json, which
// is what the proxy's JIG_BASE_URL and the future bookmarklet will fetch).
cpSync("public/index.html", "dist/index.html");
cpSync("jigs", "dist/jigs", { recursive: true });

console.log("\nBuilt dist/ — deploy with:  wrangler pages deploy dist\n");
