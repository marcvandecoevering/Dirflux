// API responses must never reuse a cached proxy login page or session.
export async function requestJson(url, options = {}) {
  const headers = new Headers(options.headers);
  headers.set('Accept', 'application/json');
  const response = await fetch(url, { ...options, headers, cache: 'no-store', credentials: 'same-origin' });
  return { response, body: parseApiResponse(await response.text(), response.headers.get('content-type'), response.status) };
}

export function parseApiResponse(text, contentType, status) {
  if (!/^application\/(?:[\w.-]+\+)?json(?:\s*;|\s*$)/i.test(contentType || '')) {
    throw new Error(`The server or access proxy returned a page instead of API data (HTTP ${status}). Reload this page and sign in to your access proxy if prompted. If this continues, ask the administrator to check proxy authentication and caching.`);
  }
  try { return JSON.parse(text); }
  catch { throw new Error(`The server returned invalid API data (HTTP ${status}). Try again or contact the administrator.`); }
}
