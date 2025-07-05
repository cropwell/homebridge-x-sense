import { PlatformAccessory } from 'homebridge';
import { XSenseHomebridgePlatform } from '../platform';
import { DeviceInfo } from '../api/types';
/**
 * Manages a single X-Sense Smoke and CO combination sensor accessory.
 */
export declare class SmokeAndCOSensorAccessory {
    private readonly platform;
    readonly accessory: PlatformAccessory<DeviceInfo>;
    private smokeService;
    private coService;
    private batteryService;
    private state;
    constructor(platform: XSenseHomebridgePlatform, accessory: PlatformAccessory<DeviceInfo>);
    /**
     * Updates the accessory state from the initial device information poll.
     */
    updateFromDeviceInfo(device: DeviceInfo): void;
    /**
     * Updates the accessory state from a real-time MQTT shadow update.
     * These updates typically contain battery, temperature, and humidity data.
     */
    updateFromShadow(shadow: any): void;
    /**
     * Updates the accessory state from a real-time MQTT event.
     * These events are typically for alarms.
     */
    updateFromEvent(event: any): void;
    private updateBattery;
}
