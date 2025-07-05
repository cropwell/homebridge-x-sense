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
import { createHmac } from 'crypto';
import { API_HOST, CLIENT_TYPE, APP_VERSION, APP_CODE } from './constants';
import { DeviceInfo, GetDeviceListResponse, GetIotCredentialResponse, IotCredentials, GetClientInfoResponse, ClientInfo } from './types';

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
        if (this.session && config.headers) {
          config.headers['token'] = this.session.getIdToken().getJwtToken();
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
    const response = await this.http.post<GetClientInfoResponse>('/app', {
      clientType: CLIENT_TYPE,
      mac: 'abcdefg',
      appVersion: APP_VERSION,
      bizCode: '101001',
      appCode: APP_CODE,
    });

    if (response.data.reCode !== 200) {
      throw new Error(`Failed to fetch client info: ${response.data.reMsg}`);
    }

    this.clientInfo = response.data.reData;
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
    const response = await this.http.post<GetDeviceListResponse>('/v1/user/getDeviceList', {
      'userId': this.session?.getIdToken().payload.sub,
    });

    if (response.data.code !== 0) {
      throw new Error(`Error fetching device list: ${response.data.msg} (code: ${response.data.code})`);
    }
    // Store for later use in MQTT reconnects
    this.lastKnownDevices = response.data.data ?? [];
    return this.lastKnownDevices;
  }

  public async getIotCredential(): Promise<IotCredentials> {
    this.log.debug('Fetching IoT credentials...');
    const response = await this.http.post<GetIotCredentialResponse>('/v1/user/getIotCredential', {});

    if (response.data.code !== 0) {
      throw new Error(`Error fetching IoT credentials: ${response.data.msg} (code: ${response.data.code})`);
    }
    if (!response.data.data) {
      throw new Error('IoT credentials response is empty.');
    }
    this.log.debug('Successfully fetched IoT credentials.');
    return response.data.data;
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

      this.log.info(`Connecting to MQTT broker at wss://${creds.iotEndpoint}/mqtt`);

      this.mqttClient = mqttConnect(({
        host: creds.iotEndpoint,
        protocol: 'wss',
        clientId: `homebridge-xsense_${Math.random().toString(16).substring(2, 10)}`,
        accessKeyId: creds.accessKey,
        secretAccessKey: creds.secretKey,
        sessionToken: creds.sessionToken,
        reconnectPeriod: 5000,
      } as any));

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
