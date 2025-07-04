# X-Sense Homebridge Plugin Backlog

### Epic 1: Project scaffolding & tooling

1. **Initialise plugin repo**  
   - **User story:** As a developer, I want a Homebridge plugin template scaffolded so I can focus on core logic.  
   - **Tasks:**  
     - Scaffold with `homebridge-plugin-template`.  
     - Add dependencies in `package.json`:  
       - `amazon-cognito-identity-js` (for AWS Cognito)  
       - `mqtt` (for MQTT over WebSockets)  
       - `axios` or `node-fetch` (for REST)  
       - `homebridge`  
     - Configure TypeScript/ESLint.  
     - Add CI via GitHub Actions for linting/build.  
   - **Acceptance criteria:** Fresh clone runs `npm run lint` and `npm test` without errors.

2. **Define configuration schema**  
   - **User story:** As an end-user, I want to enter my X-Sense credentials in Homebridge UI.  
   - **Tasks:**  
     - Create `config.schema.json` with fields: `username`, `password`, `pollingInterval`.  
     - In `platform.ts` validate config at startup and log errors if missing.  
   - **Acceptance criteria:** Homebridge UI exposes form; missing fields cause a clear startup error.

---

### Epic 2: X-Sense API client

3. **Survey existing Python client**  
   - **User story:** As a developer, I need to understand how the HA integration logs in and fetches data.  
   - **Tasks:**  
     - Review `homeassistant/components/xsense/manifest.json` to see the `python-xsense` dependency.  
     - Open `homeassistant/components/xsense/__init__.py` to see setup flow.  
     - Inspect `python-xsense` library (in HA’s `requirements.txt`) for auth and REST calls.  
   - **Acceptance criteria:** You can map each Python client method to a planned JS equivalent.

4. **Implement Cognito authentication in JS**  
   - **User story:** As the plugin, I need to log in via AWS Cognito.  
   - **Tasks:**  
     - Create `src/api/XsenseApi.ts`.  
     - Port logic from `python-xsense`’s `XsenseClient.login()` into JS using `amazon-cognito-identity-js`.  
     - Store `idToken`, `accessToken`, `refreshToken` and schedule refresh.  
   - **Acceptance criteria:** `XsenseApi.login()` returns valid tokens when tested against a real hub.

5. **Wrap REST endpoints**  
   - **User story:** As the plugin, I want to fetch houses, stations and their state.  
   - **Tasks:**  
     - In `XsenseApi`, add methods matching HA calls in `homeassistant/components/xsense/coordinator.py`:  
       - `/house/{id}/state` → `getHouseState(houseId)`  
       - `/station/{sn}/state` → `getStationState(sn)`  
     - Use `axios` to issue requests with the Cognito `idToken` in headers.  
   - **Acceptance criteria:** JSON response matches what HA’s `async_update()` reads in `coordinator.py`.

---

### Epic 3: MQTT real-time updates

6. **Inspect HA coordinator for topics**  
   - **User story:** As a developer, I need to know which MQTT topics to subscribe to.  
   - **Tasks:**  
     - Review `homeassistant/components/xsense/coordinator.py`:  
       - Note topics in `TOPIC_EVENTS` and `TOPIC_SHADOW_UPDATE`.  
     - Extract sample payloads from the `.async_handle_event()` method.  
   - **Acceptance criteria:** List of topics and payload structures documented.

7. **Implement MQTT client in JS**  
   - **User story:** As the plugin, I want live updates from X-Sense.  
   - **Tasks:**  
     - In `XsenseApi`, add `connectMqtt()` that uses `mqtt.connect()` over WSS with AWS credentials.  
     - Subscribe to topics from HA’s `coordinator.py`:  
       ```
       @xsense/events/+/{houseId}
       $aws/things/{stationShadow}/shadow/name/+/update
       ```  
     - Parse messages and emit events via Node’s `EventEmitter`.  
   - **Acceptance criteria:** Real-time JSON arrives and matches HA’s update logic.

---

### Epic 4: Data mapping & HomeKit services

8. **Port sensor mappings**  
   - **User story:** As the plugin, I need a consistent model for each station.  
   - **Tasks:**  
     - Review `homeassistant/components/xsense/sensor.py` and `binary_sensor.py`.  
     - Identify JSON keys and value functions (e.g. `alarmStatus`, `coPpm`, `batteryLevel`, `temperature`, `humidity`, `rfLevel`).  
     - Implement a `Station` class in `src/model/Station.ts` with getters that mirror the Python lambdas.  
   - **Acceptance criteria:** Feeding sample JSON updates a `Station` instance correctly.

9. **Create Homebridge accessories**  
   - **User story:** As a HomeKit user, I want each X-Sense device to appear with correct services.  
   - **Tasks:**  
     - In `src/platform.ts`, during `configureAccessory()`:  
       - For each station, instantiate:  
         - `Accessory.SmokeSensor` (for `alarmStatus`)  
         - `Accessory.CarbonMonoxideSensor` (`coPpm` threshold)  
         - `Accessory.TemperatureSensor` & `Accessory.HumiditySensor`  
         - `Accessory.BatteryService` & a custom `SignalStrength` characteristic (for `rfLevel`)  
       - Hook each service’s `getCharacteristic(...)` to `Station` getters.  
       - Listen to `XsenseApi` events to call `updateCharacteristic()`.  
   - **Acceptance criteria:** Sensors appear in HomeKit; state changes in the official app fire HomeKit events.

---

### Epic 5: Resilience & error handling

10. **Token and connection recovery**  
    - **User story:** As the plugin, I want to survive expired tokens and dropped MQTT.  
    - **Tasks:**  
      - Catch MQTT `error`/`offline` events; call `XsenseApi.login()` and reconnect.  
      - Wrap REST calls to retry once on 401 after refreshing tokens.  
    - **Acceptance criteria:** Manual token revocation triggers an automatic reconnect within 30 s.

11. **Logging & diagnostics**  
    - **User story:** As an operator, I want clear logs of auth, MQTT and parsing errors.  
    - **Tasks:**  
      - Use `this.log.debug/info/error` in `platform.ts` and in `XsenseApi`.  
      - Mirror HA’s log messages (see `homeassistant/components/xsense/__init__.py` for style).  
    - **Acceptance criteria:** Logs include timestamps, error details and are filterable by log level.

---

### Epic 6: Testing & documentation

12. **Unit tests for API client**  
    - **User story:** As a developer, I want tests so I can refactor without breakage.  
    - **Tasks:**  
      - In `__tests__/XsenseApi.test.ts`, mock Cognito and REST endpoints (using `nock`).  
    - **Acceptance criteria:** ≥ 80% coverage on `XsenseApi`.

13. **Integration test script**  
    - **User story:** As a developer, I want a quick end-to-end check against my hub.  
    - **Tasks:**  
      - Create `scripts/test-integration.ts` that runs login, fetches station list, connects MQTT, logs updates.  
    - **Acceptance criteria:** Running script prints live JSON without unhandled exceptions.

14. **User documentation**  
    - **User story:** As an end-user, I want clear setup steps.  
    - **Tasks:**  
      - Update `README.md` with:  
        - Clone/plugin install steps  
        - Config schema (`username`, `password`, `pollingInterval`)  
        - How to locate `houseId`/`stationSN` if needed (reference HA’s discovery in `coordinator.py`)  
      - Add troubleshooting section (e.g. token errors, MQTT failures).  
    - **Acceptance criteria:** Following the doc yields a working plugin in Homebridge without further guidance.
