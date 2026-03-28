/// <reference path="./types.d.ts" />

/**
 * Cloudflare Workers Endpoint: /api/security/report
 * Nhận và xử lý security alerts từ client
 */

interface SecurityEvent {
  event: string
  severity: 'low' | 'medium' | 'high' | 'critical'
  message: string
  details?: Record<string, any>
  timestamp: number
  machineId: string
  username?: string
  appVersion?: string
}

interface Env {
  // Cloudflare KV để lưu events (optional)
  SECURITY_EVENTS_KV?: KVNamespace
  
  // Cloudflare D1 Database (optional - nếu muốn lưu vào SQL)
  DB?: D1Database
  
  // Email service (SendGrid, Resend, etc.)
  SENDGRID_API_KEY?: string
  ALERT_EMAIL?: string
  
  // Webhook URL (optional - để gửi alerts đến Discord, Slack, etc.)
  WEBHOOK_URL?: string
}

/**
 * Handle security report request
 * Export function để có thể import từ file khác
 */
export async function handleSecurityReport(request: Request, env: Env): Promise<Response> {
  // Chỉ accept POST requests
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  try {
    // Parse request body
    const event: SecurityEvent = await request.json()

    // Validate required fields
    if (!event.event || !event.severity || !event.machineId) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields: event, severity, machineId' }),
        {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        }
      )
    }

    // Log event (console.log trong Cloudflare Workers sẽ hiển thị trong dashboard)
    console.log('[Security Alert]', {
      event: event.event,
      severity: event.severity,
      machineId: event.machineId.substring(0, 16) + '...', // Chỉ log một phần để bảo mật
      username: event.username || 'N/A',
      timestamp: new Date(event.timestamp).toISOString(),
    })

    // Lưu event vào KV (nếu có)
    if (env.SECURITY_EVENTS_KV) {
      const eventKey = `security:${event.machineId}:${Date.now()}`
      await env.SECURITY_EVENTS_KV.put(
        eventKey,
        JSON.stringify(event),
        { expirationTtl: 30 * 24 * 60 * 60 } // 30 ngày
      )
    }

    // Lưu vào D1 Database (nếu có)
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
      } catch (dbError: any) {
        // Nếu table chưa tồn tại, log error nhưng không fail request
        console.error('[DB Error]', dbError.message)
      }
    }

    // Gửi email alert cho critical/high events
    if (
      (event.severity === 'critical' || event.severity === 'high') &&
      env.SENDGRID_API_KEY &&
      env.ALERT_EMAIL
    ) {
      await sendEmailAlert(event, env)
    }

    // Gửi webhook (Discord/Slack) cho critical events
    if (event.severity === 'critical' && env.WEBHOOK_URL) {
      await sendWebhookAlert(event, env.WEBHOOK_URL)
    }

    // Check và auto-block
    const { checkAndAutoBlock } = await import('./auto-block')
    const blockResult = await checkAndAutoBlock(event, env)
    if (blockResult.blocked) {
      console.warn(`[Auto-Block] ${blockResult.reason}`)
    }

    // Return success
    return new Response(
      JSON.stringify({
        ok: true,
        logged: true,
        timestamp: Date.now(),
        autoBlocked: blockResult.blocked || false,
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    )
  } catch (error: any) {
    console.error('[Security Report Error]', error)
    return new Response(
      JSON.stringify({
        ok: false,
        error: error.message || 'Internal server error',
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    )
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return handleSecurityReport(request, env)
  },
}

/**
 * Gửi email alert qua SendGrid
 */
async function sendEmailAlert(event: SecurityEvent, env: Env): Promise<void> {
  try {
    const emailBody = `
🚨 SECURITY ALERT - ${event.severity.toUpperCase()}

Event Type: ${event.event}
Severity: ${event.severity}
Message: ${event.message}
Machine ID: ${event.machineId.substring(0, 16)}...
Username: ${event.username || 'N/A'}
App Version: ${event.appVersion || 'N/A'}
Timestamp: ${new Date(event.timestamp).toISOString()}

Details:
${JSON.stringify(event.details || {}, null, 2)}

---
This is an automated alert from 93 Media Tool Mix Nhac Security System.
    `.trim()

    const response = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.SENDGRID_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        personalizations: [
          {
            to: [{ email: env.ALERT_EMAIL! }],
            subject: `🚨 Security Alert: ${event.event} (${event.severity})`,
          },
        ],
        from: { email: 'noreply@yourdomain.com', name: '93 Media Tool Security' },
        content: [
          {
            type: 'text/plain',
            value: emailBody,
          },
        ],
      }),
    })

    if (!response.ok) {
      console.error('[SendGrid Error]', await response.text())
    }
  } catch (error) {
    console.error('[Email Alert Error]', error)
  }
}

/**
 * Gửi webhook alert (Discord/Slack)
 */
async function sendWebhookAlert(event: SecurityEvent, webhookUrl: string): Promise<void> {
  try {
    const color = {
      critical: 0xff0000, // Red
      high: 0xff8800, // Orange
      medium: 0xffaa00, // Yellow
      low: 0x00ff00, // Green
    }[event.severity] || 0x888888

    const payload = {
      embeds: [
        {
          title: `🚨 Security Alert: ${event.event}`,
          description: event.message,
          color: color,
          fields: [
            {
              name: 'Severity',
              value: event.severity.toUpperCase(),
              inline: true,
            },
            {
              name: 'Machine ID',
              value: `\`${event.machineId.substring(0, 16)}...\``,
              inline: true,
            },
            {
              name: 'Username',
              value: event.username || 'N/A',
              inline: true,
            },
            {
              name: 'Timestamp',
              value: `<t:${Math.floor(event.timestamp / 1000)}:F>`,
              inline: false,
            },
          ],
          timestamp: new Date(event.timestamp).toISOString(),
          footer: {
            text: '93 Media Tool Mix Nhac Security System',
          },
        },
      ],
    }

    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })

    if (!response.ok) {
      console.error('[Webhook Error]', await response.text())
    }
  } catch (error) {
    console.error('[Webhook Alert Error]', error)
  }
}

