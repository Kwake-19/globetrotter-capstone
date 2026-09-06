/**
 * Minimal reverse proxy built on global fetch (Node 18+). Forwards the
 * request's method, path, query string, headers and body faithfully to a
 * downstream service and streams the response back. A downstream that is
 * unreachable / refuses the connection produces a clean 502 instead of
 * crashing the gateway.
 *
 * We deliberately do NOT use http-proxy-middleware here - Phase 2's
 * learning goal is explicit inter-service HTTP, and a hand-rolled fetch
 * proxy keeps the forwarding rules (which headers, identity injection,
 * error handling) visible in one small file.
 */

// Never forwarded upstream:
//  - hop-by-hop headers (host/connection/content-length/transfer-encoding)
//  - accept-encoding: keep upstream responses uncompressed so we can send
//    the bytes straight back without a decode step
//  - x-user-*: identity is set ONLY by verifyToken below, so a client
//    cannot spoof it by sending the header itself
const STRIP_REQUEST_HEADERS = new Set([
  'host',
  'connection',
  'content-length',
  'transfer-encoding',
  'accept-encoding',
  'x-user-id',
  'x-is-admin',
  'x-user-name'
]);

// Recomputed by Express when we send the new body.
const STRIP_RESPONSE_HEADERS = new Set([
  'connection',
  'transfer-encoding',
  'content-encoding',
  'content-length'
]);

function makeProxy(target) {
  return async function proxy(req, res) {
    const url = target + req.originalUrl;

    const headers = {};
    for (const [key, value] of Object.entries(req.headers)) {
      if (!STRIP_REQUEST_HEADERS.has(key.toLowerCase())) headers[key] = value;
    }

    // Forward identity as headers. Downstream services trust these
    // specifically because they are not reachable from outside the Docker
    // network - only the gateway is - so the only source of an X-User-*
    // header is verifyToken on a real, verified JWT.
    if (req.userId) headers['x-user-id'] = req.userId;
    if (req.isAdmin) headers['x-is-admin'] = 'true';
    if (req.userId && req.userName) headers['x-user-name'] = encodeURIComponent(req.userName);

    const hasBody = Buffer.isBuffer(req.body) && req.body.length > 0;

    let upstream;
    try {
      upstream = await fetch(url, {
        method: req.method,
        headers,
        body: hasBody ? req.body : undefined
      });
    } catch (err) {
      console.error(`[gateway] ${req.method} ${req.originalUrl} -> ${target} failed: ${err.message}`);
      return res.status(502).json({ error: 'Upstream service is unavailable' });
    }

    res.status(upstream.status);
    upstream.headers.forEach((value, key) => {
      if (!STRIP_RESPONSE_HEADERS.has(key.toLowerCase())) res.setHeader(key, value);
    });

    if (upstream.status === 204 || req.method === 'HEAD') {
      return res.end();
    }

    const buf = Buffer.from(await upstream.arrayBuffer());
    return res.send(buf);
  };
}

module.exports = { makeProxy };
