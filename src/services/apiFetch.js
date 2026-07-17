/**
 * Smart API fetch helper for Khmer Video Dubber.
 * 
 * Routes API calls through the best available channel:
 * 1. Electron IPC (Node.js native https) — no CORS, no Cloudflare issues
 * 2. Local Python proxy sidecar — fallback if IPC unavailable
 * 3. Direct fetch — last resort (works if CORS is configured on server)
 */

const DIRECT_API = 'https://video-dubber-khmer-v1.fastapicloud.dev';
const PROXY_API = 'http://127.0.0.1:9847/proxy';

export async function apiFetch(path, options = {}) {
  const method = options.method || 'GET';
  const body = options.body ? (typeof options.body === 'string' ? JSON.parse(options.body) : options.body) : undefined;

  // Strategy 1: Electron native IPC (bypasses CORS + Cloudflare entirely)
  if (window.electron && typeof window.electron.apiRequest === 'function') {
    try {
      const result = await window.electron.apiRequest({
        url: `${DIRECT_API}${path}`,
        method,
        body
      });
      // Convert IPC result to a fetch-like response object
      return {
        ok: result.ok,
        status: result.status,
        json: async () => result.data,
        text: async () => (typeof result.data === 'string' ? result.data : JSON.stringify(result.data))
      };
    } catch (e) {
      console.error('Electron IPC api-request failed, trying proxy fallback', e);
    }
  }

  // Strategy 2: Local Python proxy sidecar
  try {
    const res = await fetch(`${PROXY_API}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...options.headers },
      body: options.body
    });
    return res;
  } catch (e) {
    console.error('Python proxy fetch failed, trying direct fallback', e);
  }

  // Strategy 3: Direct fetch (last resort)
  return fetch(`${DIRECT_API}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...options.headers },
    body: options.body
  });
}
