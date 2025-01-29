/**
 * windowcovering.js
 * homebridge-fritzbox
 *
 * @copyright 2025 Hendrik Meinl
 */

"use strict";

const Accessory = require("./accessory");

/**
 * WindowCovering
 * @extends Accessory
 */
class WindowCovering extends Accessory {

    constructor(platform, accessory, smarthome) {

        super(platform, accessory);

        this.smarthome = smarthome;


        // WindowCovering

        this.windowCovering = this.accessory.getService(this.Service.WindowCovering) || this.accessory.addService(this.Service.WindowCovering);

        this.windowCovering.setCharacteristic(this.Characteristic.Name, this.accessory.displayName);


        // Required characteristics

        this.accessory.context.device.state.CurrentPosition = 100;
        this.windowCovering.getCharacteristic(this.Characteristic.CurrentPosition)
            .onGet(this.onGetCurrentPosition.bind(this));

        this.accessory.context.device.state.PositionState = 2;
        this.windowCovering.getCharacteristic(this.Characteristic.PositionState)
            .onGet(this.onGetPositionState.bind(this));

        this.accessory.context.device.state.TargetPosition = 100;
        this.windowCovering.getCharacteristic(this.Characteristic.TargetPosition)
            .onGet(this.onGetTargetPosition.bind(this))
            .onSet(this.onSetTargetPosition.bind(this));


        // Optional characteristics

        this.accessory.context.device.state.ObstructionDetected = false;
        this.windowCovering.getCharacteristic(this.Characteristic.ObstructionDetected)
            .onGet(this.onGetObstructionDetected.bind(this));


        // Add secondary services

        this.addSecondaryServices(this.accessory.context.device.services.slice(1));
    }

    onGetCurrentPosition() {
        return this.accessory.context.device.state.CurrentPosition;
    }

    onGetPositionState() {
        return this.accessory.context.device.state.PositionState;
    }

    onGetTargetPosition() {
        return this.accessory.context.device.state.TargetPosition;
    }

    onSetTargetPosition(value) {

        // Everything that is some kind of "level" should be defered
        // to avoid "flooding" the FRITZ!Box with intermediate values
        // maybe 800ms is still too short

        if (this.deferChange) {
            clearTimeout(this.deferChange);
        }

        this.deferChange = setTimeout(() => {

            // Get our own (internal) state in case we need to undo
            const currentValue = this.accessory.context.device.state.TargetPosition;

            // Send command
            try {

                // Set our own (internal) state
                this.accessory.context.device.state.TargetPosition = value;

                // setlevel: { level: 0-255 (0-100%) }
                // setlevelpercentage: { level: 0-100 (0-100%) }
                this.smarthome.send("setlevelpercentage", { ain: this.accessory.context.device.identifier, level: value }).then(() => {
                    this.log.info(`Setting ${this.accessory.displayName} to ${value}%`);
                });

            } catch (error) {

                // Revert internal state in case of error
                this.accessory.context.device.state.TargetPosition = currentValue;

                this.log.error(`${this.accessory.displayName}:`, error.message || error);
            }
        }, 800);
    }

    onGetObstructionDetected() {
        return this.accessory.context.device.state.ObstructionDetected;
    }

    /**
     * Update accessory characteristics
     * @param {Object} state - Current smart home device state
     * @see FritzBoxPlatform#updateDevices
     */
    update(state) {

        super.update(state);


        // Get current values

        let CurrentPosition = this.accessory.context.device.state.CurrentPosition;
        let PositionState = this.accessory.context.device.state.PositionState;
        let ObstructionDetected = this.accessory.context.device.state.ObstructionDetected;


        // CurrentPosition

        if (state["levelcontrol"]?.["level"] !== undefined) {
            CurrentPosition = Math.round(100 / 255 * parseInt(state["levelcontrol"]["level"]));
        } else if (state["levelcontrol"]?.["levelpercentage"] !== undefined) {
            CurrentPosition = parseInt(state["levelcontrol"]["levelpercentage"]);
        } else {
            // oops!
        }


        // PositionState

        const TargetPosition = this.accessory.context.device.state.TargetPosition;
        PositionState = (CurrentPosition !== TargetPosition) ? ((CurrentPosition > TargetPosition) ? 0 : 1) : 2;


        // ObstructionDetected

        // <alert><state>0/1 (bitmask 00000001 = obstruction detected)
        const alert = parseInt(state["alert"]?.["state"] || 0);
        ObstructionDetected = (alert & 1) === 1 ? true : false;


        this.accessory.context.device.state.CurrentPosition = CurrentPosition;
        this.accessory.context.device.state.PositionState = PositionState;
        this.accessory.context.device.state.ObstructionDetected = ObstructionDetected;

        this.windowCovering.updateCharacteristic(this.Characteristic.CurrentPosition, CurrentPosition);
        this.windowCovering.updateCharacteristic(this.Characteristic.PositionState, PositionState);
        this.windowCovering.updateCharacteristic(this.Characteristic.ObstructionDetected, ObstructionDetected);

        this.api.updatePlatformAccessories([this.accessory]);
    }
}

module.exports = WindowCovering;
