# Change Log

## v0.3.3 (2025-11-18)

- Removed global database for smart home devices (there was only one entry anyway). Details about discovered devices will be saved to homebridge storage folder instead. This way users may edit services and characteristics if needed, or even skip a device entirely.

## v0.3.2 (2025-11-18)

- Added basic support for (upcoming) REST-API
- **Experimental:** Switch for FRITZ!Box LEDs (requires FRITZ!OS 8.20)

## v0.3.1 (2025-11-08)

- Bugfix

## v0.3.0 (2025-02-11)

- Added energy metering as custom service

## v0.2.4 (2025-02-06)

- Minor bugfixes

## v0.2.3 (2025-02-02)

- Bugfixes and code refactoring

## v0.2.2 (2025-01-31)

- Refined the service discovery for unknown smart home devices

## v0.2.1 (2025-01-30)

- Bugfix

## v0.2.0 (2025-01-29)

- Changed the way how secondary services for smart home devices are added, because sometimes HomeKit doesn't play nice
- Added optional characteristics for lightbulbs (brightness, color temperature, hue/saturation). Don't know if this works as expected. I have no devices to test.
- Added support for HAN-FUN devices. Might work. I have no devices to test.

## v0.1.0 (2025-01-26)

Initial commit
