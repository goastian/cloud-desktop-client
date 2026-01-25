const os = require('os');
const { v4: uuidv4 } = require('uuid');

class DeviceManager {
    constructor(store) {
        this.store = store;
        this.initializeDevice();
    }

    initializeDevice() {
        // Generate or retrieve device ID
        if (!this.store.get('deviceId')) {
            this.store.set('deviceId', this.generateDeviceId());
        }

        // Set default device name if not set
        if (!this.store.get('deviceName')) {
            this.store.set('deviceName', this.getDefaultDeviceName());
        }
    }

    generateDeviceId() {
        // Create a unique device ID based on hardware + random UUID
        const machineId = `${os.hostname()}-${os.platform()}-${os.arch()}`;
        return `${machineId}-${uuidv4().substring(0, 8)}`;
    }

    getDefaultDeviceName() {
        const hostname = os.hostname();
        const platform = this.getPlatformName();
        return `${hostname} (${platform})`;
    }

    getPlatformName() {
        switch (os.platform()) {
            case 'darwin': return 'macOS';
            case 'win32': return 'Windows';
            case 'linux': return 'Linux';
            default: return os.platform();
        }
    }

    getDeviceInfo() {
        return {
            id: this.store.get('deviceId'),
            name: this.store.get('deviceName'),
            platform: os.platform(),
            platformName: this.getPlatformName(),
            hostname: os.hostname(),
            arch: os.arch(),
            osVersion: os.release(),
            totalMemory: os.totalmem(),
            cpus: os.cpus().length,
            homeDir: os.homedir(),
            username: os.userInfo().username
        };
    }

    setDeviceName(name) {
        if (!name || name.trim().length === 0) {
            throw new Error('Device name cannot be empty');
        }
        this.store.set('deviceName', name.trim());
        return this.getDeviceInfo();
    }

    getDeviceId() {
        return this.store.get('deviceId');
    }

    getDeviceName() {
        return this.store.get('deviceName');
    }

    // Get device info for API registration
    getRegistrationInfo() {
        const info = this.getDeviceInfo();
        return {
            device_id: info.id,
            device_name: info.name,
            platform: info.platform,
            platform_name: info.platformName,
            os_version: info.osVersion,
            hostname: info.hostname
        };
    }
}

module.exports = DeviceManager;
