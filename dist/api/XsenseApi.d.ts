import { EventEmitter } from 'events';
import { Logger } from 'homebridge';
import { CognitoUserSession } from 'amazon-cognito-identity-js';
import { DeviceInfo, IotCredentials } from './types';
export declare class XsenseApi extends EventEmitter {
    private readonly email;
    private readonly password;
    private readonly log;
    private readonly userPool;
    private readonly user;
    private readonly authDetails;
    private session;
    private readonly http;
    private mqttClient;
    private mqttRefreshTimer?;
    private lastKnownDevices;
    constructor(email: string, password: string, log: Logger);
    login(): Promise<CognitoUserSession>;
    private refreshSession;
    getDeviceList(): Promise<DeviceInfo[]>;
    getIotCredential(): Promise<IotCredentials>;
    connectMqtt(): Promise<void>;
    private reconnectMqtt;
    disconnectMqtt(clearTimers?: boolean): void;
}
