/**
 * smarthome.js
 * homebridge-fritzbox
 *
 * @copyright 2025 Hendrik Meinl
 */

"use strict";

const crypto = require("node:crypto");
const { Buffer } = require("node:buffer");
const { XMLParser } = require("fast-xml-parser");

/**
 * AHA HTTP Interface
 * @see https://avm.de/fileadmin/user_upload/Global/Service/Schnittstellen/AHA-HTTP-Interface.pdf
 */
class SmartHome {

    /**
     * Note: url is NOT a string!!
     * @param {URL} url - TR-064 service description url
     */
    constructor(log, config, url) {

        this.log = log;

        this.username = config.username || "";
        this.password = config.password || "";

        this.SID = "0000000000000000";
        this.timestamp = 0;

        this.loginURL   = new URL(`${url.protocol}//${url.hostname}/login_sid.lua`);
        this.serviceURL = new URL(`${url.protocol}//${url.hostname}/webservices/homeautoswitch.lua`);

        const parserOptions = {
            ignoreDeclaration: true,
            ignoreAttributes: false,
            attributeNamePrefix : "@",
            parseTagValue: false,
            isArray: (name, jpath) => {
                return /\.(?<name>[^.]+)list\.(\k<name>)$/m.test(jpath);
            }
        };

        this.parser = new XMLParser(parserOptions);
    }

    /**
     * Get session info containing the SID and/or challenge
     * @param {URL} url   - The url including searchParams
     * @returns {Promise} - The session info
     * @private
     */
    async getSessionInfo(url) {

        try {

            const response = await fetch(url);

            if (!response.ok) {
                throw new Error(`[SmartHome] Error getting session info: ${response.status} ${response.statusText}`);
            }

            const data = await response.text();
            const obj  = this.parser.parse(data, true);

            return obj;

        } catch (error) {
            if (
                error instanceof TypeError
                && error.message === "fetch failed"
                && error.cause instanceof Error
                && error.cause.message === "self-signed certificate"
            ) {
                throw new Error("Can not establish SSL connection to FRITZ!Box with self-signed certificate");
            } else {
                throw error;
            }
        }
    }

    /**
     * Check, if a current SID is valid or request a new one
     * @private
     */
    async getSID() {

        // According to AVM Technical Note - Session ID
        // session IDs are valid for 60 minutes and will
        // be renewed with each request

        const isValid = (Date.now() - this.timestamp) < (60 * 60 * 1000);
        if (this.SID !== "0000000000000000" && isValid) {
            this.timestamp = Date.now();
            return;
        }

        let url = new URL(`?sid=${this.SID}`, this.loginURL);

        let sessionInfo = await this.getSessionInfo(url);

        let SID = sessionInfo?.["SessionInfo"]?.["SID"];
        if (SID !== undefined && SID !== "0000000000000000") {
            this.SID = SID;
            this.timestamp = Date.now();
            return;
        }

        const challenge = sessionInfo?.["SessionInfo"]?.["Challenge"];
        if (!challenge) {
            throw new Error("[SmartHome] Session info contains no challenge");
        }

        const hash = crypto.createHash("MD5");
        const buffer = Buffer.from(challenge + "-" + this.password, "utf-16le");
        hash.update(buffer);

        const username = encodeURIComponent(this.username);
        const response = challenge + "-" + hash.digest("hex");

        url = new URL(`?username=${username}&response=${response}`, this.loginURL);

        sessionInfo = await this.getSessionInfo(url);

        SID = sessionInfo?.["SessionInfo"]?.["SID"];
        if (SID !== undefined && SID !== "0000000000000000") {
            this.SID = SID;
            this.timestamp = Date.now();
            return;
        }

        throw new Error("[SmartHome] Could not get SID");
    }

    /**
     * Send command via AHA protocol
     * @param {string}    switchcmd - The command to send
     * @param {?Object}   params    - Command parameters as key/value
     * @returns {Promise}           - FRITZ!Box response
     * @public
     */
    async send(switchcmd, params = null) {

        try {

            await this.getSID();

            const url = this.getURLForSwitchcmd(switchcmd, params);

            let response = await fetch(url);

            if (!response.ok) {
                throw new Error(`[SmartHome] Error sending command ${switchcmd}: ${response.status} ${response.statusText}`);
            }

            const data = await response.text();

            // Response is the status text as "text/plain; charset=utf-8"
            // except for some switchcmd where it is "text/xml; charset=utf-8"

            const exceptions = [
                "getdevicelistinfos",
                "getbasicdevicestats",
                "gettriggerlistinfos",
                "gettemplatelistinfos",
                "getcolordefaults",
                "getsubscriptionstate",
                "getdeviceinfos"
            ];

            if (exceptions.includes(switchcmd)) {
                response  = this.parser.parse(data, true);
            } else {
                response = data;
            }

            return response;

        } catch (error) {
            if (
                error instanceof TypeError
                && error.message === "fetch failed"
                && error.cause instanceof Error
                && error.cause.message === "self-signed certificate"
            ) {
                throw new Error("Can not establish SSL connection to FRITZ!Box with self-signed certificate");
            } else {
                throw error;
            }
        }
    }

