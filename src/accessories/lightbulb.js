/**
 * lightbulb.js
 * homebridge-fritzbox
 *
 * @copyright 2025 Hendrik Meinl
 */

"use strict";

const Accessory = require("./accessory");

/**
 * Lightbulb
 * @extends Accessory
 */
class Lightbulb extends Accessory {

    constructor(platform, accessory, smarthome) {

        super(platform, accessory);

        this.smarthome = smarthome;


        // Lightbulb

        this.lightbulb = this.accessory.getService(this.Service.Lightbulb) || this.accessory.addService(this.Service.Lightbulb);

        this.lightbulb.setCharacteristic(this.Characteristic.Name, this.accessory.displayName);

        this.accessory.context.device.state.On = 0;
        this.lightbulb.getCharacteristic(this.Characteristic.On)
            .onGet(this.getOn.bind(this))
            .onSet(this.setOn.bind(this));


        // TODO: Add lightbulb characteristics
        // And here goes our fancy code for Brightness/ColorTemperature/Hue/Saturation
        // Anyone willing to send me some test devices?


        // Set as primary service, as the parent class might have added additional services
        this.lightbulb.setPrimaryService(true);
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

            const newValue = response.trim() === "1" ? true : false;

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
        this.lightbulb.updateCharacteristic(this.Characteristic.On, this.accessory.context.device.state.On);

        this.api.updatePlatformAccessories([this.accessory]);
    }
}

module.exports = Lightbulb;
