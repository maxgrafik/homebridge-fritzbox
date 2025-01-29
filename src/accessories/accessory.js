/**
 * accessory.js
 * homebridge-fritzbox
 *
 * @copyright 2025 Hendrik Meinl
 */

"use strict";

/**
 * Base class for all smart home accessories
 * Manages additional services besides an accessory's primary service
 */
class Accessory {

    constructor(platform, accessory) {

        this.platform = platform;
        this.accessory = accessory;

        this.log = platform.log;
        this.api = platform.api;

        this.Service = platform.api.hap.Service;
        this.Characteristic = platform.api.hap.Characteristic;


        // Accessory information

        this.accessory.getService(this.Service.AccessoryInformation)
            .setCharacteristic(this.Characteristic.Manufacturer, this.accessory.context.device.manufacturer)
            .setCharacteristic(this.Characteristic.SerialNumber, this.accessory.context.device.serialNo)
            .setCharacteristic(this.Characteristic.Model, this.accessory.context.device.model)
            .setCharacteristic(this.Characteristic.FirmwareRevision, this.accessory.context.device.fwversion);
    }

    addSecondaryServices(services) {

        if (services.length === 0) {
            return;
        }


        // Since manufacturers nowadays put all kinds of sensors into our smart home devices
        // (whether they make sense or not), we delegate handling of the more common ones into
        // the parent Accessory class, so we don't have to deal with them in every child class.


        // TemperatureSensor (if any)

        if (services.includes("TemperatureSensor")) {

            this.temperatureSensor = this.accessory.getService(this.Service.TemperatureSensor) || this.accessory.addService(this.Service.TemperatureSensor);

            this.temperatureSensor.setCharacteristic(this.Characteristic.Name, this.accessory.displayName);

            this.accessory.context.device.state.CurrentTemperature = 0;
            this.temperatureSensor.getCharacteristic(this.Characteristic.CurrentTemperature)
                .onGet(this.onGetCurrentTemperature.bind(this));
        }


        // HumiditySensor (if any)

        if (services.includes("HumiditySensor")) {

            this.humiditySensor = this.accessory.getService(this.Service.HumiditySensor) || this.accessory.addService(this.Service.HumiditySensor);

            this.humiditySensor.setCharacteristic(this.Characteristic.Name, this.accessory.displayName);

            this.accessory.context.device.state.CurrentRelativeHumidity = 0;
            this.humiditySensor.getCharacteristic(this.Characteristic.CurrentRelativeHumidity)
                .onGet(this.onGetCurrentRelativeHumidity.bind(this));
        }


        // Battery (if any)

        if (services.includes("Battery")) {

            this.battery = this.accessory.getService(this.Service.Battery) || this.accessory.addService(this.Service.Battery);

            // Required characteristics for Battery
            this.accessory.context.device.state.StatusLowBattery = 0;
            this.battery.getCharacteristic(this.Characteristic.StatusLowBattery)
                .onGet(this.onGetStatusLowBattery.bind(this));

            // Optional characteristics for Battery
            if (this.accessory.context.device.characteristics.includes("BatteryLevel")) {
                this.accessory.context.device.state.BatteryLevel = 100;
                this.battery.getCharacteristic(this.Characteristic.BatteryLevel)
                    .onGet(this.onGetBatteryLevel.bind(this));
            }
        }
    }

    onGetCurrentTemperature() {
        return this.accessory.context.device.state.CurrentTemperature;
    }

    onGetCurrentRelativeHumidity() {
        return this.accessory.context.device.state.CurrentRelativeHumidity;
    }

    onGetStatusLowBattery() {
        return this.accessory.context.device.state.StatusLowBattery;
    }

    onGetBatteryLevel() {
        return this.accessory.context.device.state.BatteryLevel;
    }

    /**
     * Update accessory characteristics
     * @param {Object} state - Current smart home device state
     * @see FritzBoxPlatform#updateDevices
     */
    update(state) {

        // Accessory information (FirmwareRevision)

        const fwversion = state["@fwversion"];
        if (fwversion !== undefined && fwversion !== this.accessory.context.device.fwversion) {
            this.accessory.context.device.fwversion = fwversion;
            this.accessory.getService(this.Service.AccessoryInformation)
                .updateCharacteristic(this.Characteristic.FirmwareRevision, fwversion);
        }


        // CurrentTemperature

        // HomeKit: °C -270-100, step 0.1 (float)
        // FRITZ!Box: °C -/+ n, step 1 (int) -> temperature = value/10 -> 195 = 19.5 °C
        if (this.temperatureSensor !== undefined) {
            const CurrentTemperature = parseInt(state["temperature"]?.["celsius"] || 0) / 10;
            const Offset = parseInt(state["temperature"]?.["offset"] || 0) / 10;
            this.accessory.context.device.state.CurrentTemperature = CurrentTemperature + Offset;
            this.temperatureSensor.updateCharacteristic(this.Characteristic.CurrentTemperature, CurrentTemperature + Offset);
        }


        // CurrentRelativeHumidity

        // Percentage 0-100, step 1 (float)
        if (this.humiditySensor !== undefined) {
            const CurrentRelativeHumidity = parseInt(state["humidity"]?.["rel_humidity"] || 0);
            this.accessory.context.device.state.CurrentRelativeHumidity = CurrentRelativeHumidity;
            this.humiditySensor.updateCharacteristic(this.Characteristic.CurrentRelativeHumidity, CurrentRelativeHumidity);
        }


        // Battery

        if (this.battery !== undefined) {

            const StatusLowBattery = state["batterylow"] !== undefined
                ? parseInt(state["batterylow"])
                : (state["battery"] < 10 ? 1 : 0);

            const BatteryLevel = state["battery"] !== undefined
                ? parseInt(state["battery"])
                : (state["batterylow"] === 0 ? 100 : 10);

            // StatusLowBattery (required)
            this.accessory.context.device.state.StatusLowBattery = StatusLowBattery;
            this.battery.updateCharacteristic(this.Characteristic.StatusLowBattery, StatusLowBattery);

            // BatteryLevel (optional)
            if (Object.hasOwn(this.accessory.context.device.state, "BatteryLevel")) {
                this.accessory.context.device.state.BatteryLevel = BatteryLevel;
                this.battery.updateCharacteristic(this.Characteristic.BatteryLevel, BatteryLevel);
            }
        }
    }
}

module.exports = Accessory;
