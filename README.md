# Astian Cloud Desktop Client

A cross-platform desktop synchronization client for Astian Cloud, built with Electron. Sync your files seamlessly between your local machine and Astian Cloud server.

![Astian Cloud](https://img.shields.io/badge/Astian-Cloud-667eea)
![Electron](https://img.shields.io/badge/Electron-25.9.0-47848F)
![License](https://img.shields.io/badge/License-AGPL--3.0-blue)
![Platform](https://img.shields.io/badge/Platform-Linux%20%7C%20Windows%20%7C%20macOS-lightgrey)

## 📋 Table of Contents

- [Features](#-features)
- [Feature Checklist](#-feature-checklist)
- [Requirements](#-requirements)
- [Installation](#-installation)
- [Development](#-development)
- [Project Structure](#-project-structure)
- [Architecture](#-architecture)
- [API Integration](#-api-integration)
- [Building](#-building)
- [Contributing](#-contributing)
- [License](#-license)

## ✨ Features

### Core Synchronization
- **Bidirectional Sync** - Automatically sync files between local folders and Astian Cloud
- **Multiple Sync Folders** - Add and manage multiple folders for synchronization
- **Real-time File Watching** - Detect local file changes instantly using chokidar
- **Periodic Server Sync** - Check for server changes every 30 seconds
- **Smart Conflict Resolution** - Compare timestamps to determine which version to keep

### Backup System
- **One-way Backup** - Upload folders to cloud without bidirectional sync
- **Selective Backup** - Choose specific folders for backup
- **Manual Backup Trigger** - Start backups on demand

### Device Management
- **Device Identification** - Unique device ID and customizable device name
- **Multi-device Support** - See which device uploaded each file
- **Device Registration** - Register devices with the Astian Cloud server

### Authentication
- **Email-based Authentication** - Secure login via email verification
- **Device Pairing** - Pair devices using verification codes
- **Token Management** - Automatic token refresh and secure storage

### Environment Configuration
- **Development Mode** - Connect to localhost:8000 for local testing
- **Production Mode** - Connect to configurable production server
- **Easy Switching** - Toggle between environments (dev mode only)

### User Interface
- **System Tray Integration** - Minimize to system tray
- **Dashboard View** - Overview of sync status and folders
- **Activity History** - View recent sync activities
- **Settings Panel** - Configure all aspects of the client

### Advanced Features
- **Offline Cache** - Cache files for offline access
- **Bandwidth Limits** - Set upload/download speed limits
- **Exclusion Patterns** - Exclude files by pattern (*.tmp, node_modules, etc.)
- **Sync Modes** - Automatic, manual, or selective sync

## ✅ Feature Checklist

### Implemented Features

- [x] Email-based authentication with device pairing
- [x] Bidirectional file synchronization
- [x] Multiple sync folders support
- [x] Real-time local file watching
- [x] Periodic server sync (30s interval)
- [x] File upload to server
- [x] File download from server
- [x] File deletion sync
- [x] Backup folders (one-way upload)
- [x] Device identification and naming
- [x] System tray integration
- [x] Dashboard with tabs (Sync, Backup, Activity, Settings)
- [x] Activity history tracking
- [x] Environment configuration (dev/prod)
- [x] Persistent file mapping (survives reinstall)
- [x] Token refresh mechanism
- [x] Exclusion patterns
- [x] Bandwidth limit settings (UI only)
- [x] Sync mode selection (UI only)
- [x] Offline cache settings (UI only)

### Pending Features

- [ ] Actual bandwidth throttling implementation
- [ ] Selective sync (choose specific files/folders)
- [ ] File versioning and history
- [ ] Conflict resolution UI
- [ ] Shared folders support
- [ ] End-to-end encryption
- [ ] Delta sync (only sync changed parts)
- [ ] LAN sync (sync between devices on same network)
- [ ] Notifications (desktop notifications for sync events)
- [ ] Auto-update mechanism
- [ ] Folder sharing between users
- [ ] Comments and collaboration features
- [ ] File preview in client
- [ ] Search functionality
- [ ] Trash/recycle bin integration
- [ ] Symbolic link support
- [ ] Large file chunked upload
- [ ] Resume interrupted transfers
- [ ] Sync scheduling (sync at specific times)
- [ ] Storage quota display
- [ ] Detailed sync statistics

## 📦 Requirements

- **Node.js** >= 16.x
- **npm** >= 8.x
- **Astian Cloud Server** running (for backend API)

## 🚀 Installation

### From Source

```bash
# Clone the repository
git clone https://github.com/niceastian/cloud.git
cd cloud/desktop-client

# Install dependencies
npm install

# Run in development mode
npm run dev

# Run in production mode
npm start
```

### Pre-built Binaries

Download the latest release for your platform:
- **Linux:** AppImage or .deb
- **Windows:** NSIS installer or portable
- **macOS:** DMG or ZIP

## 💻 Development

### Getting Started

1. **Clone and install:**
   ```bash
   git clone https://github.com/niceastian/cloud.git
   cd cloud/desktop-client
   npm install
   ```

2. **Start the Astian Cloud backend:**
   ```bash
   cd ../  # Go to cloud root
   php artisan serve --port=8000
   ```

3. **Run the desktop client in dev mode:**
   ```bash
   cd desktop-client
   npm run dev
   ```

### Development Mode Features

When running with `npm run dev` (or `electron . --dev`):
- Environment toggle is visible in UI
- Can switch between localhost:8000 and production server
- Additional logging in console
- DevTools can be opened with Ctrl+Shift+I

### Available Scripts

| Command | Description |
|---------|-------------|
| `npm start` | Run in production mode |
| `npm run dev` | Run in development mode with dev tools |
| `npm run build` | Build for current platform |
| `npm run build:linux` | Build for Linux (AppImage, deb) |
| `npm run build:win` | Build for Windows (NSIS, portable) |
| `npm run build:mac` | Build for macOS (DMG, ZIP) |
| `npm run build:all` | Build for all platforms |

### Environment Variables

The client uses a configuration store (via `conf` package) for settings. Key configurations:

| Key | Description | Default |
|-----|-------------|---------|
| `environment` | Current environment (development/production) | production |
| `serverUrl` | Current server URL | https://cloud2.astian.org |
| `productionUrl` | Production server URL | https://cloud2.astian.org |
| `authToken` | Authentication token | - |
| `syncFolder` | Primary sync folder path | - |
| `syncFolders` | Array of sync folder configurations | [] |

## 📁 Project Structure

```
desktop-client/
├── assets/                    # Application icons
│   ├── icon.png              # Linux icon (512x512)
│   ├── icon.ico              # Windows icon
│   ├── icon.icns             # macOS icon
│   └── tray-icon.png         # System tray icon (32x32)
├── src/
│   ├── main/                 # Main process (Node.js)
│   │   ├── index.js          # Application entry point
│   │   ├── auth-service.js   # Authentication handling
│   │   ├── sync-engine.js    # Core synchronization logic
│   │   ├── sync-folders-manager.js  # Multi-folder management
│   │   ├── backup-service.js # Backup functionality
│   │   ├── device-manager.js # Device identification
│   │   ├── environment-config.js    # Dev/prod configuration
│   │   ├── settings-manager.js      # User settings
│   │   ├── activity-history.js      # Activity tracking
│   │   └── offline-cache.js  # Offline file caching
│   └── renderer/             # Renderer process (UI)
│       ├── index.html        # Main HTML file
│       └── app.js            # UI logic
├── dist/                     # Build output
├── package.json
└── README.md
```

## 🏗️ Architecture

### Main Process Services

| Service | File | Description |
|---------|------|-------------|
| **SyncEngine** | `sync-engine.js` | Core bidirectional sync logic with file watching |
| **AuthService** | `auth-service.js` | Email authentication and token management |
| **SyncFoldersManager** | `sync-folders-manager.js` | Manages multiple sync folders |
| **BackupService** | `backup-service.js` | One-way backup to cloud |
| **DeviceManager** | `device-manager.js` | Device identification and naming |
| **EnvironmentConfig** | `environment-config.js` | Dev/prod environment switching |
| **SettingsManager** | `settings-manager.js` | User preferences and settings |
| **ActivityHistory** | `activity-history.js` | Tracks sync activities |
| **OfflineCache** | `offline-cache.js` | Caches files for offline access |

### IPC Communication

The main and renderer processes communicate via Electron's IPC:

```javascript
// Renderer → Main (invoke/handle)
ipcRenderer.invoke('get-config')
ipcRenderer.invoke('set-server-url', url)
ipcRenderer.invoke('add-sync-folder', folderPath)

// Main → Renderer (send/on)
mainWindow.webContents.send('sync-status-changed', { folderId, status })
```

### Key IPC Handlers

| Handler | Description |
|---------|-------------|
| `get-config` | Get current configuration |
| `set-server-url` | Update server URL |
| `validate-email` | Validate email for authentication |
| `verify-pairing-code` | Verify device pairing code |
| `add-sync-folder` | Add a new sync folder |
| `remove-sync-folder` | Remove a sync folder |
| `toggle-sync-folder` | Enable/disable a sync folder |
| `get-environment` | Get environment configuration |
| `set-environment` | Switch between dev/prod |
| `sync-now` | Trigger manual sync |

## 🔌 API Integration

The client communicates with Astian Cloud server via REST API:

### Endpoints Used

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/external/validate-email` | Validate email for login |
| POST | `/api/external/verify-pairing` | Verify pairing code |
| GET | `/api/external/workspaces` | Get user workspaces |
| GET | `/api/external/files` | List files in workspace |
| POST | `/api/external/files` | Upload new file |
| POST | `/api/external/files/{id}` | Update existing file |
| GET | `/api/external/files/{id}/download` | Download file |
| DELETE | `/api/external/files/{id}` | Delete file |

### Authentication

All API requests include the Bearer token:
```javascript
headers: {
    'Authorization': `Bearer ${authToken}`
}
```

## 🔨 Building

### Prerequisites

1. Install build dependencies:
   ```bash
   npm install
   ```

2. Create application icons in `assets/` folder:
   - `icon.png` (512x512) for Linux
   - `icon.ico` (multi-resolution) for Windows
   - `icon.icns` (multi-resolution) for macOS
   - `tray-icon.png` (32x32) for system tray

### Build Commands

```bash
# Build for current platform
npm run build

# Build for specific platform
npm run build:linux   # AppImage + deb
npm run build:win     # NSIS + portable
npm run build:mac     # DMG + ZIP

# Build for all platforms (requires all platform tools)
npm run build:all
```

### Build Output

Built packages are placed in `dist/` folder:
- Linux: `Astian Cloud-1.0.0.AppImage`, `astian-cloud-desktop_1.0.0_amd64.deb`
- Windows: `Astian Cloud Setup 1.0.0.exe`, `Astian Cloud 1.0.0.exe` (portable)
- macOS: `Astian Cloud-1.0.0.dmg`, `Astian Cloud-1.0.0-mac.zip`

## 🤝 Contributing

We welcome contributions! Here's how to get started:

### Development Workflow

1. **Fork the repository**

2. **Create a feature branch:**
   ```bash
   git checkout -b feature/your-feature-name
   ```

3. **Make your changes**

4. **Test thoroughly:**
   - Run `npm run dev` and test all features
   - Test on multiple platforms if possible
   - Ensure no console errors

5. **Commit with clear messages:**
   ```bash
   git commit -m "feat: add new feature description"
   ```

6. **Push and create a Pull Request**

### Commit Message Convention

We follow [Conventional Commits](https://www.conventionalcommits.org/):

- `feat:` New feature
- `fix:` Bug fix
- `docs:` Documentation changes
- `style:` Code style changes (formatting, etc.)
- `refactor:` Code refactoring
- `test:` Adding or updating tests
- `chore:` Maintenance tasks

### Code Style Guidelines

- Use ES6+ JavaScript features
- Use async/await for asynchronous code
- Add JSDoc comments for public methods
- Keep functions small and focused
- Handle errors appropriately

### Areas for Contribution

- **Bug fixes** - Check issues labeled `bug`
- **New features** - Check the pending features list above
- **Documentation** - Improve README, add JSDoc comments
- **Testing** - Add unit tests, integration tests
- **UI/UX** - Improve the user interface
- **Translations** - Add i18n support

### Reporting Issues

When reporting issues, please include:
- Operating system and version
- Node.js and npm versions
- Steps to reproduce
- Expected vs actual behavior
- Console logs if applicable

## 📄 License

This project is licensed under the **GNU Affero General Public License v3.0 (AGPL-3.0)**.

See [LICENSE](../LICENSE) for the full license text.

## 🔗 Links

- **Astian Cloud Web:** [https://cloud2.astian.org](https://cloud2.astian.org)
- **Astian Website:** [https://astian.org](https://astian.org)
- **Repository:** [https://github.com/niceastian/cloud](https://github.com/niceastian/cloud)

---

Made with ❤️ by [Astian](https://astian.org)
