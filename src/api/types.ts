export interface DeviceInfo {
  station_sn: string;
  station_name: string;
  device_id: string;
  device_name: string;
  type_id: number;
  device_model: string;
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
  accessKey: string;
  secretKey: string;
  sessionToken: string;
  expiration: string; // ISO 8601 date string
  iotPolicy: string;
  iotEndpoint: string;
}

export interface GetIotCredentialResponse {
  code: number;
  msg: string;
  data: IotCredentials;
}