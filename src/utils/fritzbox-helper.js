/**
 * fritzbox-helper.js
 * homebridge-fritzbox
 *
 * @copyright 2025 Hendrik Meinl
 */

"use strict";

const HomeKitHelper = require("./homekit-helper");

class FritzBoxHelper {

    constructor() {
        this.ColorDefaults = [];
        this.TemperatureDefaults = [];
    }

    /**
    * Get HomeKit services and characteristics for unknown devices
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
            "EnergyMeter",
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
        // starting with sensors, because the first services
        // are considered mutually exclusive
        const secondaryServices = [];
        for (const service of services.slice(5)) {
            const match = deviceReportedServices.find((element) => element === service);
            if (match && !primaryService.includes(match)) {
                secondaryServices.push(match);
            }
        }

        deviceReportedServices = primaryService.concat(secondaryServices);


        // Add Battery service (if any)

        if (Object.hasOwn(device, "batterylow") || Object.hasOwn(device, "battery")) {
            deviceReportedServices.push("Battery");
        }


        // Get characteristics

        let deviceReportedCharacteristics = [];

        if (deviceReportedServices.includes("Lightbulb")) {
            deviceReportedCharacteristics = this.getLightbulbCharacteristics(device);
        }


        // Add BatteryLevel characteristic (if available)

        if (Object.hasOwn(device, "battery")) {
            deviceReportedCharacteristics.push("BatteryLevel");
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

        const services = [
            null,                 // Bit  0: HAN-FUN Device
            null,                 // Bit  1: ZigBee Device (see AHA-HTTP-Interface, 1.2.1)
            "Lightbulb",          // Bit  2: Lightbulb
            null,                 // Bit  3: -
            null,                 // Bit  4: AlarmSensor ??? whatever this is
            null,                 // Bit  5: AVM Button
            "Thermostat",         // Bit  6: AVM Thermostat
            "EnergyMeter",        // Bit  7: AVM Energy Meter
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

        const supportedModes = parseInt(device["colorcontrol"]?.["@supported_modes"]);
        const supportsHueSaturation = (supportedModes & (1 << 0));
        const supportsColorTemperature = (supportedModes & (1 << 2));
        // const fullColorSupport = parseInt(device["colorcontrol"]?.["@fullcolorsupport"] || 0);
        const currentMode = parseInt(device["colorcontrol"]?.["@current_mode"] || 0);
        const mapped = parseInt(device["colorcontrol"]?.["@mapped"] || 0);

        if (supportsHueSaturation || currentMode === 1) {
            characteristics.push("Hue", "Saturation");
        }

        if (supportsColorTemperature || currentMode === 4) {
            characteristics.push("ColorTemperature");
        }

        if (mapped) {
            characteristics.push("UseMappedColor");
        }

        return characteristics;
    }

    /**
    * Get ColorDefaults for colored Lightbulbs
    * @param {class} aha - Instance of AHA module
    * @public
    */
    async getColorDefaults(aha) {

        // Don't load twice
        if (this.ColorDefaults.length !== 0) {
            return;
        }

        const obj = await aha.send("getcolordefaults");

        for (const hsObj of (obj["colordefaults"]?.["hsdefaults"]?.["hs"] || [])) {
            for (const color of (hsObj["color"] || [])) {
                this.ColorDefaults.push([
                    parseInt(color["@hue"]),
                    parseInt(color["@sat"] || color["@saturation"]),
                    parseInt(color["@val"] || color["@value"])
                ]);
            }
        }

        for (const tempObj of (obj["colordefaults"]?.["temperaturedefaults"]?.["temp"] || [])) {
            this.TemperatureDefaults.push(
                parseInt(tempObj["@val"] || tempObj["@value"])
            );
        }
    }

    /**
    * Get closest FRITZ!Box HSV color
    * @param   {Array} colorHK - HomeKit HSV values ([0-360, 0-100, 0-100])
    * @returns {Array}         - FRITZ!Box HSV values ([0-359, 0-255, 0-255])
    * @public
    */
    getClosestColor(colorHK) {

        // https://stackoverflow.com/questions/35113979/calculate-distance-between-colors-in-hsv-space#39113477

        // Normalize HomeKit values
        const hueHK = colorHK[0] * (Math.PI * 2) / 360;
        const satHK = colorHK[1] / 100;
        const valHK = colorHK[2] / 100;

        // Get squared cartesian distance
        const distanceHSV = (colorFB) => {

            // Normalize FRITZ!Box values
            const hueFB = colorFB[0] * (Math.PI * 2) / 360;
            const satFB = colorFB[1] / 255;
            const valFB = colorFB[2] / 255;

            return (
                Math.pow((Math.sin(hueHK)*satHK*valHK)-(Math.sin(hueFB)*satFB*valFB), 2) +
                Math.pow((Math.cos(hueHK)*satHK*valHK)-(Math.cos(hueFB)*satFB*valFB), 2) +
                Math.pow(valHK-valFB, 2)
            );
        };

        // Find closest color
        const distances = [];
        this.ColorDefaults.forEach((color, index) => {
            const distance = distanceHSV(color);
            distances.push({ distance: distance, index: index });
        });
        distances.sort((a, b) => a.distance - b.distance);

        // Return matching FRITZ!Box color default
        return this.ColorDefaults[distances[0].index];
    }

    /**
    * Get closest FRITZ!Box color temperature
    * @param   {number} temp - Temperature in Mired
    * @returns {number}      - Temperature in Kelvin
    * @public
    */
    getClosestColorTemperature(temp) {

        // Convert Mired to Kelvin
        const tempKelvin = HomeKitHelper.MiredToKelvin(temp);

        // Find closest FRITZ!Box color temperature
        return this.TemperatureDefaults.reduce((prev, curr) => {
            return (Math.abs(curr - tempKelvin) < Math.abs(prev - tempKelvin) ? curr : prev);
        });
    }
}

// Taking advantage of Node.js module caching
// this effectively creates a Singleton

module.exports = new FritzBoxHelper();
