#!/bin/bash
# Test script cho security report endpoint

ENDPOINT="https://license-server.dungdong333.workers.dev/api/security/report"

echo "🧪 Testing Security Report Endpoint"
echo "===================================="
echo ""

# Test 1: SIGNATURE_INVALID
echo "Test 1: SIGNATURE_INVALID (High)"
curl -X POST "$ENDPOINT" \
  -H "Content-Type: application/json" \
  -d '{
    "event": "SIGNATURE_INVALID",
    "severity": "high",
    "message": "Invalid signature detected for POST /api/auth/check",
    "details": {
      "path": "/api/auth/check",
      "method": "POST",
      "expectedSignature": "abc123...",
      "receivedSignature": "xyz789..."
    },
    "timestamp": '$(date +%s000)',
    "machineId": "test-machine-id-123",
    "username": "testuser",
    "appVersion": "1.0.4"
  }'
echo ""
echo ""

# Test 2: TAMPERING_DETECTED
echo "Test 2: TAMPERING_DETECTED (Critical)"
curl -X POST "$ENDPOINT" \
  -H "Content-Type: application/json" \
  -d '{
    "event": "TAMPERING_DETECTED",
    "severity": "critical",
    "message": "Tampering detected: Executable integrity check failed",
    "details": {
      "reasons": ["Executable integrity check failed"],
      "file": "main.exe"
    },
    "timestamp": '$(date +%s000)',
    "machineId": "test-machine-id-456",
    "appVersion": "1.0.4"
  }'
echo ""
echo ""

# Test 3: LICENSE_CHECK_FAILED
echo "Test 3: LICENSE_CHECK_FAILED (High)"
curl -X POST "$ENDPOINT" \
  -H "Content-Type: application/json" \
  -d '{
    "event": "LICENSE_CHECK_FAILED",
    "severity": "high",
    "message": "License check failed: License bị từ chối",
    "details": {
      "reason": "License bị từ chối",
      "status": "denied",
      "attemptCount": 5
    },
    "timestamp": '$(date +%s000)',
    "machineId": "test-machine-id-789",
    "username": "testuser2",
    "appVersion": "1.0.4"
  }'
echo ""
echo ""

echo "✅ Tests completed!"
echo "Check Cloudflare Dashboard logs to see if events were received."


