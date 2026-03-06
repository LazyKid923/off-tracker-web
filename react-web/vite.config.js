import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 5187,
    proxy: {
      '/api': {
        target: 'http://localhost:8787',
        changeOrigin: true
      }
    }
  }
});
