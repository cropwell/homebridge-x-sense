import { XsenseApi } from '../src/api/XsenseApi';
import { Logger } from 'homebridge';
import nock from 'nock';
import { connect as mqttConnect } from 'mqtt';
import { API_HOST } from '../src/api/constants';
import aws4 from 'aws4';

// Mock the Cognito library
const mockAuthenticateUser = jest.fn();
const mockRefreshSession = jest.fn();
const mockClientRequest = jest.fn((_op: string, _params: any, cb: any) => cb(null, {}));

// Mock the MQTT library
const mockMqttClient = {
  on: jest.fn(),
  subscribe: jest.fn(),
  end: jest.fn(),
};
jest.mock('mqtt', () => ({
  connect: jest.fn().mockImplementation(() => mockMqttClient),
}));
const mockedMqttConnect = mqttConnect as jest.Mock;

jest.mock('aws4', () => ({
  sign: jest.fn((opts: any) => {
    opts.headers = { Authorization: 'signed' };
    return opts;
  }),
}));
const mockedAws4Sign = (aws4 as unknown as { sign: jest.Mock }).sign;

jest.mock('amazon-cognito-identity-js', () => {
  return {
    CognitoUserPool: jest.fn().mockImplementation(() => ({
      client: { request: mockClientRequest },
    })),
    CognitoUser: jest.fn().mockImplementation(() => ({
      authenticateUser: mockAuthenticateUser,
      refreshSession: mockRefreshSession,
    })),
    AuthenticationDetails: jest.fn(),
    CognitoUserSession: jest.fn(),
    CognitoRefreshToken: jest.fn(),
  };
});

// A mock logger for the tests
const mockLogger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
} as unknown as Logger;

