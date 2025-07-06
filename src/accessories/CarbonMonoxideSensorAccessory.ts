import { Service, PlatformAccessory } from 'homebridge';
import { XSenseHomebridgePlatform } from '../platform';
import { DeviceInfo } from '../api/types';

export class CarbonMonoxideSensorAccessory {
  private coService: Service;
  private batteryService: Service;

  private state = {
    coDetected: this.platform.Characteristic.CarbonMonoxideDetected.CO_LEVELS_NORMAL,
    batteryLevel: 100,
    statusLowBattery: this.platform.Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL,
  };

  constructor(
    private readonly platform: XSenseHomebridgePlatform,
    public readonly accessory: PlatformAccessory<DeviceInfo>,
  ) {
    this.accessory.getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.platform.Characteristic.Manufacturer, 'X-Sense')
      .setCharacteristic(this.platform.Characteristic.Model, accessory.context.device_model)
      .setCharacteristic(this.platform.Characteristic.SerialNumber, accessory.context.device_id);

    this.coService = this.accessory.getService(this.platform.Service.CarbonMonoxideSensor)
      || this.accessory.addService(this.platform.Service.CarbonMonoxideSensor);
    this.coService.setCharacteristic(this.platform.Characteristic.Name, accessory.context.device_name);
    this.coService.getCharacteristic(this.platform.Characteristic.CarbonMonoxideDetected)
      .onGet(() => this.state.coDetected);

    this.batteryService = this.accessory.getService(this.platform.Service.Battery)
      || this.accessory.addService(this.platform.Service.Battery);
    this.batteryService.getCharacteristic(this.platform.Characteristic.BatteryLevel)
      .onGet(() => this.state.batteryLevel);
    this.batteryService.getCharacteristic(this.platform.Characteristic.StatusLowBattery)
      .onGet(() => this.state.statusLowBattery);
    this.batteryService.setCharacteristic(this.platform.Characteristic.BatteryLevel, this.state.batteryLevel);
    this.batteryService.setCharacteristic(this.platform.Characteristic.StatusLowBattery, this.state.statusLowBattery);

    this.updateFromDeviceInfo(accessory.context);
  }

  public updateFromDeviceInfo(device: DeviceInfo): void {
    this.platform.log.debug(`Updating ${this.accessory.displayName} from initial info:`, device.status);
    const status: any = device.status as any;
    const battery = status.battery ?? status.batteryLevel ??
      status.battery_level ??
      status.batteryPercentage ??
      status.battery_percentage;
    this.updateBattery(battery);
  }

  public updateFromShadow(shadow: any): void {
    this.platform.log.debug(`Updating ${this.accessory.displayName} from shadow:`, shadow);
    const battery = shadow.battery ?? shadow.batteryLevel ?? shadow.battery_level ??
      shadow.batteryPercentage ?? shadow.battery_percentage;
    if (battery !== undefined) {
      this.updateBattery(battery);
    }
  }

  public updateFromEvent(event: any): void {
    this.platform.log.debug(`Updating ${this.accessory.displayName} from event:`, event);

    if (event.type === 1 && event.alarmStatus !== undefined) {
      const alarmStatus = event.alarmStatus;
      const coDetected = (alarmStatus === 2 || alarmStatus === 3)
        ? this.platform.Characteristic.CarbonMonoxideDetected.CO_LEVELS_ABNORMAL
        : this.platform.Characteristic.CarbonMonoxideDetected.CO_LEVELS_NORMAL;

      if (this.state.coDetected !== coDetected) {
        this.state.coDetected = coDetected;
        this.coService.updateCharacteristic(this.platform.Characteristic.CarbonMonoxideDetected, this.state.coDetected);
        this.platform.log.info(`[${this.accessory.displayName}] CO alarm status changed to: ${coDetected === 1 ? 'DETECTED' : 'NORMAL'}`);
      }
    }
  }

  private updateBattery(level?: number): void {
    if (typeof level !== 'number' || !Number.isFinite(level)) {
      this.platform.log.debug(`[${this.accessory.displayName}] Ignoring invalid battery level: ${level}`);
      return;
    }

    const clamped = Math.min(100, Math.max(0, level));
    const lowBattery = clamped <= 20
      ? this.platform.Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW
      : this.platform.Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL;

    if (this.state.batteryLevel !== clamped) {
      this.state.batteryLevel = clamped;
      this.batteryService.updateCharacteristic(this.platform.Characteristic.BatteryLevel, this.state.batteryLevel);
      this.platform.log.debug(`[${this.accessory.displayName}] Battery level updated to ${clamped}%`);
    }

    if (this.state.statusLowBattery !== lowBattery) {
      this.state.statusLowBattery = lowBattery;
      this.batteryService.updateCharacteristic(this.platform.Characteristic.StatusLowBattery, this.state.statusLowBattery);
      this.platform.log.info(`[${this.accessory.displayName}] Low battery status changed to: ${lowBattery === 1 ? 'LOW' : 'NORMAL'}`);
    }
  }
}
