import { build } from "esbuild";

await build({
  entryPoints: ["dev/agentation.jsx"],
  bundle: true,
  platform: "browser",
  format: "iife",
  target: "es2022",
  define: { "process.env.NODE_ENV": '"development"' },
  outfile: ".generated/agentation.txt",
});
