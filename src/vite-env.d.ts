/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL: string
  readonly VITE_MOCK_MODE: string
  readonly VITE_WHATSAPP_NUMBER: string
  readonly VITE_TIKTOK_PIXEL_ID: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
