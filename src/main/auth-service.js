const axios = require('axios');

class AuthService {
    constructor(store, environmentConfig = null) {
        this.store = store;
        this.environmentConfig = environmentConfig;
        this.serverUrl = this._getServerUrl();
    }

    _getServerUrl() {
        if (this.environmentConfig) {
            return this.environmentConfig.getServerUrl();
        }
        return this.store.get('serverUrl', 'http://localhost:8000');
    }

    updateServerUrl(url) {
        this.serverUrl = url;
    }

    generateCode() {
        return Math.floor(100000 + Math.random() * 900000).toString();
    }

    getServerUrl() {
        return this._getServerUrl();
    }

    async validateUserEmail(email) {
        try {
            const serverUrl = this.getServerUrl();
            console.log(`[AuthService] Validating email ${email} at ${serverUrl}`);
            
            const response = await axios.post(`${serverUrl}/api/desktop/validate-email`, {
                email
            }, {
                timeout: 10000
            });

            return {
                success: true,
                exists: response.data.exists,
                user: response.data.user || null
            };
        } catch (error) {
            console.error('Error validating email:', error);
            return {
                success: false,
                error: error.response?.data?.message || error.message
            };
        }
    }

    async registerPairingCode(email) {
        try {
            const code = this.generateCode();
            const deviceName = require('os').hostname();
            const platform = process.platform;
            const serverUrl = this.getServerUrl();

            console.log(`[AuthService] Registering pairing code for ${email} at ${serverUrl}`);

            const response = await axios.post(`${serverUrl}/api/desktop/register-code`, {
                code,
                email,
                device_name: deviceName,
                platform
            }, {
                timeout: 10000
            });

            if (response.data.success) {
                this.store.set('pendingCode', code);
                this.store.set('userEmail', email);
                return { success: true, code };
            }

            return { success: false, error: 'Failed to register code' };
        } catch (error) {
            console.error('Error registering pairing code:', error);
            return { 
                success: false, 
                error: error.response?.data?.message || error.message 
            };
        }
    }

    async checkPairingApproval(code) {
        try {
            const serverUrl = this.getServerUrl();
            
            console.log(`[AuthService] Checking approval for code ${code} at ${serverUrl}`);
            
            const response = await axios.post(`${serverUrl}/api/desktop/check-approval`, {
                code: code,
                device_name: require('os').hostname(),
                platform: process.platform
            }, {
                timeout: 10000
            });

            if (response.data.success && response.data.approved) {
                return {
                    success: true,
                    token: response.data.token,
                    user: response.data.user
                };
            }

            return {
                success: false,
                error: response.data.message || 'Not approved yet'
            };
        } catch (error) {
            console.error('Error checking approval:', error);
            return {
                success: false,
                error: error.response?.data?.message || error.message || 'Network error'
            };
        }
    }

    async refreshToken() {
        try {
            const serverUrl = this.getServerUrl();
            const token = this.store.get('authToken');

            const response = await axios.post(
                `${serverUrl}/api/desktop/refresh-token`,
                {},
                {
                    headers: {
                        'Authorization': `Bearer ${token}`
                    }
                }
            );

            if (response.data.success) {
                this.store.set('authToken', response.data.token);
                return { success: true, token: response.data.token };
            }

            return { success: false };
        } catch (error) {
            console.error('Error refreshing token:', error);
            return { success: false };
        }
    }
}

module.exports = AuthService;
