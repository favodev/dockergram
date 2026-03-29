import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) {
            return
          }

          if (id.includes('/three') || id.includes('@react-three') || id.includes('/troika-') || id.includes('/postprocessing')) {
            return 'three-vendor'
          }

          if (id.includes('/react') || id.includes('/scheduler')) {
            return 'react-vendor'
          }

          if (id.includes('/zustand') || id.includes('/reconnecting-websocket')) {
            return 'data-vendor'
          }
        },
      },
    },
  },
})
