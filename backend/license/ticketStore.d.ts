export interface StoredTicket {
    ticket?: string;
    requestId?: string;
    note?: string;
    lastSuccessAt?: number;
}
export declare function readStoredTicket(): StoredTicket | null;
export declare function writeStoredTicket(ticket: StoredTicket): void;
export declare function clearStoredTicket(): void;
