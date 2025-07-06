import { API, DynamicPlatformPlugin, Logger, PlatformAccessory, PlatformConfig, Service, Characteristic } from 'homebridge';

import { PLATFORM_NAME, PLUGIN_NAME } from './settings';
import { DeviceInfo } from './api/types';
import { XsenseApi } from './api/XsenseApi';
import { SmokeAndCOSensorAccessory } from './accessories/SmokeAndCOSensorAccessory';
import { SmokeSensorAccessory } from './accessories/SmokeSensorAccessory';
import { CarbonMonoxideSensorAccessory } from './accessories/CarbonMonoxideSensorAccessory';
import { detectCapabilities, DeviceCapability } from './deviceCapabilities';

export class XSenseHomebridgePlatform implements DynamicPlatformPlugin {
  public readonly Service: typeof Service = this.api.hap.Service;
  public readonly Characteristic: typeof Characteristic = this.api.hap.Characteristic;
  public readonly accessories: PlatformAccessory[] = [];
  private xsenseApi?: XsenseApi;
  private readonly accessoryHandlers = new Map<string, SmokeAndCOSensorAccessory | SmokeSensorAccessory | CarbonMonoxideSensorAccessory>();
  private pollingInterval?: NodeJS.Timeout;

  constructor(
    public readonly log: Logger,
    public readonly config: PlatformConfig,
    public readonly api: API,
  ) {
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

  configureAccessory(accessory: PlatformAccessory) {
    this.log.info('Loading accessory from cache:', accessory.displayName);
    this.accessories.push(accessory);
  }

  private async discoverDevices() {
    if (!this.config.username || !this.config.password) {
      this.log.error('Username or password not configured. Please check your Homebridge configuration.');
      return;
    }

    this.xsenseApi = new XsenseApi(this.config.username, this.config.password, this.log);

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
        const capabilities = detectCapabilities(device.device_model);
        device.capabilities = capabilities;
        const uuid = this.api.hap.uuid.generate(device.device_id);
        const existingAccessory = cachedAccessories.find(accessory => accessory.UUID === uuid);

        const createHandler = (acc: PlatformAccessory<DeviceInfo>) => {
          const hasSmoke = capabilities.includes(DeviceCapability.Smoke);
          const hasCo = capabilities.includes(DeviceCapability.CarbonMonoxide);
          if (hasSmoke && hasCo) {
            return new SmokeAndCOSensorAccessory(this, acc as PlatformAccessory<DeviceInfo>);
          } else if (hasSmoke) {
            return new SmokeSensorAccessory(this, acc as PlatformAccessory<DeviceInfo>);
          } else if (hasCo) {
            return new CarbonMonoxideSensorAccessory(this, acc as PlatformAccessory<DeviceInfo>);
          }
          return new SmokeAndCOSensorAccessory(this, acc as PlatformAccessory<DeviceInfo>);
        };

        if (existingAccessory) {
          this.log.info('Restoring existing accessory from cache:', device.device_name);
          existingAccessory.context = device;
          this.api.updatePlatformAccessories([existingAccessory]);
          const handler = createHandler(existingAccessory as PlatformAccessory<DeviceInfo>);
          this.accessoryHandlers.set(uuid, handler);
        } else {
          this.log.info('Registering new accessory:', device.device_name);
          const accessory = new this.api.platformAccessory<DeviceInfo>(device.device_name, uuid);
          accessory.context = device;
          const handler = createHandler(accessory);
          this.accessoryHandlers.set(uuid, handler);
          this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
        }
      }

      const accessoriesToUnregister = cachedAccessories.filter(cached =>
        !sensorDevices.some(d => this.api.hap.uuid.generate(d.device_id) === cached.UUID),
      );

      if (accessoriesToUnregister.length > 0) {
        this.log.info('Unregistering stale accessories:', accessoriesToUnregister.map(a => a.displayName));
        this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, accessoriesToUnregister);
      }

      // Connect to MQTT for real-time updates
      await this.xsenseApi.connectMqtt();

      // Listen for MQTT messages
      this.xsenseApi.on('message', (topic: string, payload: any) => {
        this.handleMqttMessage(topic, payload);
      });

      // Start periodic polling as a fallback
      const pollingMinutes = this.config.pollingInterval || 15;
      this.log.info(`Starting periodic polling every ${pollingMinutes} minutes.`);
      this.pollingInterval = setInterval(() => this.refreshAllDevices(), pollingMinutes * 60 * 1000);

    } catch (error) {
      this.log.error('Failed to initialize X-Sense API client. Please check credentials and connectivity.', error);
    }
  }

  private async refreshAllDevices() {
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
    } catch (error) {
      this.log.error('Error during periodic device refresh:', error);
    }
  }

  private handleMqttMessage(topic: string, payload: any) {
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
    } else if (topic.includes('@xsense/events')) {
      // Event topics are for alarms
      if (payload.devId) {
        const uuid = this.api.hap.uuid.generate(payload.devId);
        const handler = this.accessoryHandlers.get(uuid);
        handler?.updateFromEvent(payload);
      }
    }
  }
}