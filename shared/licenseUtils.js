import crypto from 'node:crypto';
export function normalizeMachineIdentifier(raw) {
    return raw.replace(/\s+/g, '').toUpperCase();
}
export function hashMachineIdentifier(raw) {
    var normalized = normalizeMachineIdentifier(raw);
    return crypto.createHash('sha256').update(normalized).digest('hex');
}
export function encodePayload(payload) {
    return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}
export function decodePayload(payload) {
    var json = Buffer.from(payload, 'base64url').toString('utf8');
    return JSON.parse(json);
}
