/**
 * Password Validator
 * Validate password strength
 */
export interface PasswordValidationResult {
    valid: boolean;
    errors: string[];
    strength: 'weak' | 'medium' | 'strong';
}
/**
 * Validate password strength
 */
export declare function validatePasswordStrength(password: string): PasswordValidationResult;
