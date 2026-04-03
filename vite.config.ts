import { defineConfig } from 'vite'
import path from 'path'

export default defineConfig({
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    lib: {
      entry: path.resolve(__dirname, 'src/index.tsx'),
      formats: ['es'],
      fileName: () => '_worker.js',
    },
    rollupOptions: {
      external: [],
    },
    minify: 'esbuild',
    sourcemap: false,
  },
  resolve: {
    alias: {
      '~': path.resolve(__dirname, 'src'),
    },
  },
})
