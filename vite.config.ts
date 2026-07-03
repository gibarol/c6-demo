import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // Vercel serve na raiz do domínio.
  base: '/',
  server: { port: 5173 },
})
