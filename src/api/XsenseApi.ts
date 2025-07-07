import { EventEmitter } from 'events';
import { Logger } from 'homebridge';
import axios, { AxiosError, AxiosInstance, AxiosRequestConfig } from 'axios';
import {
  CognitoUserPool,
  CognitoUser,
  AuthenticationDetails,
  CognitoUserSession,
} from 'amazon-cognito-identity-js';
import { MqttClient, connect as mqttConnect } from 'mqtt';
import aws4 from 'aws4';
import { createHmac, createHash } from 'crypto';
import { API_HOST, IOT_ENDPOINT_URL, CLIENT_TYPE, APP_VERSION, APP_CODE } from './constants';
import { DeviceInfo, IotCredentials, ClientInfo } from './types';

export class XsenseApi extends EventEmitter {
  private readonly log: Logger;
  private userPool?: CognitoUserPool;
  private user?: CognitoUser;
  private authDetails?: AuthenticationDetails;
  private clientInfo?: ClientInfo;
  private clientSecret?: Buffer;
  private session: CognitoUserSession | null = null;
  private readonly http: AxiosInstance;
  private mqttClient: MqttClient | null = null;
  private mqttRefreshTimer?: NodeJS.Timeout;
  private lastKnownDevices: DeviceInfo[] = [];
  private iotEndpoint?: string;

  private decodeSecret(encoded: string): Buffer {
    const value = Buffer.from(encoded, 'base64');
    return value.subarray(4, value.length - 1);
  }

  private generateHash(data: string): string {
    if (!this.clientSecret) {
      throw new Error('Client secret not available');
    }
    return createHmac('sha256', this.clientSecret).update(data, 'utf8').digest('base64');
  }

  private calculateMac(data: Record<string, any>): string {
    if (!this.clientSecret) {
      throw new Error('Client secret not available');
    }

    const values: string[] = [];
    for (const key of Object.keys(data)) {
      const value = (data as any)[key];
      if (Array.isArray(value)) {
        if (value.length > 0 && typeof value[0] === 'string') {
          values.push(...value);
        } else {
          values.push(JSON.stringify(value));
        }
      } else if (typeof value === 'object' && value !== null) {
        values.push(JSON.stringify(value));
      } else if (value !== undefined && value !== null) {
        values.push(String(value));
      }
    }

    const concatenated = values.join('');
    const md5 = createHash('md5');
    md5.update(Buffer.from(concatenated, 'utf8'));
    md5.update(this.clientSecret);
    return md5.digest('hex');
  }

  private async apiCall<T>(code: string, data: Record<string, any>, unauth = false): Promise<T> {
    const payload = {
      ...data,
      clientType: CLIENT_TYPE,
      mac: unauth ? 'abcdefg' : this.calculateMac(data),
      appVersion: APP_VERSION,
      bizCode: code,
      appCode: APP_CODE,
    };

    const headers: Record<string, string> = {};
    if (!unauth && this.session) {
      headers['Authorization'] = this.session.getAccessToken().getJwtToken();
    }

    const response = await this.http.post('/app', payload, { headers });

    if (response.data.reCode !== 200) {
      throw new Error(response.data.reMsg);
    }
    return response.data.reData as T;
  }

  private wrapRequest() {
    const original = (this.userPool as any).client.request.bind((this.userPool as any).client);
    (this.userPool as any).client.request = (operation: string, params: any, cb: any) => {
      if (this.clientInfo && this.clientSecret) {
        if (operation === 'InitiateAuth' && params.AuthParameters) {
          const user = params.AuthParameters.USERNAME;
          params.AuthParameters.SECRET_HASH = this.generateHash(user + this.clientInfo.clientId);
        }
        if (operation === 'RespondToAuthChallenge' && params.ChallengeResponses) {
          const user = params.ChallengeResponses.USERNAME;
          params.ChallengeResponses.SECRET_HASH = this.generateHash(user + this.clientInfo.clientId);
        }
      }
      return original(operation, params, cb);
    };
  }

