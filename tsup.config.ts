import { defineConfig } from 'tsup';

// `electron` is a peer/optional dependency and is only ever loaded lazily at runtime
// (see src/secure-store.ts). Marking it external means esbuild never tries to resolve
// it at build time, so this package builds cleanly WITHOUT electron installed.
export default defineConfig({
  entry: { index: 'src/index.ts' },
  format: ['esm'],
  dts: true,
  clean: true,
  sourcemap: true,
  treeshake: true,
  external: ['electron'],
});
