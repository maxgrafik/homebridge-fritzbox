/**
 * switch.js
 * homebridge-fritzbox
 *
 * @copyright 2025 Hendrik Meinl
 */

"use strict";

const Accessory = require("./accessory");

/**
 * Switch
 * @extends Accessory
 */
class Switch extends Accessory {

    constructor(platform, accessory, aha) {

        super(platform, accessory);

        this.aha = aha;


        // Switch

        this.switchService = this.accessory.getService(this.Service.Switch) || this.accessory.addService(this.Service.Switch);

        this.switchService.setCharacteristic(this.Characteristic.Name, this.accessory.displayName);

        this.accessory.context.device.state.On = false;
        this.switchService.getCharacteristic(this.Characteristic.On)
            .onGet(this.getOn.bind(this))
            .onSet(this.setOn.bind(this));


        // Add secondary services

        this.addSecondaryServices(this.accessory.context.device.services.slice(1));
    }

    getOn() {
        return this.accessory.context.device.state.On;
    }

    setOn(value) {

        // Skip, if value doesn't change
        if (value === this.accessory.context.device.state.On) {
            return;
        }

        // Set our own (internal) state
        this.accessory.context.device.state.On = value;

        // Send switch on/off command
        const switchcmd = value ? "setswitchon" : "setswitchoff";
        this.aha.send(switchcmd, { ain: this.accessory.context.device.identifier }).then((response) => {

            const newValue = parseInt(response) ? true : false;

            this.log.info(`${this.accessory.displayName} was switched`, newValue ? "on" : "off");

        }).catch((error) => {

            // Revert internal state in case of error
            this.accessory.context.device.state.On = !this.accessory.context.device.state.On;
            this.switchService.updateCharacteristic(this.Characteristic.On, this.accessory.context.device.state.On);

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

        let isOn = this.accessory.context.device.state.On;
        if (state["switch"]?.["state"] !== undefined) {
            isOn = parseInt(state["switch"]["state"]) === 1;
        } else if (state["simpleonoff"]?.["state"] !== undefined) {
            isOn = parseInt(state["simpleonoff"]["state"]) === 1;
        } else {
            // oops!
        }

        this.accessory.context.device.state.On = isOn;
        this.switchService.updateCharacteristic(this.Characteristic.On, this.accessory.context.device.state.On);

        this.api.updatePlatformAccessories([this.accessory]);
    }
}

module.exports = Switch;