  constructor(
    private readonly email: string,
    private readonly password: string,
    log: Logger,
  ) {
    super();
    this.log = log;

    this.http = axios.create({
      baseURL: API_HOST,
      headers: {
        'Content-Type': 'application/json',
      },
      proxy: false,
    });

    this.http.interceptors.request.use(
      (config) => {
        if (this.session && config.headers && !config.headers['Authorization']) {
          config.headers['Authorization'] = this.session.getAccessToken().getJwtToken();
        }
        return config;
      },
      (error) => Promise.reject(error),
    );

    this.http.interceptors.response.use(
      (response) => response,
      async (error: AxiosError) => {
        const originalRequest = error.config as AxiosRequestConfig & { headers: { 'X-Retry'?: string } };
        if (error.response?.status === 401 && originalRequest && !originalRequest.headers?.['X-Retry']) {
          originalRequest.headers['X-Retry'] = 'true';
          this.log.info('Token expired, attempting to refresh...');
          try {
            await this.refreshSession();
            this.log.info('Token refreshed successfully.');
            return this.http(originalRequest);
          } catch (refreshError) {
            this.log.error('Failed to refresh token. Please re-login.', refreshError);
            this.session = null;
            return Promise.reject(refreshError);
          }
        }
        return Promise.reject(error);
      },
    );
  }

  private async fetchClientInfo(): Promise<ClientInfo> {
    if (this.clientInfo) {
      return this.clientInfo;
    }

    this.log.debug('Fetching client info...');
    const data = await this.apiCall<ClientInfo>('101001', {}, true);
    this.clientInfo = data;
    this.clientSecret = this.decodeSecret(this.clientInfo.clientSecret);
    this.userPool = new CognitoUserPool({
      UserPoolId: this.clientInfo.userPoolId,
      ClientId: this.clientInfo.clientId,
    });
    this.user = new CognitoUser({
      Username: this.email,
      Pool: this.userPool,
    });
    this.authDetails = new AuthenticationDetails({
      Username: this.email,
      Password: this.password,
    });

    this.wrapRequest();
    return this.clientInfo;
  }

  public login(): Promise<CognitoUserSession> {
    return new Promise(async (resolve, reject) => {
      try {
        await this.fetchClientInfo();
      } catch (err) {
        return reject(err);
      }

      this.user!.authenticateUser(this.authDetails!, {
        onSuccess: (session) => {
          this.log.debug('Cognito authentication successful.');
          this.session = session;
          resolve(session);
        },
        onFailure: (err) => {
          this.log.error('Cognito authentication failed:', err.message);
          reject(err);
        },
      });
    });
  }

  private refreshSession(): Promise<CognitoUserSession> {
    return new Promise((resolve, reject) => {
      const refreshToken = this.session?.getRefreshToken();
      if (!refreshToken) {
        return reject(new Error('No refresh token available.'));
      }

      this.user!.refreshSession(refreshToken, (err, session) => {
        if (err) {
          return reject(err);
        }
        this.session = session;
        resolve(session);
      });
    });
  }

  public async getDeviceList(): Promise<DeviceInfo[]> {
    this.log.debug('Fetching device list...');

    const houses = await this.apiCall<any[]>('102007', { utctimestamp: '0' });
    const devices: DeviceInfo[] = [];

    for (const house of houses) {
      const stationData = await this.apiCall<any>('103007', { houseId: house.houseId, utctimestamp: '0' });
      for (const station of stationData.stations ?? []) {
        for (const d of station.devices ?? []) {
          devices.push({
            station_sn: station.stationSn,
            station_name: station.stationName,
            device_id: d.deviceId,
            device_name: d.deviceName,
            type_id: d.deviceType,
            device_model: d.deviceModel ?? d.deviceType,
            mqttServer: house.mqttServer ?? house.mqtt_server,
            mqttRegion: house.mqttRegion ?? house.mqtt_region,
            status: d.status ?? {},
          });
        }
      }
    }

    this.lastKnownDevices = devices;
    return this.lastKnownDevices;
  }

  

  public async getIotCredential(): Promise<IotCredentials> {
    this.log.debug('Fetching IoT credentials...');
    const raw = await this.apiCall<any>('101003', { userName: this.email });
    this.log.debug('Successfully fetched IoT credentials.');

    const creds: IotCredentials = {
      accessKeyId: raw.accessKeyId,
      secretAccessKey: raw.secretAccessKey,
      sessionToken: raw.sessionToken,
      expiration: raw.expiration,
      iotPolicy: raw.iotPolicy,
      iotEndpoint: raw.iotEndpoint ?? raw.iot_endpoint ?? raw.mqttServer ??
        raw.mqtt_server ?? raw.host ?? raw.endpoint,
    };



    return creds;
  }

