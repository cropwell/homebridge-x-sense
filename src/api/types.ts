export interface DeviceInfo {
  station_sn: string;
  station_name: string;
  device_id: string;
  device_name: string;
  type_id: number;
  device_model: string;
  /**
   * Capabilities detected for this device. Not returned by the API but stored
   * in the accessory context so we know which services to expose.
   */
  capabilities?: string[];
  mqttServer?: string;
  mqttRegion?: string;
  status: {
    battery: number;
    online: number;
    // ... other status properties
  };
}

export interface GetDeviceListResponse {
  code: number;
  msg: string;
  data: DeviceInfo[];
}

export interface IotCredentials {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken: string;
  expiration: string; // ISO 8601 date string
  iotPolicy?: string;
  iotEndpoint?: string;
  mqttServer?: string;
}

export interface GetIotCredentialResponse {
  code: number;
  msg: string;
  data: IotCredentials;
}

export interface ClientInfo {
  clientId: string;
  clientSecret: string;
  cgtRegion: string;
  userPoolId: string;
}

export interface GetClientInfoResponse {
  reCode: number;
  reMsg: string;
  reData: ClientInfo;
}
