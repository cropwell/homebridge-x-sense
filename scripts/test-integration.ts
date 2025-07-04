import 'dotenv/config';
import { XsenseApi } from '../src/api/XsenseApi';
import { Logger } from 'homebridge';

// A simple console logger for the script
const log: Logger = {
  info: (...args) => console.log('[INFO]', ...args),
  warn: (...args) => console.warn('[WARN]', ...args),
  error: (...args) => console.error('[ERROR]', ...args),
  debug: (...args) => console.log('[DEBUG]', ...args),
};

async function main() {
  const { XSENSE_USERNAME, XSENSE_PASSWORD } = process.env;

  if (!XSENSE_USERNAME || !XSENSE_PASSWORD) {
    log.error('Please create a .env file and provide XSENSE_USERNAME and XSENSE_PASSWORD.');
    process.exit(1);
  }

  log.info('Starting X-Sense integration test...');
  const api = new XsenseApi(XSENSE_USERNAME, XSENSE_PASSWORD, log);

  try {
    log.info('Attempting to log in...');
    await api.login();
    log.info('Login successful.');

    log.info('Fetching device list...');
    const devices = await api.getDeviceList();
    log.info(`Discovered ${devices.length} devices:`);
    console.log(JSON.stringify(devices, null, 2));

    if (devices.length > 0) {
      log.info('Connecting to MQTT for real-time updates...');
      await api.connectMqtt();

      api.on('message', (topic, payload) => {
        log.info(`<<< MQTT Message on topic: ${topic} >>>`);
        console.log(JSON.stringify(payload, null, 2));
      });

      log.info('---');
      log.info('Integration test script is running.');
      log.info('Listening for MQTT messages... (Press Ctrl+C to exit)');
      log.info('---');
    } else {
      log.warn('No devices found, skipping MQTT connection.');
    }

  } catch (error) {
    log.error('An error occurred during the integration test:', error);
    process.exit(1);
  }
}

main();