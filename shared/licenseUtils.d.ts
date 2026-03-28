export declare function normalizeMachineIdentifier(raw: string): string;
export declare function hashMachineIdentifier(raw: string): string;
export declare function encodePayload(payload: unknown): string;
export declare function decodePayload<T>(payload: string): T;