describe('XsenseApi', () => {
  let api: XsenseApi;
  const username = 'test@example.com';
  const password = 'password';

  beforeEach(() => {
    // Reset mocks before each test
    jest.clearAllMocks();
    nock.cleanAll();
    
    const encoded = Buffer.from('1234secretZ').toString('base64');
    
    nock(API_HOST)
      .post('/app')
      .reply(200, {
        reCode: 200,
        reMsg: 'OK',
        reData: {
          clientId: 'test-client',
          clientSecret: encoded,
          cgtRegion: 'eu-central-1',
          userPoolId: 'eu-central-1_test',
        },
      });
    api = new XsenseApi(username, password, mockLogger);
  });

  describe('login', () => {
    it('should authenticate and store the session on success', async () => {
      const mockSession = {
        getIdToken: () => ({ getJwtToken: () => 'id-token', payload: { sub: 'user-sub' } }),
        getAccessToken: () => ({ getJwtToken: () => 'access-token' }),
        getRefreshToken: () => ({ getToken: () => 'refresh-token' }),
        isValid: () => true,
      };
      mockAuthenticateUser.mockImplementation((_details, callbacks) => {
        callbacks.onSuccess(mockSession);
      });

      await api.login();

      expect(mockAuthenticateUser).toHaveBeenCalled();
      expect(mockLogger.debug).toHaveBeenCalledWith('Cognito authentication successful.');
    });

    it('should reject on authentication failure', async () => {
      const authError = new Error('Authentication failed');
      mockAuthenticateUser.mockImplementation((_details, callbacks) => {
        callbacks.onFailure(authError);
      });

      await expect(api.login()).rejects.toThrow('Authentication failed');
      expect(mockLogger.error).toHaveBeenCalledWith('Cognito authentication failed:', 'Authentication failed');
    });
  });

  describe('getDeviceList', () => {
    beforeEach(async () => {
      // Mock a successful login before these tests
      const mockSession = {
        getIdToken: () => ({ getJwtToken: () => 'id-token', payload: { sub: 'user-sub' } }),
        getAccessToken: () => ({ getJwtToken: () => 'access-token' }),
        getRefreshToken: () => ({ getToken: () => 'refresh-token' }),
        isValid: () => true,
      };
      mockAuthenticateUser.mockImplementation((_details, callbacks) => {
        callbacks.onSuccess(mockSession);
      });
      await api.login();
    });

    it('should fetch and return the device list', async () => {
      const houses = [{ houseId: 'h1', mqttServer: 'house.endpoint', mqttRegion: 'eu-central-1' }];
      const stations = { stations: [{ stationSn: 's1', stationName: 'Station', devices: [{ deviceId: '123', deviceName: 'Living Room', deviceType: 1 }] }] };
      nock(API_HOST).post('/app').reply(200, { reCode: 200, reData: houses }).post('/app').reply(200, { reCode: 200, reData: stations });

      const devices = await api.getDeviceList();

      expect(devices).toEqual([
        {
          station_sn: 's1',
          station_name: 'Station',
          device_id: '123',
          device_name: 'Living Room',
          type_id: 1,
          device_model: 1,
          mqttServer: 'house.endpoint',
          mqttRegion: 'eu-central-1',
          status: {},
        },
      ]);
      expect(nock.isDone()).toBe(true);
    });

    it('should throw an error if the API returns a non-zero code', async () => {
      nock(API_HOST).post('/app').reply(200, { reCode: 500, reMsg: 'API Error' });

      await expect(api.getDeviceList()).rejects.toThrow('API Error');
      expect(nock.isDone()).toBe(true);
    });
  });

  

  describe('Token Refresh', () => {
    it('should refresh token on 401 and retry the request', async () => {
      const initialSession = {
        getIdToken: () => ({ getJwtToken: () => 'expired-token', payload: { sub: 'user-sub' } }),
        getAccessToken: () => ({ getJwtToken: () => 'expired-access' }),
        getRefreshToken: () => ({ getToken: () => 'refresh-token' }),
        isValid: () => false, // Simulate expired
      };
      mockAuthenticateUser.mockImplementation((_details, callbacks) => callbacks.onSuccess(initialSession));
      await api.login();

      const newSession = {
        getIdToken: () => ({ getJwtToken: () => 'new-valid-token', payload: { sub: 'user-sub' } }),
        getAccessToken: () => ({ getJwtToken: () => 'new-access' }),
        isValid: () => true,
      };
      mockRefreshSession.mockImplementation((_token, callback) => callback(null, newSession));

      const scope1 = nock(API_HOST)
        .post('/app')
        .reply(401, { msg: 'Unauthorized' });

      const mockDevices = { stations: [{ stationSn: 's1', stationName: 'Station', devices: [{ deviceId: '456', deviceName: 'Device', deviceType: 1 }] }] };
      const scope2 = nock(API_HOST)
        .post('/app')
        .reply(200, { reCode: 200, reData: [{ houseId: 'h1', mqttServer: 'house.endpoint', mqttRegion: 'eu-central-1' }] })
        .post('/app')
        .reply(200, { reCode: 200, reData: mockDevices });

      const devices = await api.getDeviceList();

      expect(devices).toEqual([
        {
          station_sn: 's1',
          station_name: 'Station',
          device_id: '456',
          device_name: 'Device',
          type_id: 1,
          device_model: 1,
          mqttServer: 'house.endpoint',
          mqttRegion: 'eu-central-1',
          status: {},
        },
      ]);
      expect(scope1.isDone()).toBe(true);
      expect(scope2.isDone()).toBe(true);
      expect(mockRefreshSession).toHaveBeenCalled();
      expect(mockLogger.info).toHaveBeenCalledWith('Token expired, attempting to refresh...');
      expect(mockLogger.info).toHaveBeenCalledWith('Token refreshed successfully.');
    });

    it('should fail if token refresh fails', async () => {
      const initialSession = {
        getIdToken: () => ({ getJwtToken: () => 'expired-token', payload: { sub: 'user-sub' } }),
        getAccessToken: () => ({ getJwtToken: () => 'expired-access' }),
        getRefreshToken: () => ({ getToken: () => 'refresh-token' }),
        isValid: () => false,
      };
      mockAuthenticateUser.mockImplementation((_details, callbacks) => callbacks.onSuccess(initialSession));
      await api.login();

      const refreshError = new Error('Invalid refresh token');
      mockRefreshSession.mockImplementation((_token, callback) => callback(refreshError, null));

      nock(API_HOST)
        .post('/app')
        .reply(401, { msg: 'Unauthorized' });

      await expect(api.getDeviceList()).rejects.toThrow('Invalid refresh token');
      expect(mockLogger.error).toHaveBeenCalledWith('Failed to refresh token. Please re-login.', refreshError);
    });

    it('should re-login on NotAuthorizedException and retry the request', async () => {
      const initialSession = {
        getIdToken: () => ({ getJwtToken: () => 'expired-token', payload: { sub: 'user-sub' } }),
        getAccessToken: () => ({ getJwtToken: () => 'expired-access' }),
        getRefreshToken: () => ({ getToken: () => 'refresh-token' }),
        isValid: () => true,
      };
      mockAuthenticateUser.mockImplementationOnce((_details, callbacks) => callbacks.onSuccess(initialSession));
      await api.login();

      // Mock the second login attempt (after the exception)
      const newSession = {
        getIdToken: () => ({ getJwtToken: () => 'new-valid-token', payload: { sub: 'user-sub' } }),
        getAccessToken: () => ({ getJwtToken: () => 'new-access' }),
        isValid: () => true,
      };
      mockAuthenticateUser.mockImplementationOnce((_details, callbacks) => callbacks.onSuccess(newSession));

      const scope = nock(API_HOST)
        .post('/app')
        .reply(200, { reCode: 401, reMsg: 'NotAuthorizedException' }) // First call fails
        .post('/app')
        .reply(200, { reCode: 200, reData: [{ houseId: 'h1' }] }) // Second call succeeds
        .post('/app')
        .reply(200, { reCode: 200, reData: { stations: [] } });

      await api.getDeviceList();

      expect(scope.isDone()).toBe(true);
      expect(mockAuthenticateUser).toHaveBeenCalledTimes(2); // Initial login + re-login
      expect(mockLogger.info).toHaveBeenCalledWith('Session expired, attempting to log in again...');
      expect(mockLogger.info).toHaveBeenCalledWith('Re-login successful, retrying API call.');
    });
  });

  describe('MQTT Connection', () => {
    const mockDevices = [
      { device_id: 'd1', station_sn: 's1_a', device_name: 'Smoke 1', status: { battery: 100, online: 1 }, type_id: 1, device_model: 'XS01-M' },
      { device_id: 's1_a', station_sn: 's1_a', device_name: 'Station 1', status: { battery: 100, online: 1 }, type_id: 1, device_model: 'SBS50' },
    ];
    const mockCreds = {
      iotEndpoint: 'test.iot.endpoint', // This will be ignored
      accessKeyId: 'key',
      secretAccessKey: 'secret',
      sessionToken: 'token',
      expiration: new Date(Date.now() + 3600 * 1000).toISOString(),
    };
    const hardcodedEndpoint = 'a3p56i1nw0xqwj-ats.iot.us-east-1.amazonaws.com';
    const hardcodedRegion = 'us-east-1';

    beforeEach(async () => {
      // Mock a successful login before these tests
      const mockSession = {
        getIdToken: () => ({ getJwtToken: () => 'id-token', payload: { sub: 'user-sub' } }),
        getAccessToken: () => ({ getJwtToken: () => 'access-token' }),
        isValid: () => true,
      };
      mockAuthenticateUser.mockImplementation((_details, callbacks) => {
        callbacks.onSuccess(mockSession);
      });
      await api.login();

      // Mock device list and credentials
      nock(API_HOST)
        .post('/app')
        .times(Infinity) // Allow multiple calls for different tests
        .reply(200, (_uri, requestBody) => {
          const body = typeof requestBody === 'string' ? JSON.parse(requestBody) : requestBody;
          if (body.bizCode === '102007') {
            return { reCode: 200, reData: [{ houseId: 'h1', mqttServer: 'wrong.endpoint', mqttRegion: 'eu-west-1' }] };
          }
          if (body.bizCode === '103007') {
            return { reCode: 200, reData: { stations: mockDevices.map(d => ({ stationSn: d.station_sn, stationName: d.device_name, devices: [d] })) } };
          }
          if (body.bizCode === '101003') {
            return { reCode: 200, reData: mockCreds };
          }
          return { reCode: 404, reMsg: 'Not Found' };
        });
    });

    it('should always connect to the hardcoded MQTT endpoint', async () => {
      await api.getDeviceList(); // Populate lastKnownDevices
      await api.connectMqtt();

      expect(mockedAws4Sign).toHaveBeenCalledWith(
        expect.objectContaining({
          host: hardcodedEndpoint,
          region: hardcodedRegion,
        }),
        expect.anything(),
      );

      expect(mockedMqttConnect).toHaveBeenCalledWith(
        `wss://${hardcodedEndpoint}/mqtt`,
        expect.objectContaining({ wsOptions: { headers: { Authorization: 'signed' } } }),
      );

      // Simulate the 'connect' event to trigger subscriptions
      const connectCallback = mockMqttClient.on.mock.calls.find(call => call[0] === 'connect')[1];
      connectCallback();

      expect(mockMqttClient.subscribe).toHaveBeenCalledWith(
        expect.arrayContaining([
          '@xsense/events/1/s1/s1_a',
          '$aws/things/s1_a/shadow/name/+/update',
        ]),
        expect.any(Function),
      );
    });

    it('should schedule a credential refresh', async () => {
      const setTimeoutSpy = jest.spyOn(global, 'setTimeout');
      const reconnectSpy = jest.spyOn(api as any, 'reconnectMqtt').mockImplementation(() => Promise.resolve());

      await api.getDeviceList();
      await api.connectMqtt();

      // Check that setTimeout was called with a reasonable delay
      expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), expect.any(Number));
      const delay = setTimeoutSpy.mock.calls[0][1];
      expect(delay).toBeGreaterThan(0);

      reconnectSpy.mockRestore();
      setTimeoutSpy.mockRestore();
    });
  });
});