/**
 * humiditysensor.js
 * homebridge-fritzbox
 *
 * @copyright 2025 Hendrik Meinl
 */

"use strict";

const Accessory = require("./accessory");

/**
 * HumiditySensor
 * @extends Accessory
 */
class HumiditySensor extends Accessory {

    constructor(platform, accessory) {

        // HumiditySensors can already be handled by parent class
        // So we only tell the parent class to make it primary

        super(platform, accessory, "HumiditySensor");
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

module.exports = HumiditySensor;
