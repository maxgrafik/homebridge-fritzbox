/**
 * outlet.js
 * homebridge-fritzbox
 *
 * @copyright 2025 Hendrik Meinl
 */

"use strict";

const Accessory = require("./accessory");

/**
 * Outlet
 * @extends Accessory
 */
class Outlet extends Accessory {

    constructor(platform, accessory, smarthome) {

        super(platform, accessory);

        this.smarthome = smarthome;


        // Outlet

        this.outlet = this.accessory.getService(this.Service.Outlet) || this.accessory.addService(this.Service.Outlet);

        this.outlet.setCharacteristic(this.Characteristic.Name, this.accessory.displayName);

        this.accessory.context.device.state.On = 0;
        this.outlet.getCharacteristic(this.Characteristic.On)
            .onGet(this.getOn.bind(this))
            .onSet(this.setOn.bind(this));


        // Add secondary services

        this.addSecondaryServices(this.accessory.context.device.services.slice(1));
    }

    getOn() {
        return this.accessory.context.device.state.On;
    }

    setOn(value) {

        // Set our own (internal) state
        this.accessory.context.device.state.On = value;

        // Send switch on/off command
        const switchcmd = value ? "setswitchon" : "setswitchoff";
        this.smarthome.send(switchcmd, { ain: this.accessory.context.device.identifier }).then((response) => {

            const newValue = parseInt(response) ? true : false;

            this.log.info(`${this.accessory.displayName} was switched`, newValue ? "on" : "off");

        }).catch((error) => {

            // Revert internal state in case of error
            this.accessory.context.device.state.On = !this.accessory.context.device.state.On;

            this.log.error(`${this.accessory.displayName}:`, error.message || error);
        });
    }

    /**
     * Update accessory characteristics
     * @param {Object} state - Current smart home device state
     * @see FritzBoxPlatform#updateDevices
     */
    update(state) {

        super.update(state);

        let isOn = 0;
        if (state["switch"]?.["state"] !== undefined) {
            isOn = parseInt(state["switch"]["state"]);
        } else if (state["simpleonoff"]?.["state"] !== undefined) {
            isOn = parseInt(state["simpleonoff"]["state"]);
        } else {
            // oops!
        }

        this.accessory.context.device.state.On = (isOn === 1) ? true : false;
        this.outlet.updateCharacteristic(this.Characteristic.On, this.accessory.context.device.state.On);

        this.api.updatePlatformAccessories([this.accessory]);
    }
}

module.exports = Outlet;
