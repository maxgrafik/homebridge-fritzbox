/**
 * thermostat.js
 * homebridge-fritzbox
 *
 * @copyright 2025 Hendrik Meinl
 */

"use strict";

const Accessory = require("./accessory");

/**
 * Thermostat
 * @extends Accessory
 */
class Thermostat extends Accessory {

    constructor(platform, accessory, aha) {

        super(platform, accessory);

        this.aha = aha;


        // Thermostat

        this.thermostat = this.accessory.getService(this.Service.Thermostat) || this.accessory.addService(this.Service.Thermostat);

        this.thermostat.setCharacteristic(this.Characteristic.Name, this.accessory.displayName);


        // Required characteristics

        this.accessory.context.device.state.CurrentHeatingCoolingState = 0;
        this.thermostat.getCharacteristic(this.Characteristic.CurrentHeatingCoolingState)
            .onGet(this.onGetCurrentState.bind(this));

        this.accessory.context.device.state.TargetHeatingCoolingState = 0;
        this.thermostat.getCharacteristic(this.Characteristic.TargetHeatingCoolingState)
            .onGet(this.onGetTargetState.bind(this))
            .onSet(this.onSetTargetState.bind(this));

        // Hide heating/cooling options from target state
        this.thermostat.getCharacteristic(this.Characteristic.TargetHeatingCoolingState).setProps({
            validValues: [0, 3],
        });

        this.accessory.context.device.state.CurrentTemperature = 0;
        this.thermostat.getCharacteristic(this.Characteristic.CurrentTemperature)
            .onGet(this.onGetCurrentTemperature.bind(this));

        this.accessory.context.device.state.TargetTemperature = 0;
        this.thermostat.getCharacteristic(this.Characteristic.TargetTemperature)
            .onGet(this.onGetTargetTemperature.bind(this))
            .onSet(this.onSetTargetTemperature.bind(this));

        // Set temperature range (Celsius)
        this.thermostat.getCharacteristic(this.Characteristic.TargetTemperature).setProps({
            minValue: 8,
            maxValue: 28,
            minStep: 0.5,
        });


        /**
         * NOTE
         * TemperatureDisplayUnits is meant to control the units used on a physical thermostat display
         * HomeKit is ALWAYS celsius. The conversion between °C and °F is done by HomeKit depending on
         * system settings.
         */

        this.accessory.context.device.state.TemperatureDisplayUnits = 0;
        this.thermostat.getCharacteristic(this.Characteristic.TemperatureDisplayUnits)
            .onGet(this.onGetTemperatureDisplayUnits.bind(this))
            .onSet(this.onGetTemperatureDisplayUnits.bind(this));


        // Add secondary services

        this.addSecondaryServices(this.accessory.context.device.services.slice(1));
    }

    onGetCurrentState() {
        return this.accessory.context.device.state.CurrentHeatingCoolingState;
    }

    onGetTargetState() {
        return this.accessory.context.device.state.TargetHeatingCoolingState;
    }

    onSetTargetState(value) {

        // Get our own (internal) state in case we need to undo
        const currentValue = this.accessory.context.device.state.TargetHeatingCoolingState;

        // Set our own (internal) state
        this.accessory.context.device.state.TargetHeatingCoolingState = value;

        if (value === 0) {

            // Send command
            this.aha.send("sethkrtsoll", { ain: this.accessory.context.device.identifier, param: 253 }).then(() => {

                this.log.info(`${this.accessory.displayName} was switched off`);

            }).catch((error) => {

                // Revert internal state in case of error
                this.accessory.context.device.state.TargetHeatingCoolingState = currentValue;
                this.thermostat.updateCharacteristic(this.Characteristic.TargetHeatingCoolingState, currentValue);

                this.log.error(`${this.accessory.displayName}:`, error.message || error);
            });

        } else if (value === 3) {

            const temperature = Math.round(Math.max(8, Math.min(28, this.accessory.context.device.state.TargetTemperature)) * 2) / 2;

            // Send command
            this.aha.send("sethkrtsoll", { ain: this.accessory.context.device.identifier, param: (temperature * 2) }).then(() => {

                this.log.info(`${this.accessory.displayName} was switched on`);

            }).catch((error) => {

                // Revert internal state in case of error
                this.accessory.context.device.state.TargetHeatingCoolingState = currentValue;
                this.thermostat.updateCharacteristic(this.Characteristic.TargetHeatingCoolingState, currentValue);

                this.log.error(`${this.accessory.displayName}:`, error.message || error);
            });
        }
    }

    onGetCurrentTemperature() {
        return this.accessory.context.device.state.CurrentTemperature;
    }