  public async connectMqtt() {
    if (this.lastKnownDevices.length === 0) {
      this.log.warn('No devices available to connect to MQTT. Call getDeviceList first.');
      return;
    }

    if (this.mqttClient?.connected) {
      this.log.debug('MQTT client is already connected.');
      return;
    }

    try {
      const creds = await this.getIotCredential();
      const endpoint = 'a3p56i1nw0xqwj-ats.iot.us-east-1.amazonaws.com';
      const region = 'us-east-1';
      this.log.debug(`Using hardcoded MQTT endpoint: ${endpoint}`);

      const sanitized = endpoint.replace(/^wss?:\/\//, '').replace(/\/?mqtt$/, '');

      // Proactively refresh credentials 5 minutes before they expire
      const expiration = new Date(creds.expiration).getTime();
      const now = Date.now();
      const refreshDelay = expiration - now - (5 * 60 * 1000);
      if (this.mqttRefreshTimer) {
        clearTimeout(this.mqttRefreshTimer);
      }
      this.mqttRefreshTimer = setTimeout(() => this.reconnectMqtt(), Math.max(0, refreshDelay));
      this.log.info(`Scheduled MQTT credential refresh in ${Math.round(refreshDelay / 60000)} minutes.`);

      const uniqueStationSns = [...new Set(this.lastKnownDevices.map(d => d.station_sn))];

      this.log.info(`Connecting to MQTT broker at wss://${sanitized}/mqtt`);

      const signOpts: any = {
        host: sanitized,
        path: '/mqtt',
        service: 'iotdevicegateway',
        region,
        method: 'GET',
      };
      const signed = aws4.sign(signOpts, {
        accessKeyId: creds.accessKeyId,
        secretAccessKey: creds.secretAccessKey,
        sessionToken: creds.sessionToken,
      });

      this.mqttClient = mqttConnect(`wss://${sanitized}/mqtt`, {
        protocol: 'wss',
        clientId: `homebridge-xsense_${Math.random().toString(16).substring(2, 10)}`,
        reconnectPeriod: 5000,
        wsOptions: { headers: signed.headers },
      } as any);

      this.mqttClient.on('connect', () => {
        this.log.info('MQTT client connected.');

        uniqueStationSns.forEach(stationSn => {
          const houseId = stationSn.split('_')[0];
          const eventTopic = `@xsense/events/1/${houseId}/${stationSn}`;
          const shadowTopic = `$aws/things/${stationSn}/shadow/name/+/update`;

          this.mqttClient?.subscribe([eventTopic, shadowTopic], (err) => {
            if (!err) {
              this.log.debug(`Subscribed to ${eventTopic} and ${shadowTopic}`);
            } else {
              this.log.error(`Failed to subscribe for station ${stationSn}:`, err);
            }
          });
        });
      });

      this.mqttClient.on('message', (topic, payload) => {
        this.log.debug(`MQTT message received on topic ${topic}:`, payload.toString());
        try {
          const message = JSON.parse(payload.toString());
          this.emit('message', topic, message);
        } catch (e) {
          this.log.error(`Failed to parse MQTT message: ${payload.toString()}`, e);
        }
      });

      this.mqttClient.on('error', (error) => this.log.error('MQTT client error:', error));
      this.mqttClient.on('reconnect', () => this.log.info('MQTT client reconnecting...'));
      this.mqttClient.on('close', () => this.log.info('MQTT client connection closed.'));

    } catch (error) {
      this.log.error('Failed to connect to MQTT broker:', error);
    }
  }

  private async reconnectMqtt() {
    this.log.info('Attempting to refresh MQTT connection credentials and reconnect...');
    this.disconnectMqtt(false);
    await this.connectMqtt();
  }

  public disconnectMqtt(clearTimers = true) {
    if (this.mqttClient) {
      this.log.info('Disconnecting MQTT client.');
      this.mqttClient.end(true);
      this.mqttClient = null;
    }
    if (clearTimers && this.mqttRefreshTimer) {
      clearTimeout(this.mqttRefreshTimer);
      this.mqttRefreshTimer = undefined;
    }
  }
}
