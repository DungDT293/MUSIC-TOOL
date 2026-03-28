/**
 * Example: Cách integrate security report endpoint vào existing worker
 * 
 * Nếu bạn đã có worker tại license-server.dungdong333.workers.dev,
 * thêm route này vào worker hiện tại.
 */

// ============================================
// EXISTING WORKER CODE (giữ nguyên)
// ============================================

interface Env {
  // Your existing env vars...
  SECURITY_EVENTS_KV?: KVNamespace
  DB?: D1Database
  SENDGRID_API_KEY?: string
  ALERT_EMAIL?: string
  WEBHOOK_URL?: string
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    
    // ============================================
    // EXISTING ROUTES (giữ nguyên)
    // ============================================
    
    // Auth routes
    if (url.pathname === '/api/auth/register' && request.method === 'POST') {
      // ... existing code ...
      return new Response(JSON.stringify({ ok: true }))
    }
    
    if (url.pathname === '/api/auth/login' && request.method === 'POST') {
      // ... existing code ...
      return new Response(JSON.stringify({ ok: true }))
    }
    
    // License routes
    if (url.pathname === '/api/license/check' && request.method === 'POST') {
      // ... existing code ...
      return new Response(JSON.stringify({ ok: true }))
    }
    
    // ============================================
    // NEW: Security Report Endpoint
    // ============================================
    
    if (url.pathname === '/api/security/report' && request.method === 'POST') {
      return handleSecurityReport(request, env)
    }
    
    // Default 404
    return new Response('Not found', { status: 404 })
  },
}

/**
 * Handle security report request
 */
async function handleSecurityReport(request: Request, env: Env): Promise<Response> {
  try {
    const event = await request.json()
    
    // Validate
    if (!event.event || !event.severity || !event.machineId) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      )
    }
    
    // Log
    console.log('[Security Alert]', {
      event: event.event,
      severity: event.severity,
      machineId: event.machineId.substring(0, 16) + '...',
      username: event.username || 'N/A',
    })
    
    // Lưu vào KV (nếu có)
    if (env.SECURITY_EVENTS_KV) {
      const eventKey = `security:${event.machineId}:${Date.now()}`
      await env.SECURITY_EVENTS_KV.put(eventKey, JSON.stringify(event), {
        expirationTtl: 30 * 24 * 60 * 60, // 30 ngày
      })
    }
    
    // Lưu vào D1 (nếu có)
    if (env.DB) {
      try {
        await env.DB.prepare(
          `INSERT INTO security_events 
           (event_type, severity, message, details, timestamp, machine_id, username, app_version)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        )
          .bind(
            event.event,
            event.severity,
            event.message,
            JSON.stringify(event.details || {}),
            event.timestamp,
            event.machineId,
            event.username || null,
            event.appVersion || null
          )
          .run()
      } catch (dbError) {
        console.error('[DB Error]', dbError)
      }
    }
    
    // Gửi email cho critical/high events
    if (
      (event.severity === 'critical' || event.severity === 'high') &&
      env.SENDGRID_API_KEY &&
      env.ALERT_EMAIL
    ) {
      await sendEmailAlert(event, env)
    }
    
    // Gửi webhook cho critical events
    if (event.severity === 'critical' && env.WEBHOOK_URL) {
      await sendWebhookAlert(event, env.WEBHOOK_URL)
    }
    
    return new Response(
      JSON.stringify({ ok: true, logged: true }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )
  } catch (error: any) {
    console.error('[Security Report Error]', error)
    return new Response(
      JSON.stringify({ ok: false, error: error.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
}

/**
 * Send email alert
 */
async function sendEmailAlert(event: any, env: Env): Promise<void> {
  try {
    const emailBody = `
🚨 SECURITY ALERT - ${event.severity.toUpperCase()}

Event Type: ${event.event}
Severity: ${event.severity}
Message: ${event.message}
Machine ID: ${event.machineId.substring(0, 16)}...
Username: ${event.username || 'N/A'}
Timestamp: ${new Date(event.timestamp).toISOString()}

Details:
${JSON.stringify(event.details || {}, null, 2)}
    `.trim()
    
    await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.SENDGRID_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        personalizations: [{
          to: [{ email: env.ALERT_EMAIL! }],
          subject: `🚨 Security Alert: ${event.event} (${event.severity})`,
        }],
        from: { email: 'noreply@yourdomain.com', name: '93 Media Tool Security' },
        content: [{ type: 'text/plain', value: emailBody }],
      }),
    })
  } catch (error) {
    console.error('[Email Alert Error]', error)
  }
}

/**
 * Send webhook alert (Discord/Slack)
 */
async function sendWebhookAlert(event: any, webhookUrl: string): Promise<void> {
  try {
    const color = {
      critical: 0xff0000,
      high: 0xff8800,
      medium: 0xffaa00,
      low: 0x00ff00,
    }[event.severity] || 0x888888
    
    await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        embeds: [{
          title: `🚨 Security Alert: ${event.event}`,
          description: event.message,
          color: color,
          fields: [
            { name: 'Severity', value: event.severity.toUpperCase(), inline: true },
            { name: 'Machine ID', value: `\`${event.machineId.substring(0, 16)}...\``, inline: true },
            { name: 'Username', value: event.username || 'N/A', inline: true },
          ],
          timestamp: new Date(event.timestamp).toISOString(),
        }],
      }),
    })
  } catch (error) {
    console.error('[Webhook Alert Error]', error)
  }
}


