/**
 * fritzbox.js
 * homebridge-fritzbox
 *
 * @copyright 2025 Hendrik Meinl
 */

"use strict";

const HomeKitHelper = require("../utils/homekit-helper");

class FritzBox {

    constructor(platform, accessory, tr064) {

        this.platform = platform;
        this.accessory = accessory;

        this.log = platform.log;
        this.api = platform.api;

        this.Service = platform.api.hap.Service;
        this.Characteristic = platform.api.hap.Characteristic;

        this.tr064 = tr064;

        this.services = new Map();
        this.configuredNames = [];


        // Accessory information

        this.accessoryInformation = this.accessory.getService(this.Service.AccessoryInformation);
        this.accessoryInformation
            .setCharacteristic(this.Characteristic.Manufacturer, this.accessory.context.device.manufacturer)
            .setCharacteristic(this.Characteristic.SerialNumber, this.accessory.context.device.serialNo)
            .setCharacteristic(this.Characteristic.Model, this.accessory.context.device.model)
            .setCharacteristic(this.Characteristic.FirmwareRevision, this.accessory.context.device.fwversion);

        this.accessoryInformation.setPrimaryService(true);


        // Feature switches

        for (const switchConfig of this.accessory.context.device.switches) {

            switchConfig.name = this.createUniqueName(switchConfig.name);
            switchConfig.configuredName = switchConfig.configuredName ?? switchConfig.name;

            const switchService = this.accessory.getService(switchConfig.name) || this.accessory.addService(this.Service.Switch, switchConfig.name, switchConfig.subtype);

            // Adding optional ConfiguredName because of:
            // https://github.com/homebridge/homebridge/issues/3210

            // Setup ConfiguredName before setting Characteristic.On
            // otherwise the name doesn't show up in Apple's Home app

            // Only add, if it doesn't exist yet!
            if (!switchService.testCharacteristic(this.Characteristic.ConfiguredName)) {
                switchService.addOptionalCharacteristic(this.Characteristic.ConfiguredName);
            }

            switchService.getCharacteristic(this.Characteristic.ConfiguredName)
                .updateValue(switchConfig.configuredName);

            switchService.getCharacteristic(this.Characteristic.ConfiguredName)
                .onGet(this.onGetConfiguredName.bind(this, switchConfig))
                .onSet(this.onSetConfiguredName.bind(this, switchConfig));

            switchService.getCharacteristic(this.Characteristic.On)
                .onGet(this.onGet.bind(this, switchConfig))
                .onSet(this.onSet.bind(this, switchConfig));

            this.services.set(switchConfig.subtype, switchService);
        }


        // LED switch (Experimental)

        if (this.accessory.context.device.switchLED) {

            const LEDSwitchService = this.accessory.getService("LEDs") || this.accessory.addService(this.Service.Switch, "LEDs", "FritzBox-LEDs");

            this.accessory.context.device.switchLED_On = true;
            LEDSwitchService.getCharacteristic(this.Characteristic.On)
                .onGet(this.onGetLED.bind(this))
                .onSet(this.onSetLED.bind(this));

            this.services.set("FritzBox-LEDs", LEDSwitchService);
        }


        // Clean up

        // Any previously created switch service will still be
        // retained by Homebridge unless we explicitly remove it.
        // So we clean up leftover switches the user has decided
        // to not include anymore.

        for (const service of this.accessory.services) {
            if (
                service.UUID === "00000049-0000-1000-8000-0026BB765291" // Switch service UUID
                && !this.services.has(service.subtype)
            ) {
                this.accessory.removeService(service);
            }
        }


        // Update loop

        this.lastUpdate = Date.now();
        this.lastFWUpdate = Date.now();

        this.updateInterval = Math.max(5, (platform.config.update?.fritzbox || 60));

        this.updateTimer = setInterval(
            this.update.bind(this),
            this.updateInterval * 1000
        );
    }

    onGetLED() {
        return this.accessory.context.device.switchLED_On;
    }

    onSetLED(value) {

        // Skip, if value doesn't change
        if (value === this.accessory.context.device.switchLED_On) {
            return;
        }

        // Set our own (internal) state
        this.accessory.context.device.switchLED_On = value;

        const serviceType = "urn:dslforum-org:service:DeviceConfig:1";
        const actionName = "X_AVM-DE_CreateUrlSID";

        this.tr064.hasService(serviceType).then((hasService) => {

            if (!hasService) {
                throw new Error("[TR064] Cannot get SID");
            }

            this.tr064.send(serviceType, actionName).then((UrlSID) => {

                const SID = /(?<=sid=)[A-Fa-f0-9]+/.exec(UrlSID?.["NewX_AVM-DE_UrlSID"] || "");

                if (SID === null) {
                    throw new Error("[TR064] Cannot get SID");
                }

                const headers = new Headers();
                headers.append("Authorization", `AVM-SID ${SID[0]}`);
                headers.append("Content-Type", "application/json");

                let options = {
                    method: "GET",
                    headers: headers,
                };

                const deviceURL = this.tr064.deviceURL;
                const url = `${deviceURL.protocol}//${deviceURL.hostname}/api/v0/generic/box`;

                fetch(url, options).then((response) => {

                    if (!response.ok) {
                        throw new Error(`[TR064] GET: ${response.status} ${response.statusText}`);
                    }

                    response.json().then((data) => {

                        // const ledDisplay = data["led_display"] || null;
                        const ledDimMode = data["led_dim_mode"] || null;
                        const ledDimBrightness = data["led_dim_brightness"] || null;

                        const LEDsettings = { "led_display": (value === true ? "0" : "2") };
                        if (ledDimMode !== null) { LEDsettings["led_dim_mode"] = ledDimMode; }
                        if (ledDimBrightness !== null) { LEDsettings["led_dim_brightness"] = ledDimBrightness; }

                        options = {
                            method: "PUT",
                            headers: headers,
                            body: JSON.stringify(LEDsettings),
                        };

                        fetch(url, options).then(() => {
                            this.log.info("LEDs switched %s", (value ? "on" : "off"));
                        });

                    });
                });
            });

        }).catch((error) => {

            // Revert internal state in case of error
            this.accessory.context.device.switchLED_On = !this.accessory.context.device.switchLED_On;

            const service = this.services.get("FritzBox-LEDs");
            if (service !== undefined) {
                service.updateCharacteristic(this.Characteristic.On, this.accessory.context.device.switchLED_On);
            }

            this.log.error("LEDs:", error.message || error);
        });
    }

