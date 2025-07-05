"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.XSenseHomebridgePlatform = void 0;
const settings_1 = require("./settings");
const XsenseApi_1 = require("./api/XsenseApi");
const SmokeAndCOSensorAccessory_1 = require("./accessories/SmokeAndCOSensorAccessory");
class XSenseHomebridgePlatform {
    constructor(log, config, api) {
        this.log = log;
        this.config = config;
        this.api = api;
        this.Service = this.api.hap.Service;
        this.Characteristic = this.api.hap.Characteristic;
        this.accessories = [];
        this.accessoryHandlers = new Map();
        this.log.debug('Finished initializing platform:', this.config.name);
        this.api.on('didFinishLaunching', async () => {
            log.debug('Executed didFinishLaunching callback');
            await this.discoverDevices();
        });
        this.api.on('shutdown', () => {
            this.log.info('Homebridge is shutting down, disconnecting from X-Sense.');
            if (this.pollingInterval) {
                clearInterval(this.pollingInterval);
            }
            this.xsenseApi?.disconnectMqtt();
        });
    }
    configureAccessory(accessory) {
        this.log.info('Loading accessory from cache:', accessory.displayName);
        this.accessories.push(accessory);
    }
    async discoverDevices() {
        if (!this.config.username || !this.config.password) {
            this.log.error('Username or password not configured. Please check your Homebridge configuration.');
            return;
        }
        this.xsenseApi = new XsenseApi_1.XsenseApi(this.config.username, this.config.password, this.log);
        try {
            await this.xsenseApi.login();
            this.log.info('Successfully logged into X-Sense API.');
            const devices = await this.xsenseApi.getDeviceList();
            this.log.info(`Discovered ${devices.length} devices.`);
            // Filter for actual sensors, not base stations which don't have their own sensors
            const sensorDevices = devices.filter(d => d.device_id !== d.station_sn);
            const cachedAccessories = [...this.accessories];
            this.log.info(`Found ${sensorDevices.length} sensor devices to register.`);
            for (const device of sensorDevices) {
                const uuid = this.api.hap.uuid.generate(device.device_id);
                const existingAccessory = cachedAccessories.find(accessory => accessory.UUID === uuid);
                if (existingAccessory) {
                    this.log.info('Restoring existing accessory from cache:', device.device_name);
                    existingAccessory.context = device;
                    this.api.updatePlatformAccessories([existingAccessory]);
                    const handler = new SmokeAndCOSensorAccessory_1.SmokeAndCOSensorAccessory(this, existingAccessory);
                    this.accessoryHandlers.set(uuid, handler);
                }
                else {
                    this.log.info('Registering new accessory:', device.device_name);
                    const accessory = new this.api.platformAccessory(device.device_name, uuid);
                    accessory.context = device;
                    const handler = new SmokeAndCOSensorAccessory_1.SmokeAndCOSensorAccessory(this, accessory);
                    this.accessoryHandlers.set(uuid, handler);
                    this.api.registerPlatformAccessories(settings_1.PLUGIN_NAME, settings_1.PLATFORM_NAME, [accessory]);
                }
            }
            const accessoriesToUnregister = cachedAccessories.filter(cached => !sensorDevices.some(d => this.api.hap.uuid.generate(d.device_id) === cached.UUID));
            if (accessoriesToUnregister.length > 0) {
                this.log.info('Unregistering stale accessories:', accessoriesToUnregister.map(a => a.displayName));
                this.api.unregisterPlatformAccessories(settings_1.PLUGIN_NAME, settings_1.PLATFORM_NAME, accessoriesToUnregister);
            }
            // Connect to MQTT for real-time updates
            await this.xsenseApi.connectMqtt();
            // Listen for MQTT messages
            this.xsenseApi.on('message', (topic, payload) => {
                this.handleMqttMessage(topic, payload);
            });
            // Start periodic polling as a fallback
            const pollingMinutes = this.config.pollingInterval || 15;
            this.log.info(`Starting periodic polling every ${pollingMinutes} minutes.`);
            this.pollingInterval = setInterval(() => this.refreshAllDevices(), pollingMinutes * 60 * 1000);
        }
        catch (error) {
            this.log.error('Failed to initialize X-Sense API client. Please check credentials and connectivity.', error);
        }
    }
    async refreshAllDevices() {
        this.log.info('Polling for device status updates...');
        if (!this.xsenseApi) {
            this.log.warn('API client not available, skipping poll.');
            return;
        }
        try {
            const devices = await this.xsenseApi.getDeviceList();
            this.log.debug(`Poll found ${devices.length} devices.`);
            for (const device of devices) {
                const uuid = this.api.hap.uuid.generate(device.device_id);
                const handler = this.accessoryHandlers.get(uuid);
                if (handler) {
                    handler.updateFromDeviceInfo(device);
                }
            }
        }
        catch (error) {
            this.log.error('Error during periodic device refresh:', error);
        }
    }
    handleMqttMessage(topic, payload) {
        this.log.debug(`Received real-time update on ${topic}:`, JSON.stringify(payload));
        if (topic.includes('shadow/update')) {
            // Shadow updates contain state for multiple devices attached to a base station
            const devices = payload.state?.reported?.devices;
            if (devices && Array.isArray(devices)) {
                for (const deviceState of devices) {
                    if (deviceState.deviceId) {
                        const uuid = this.api.hap.uuid.generate(deviceState.deviceId);
                        const handler = this.accessoryHandlers.get(uuid);
                        handler?.updateFromShadow(deviceState);
                    }
                }
            }
        }
        else if (topic.includes('@xsense/events')) {
            // Event topics are for alarms
            if (payload.devId) {
                const uuid = this.api.hap.uuid.generate(payload.devId);
                const handler = this.accessoryHandlers.get(uuid);
                handler?.updateFromEvent(payload);
            }
        }
    }
}
exports.XSenseHomebridgePlatform = XSenseHomebridgePlatform;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicGxhdGZvcm0uanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi9zcmMvcGxhdGZvcm0udHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7O0FBRUEseUNBQXdEO0FBRXhELCtDQUE0QztBQUM1Qyx1RkFBb0Y7QUFFcEYsTUFBYSx3QkFBd0I7SUFRbkMsWUFDa0IsR0FBVyxFQUNYLE1BQXNCLEVBQ3RCLEdBQVE7UUFGUixRQUFHLEdBQUgsR0FBRyxDQUFRO1FBQ1gsV0FBTSxHQUFOLE1BQU0sQ0FBZ0I7UUFDdEIsUUFBRyxHQUFILEdBQUcsQ0FBSztRQVZWLFlBQU8sR0FBbUIsSUFBSSxDQUFDLEdBQUcsQ0FBQyxHQUFHLENBQUMsT0FBTyxDQUFDO1FBQy9DLG1CQUFjLEdBQTBCLElBQUksQ0FBQyxHQUFHLENBQUMsR0FBRyxDQUFDLGNBQWMsQ0FBQztRQUNwRSxnQkFBVyxHQUF3QixFQUFFLENBQUM7UUFFckMsc0JBQWlCLEdBQUcsSUFBSSxHQUFHLEVBQXFDLENBQUM7UUFRaEYsSUFBSSxDQUFDLEdBQUcsQ0FBQyxLQUFLLENBQUMsaUNBQWlDLEVBQUUsSUFBSSxDQUFDLE1BQU0sQ0FBQyxJQUFJLENBQUMsQ0FBQztRQUVwRSxJQUFJLENBQUMsR0FBRyxDQUFDLEVBQUUsQ0FBQyxvQkFBb0IsRUFBRSxLQUFLLElBQUksRUFBRTtZQUMzQyxHQUFHLENBQUMsS0FBSyxDQUFDLHNDQUFzQyxDQUFDLENBQUM7WUFDbEQsTUFBTSxJQUFJLENBQUMsZUFBZSxFQUFFLENBQUM7UUFDL0IsQ0FBQyxDQUFDLENBQUM7UUFFSCxJQUFJLENBQUMsR0FBRyxDQUFDLEVBQUUsQ0FBQyxVQUFVLEVBQUUsR0FBRyxFQUFFO1lBQzNCLElBQUksQ0FBQyxHQUFHLENBQUMsSUFBSSxDQUFDLDBEQUEwRCxDQUFDLENBQUM7WUFDMUUsSUFBSSxJQUFJLENBQUMsZUFBZSxFQUFFLENBQUM7Z0JBQ3pCLGFBQWEsQ0FBQyxJQUFJLENBQUMsZUFBZSxDQUFDLENBQUM7WUFDdEMs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Q3pDLENBQUM7Z0JBQ0gsQ0FBQztZQUNILENBQUM7UUFDSCxDQUFDO2FBQU0sSUFBSSxLQUFLLENBQUMsUUFBUSxDQUFDLGdCQUFnQixDQUFDLEVBQUUsQ0FBQztZQUM1Qyw4QkFBOEI7WUFDOUIsSUFBSSxPQUFPLENBQUMsS0FBSyxFQUFFLENBQUM7Z0JBQ2xCLE1BQU0sSUFBSSxHQUFHLElBQUksQ0FBQyxHQUFHLENBQUMsR0FBRyxDQUFDLElBQUksQ0FBQyxRQUFRLENBQUMsT0FBTyxDQUFDLEtBQUssQ0FBQyxDQUFDO2dCQUN2RCxNQUFNLE9BQU8sR0FBRyxJQUFJLENBQUMsaUJBQWlCLENBQUMsR0FBRyxDQUFDLElBQUksQ0FBQyxDQUFDO2dCQUNqRCxPQUFPLEVBQUUsZUFBZSxDQUFDLE9BQU8sQ0FBQyxDQUFDO1lBQ3BDLENBQUM7UUFDSCxDQUFDO0lBQ0gsQ0FBQztDQUNGO0FBbEpELDREQWtKQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IEFQSSwgRHluYW1pY1BsYXRmb3JtUGx1Z2luLCBMb2dnZXIsIFBsYXRmb3JtQWNjZXNzb3J5LCBQbGF0Zm9ybUNvbmZpZywgU2VydmljZSwgQ2hhcmFjdGVyaXN0aWMgfSBmcm9tICdob21lYnJpZGdlJztcblxuaW1wb3J0IHsgUExBVEZPUk1fTkFNRSwgUExVR0lOX05BTUUgfSBmcm9tICcuL3NldHRpbmdzJztcbmltcG9ydCB7IERldmljZUluZm8gfSBmcm9tICcuL2FwaS90eXBlcyc7XG5pbXBvcnQgeyBYc2Vuc2VBcGkgfSBmcm9tICcuL2FwaS9Yc2Vuc2VBcGknO1xuaW1wb3J0IHsgU21va2VBbmRDT1NlbnNvckFjY2Vzc29yeSB9IGZyb20gJy4vYWNjZXNzb3JpZXMvU21va2VBbmRDT1NlbnNvckFjY2Vzc29yeSc7XG5cbmV4cG9ydCBjbGFzcyBYU2Vuc2VIb21lYnJpZGdlUGxhdGZvcm0gaW1wbGVtZW50cyBEeW5hbWljUGxhdGZvcm1QbHVnaW4ge1xuICBwdWJsaWMgcmVhZG9ubHkgU2VydmljZTogdHlwZW9mIFNlcnZpY2UgPSB0aGlzLmFwaS5oYXAuU2VydmljZTtcbiAgcHVibGljIHJlYWRvbmx5IENoYXJhY3RlcmlzdGljOiB0eXBlb2YgQ2hhcmFjdGVyaXN0aWMgPSB0aGlzLmFwaS5oYXAuQ2hhcmFjdGVyaXN0aWM7XG4gIHB1YmxpYyByZWFkb25seSBhY2Nlc3NvcmllczogUGxhdGZvcm1BY2Nlc3NvcnlbXSA9IFtdO1xuICBwcml2YXRlIHhzZW5zZUFwaT86IFhzZW5zZUFwaTtcbiAgcHJpdmF0ZSByZWFkb25seSBhY2Nlc3NvcnlIYW5kbGVycyA9IG5ldyBNYXA8c3RyaW5nLCBTbW9rZUFuZENPU2Vuc29yQWNjZXNzb3J5PigpO1xuICBwcml2YXRlIHBvbGxpbmdJbnRlcnZhbD86IE5vZGVKUy5UaW1lb3V0O1xuXG4gIGNvbnN0cnVjdG9yKFxuICAgIHB1YmxpYyByZWFkb25seSBsb2c6IExvZ2dlcixcbiAgICBwdWJsaWMgcmVhZG9ubHkgY29uZmlnOiBQbGF0Zm9ybUNvbmZpZyxcbiAgICBwdWJsaWMgcmVhZG9ubHkgYXBpOiBBUEksXG4gICkge1xuICAgIHRoaXMubG9nLmRlYnVnKCdGaW5pc2hlZCBpbml0aWFsaXppbmcgcGxhdGZvcm06JywgdGhpcy5jb25maWcubmFtZSk7XG5cbiAgICB0aGlzLmFwaS5vbignZGlkRmluaXNoTGF1bmNoaW5nJywgYXN5bmMgKCkgPT4ge1xuICAgICAgbG9nLmRlYnVnKCdFeGVjdXRlZCBkaWRGaW5pc2hMYXVuY2hpbmcgY2FsbGJhY2snKTtcbiAgICAgIGF3YWl0IHRoaXMuZGlzY292ZXJEZXZpY2VzKCk7XG4gICAgfSk7XG5cbiAgICB0aGlzLmFwaS5vbignc2h1dGRvd24nLCAoKSA9PiB7XG4gICAgICB0aGlzLmxvZy5pbmZvKCdIb21lYnJpZGdlIGlzIHNodXR0aW5nIGRvd24sIGRpc2Nvbm5lY3RpbmcgZnJvbSBYLVNlbnNlLicpO1xuICAgICAgaWYgKHRoaXMucG9sbGluZ0ludGVydmFsKSB7XG4gICAgICAgIGNsZWFySW50ZXJ2YWwodGhpcy5wb2xsaW5nSW50ZXJ2YWwpO1xuICAgICAgfVxuICAgICAgdGhpcy54c2Vuc2VBcGk/LmRpc2Nvbm5lY3RNcXR0KCk7XG4gICAgfSk7XG4gIH1cblxuICBjb25maWd1cmVBY2Nlc3NvcnkoYWNjZXNzb3J5OiBQbGF0Zm9ybUFjY2Vzc29yeSkge1xuICAgIHRoaXMubG9nLmluZm8oJ0xvYWRpbmcgYWNjZXNzb3J5IGZyb20gY2FjaGU6JywgYWNjZXNzb3J5LmRpc3BsYXlOYW1lKTtcbiAgICB0aGlzLmFjY2Vzc29yaWVzLnB1c2goYWNjZXNzb3J5KTtcbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgZGlzY292ZXJEZXZpY2VzKCkge1xuICAgIGlmICghdGhpcy5jb25maWcudXNlcm5hbWUgfHwgIXRoaXMuY29uZmlnLnBhc3N3b3JkKSB7XG4gICAgICB0aGlzLmxvZy5lcnJvcignVXNlcm5hbWUgb3IgcGFzc3dvcmQgbm90IGNvbmZpZ3VyZWQuIFBsZWFzZSBjaGVjayB5b3VyIEhvbWVicmlkZ2UgY29uZmlndXJhdGlvbi4nKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICB0aGlzLnhzZW5zZUFwaSA9IG5ldyBYc2Vuc2VBcGkodGhpcy5jb25maWcudXNlcm5hbWUsIHRoaXMuY29uZmlnLnBhc3N3b3JkLCB0aGlzLmxvZyk7XG5cbiAgICB0cnkge1xuICAgICAgYXdhaXQgdGhpcy54c2Vuc2VBcGkubG9naW4oKTtcbiAgICAgIHRoaXMubG9nLmluZm8oJ1N1Y2Nlc3NmdWxseSBsb2dnZWQgaW50byBYLVNlbnNlIEFQSS4nKTtcbiAgICAgIGNvbnN0IGRldmljZXMgPSBhd2FpdCB0aGlzLnhzZW5zZUFwaS5nZXREZXZpY2VMaXN0KCk7XG4gICAgICB0aGlzLmxvZy5pbmZvKGBEaXNjb3ZlcmVkICR7ZGV2aWNlcy5sZW5ndGh9IGRldmljZXMuYCk7XG5cbiAgICAgIC8vIEZpbHRlciBmb3IgYWN0dWFsIHNlbnNvcnMsIG5vdCBiYXNlIHN0YXRpb25zIHdoaWNoIGRvbid0IGhhdmUgdGhlaXIgb3duIHNlbnNvcnNcbiAgICAgIGNvbnN0IHNlbnNvckRldmljZXMgPSBkZXZpY2VzLmZpbHRlcihkID0+IGQuZGV2aWNlX2lkICE9PSBkLnN0YXRpb25fc24pO1xuICAgICAgY29uc3QgY2FjaGVkQWNjZXNzb3JpZXMgPSBbLi4udGhpcy5hY2Nlc3Nvcmllc107XG5cbiAgICAgIHRoaXMubG9nLmluZm8oYEZvdW5kICR7c2Vuc29yRGV2aWNlcy5sZW5ndGh9IHNlbnNvciBkZXZpY2VzIHRvIHJlZ2lzdGVyLmApO1xuXG4gICAgICBmb3IgKGNvbnN0IGRldmljZSBvZiBzZW5zb3JEZXZpY2VzKSB7XG4gICAgICAgIGNvbnN0IHV1aWQgPSB0aGlzLmFwaS5oYXAudXVpZC5nZW5lcmF0ZShkZXZpY2UuZGV2aWNlX2lkKTtcbiAgICAgICAgY29uc3QgZXhpc3RpbmdBY2Nlc3NvcnkgPSBjYWNoZWRBY2Nlc3Nvcmllcy5maW5kKGFjY2Vzc29yeSA9PiBhY2Nlc3NvcnkuVVVJRCA9PT0gdXVpZCk7XG5cbiAgICAgICAgaWYgKGV4aXN0aW5nQWNjZXNzb3J5KSB7XG4gICAgICAgICAgdGhpcy5sb2cuaW5mbygnUmVzdG9yaW5nIGV4aXN0aW5nIGFjY2Vzc29yeSBmcm9tIGNhY2hlOicsIGRldmljZS5kZXZpY2VfbmFtZSk7XG4gICAgICAgICAgZXhpc3RpbmdBY2Nlc3NvcnkuY29udGV4dCA9IGRldmljZTtcbiAgICAgICAgICB0aGlzLmFwaS51cGRhdGVQbGF0Zm9ybUFjY2Vzc29yaWVzKFtleGlzdGluZ0FjY2Vzc29yeV0pO1xuICAgICAgICAgIGNvbnN0IGhhbmRsZXIgPSBuZXcgU21va2VBbmRDT1NlbnNvckFjY2Vzc29yeSh0aGlzLCBleGlzdGluZ0FjY2Vzc29yeSBhcyBQbGF0Zm9ybUFjY2Vzc29yeTxEZXZpY2VJbmZvPik7XG4gICAgICAgICAgdGhpcy5hY2Nlc3NvcnlIYW5kbGVycy5zZXQodXVpZCwgaGFuZGxlcik7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgdGhpcy5sb2cuaW5mbygnUmVnaXN0ZXJpbmcgbmV3IGFjY2Vzc29yeTonLCBkZXZpY2UuZGV2aWNlX25hbWUpO1xuICAgICAgICAgIGNvbnN0IGFjY2Vzc29yeSA9IG5ldyB0aGlzLmFwaS5wbGF0Zm9ybUFjY2Vzc29yeTxEZXZpY2VJbmZvPihkZXZpY2UuZGV2aWNlX25hbWUsIHV1aWQpO1xuICAgICAgICAgIGFjY2Vzc29yeS5jb250ZXh0ID0gZGV2aWNlO1xuICAgICAgICAgIGNvbnN0IGhhbmRsZXIgPSBuZXcgU21va2VBbmRDT1NlbnNvckFjY2Vzc29yeSh0aGlzLCBhY2Nlc3NvcnkpO1xuICAgICAgICAgIHRoaXMuYWNjZXNzb3J5SGFuZGxlcnMuc2V0KHV1aWQsIGhhbmRsZXIpO1xuICAgICAgICAgIHRoaXMuYXBpLnJlZ2lzdGVyUGxhdGZvcm1BY2Nlc3NvcmllcyhQTFVHSU5fTkFNRSwgUExBVEZPUk1fTkFNRSwgW2FjY2Vzc29yeV0pO1xuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIGNvbnN0IGFjY2Vzc29yaWVzVG9VbnJlZ2lzdGVyID0gY2FjaGVkQWNjZXNzb3JpZXMuZmlsdGVyKGNhY2hlZCA9PlxuICAgICAgICAhc2Vuc29yRGV2aWNlcy5zb21lKGQgPT4gdGhpcy5hcGkuaGFwLnV1aWQuZ2VuZXJhdGUoZC5kZXZpY2VfaWQpID09PSBjYWNoZWQuVVVJRCksXG4gICAgICApO1xuXG4gICAgICBpZiAoYWNjZXNzb3JpZXNUb1VucmVnaXN0ZXIubGVuZ3RoID4gMCkge1xuICAgICAgICB0aGlzLmxvZy5pbmZvKCdVbnJlZ2lzdGVyaW5nIHN0YWxlIGFjY2Vzc29yaWVzOicsIGFjY2Vzc29yaWVzVG9VbnJlZ2lzdGVyLm1hcChhID0+IGEuZGlzcGxheU5hbWUpKTtcbiAgICAgICAgdGhpcy5hcGkudW5yZWdpc3RlclBsYXRmb3JtQWNjZXNzb3JpZXMoUExVR0lOX05BTUUsIFBMQVRGT1JNX05BTUUsIGFjY2Vzc29yaWVzVG9VbnJlZ2lzdGVyKTtcbiAgICAgIH1cblxuICAgICAgLy8gQ29ubmVjdCB0byBNUVRUIGZvciByZWFsLXRpbWUgdXBkYXRlc1xuICAgICAgYXdhaXQgdGhpcy54c2Vuc2VBcGkuY29ubmVjdE1xdHQoKTtcblxuICAgICAgLy8gTGlzdGVuIGZvciBNUVRUIG1lc3NhZ2VzXG4gICAgICB0aGlzLnhzZW5zZUFwaS5vbignbWVzc2FnZScsICh0b3BpYzogc3RyaW5nLCBwYXlsb2FkOiBhbnkpID0+IHtcbiAgICAgICAgdGhpcy5oYW5kbGVNcXR0TWVzc2FnZSh0b3BpYywgcGF5bG9hZCk7XG4gICAgICB9KTtcblxuICAgICAgLy8gU3RhcnQgcGVyaW9kaWMgcG9sbGluZyBhcyBhIGZhbGxiYWNrXG4gICAgICBjb25zdCBwb2xsaW5nTWludXRlcyA9IHRoaXMuY29uZmlnLnBvbGxpbmdJbnRlcnZhbCB8fCAxNTtcbiAgICAgIHRoaXMubG9nLmluZm8oYFN0YXJ0aW5nIHBlcmlvZGljIHBvbGxpbmcgZXZlcnkgJHtwb2xsaW5nTWludXRlc30gbWludXRlcy5gKTtcbiAgICAgIHRoaXMucG9sbGluZ0ludGVydmFsID0gc2V0SW50ZXJ2YWwoKCkgPT4gdGhpcy5yZWZyZXNoQWxsRGV2aWNlcygpLCBwb2xsaW5nTWludXRlcyAqIDYwICogMTAwMCk7XG5cbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgdGhpcy5sb2cuZXJyb3IoJ0ZhaWxlZCB0byBpbml0aWFsaXplIFgtU2Vuc2UgQVBJIGNsaWVudC4gUGxlYXNlIGNoZWNrIGNyZWRlbnRpYWxzIGFuZCBjb25uZWN0aXZpdHkuJywgZXJyb3IpO1xuICAgIH1cbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgcmVmcmVzaEFsbERldmljZXMoKSB7XG4gICAgdGhpcy5sb2cuaW5mbygnUG9sbGluZyBmb3IgZGV2aWNlIHN0YXR1cyB1cGRhdGVzLi4uJyk7XG4gICAgaWYgKCF0aGlzLnhzZW5zZUFwaSkge1xuICAgICAgdGhpcy5sb2cud2FybignQVBJIGNsaWVudCBub3QgYXZhaWxhYmxlLCBza2lwcGluZyBwb2xsLicpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICB0cnkge1xuICAgICAgY29uc3QgZGV2aWNlcyA9IGF3YWl0IHRoaXMueHNlbnNlQXBpLmdldERldmljZUxpc3QoKTtcbiAgICAgIHRoaXMubG9nLmRlYnVnKGBQb2xsIGZvdW5kICR7ZGV2aWNlcy5sZW5ndGh9IGRldmljZXMuYCk7XG4gICAgICBmb3IgKGNvbnN0IGRldmljZSBvZiBkZXZpY2VzKSB7XG4gICAgICAgIGNvbnN0IHV1aWQgPSB0aGlzLmFwaS5oYXAudXVpZC5nZW5lcmF0ZShkZXZpY2UuZGV2aWNlX2lkKTtcbiAgICAgICAgY29uc3QgaGFuZGxlciA9IHRoaXMuYWNjZXNzb3J5SGFuZGxlcnMuZ2V0KHV1aWQpO1xuICAgICAgICBpZiAoaGFuZGxlcikge1xuICAgICAgICAgIGhhbmRsZXIudXBkYXRlRnJvbURldmljZUluZm8oZGV2aWNlKTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICB0aGlzLmxvZy5lcnJvcignRXJyb3IgZHVyaW5nIHBlcmlvZGljIGRldmljZSByZWZyZXNoOicsIGVycm9yKTtcbiAgICB9XG4gIH1cblxuICBwcml2YXRlIGhhbmRsZU1xdHRNZXNzYWdlKHRvcGljOiBzdHJpbmcsIHBheWxvYWQ6IGFueSkge1xuICAgIHRoaXMubG9nLmRlYnVnKGBSZWNlaXZlZCByZWFsLXRpbWUgdXBkYXRlIG9uICR7dG9waWN9OmAsIEpTT04uc3RyaW5naWZ5KHBheWxvYWQpKTtcblxuICAgIGlmICh0b3BpYy5pbmNsdWRlcygnc2hhZG93L3VwZGF0ZScpKSB7XG4gICAgICAvLyBTaGFkb3cgdXBkYXRlcyBjb250YWluIHN0YXRlIGZvciBtdWx0aXBsZSBkZXZpY2VzIGF0dGFjaGVkIHRvIGEgYmFzZSBzdGF0aW9uXG4gICAgICBjb25zdCBkZXZpY2VzID0gcGF5bG9hZC5zdGF0ZT8ucmVwb3J0ZWQ/LmRldmljZXM7XG4gICAgICBpZiAoZGV2aWNlcyAmJiBBcnJheS5pc0FycmF5KGRldmljZXMpKSB7XG4gICAgICAgIGZvciAoY29uc3QgZGV2aWNlU3RhdGUgb2YgZGV2aWNlcykge1xuICAgICAgICAgIGlmIChkZXZpY2VTdGF0ZS5kZXZpY2VJZCkge1xuICAgICAgICAgICAgY29uc3QgdXVpZCA9IHRoaXMuYXBpLmhhcC51dWlkLmdlbmVyYXRlKGRldmljZVN0YXRlLmRldmljZUlkKTtcbiAgICAgICAgICAgIGNvbnN0IGhhbmRsZXIgPSB0aGlzLmFjY2Vzc29yeUhhbmRsZXJzLmdldCh1dWlkKTtcbiAgICAgICAgICAgIGhhbmRsZXI/LnVwZGF0ZUZyb21TaGFkb3coZGV2aWNlU3RhdGUpO1xuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgfVxuICAgIH0gZWxzZSBpZiAodG9waWMuaW5jbHVkZXMoJ0B4c2Vuc2UvZXZlbnRzJykpIHtcbiAgICAgIC8vIEV2ZW50IHRvcGljcyBhcmUgZm9yIGFsYXJtc1xuICAgICAgaWYgKHBheWxvYWQuZGV2SWQpIHtcbiAgICAgICAgY29uc3QgdXVpZCA9IHRoaXMuYXBpLmhhcC51dWlkLmdlbmVyYXRlKHBheWxvYWQuZGV2SWQpO1xuICAgICAgICBjb25zdCBoYW5kbGVyID0gdGhpcy5hY2Nlc3NvcnlIYW5kbGVycy5nZXQodXVpZCk7XG4gICAgICAgIGhhbmRsZXI/LnVwZGF0ZUZyb21FdmVudChwYXlsb2FkKTtcbiAgICAgIH1cbiAgICB9XG4gIH1cbn0iXX0=