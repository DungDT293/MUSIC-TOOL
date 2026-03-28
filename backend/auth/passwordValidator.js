/**
 * Password Validator
 * Validate password strength
 */
/**
 * Validate password strength
 */
export function validatePasswordStrength(password) {
    var errors = [];
    // Minimum length
    if (password.length < 8) {
        errors.push('Mật khẩu phải có ít nhất 8 ký tự');
    }
    // Check for lowercase letter
    if (!/[a-z]/.test(password)) {
        errors.push('Mật khẩu phải có ít nhất một chữ thường');
    }
    // Check for uppercase letter
    if (!/[A-Z]/.test(password)) {
        errors.push('Mật khẩu phải có ít nhất một chữ hoa');
    }
    // Check for number
    if (!/[0-9]/.test(password)) {
        errors.push('Mật khẩu phải có ít nhất một số');
    }
    // Check for special character
    if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) {
        errors.push('Mật khẩu phải có ít nhất một ký tự đặc biệt');
    }
    // Determine strength
    var strength = 'weak';
    if (errors.length === 0) {
        strength = password.length >= 12 ? 'strong' : 'medium';
    }
    else if (errors.length <= 2 && password.length >= 8) {
        strength = 'medium';
    }
    return {
        valid: errors.length === 0,
        errors: errors,
        strength: strength,
    };
}
