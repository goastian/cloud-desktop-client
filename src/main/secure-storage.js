/**
 * Secure Storage - Encrypts sensitive data using Electron's safeStorage API
 * Falls back to plain text if safeStorage is not available (e.g., Linux without keyring)
 */

const { safeStorage } = require('electron');

class SecureStorage {
    constructor(store) {
        this.store = store;
    }

    /**
     * Check if encryption is available on this platform
     */
    isEncryptionAvailable() {
        return safeStorage.isEncryptionAvailable();
    }

    /**
     * Store a sensitive value (encrypted if possible)
     * @param {string} key - Storage key
     * @param {string} value - Plain text value to store
     */
    setSecure(key, value) {
        if (this.isEncryptionAvailable()) {
            const encrypted = safeStorage.encryptString(value);
            this.store.set(key, encrypted.toString('base64'));
            this.store.set(`${key}_encrypted`, true);
        } else {
            // Fallback: store as plain text with a warning flag
            this.store.set(key, value);
            this.store.set(`${key}_encrypted`, false);
            console.warn(`[SecureStorage] Encryption not available, storing '${key}' in plain text`);
        }
    }

    /**
     * Retrieve a sensitive value (decrypted if it was encrypted)
     * @param {string} key - Storage key
     * @returns {string|null} - Decrypted value or null if not found
     */
    getSecure(key) {
        const value = this.store.get(key);
        if (value === undefined || value === null) return null;

        const wasEncrypted = this.store.get(`${key}_encrypted`, false);

        if (wasEncrypted && this.isEncryptionAvailable()) {
            try {
                const buffer = Buffer.from(value, 'base64');
                return safeStorage.decryptString(buffer);
            } catch (error) {
                console.error(`[SecureStorage] Failed to decrypt '${key}':`, error.message);
                return null;
            }
        }

        // Plain text fallback or migration from old unencrypted storage
        if (typeof value === 'string' && !wasEncrypted) {
            // Auto-migrate: re-encrypt if encryption is now available
            if (this.isEncryptionAvailable() && value.length > 0) {
                console.log(`[SecureStorage] Migrating '${key}' to encrypted storage`);
                this.setSecure(key, value);
            }
            return value;
        }

        return value;
    }

    /**
     * Delete a sensitive value
     * @param {string} key - Storage key
     */
    deleteSecure(key) {
        this.store.delete(key);
        this.store.delete(`${key}_encrypted`);
    }

    /**
     * Check if a secure key exists
     * @param {string} key - Storage key
     */
    hasSecure(key) {
        return this.store.has(key);
    }
}

module.exports = SecureStorage;
