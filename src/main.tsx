import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'
import { initPixel } from './tiktok'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// Pixel do TikTok (PageView). Depois do render e blindado — nunca pode blanquear a página.
try { initPixel() } catch { /* no-op */ }
