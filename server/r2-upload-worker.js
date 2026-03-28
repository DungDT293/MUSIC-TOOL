/**
 * Cloudflare Worker: R2 Upload Endpoint
 * 
 * Upload files to R2 bucket via HTTP POST
 * Simple alternative to AWS CLI
 */

export default {
  async fetch(request, env) {
    // CORS headers
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    };

    // Handle OPTIONS (preflight)
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    // Only allow POST
    if (request.method !== 'POST') {
      return new Response('Method not allowed', { 
        status: 405,
        headers: corsHeaders,
      });
    }

    try {
      // Get file from request body
      const formData = await request.formData();
      const file = formData.get('file');
      const key = formData.get('key') || `win/${file.name}`;

      if (!file) {
        return new Response('No file provided', { 
          status: 400,
          headers: corsHeaders,
        });
      }

      // Upload to R2
      await env.UPDATES_BUCKET.put(key, file.body, {
        httpMetadata: {
          contentType: file.type || 'application/octet-stream',
        },
      });

      return new Response(JSON.stringify({ 
        success: true, 
        key,
        size: file.size,
      }), {
        status: 200,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
        },
      });
    } catch (error) {
      console.error('Upload error:', error);
      return new Response(JSON.stringify({ 
        success: false, 
        error: error.message 
      }), {
        status: 500,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
        },
      });
    }
  },
};
