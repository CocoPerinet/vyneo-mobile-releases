import {defineConfig} from "vitest/config";
import {svelte} from "@sveltejs/vite-plugin-svelte";
import {fileURLToPath} from "node:url";
import {resolve} from "node:path";

const frontend=fileURLToPath(new URL(".",import.meta.url));
export default defineConfig({
  root:frontend,
  base:"./",
  plugins:[svelte()],
  resolve:{alias:{"$src":resolve(frontend,"src")}},
  build:{
    outDir:"dist",emptyOutDir:true,target:"es2022",
    sourcemap:false,cssCodeSplit:true,assetsInlineLimit:1024
  },
  server:{host:"127.0.0.1",port:4260,strictPort:true},
  test:{
    include:["tests/**/*.test.ts"],environment:"node",
    fileParallelism:false,maxWorkers:1,pool:"threads"
  }
});
