/**
 * Environment Configuration Service
 * 
 * Manages development and production environments for the desktop client.
 * - Development: http://localhost:8000 (fixed)
 * - Production: Configurable URL (default: https://cloud2.astian.org)
 */

const ENVIRONMENTS = {
    DEVELOPMENT: 'development',
    PRODUCTION: 'production'
};

const DEFAULT_URLS = {
    [ENVIRONMENTS.DEVELOPMENT]: 'http://localhost:8000',
    [ENVIRONMENTS.PRODUCTION]: 'https://cloud2.astian.org'
};

class EnvironmentConfig {
    constructor(store) {
        this.store = store;
        this._initializeDefaults();
    }

    _initializeDefaults() {
        // Set default environment if not set
        if (!this.store.has('environment')) {
            this.store.set('environment', ENVIRONMENTS.PRODUCTION);
        }
        
        // Set default production URL if not set
        if (!this.store.has('productionUrl')) {
            this.store.set('productionUrl', DEFAULT_URLS[ENVIRONMENTS.PRODUCTION]);
        }
    }

    /**
     * Get current environment (development or production)
     */
    getEnvironment() {
        return this.store.get('environment', ENVIRONMENTS.PRODUCTION);
    }

    /**
     * Set current environment
     * @param {string} env - 'development' or 'production'
     */
    setEnvironment(env) {
        if (!Object.values(ENVIRONMENTS).includes(env)) {
            throw new Error(`Invalid environment: ${env}. Must be 'development' or 'production'`);
        }
        this.store.set('environment', env);
        
        // Update serverUrl based on environment
        const url = this.getServerUrl();
        this.store.set('serverUrl', url);
        
        return {
            environment: env,
            serverUrl: url
        };
    }

    /**
     * Check if currently in development mode
     */
    isDevelopment() {
        return this.getEnvironment() === ENVIRONMENTS.DEVELOPMENT;
    }

    /**
     * Check if currently in production mode
     */
    isProduction() {
        return this.getEnvironment() === ENVIRONMENTS.PRODUCTION;
    }

    /**
     * Get the server URL based on current environment
     */
    getServerUrl() {
        const env = this.getEnvironment();
        
        if (env === ENVIRONMENTS.DEVELOPMENT) {
            // Development URL is always localhost:8000
            return DEFAULT_URLS[ENVIRONMENTS.DEVELOPMENT];
        }
        
        // Production URL can be customized
        return this.store.get('productionUrl', DEFAULT_URLS[ENVIRONMENTS.PRODUCTION]);
    }

    /**
     * Set the production server URL
     * @param {string} url - The production server URL
     */
    setProductionUrl(url) {
        if (!url || typeof url !== 'string') {
            throw new Error('Invalid URL');
        }
        
        // Validate URL format
        try {
            new URL(url);
        } catch (e) {
            throw new Error('Invalid URL format');
        }
        
        this.store.set('productionUrl', url);
        
        // If currently in production, update serverUrl
        if (this.isProduction()) {
            this.store.set('serverUrl', url);
        }
        
        return url;
    }

    /**
     * Get the production server URL (even if in development mode)
     */
    getProductionUrl() {
        return this.store.get('productionUrl', DEFAULT_URLS[ENVIRONMENTS.PRODUCTION]);
    }

    /**
     * Get the development server URL (always localhost:8000)
     */
    getDevelopmentUrl() {
        return DEFAULT_URLS[ENVIRONMENTS.DEVELOPMENT];
    }

    /**
     * Get full configuration
     */
    getConfig() {
        return {
            environment: this.getEnvironment(),
            serverUrl: this.getServerUrl(),
            productionUrl: this.getProductionUrl(),
            developmentUrl: this.getDevelopmentUrl(),
            isDevelopment: this.isDevelopment(),
            isProduction: this.isProduction()
        };
    }

    /**
     * Toggle between development and production
     */
    toggleEnvironment() {
        const current = this.getEnvironment();
        const newEnv = current === ENVIRONMENTS.DEVELOPMENT 
            ? ENVIRONMENTS.PRODUCTION 
            : ENVIRONMENTS.DEVELOPMENT;
        return this.setEnvironment(newEnv);
    }
}

// Export constants for external use
EnvironmentConfig.ENVIRONMENTS = ENVIRONMENTS;
EnvironmentConfig.DEFAULT_URLS = DEFAULT_URLS;

module.exports = EnvironmentConfig;
