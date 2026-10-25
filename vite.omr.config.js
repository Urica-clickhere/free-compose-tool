import { defineConfig } from 'vite';
export default defineConfig({ base: '/omr/', publicDir: 'omr-assets',  build: { outDir: 'public/omr', emptyOutDir: true, assetsInlineLimit:0, rollupOptions:{input:'omr-entry.ts',preserveEntrySignatures:'strict',output:{entryFileNames:'engine.js'}} } });