    /**
     * Get current state of all smart home devices
     * @returns {Promise} - State object
     * @public
     */
    async getState() {
        return await this.send("getdevicelistinfos");
    }

    /**
     * Get ColorDefaults for colored Lightbulbs
     * @public
     */
    async getColorDefaults() {

        const obj = await this.send("getcolordefaults");

        this.ColorDefaults = [];
        for (const hsObj of (obj["colordefaults"]?.["hsdefaults"]?.["hs"] || [])) {
            for (const color of (hsObj["color"] || [])) {
                this.ColorDefaults.push([
                    parseInt(color["@hue"]),
                    parseInt(color["@sat"] || color["@saturation"]),
                    parseInt(color["@val"] || color["@value"])
                ]);
            }
        }

        this.TemperatureDefaults = [];
        for (const tempObj of (obj["colordefaults"]?.["temperaturedefaults"]?.["temp"] || [])) {
            this.TemperatureDefaults.push(
                parseInt(tempObj["@val"] || tempObj["@value"])
            );
        }
    }

    /**
     * Compose the URL for a command
     * @param {string}  switchcmd - The command
     * @param {?Object} params    - Command parameters as key/value
     * @private
     */
    getURLForSwitchcmd(switchcmd, params = null) {

        let searchParams = `?sid=${this.SID}&switchcmd=${switchcmd}`;

        if (params !== null) {
            for (const key of Object.keys(params)) {
                searchParams = searchParams + `&${key}=${encodeURIComponent(params[key])}`;
            }
        }

        return new URL(searchParams, this.serviceURL);
    }

    /**
     * Create services and characteristics for unknown devices
     * @param   {Object} device - Device description from getdevicelistinfos
     * @returns {Object}        - Device services[] and characteristics[]
     * @public
     */
    getServicesAndCharacteristics(device) {

        const bitmask = parseInt(device["@functionbitmask"]);
        const unitType = parseInt(device["etsiunitinfo"]?.["unittype"]);

        // The following order of services is opinionated!

        const services = [
            "WindowCovering",
            "Thermostat",
            "Outlet",
            "Lightbulb",
            "Switch",
            "ContactSensor",
            "LeakSensor",
            "MotionSensor",
            "TemperatureSensor",
            "HumiditySensor",
        ];


        // Get services

        let deviceReportedServices = [];

        if (bitmask & (1 << 13)) { // Bit 13 = HAN-FUN Unit
            deviceReportedServices = this.getServiceFromUnitType(unitType);
        } else {
            deviceReportedServices = this.getServicesFromBitmask(bitmask);
        }

        // Pick the FIRST one that matches as primary service
        const primaryService = [];
        for (const service of services) {
            const match = deviceReportedServices.find((element) => element === service);
            if (match) {
                primaryService.push(match);
                break;
            }
        }

        // Pick ANY other that matches as secondary service
        const secondaryServices = [];
        for (const service of services) {
            const match = deviceReportedServices.find((element) => element === service);
            if (match && !primaryService.includes(match)) {
                secondaryServices.push(match);
            }
        }

        deviceReportedServices = primaryService.concat(secondaryServices);


        // Get characteristics

        let deviceReportedCharacteristics = [];

        if (deviceReportedServices.includes("Lightbulb")) {
            deviceReportedCharacteristics = this.getLightbulbCharacteristics(device);
        }

        return {
            services: deviceReportedServices,
            characteristics: deviceReportedCharacteristics
        };
    }

