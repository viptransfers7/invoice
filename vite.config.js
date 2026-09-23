import { defineConfig } from 'vite'

export default defineConfig({
  base: '/invoice/',
  build: {
    rollupOptions: { input: 'admin.html' },
  },
})
