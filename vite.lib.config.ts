import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Type declarations are emitted separately via `tsc -p tsconfig.lib.json`
// (see the `build:lib` script) rather than through a Vite plugin.
export default defineConfig({
  plugins: [react()],
  // Don't copy public/ (demo-app-only assets like favicon.svg/icons.svg)
  // into the published library tarball.
  publicDir: false,
  build: {
    lib: {
      entry: 'src/index.ts',
      name: 'ChainWritingEditor',
      formats: ['es', 'cjs'],
      fileName: (format) => `index.${format === 'es' ? 'mjs' : 'cjs'}`,
    },
    rollupOptions: {
      // A matcher function (not a fixed string list) so subpath imports
      // like `@tiptap/pm/state` are externalized too — a plain string in
      // the array only matches that exact specifier, not its subpaths.
      external: (id) =>
        id === 'react' ||
        id === 'react-dom' ||
        id === 'react/jsx-runtime' ||
        id.startsWith('@tiptap/'),
      output: {
        globals: {
          react: 'React',
          'react-dom': 'ReactDOM',
        },
      },
    },
  },
})
