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
        // so we add it as secondary service without having a primary

        this.addSecondaryServices(this.accessory.context.device.services);
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
