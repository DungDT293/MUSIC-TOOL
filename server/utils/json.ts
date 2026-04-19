/**
 * Convenience helper — returns a JSON Response with content-type header
 */
export function json(obj: any, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}
