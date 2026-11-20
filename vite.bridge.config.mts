import { resolve } from 'node:path'
import { defineConfig } from 'vite'

// Builds the MCP bridge (skyv-mcp) and the command line (skyv) as self-contained CommonJS files,
// so they run with the Electron binary inside Skyv.app (ELECTRON_RUN_AS_NODE=1) without node_modules.
export default defineConfig({
  build: {
    ssr: true,
    outDir: resolve(__dirname, 'out/bridge'),
    emptyOutDir: true,
    target: 'node20',
    minify: false,
    rollupOptions: {
      input: { 'skyv-mcp': resolve(__dirname, 'src/bridge/main.ts'), skyv: resolve(__dirname, 'src/bridge/cliMain.ts') },
      output: { format: 'cjs', entryFileNames: '[name].cjs', chunkFileNames: 'shared-[hash].cjs' }
    }
  },
  ssr: { noExternal: true }
})
