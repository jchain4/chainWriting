import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    // Process the editor stylesheet (instead of stubbing it to an empty
    // string) so tests can read its rules via '../editor.css?raw'.
    css: { include: [/editor\.css/] },
  },
})
