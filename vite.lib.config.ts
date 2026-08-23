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
      external: [
        'react',
        'react-dom',
        'react/jsx-runtime',
        '@tiptap/react',
        '@tiptap/starter-kit',
        '@tiptap/extension-placeholder',
        '@tiptap/extension-typography',
        '@tiptap/extension-link',
        '@tiptap/extension-underline',
        '@tiptap/pm',
      ],
      output: {
        globals: {
          react: 'React',
          'react-dom': 'ReactDOM',
        },
      },
    },
  },
})
