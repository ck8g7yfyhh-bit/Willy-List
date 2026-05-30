import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  // 將原本的 '/anime-tracker/' 改為 './'
  base: './', 
  plugins: [react()],
})