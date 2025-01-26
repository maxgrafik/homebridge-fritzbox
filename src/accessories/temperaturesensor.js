/**
 * temperaturesensor.js
 * homebridge-fritzbox
 *
 * @copyright 2025 Hendrik Meinl
 */

"use strict";

const Accessory = require("./accessory");

/**
 * TemperatureSensor
 * @extends Accessory
 */
class TemperatureSensor extends Accessory {

    constructor(platform, accessory) {

        // TemperatureSensors can already be handled by parent class
        // So we only tell the parent class to make it primary

        super(platform, accessory, "TemperatureSensor");
    }

    /**
     * Update accessory characteristics
     * @param {Object} state - Current smart home device state
     * @see FritzBoxPlatform#updateDevices
     */
    update(state) {
        super.update(state);
        this.api.updatePlatformAccessories([this.accessory]);
    }
}

module.exports = TemperatureSensor;
