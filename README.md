# Homebridge X-Sense

[![npm](https://img.shields.io/npm/v/homebridge-x-sense.svg)](https://www.npmjs.com/package/homebridge-x-sense)

This is a [Homebridge](https://homebridge.io) plugin for integrating X-Sense smoke and carbon monoxide detectors into Apple HomeKit. It uses the same unofficial API as the Home Assistant integration to provide real-time status updates for your devices.

## Features

*   **Real-time Updates:** Uses a persistent MQTT connection for instant notifications of alarms and status changes.
*   **Device Support:** Exposes combination Smoke & Carbon Monoxide alarms, smoke-only models, and CO-only models with the correct HomeKit services.
*   **Rich Notifications:** Provides status for:
    *   Smoke Detected
    *   Carbon Monoxide Detected
    *   Battery Level
    *   Low Battery Warnings
*   **Automatic Discovery:** Automatically discovers all sensors linked to your X-Sense account.
*   **Resilient:** Automatically handles token refreshes and connection recovery.
*   **Secure Connection:** Temporary AWS credentials are used to sign the MQTT
    WebSocket URL via SigV4.

## Installation

1.  Install Homebridge using the [official instructions](https://github.com/homebridge/homebridge/wiki).
2.  Install this plugin using the Homebridge UI or `npm install -g homebridge-x-sense`.
3.  Configure the plugin using the Homebridge UI or by manually editing your `config.json` file.
4.  The plugin uses temporary AWS credentials from X-Sense to sign the MQTT
    WebSocket connection.

## Configuration

You can configure this plugin via the Homebridge UI. The available options are:

| Field             | Description                                                                                             | Required | Default |
| ----------------- | ------------------------------------------------------------------------------------------------------- | -------- | ------- |
| **Email**         | The email address for your X-Sense account.                                                             | Yes      |         |
| **Password**      | The password for your X-Sense account.                                                                  | Yes      |         |
| **Polling Interval** | The interval in minutes for how often to poll the API for device status as a fallback to real-time updates. | No       | `15`    |

### Example `config.json`

```json
{
  "platform": "X-Sense",
  "username": "your-email@example.com",
  "password": "your-password",
  "pollingInterval": 15
}
```

## Troubleshooting

*   **"Cognito authentication failed" Error:** This error almost always means your email or password is incorrect. Please double-check your credentials in the plugin configuration.
*   **Devices Not Appearing:**
    1.  Check the Homebridge logs for any errors during startup. Look for messages like "Discovered X devices".
    2.  Ensure the devices are online and connected in the official X-Sense mobile app.
    3.  Try restarting Homebridge.
*   **Status Not Updating:** The plugin relies on a real-time MQTT connection. If you see "MQTT client error" or "MQTT client connection closed" in the logs, it may indicate a network issue between your Homebridge server and the X-Sense cloud. The plugin will attempt to reconnect automatically. The periodic polling will also serve as a backup to refresh the state.

## Acknowledgements

This plugin was inspired by the [ha-xsense-component_test](https://github.com/Jarnsen/ha-xsense-component_test) project and would not have been possible without the excellent work of [theosnel](https://github.com/theosnel) in decoding the X-Sense API in the [python-xsense](https://github.com/theosnel/python-xsense/tree/develop/xsense) project.

## Disclaimer

This plugin is not officially endorsed by or affiliated with X-Sense. It is a community-driven project that relies on an unofficial API. The API may change at any time, which could break this plugin. Use at your own risk.

## License

This project is licensed under the Apache-2.0 License. See the LICENSE file for details.