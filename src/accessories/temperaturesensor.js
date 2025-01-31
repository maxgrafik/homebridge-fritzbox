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

        super(platform, accessory);

        // TemperatureSensors can already be handled by parent class

        // Add first, so it becomes the primary service
        this.addSecondaryServices(["TemperatureSensor"]);

        // Add any other as secondary service
        this.addSecondaryServices(this.accessory.context.device.services.slice(1));
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