    onGet(switchConfig) {
        return switchConfig.enabled;
    }

    onSet(switchConfig, value) {

        // Skip, if value doesn't change
        if (value === switchConfig.enabled) {
            return;
        }

        // Set our own (internal) state
        switchConfig.enabled = value;

        // Create arguments object for setting this FRITZ!Box feature on/off
        const args = {};
        for (const [key, value] of Object.entries(switchConfig.args)) {
            args[key] = switchConfig[value];
        }

        // Send set on/off action
        this.tr064.send(switchConfig.service, switchConfig.actions[1], args).then(() => {

            this.log.info(`${switchConfig.configuredName} was switched`, value ? "on" : "off");

        }).catch((error) => {

            // Revert internal switch state in case of error
            switchConfig.enabled = !switchConfig.enabled;

            const service = this.services.get(switchConfig.subtype);
            if (service !== undefined) {
                service.updateCharacteristic(this.Characteristic.On, switchConfig.enabled);
            }

            this.log.error(`${switchConfig.configuredName}:`, error.message || error);
        });
    }

    onGetConfiguredName(switchConfig) {
        return switchConfig.configuredName ?? switchConfig.name;
    }

    onSetConfiguredName(switchConfig, value) {
        const configuredName = HomeKitHelper.getHomeKitFriendlyName(value);
        switchConfig.configuredName = configuredName;
    }

    async update() {

        const timeSinceLastUpdate = (Date.now() - this.lastUpdate) / 1000;
        if (timeSinceLastUpdate <= this.updateInterval) {
            return;
        }

        if (this.updateTimer) {
            clearInterval(this.updateTimer);
        }


        // Update switches for WLAN, TAM and Deflections

        for (const switchConfig of this.accessory.context.device.switches) {

            const serviceType = switchConfig.service;
            const actionName = switchConfig.actions[0];

            // Note to self:
            // This actually includes arguments not needed for getting
            // the current state of this FRITZ!Box feature. We filter
            // these out in TR064#send so that we don't need to know
            // about the required arguments for each action here.

            const args = {};
            for (const [key, value] of Object.entries(switchConfig.args)) {
                args[key] = switchConfig[value];
            }

            try {
                const state = await this.tr064.send(serviceType, actionName, args);
                if (state !== null) {
                    for (const [key, value] of Object.entries(switchConfig.args)) {
                        if (state[key] !== undefined) {
                            switchConfig[value] = state[key];
                        }
                    }
                    const service = this.services.get(switchConfig.subtype);
                    if (service !== undefined) {
                        service.updateCharacteristic(this.Characteristic.On, switchConfig.enabled);
                    }
                }
            } catch (error) {
                this.log.warn("An error occured while trying to update the state of the FRITZ!Box. Will try again");
                this.log.debug(error.message || error);
            }
        }


        // Update accessory information (FirmwareRevision) every 24h

        const timeSinceLastFWUpdate = (Date.now() - this.lastFWUpdate) / 1000;
        if (timeSinceLastFWUpdate > (24 * 60 * 60 * 1000)) {
            try {
                const state = await this.tr064.send(this.accessory.context.device.service, this.accessory.context.device.action);
                if (state !== null) {
                    for (const [key, value] of Object.entries(this.accessory.context.device.args)) {
                        this.accessory.context.device[value] = state[key];
                        this.accessory.getService(this.Service.AccessoryInformation)
                            .updateCharacteristic(this.Characteristic.FirmwareRevision, state[key]);
                    }
                }
            } catch (error) {
                this.log.warn("An error occured while trying to update the state of the FRITZ!Box. Will try again");
                this.log.debug(error.message || error);
            }
            this.lastFWUpdate = Date.now();
        }


        this.api.updatePlatformAccessories([this.accessory]);


        this.lastUpdate = Date.now();

        this.updateTimer = setInterval(
            this.update.bind(this),
            this.updateInterval * 1000
        );
    }

    /**
     * Creates a unique (HomeKit friendly) name from a proposed switch name
     * Avoids having two switches with identical names
     * @param   {string} name - Proposed switch name
     * @returns {string}      - Unique name
     */
    createUniqueName(name) {

        const base = HomeKitHelper.getHomeKitFriendlyName(name);

        let extension = "";

        let counter = 1;
        while (this.configuredNames.includes(base + extension)) {
            counter++;
            extension = ` ${counter}`;
        }

        this.configuredNames.push(base + extension);

        return base + extension;
    }
}

module.exports = FritzBox;
