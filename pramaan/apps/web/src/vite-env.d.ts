/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base URL of the Pramaan backend API (default http://localhost:8787). */
  readonly VITE_API_URL?: string;
  /** IPFS HTTP gateway used for CID links when the backend reports no gateway URL (default http://127.0.0.1:8080). */
  readonly VITE_IPFS_GATEWAY_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