    onGetTargetTemperature() {
        return this.accessory.context.device.state.TargetTemperature;
    }

    onSetTargetTemperature(value) {

        // Everything that is some kind of "level" should be defered
        // to avoid "flooding" the FRITZ!Box with intermediate values
        // maybe 800ms is still too short

        if (this.deferChange) {
            clearTimeout(this.deferChange);
        }

        this.deferChange = setTimeout(() => {

            // Get our own (internal) state in case we need to undo
            const currentValue = this.accessory.context.device.state.TargetTemperature;

            // hkrtsoll parameter: 16-56 (= 8-28°C) in steps of 0.5°C, 254 = ON, 253 = OFF
            const hkrtsoll = Math.round(Math.max(8, Math.min(28, value)) * 2);

            // Set our own (internal) state
            this.accessory.context.device.state.TargetTemperature = (hkrtsoll/2);

            // Send command
            this.aha.send("sethkrtsoll", { ain: this.accessory.context.device.identifier, param: hkrtsoll }).then(() => {

                this.log.info(`${this.accessory.displayName} was set to ${(hkrtsoll/2)}°C`);

            }).catch((error) => {

                // Revert internal state in case of error
                this.accessory.context.device.state.TargetTemperature = currentValue;
                this.thermostat.updateCharacteristic(this.Characteristic.TargetTemperature, currentValue);

                this.log.error(`${this.accessory.displayName}:`, error.message || error);
            });

        }, 800);
    }

    onGetTemperatureDisplayUnits() {
        return this.accessory.context.device.state.TemperatureDisplayUnits;
    }

    onSetTemperatureDisplayUnits(/* value */) {
        // Not documented whether this can actually be set
        // this.accessory.context.device.state.TemperatureDisplayUnits = value;
    }

    update(state) {

        super.update(state);


        // Get current values

        let CurrentHeatingCoolingState = this.accessory.context.device.state.CurrentHeatingCoolingState;
        let TargetHeatingCoolingState = this.accessory.context.device.state.TargetHeatingCoolingState;
        let CurrentTemperature = this.accessory.context.device.state.CurrentTemperature;
        let TargetTemperature = this.accessory.context.device.state.TargetTemperature;


        // CurrentTemperature

        // FRITZ!Box values: 0-120 (= 0-60°C) in steps of 0.5°C, 254 = ON , 253 = OFF, may be empty
        const hkr_tist = state["hkr"]?.["tist"];
        if (hkr_tist >= 0 && hkr_tist <= 120) {
            CurrentTemperature = parseInt(hkr_tist) / 2;
        } else {
            const celsius = state["temperature"]?.["celsius"];
            const offset = state["temperature"]?.["offset"];
            if (celsius !== undefined && offset !== undefined) {
                CurrentTemperature = parseInt(celsius + offset) / 10;
            }
        }


        // TargetTemperature

        // FRITZ!Box values: 16-56 (= 8-28°C) in steps of 0.5°C, 254 = ON, 253 = OFF, may be empty
        const hkr_tsoll = state["hkr"]?.["tsoll"];
        if (hkr_tsoll >= 16 && hkr_tsoll <= 56) {
            TargetTemperature = parseInt(hkr_tsoll) / 2;
            TargetHeatingCoolingState = 3;
        } else if (hkr_tsoll === 253) {
            // I guess "OFF" as target temperature means the thermostat is actually off?
            TargetHeatingCoolingState = 0;
        } else if (hkr_tsoll === 254) {
            // What does "ON" as target temperature mean? Boost?
            TargetHeatingCoolingState = 3;
        }


        // CurrentHeatingCoolingState

        CurrentHeatingCoolingState = (CurrentTemperature !== TargetTemperature) ? ((CurrentTemperature > TargetTemperature) ? 2 : 1) : 0;


        this.accessory.context.device.state.CurrentHeatingCoolingState = CurrentHeatingCoolingState;
        this.accessory.context.device.state.TargetHeatingCoolingState = TargetHeatingCoolingState;
        this.accessory.context.device.state.CurrentTemperature = CurrentTemperature;
        this.accessory.context.device.state.TargetTemperature = TargetTemperature;

        this.thermostat.updateCharacteristic(this.Characteristic.CurrentHeatingCoolingState, CurrentHeatingCoolingState);
        this.thermostat.updateCharacteristic(this.Characteristic.TargetHeatingCoolingState, TargetHeatingCoolingState);
        this.thermostat.updateCharacteristic(this.Characteristic.CurrentTemperature, CurrentTemperature);
        this.thermostat.updateCharacteristic(this.Characteristic.TargetTemperature, TargetTemperature);

        this.api.updatePlatformAccessories([this.accessory]);
    }
}

module.exports = Thermostat;
