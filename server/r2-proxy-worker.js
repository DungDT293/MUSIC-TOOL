/**
 * Cloudflare Worker: R2 Proxy for License Updates
 * 
 * Proxy files from R2 bucket to maintain URL structure:
 * license-updates.pages.dev/win/file.exe → R2 bucket/win/file.exe
 */

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    
    // Extract path (e.g., /win/file.exe or /beta/win/file.exe)
    const path = url.pathname;
    
    // Remove leading slash for R2 key
    const r2Key = path.startsWith('/') ? path.slice(1) : path;
    
    try {
      // Get object from R2 bucket
      const object = await env.UPDATES_BUCKET.get(r2Key);
      
      if (!object) {
        return new Response('File not found', { 
          status: 404,
          headers: {
            'Content-Type': 'text/plain',
          },
        });
      }
      
      // Get object metadata
      const headers = new Headers();
      
      // Copy HTTP metadata from R2 object
      object.writeHttpMetadata(headers);
      
      // Set ETag for caching
      if (object.httpEtag) {
        headers.set('etag', object.httpEtag);
      }
      
      // Set cache control (optional, adjust as needed)
      headers.set('Cache-Control', 'public, max-age=3600');
      
      // Return file with proper headers
      return new Response(object.body, {
        headers,
      });
    } catch (error) {
      console.error('R2 Proxy Error:', error);
      return new Response('Internal Server Error', { 
        status: 500,
        headers: {
          'Content-Type': 'text/plain',
        },
      });
    }
  },
};
