/**
 * Anti-Debugging Utilities
 * Phát hiện và ngăn chặn debugger, DevTools, reverse engineering
 */
/**
 * Detect DevTools (Chrome DevTools, Firefox DevTools)
 */
export declare function detectDevTools(): boolean;
/**
 * Detect debugger statement
 */
export declare function detectDebugger(): boolean;
/**
 * Detect common debugging tools (process names)
 */
export declare function detectDebuggerProcess(): Promise<boolean>;
/**
 * Detect VM/Sandbox environment
 */
export declare function detectVM(): boolean;
/**
 * Anti-debugging loop (làm chậm debugger)
 */
export declare function antiDebugLoop(): void;
/**
 * Disable right-click context menu (basic protection)
 */
export declare function disableContextMenu(): void;
/**
 * Main anti-debugging check
 * Returns true if debugging detected
 */
export declare function checkAntiDebug(): Promise<boolean>;
/**
 * Initialize anti-debugging (chỉ trong production)
 */
export declare function initAntiDebug(): void;
