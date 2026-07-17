import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 4927,
    watch: {
      ignored: ['**/python-backend/**', '**/node_modules/**']
    }
  },
})