    /**
     * Map FRITZ!Box device types to Homebridge services
     * @param   {number} bitmask - Bitmask describing device capabilities
     * @returns {Array}          - Array of Homebridge services
     * @private
     */
    getServicesFromBitmask(bitmask) {

        // Currently only a limited mapping, because
        // I don't have devices to test

        const services = [
            null,                 // Bit  0: HAN-FUN Device
            null,                 // Bit  1: ZigBee Device (see AHA-HTTP-Interface, 1.2.1)
            "Lightbulb",          // Bit  2: Lightbulb
            null,                 // Bit  3: -
            null,                 // Bit  4: AlarmSensor ??? whatever this is
            null,                 // Bit  5: AVM Button
            "Thermostat",         // Bit  6: AVM Thermostat
            null,                 // Bit  7: AVM Energy Meter
            "TemperatureSensor",  // Bit  8: Temperature Sensor
            "Outlet",             // Bit  9: AVM Outlet
            null,                 // Bit 10: AVM DECT Repeater
            null,                 // Bit 11: AVM Microphone
            null,                 // Bit 12: -
            null,                 // Bit 13: HAN-FUN Unit
            null,                 // Bit 14: -
            "Switch",             // Bit 15: Generic switchable device (outlet, lightbulb, etc.)
            null,                 // Bit 16: Generic level device (lightbulb, blinds, etc.) - impossible to decide
            "Lightbulb",          // Bit 17: Color Lightbulb
            "WindowCovering",     // Bit 18: Blinds
            null,                 // Bit 19: -
            "HumiditySensor"      // Bit 20: Humidity Sensor
        ];

        // https://www.geeksforgeeks.org/check-if-a-given-bit-is-set-or-not-using-javascript/
        return services.filter((element, index) => element !== null && (bitmask & (1 << index)));
    }

    /**
     * Map FRITZ!Box HAN-FUN unit types to Homebridge service
     * @param   {number} unitType - HAN-FUN unit type
     * @returns {Array}           - 1 element Array with Homebridge service or empty
     * @private
     */
    getServiceFromUnitType(unitType) {

        // HAN-FUN Unit Types

        const services = new Map([
            [273, null],              // SIMPLE_BUTTON
            [256, "Switch"],          // SIMPLE_ON_OFF_SWITCHABLE
            [262, "Outlet"],          // AC_OUTLET
            [257, "Switch"],          // SIMPLE_ON_OFF_SWITCH
            [263, "Outlet"],          // AC_OUTLET_SIMPLE_POWER_METERING
            [264, "Lightbulb"],       // SIMPLE_LIGHT
            [265, "Lightbulb"],       // DIMMABLE_LIGHT
            [266, "Lightbulb"],       // DIMMER_SWITCH
            [277, "Lightbulb"],       // COLOR_BULB
            [278, "Lightbulb"],       // DIMMABLE_COLOR_BULB
            [281, "WindowCovering"],  // BLIND
            [282, "WindowCovering"],  // LAMELLAR
            [512, "ContactSensor"],   // SIMPLE_DETECTOR
            [513, "ContactSensor"],   // DOOR_OPEN_CLOSE_DETECTOR
            [514, "ContactSensor"],   // WINDOW_OPEN_CLOSE_DETECTOR
            [515, "MotionSensor"],    // MOTION_DETECTOR
            [518, "LeakSensor"],      // FLOOD_DETECTOR
            [519, null],              // GLAS_BREAK_DETECTOR
            [520, null],              // VIBRATION_DETECTOR
            [640, null]               // SIREN
        ]);

        if (services.get(unitType)) {
            return [services.get(unitType)];
        } else {
            return [];
        }
    }

    /**
     * Return Homebridge lightbulb characteristics
     * @param   {Object} device - Device description from getdevicelistinfos
     * @returns {Array}         - Array of Homebridge characteristics
     * @private
     */
    getLightbulbCharacteristics(device) {

        const characteristics = [];

        // Brightness

        if (
            device["levelcontrol"]?.["level"] !== undefined
            || device["levelcontrol"]?.["levelpercentage"] !== undefined
        ) {
            characteristics.push("Brightness");
        }

        // ColorTemperature OR Hue/Saturation

        // const supportedModes = parseInt(device["colorcontrol"]?.["@supported_modes"]);
        // const supportsHueSaturation = (supportedModes & (1 << 0));
        // const supportsColorTemperature = (supportedModes & (1 << 2));
        // const fullColorSupport = parseInt(device["colorcontrol"]?.["@fullcolorsupport"] || 0);
        const currentMode = parseInt(device["colorcontrol"]?.["@current_mode"] || 0);
        const mapped = parseInt(device["colorcontrol"]?.["@mapped"] || 0);

        if (currentMode === 1) {
            characteristics.push("Hue", "Saturation");
        } else if (currentMode === 4) {
            characteristics.push("ColorTemperature");
        }

        if (mapped) {
            characteristics.push("UseMappedColor");
        }

        return characteristics;
    }

    /**
     * Sets the HTTPS port
     * @param {number} port - Port number
     * @public
     */
    setSecurityPort(port) {
        this.loginURL.protocol = "https:";
        this.loginURL.port = port;
        this.serviceURL.protocol = "https:";
        this.serviceURL.port = port;
    }

    /**
     * Sets the username used for authentication
     * @param {string} username
     * @public
     */
    setDefaultUser(username) {
        this.username = username;
    }
}

module.exports = SmartHome;
