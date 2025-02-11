/**
 * homekit-custom.js
 * homebridge-fritzbox
 *
 * @copyright 2025 Hendrik Meinl
 */

"use strict";

class HomeKitCustom {

    constructor(api) {

        this.api = api;

        this.Service = {};
        this.Characteristic = {};


        // Custom HomeKit Services/Characteristics
        // https://github.com/ebaauw/homebridge-lib/tree/main

        this.createCharacteristic("Voltage", "E863F10A-079E-48FF-8F27-9C2605A29F52", {
            format: api.hap.Formats.FLOAT,
            unit: "V",
            minValue: 0,
            maxValue: 380,
            minStep: 0.1,
            perms: [api.hap.Perms.PAIRED_READ, api.hap.Perms.NOTIFY]
        });

        this.createCharacteristic("TotalConsumption", "E863F10C-079E-48FF-8F27-9C2605A29F52", {
            format: api.hap.Formats.FLOAT,
            unit: "kWh",
            minValue: 0,
            maxValue: 1000000,
            minStep: 0.01,
            perms: [api.hap.Perms.PAIRED_READ, api.hap.Perms.NOTIFY]
        }, "Total Consumption");

        this.createCharacteristic("Consumption", "E863F10D-079E-48FF-8F27-9C2605A29F52", {
            format: api.hap.Formats.FLOAT,
            unit: "W",
            minValue: 0,
            maxValue: 12000,
            minStep: 0.1,
            perms: [api.hap.Perms.PAIRED_READ, api.hap.Perms.NOTIFY]
        });

        this.createService("EnergyMeter", "E863F008-079E-48FF-8F27-9C2605A29F52", [], [
            this.Characteristic.Voltage,
            this.Characteristic.TotalConsumption,
            this.Characteristic.Consumption,
        ]);
    }

    createService(key, uuid, characteristics, optionalCharacteristics) {
        this.Service[key] = class extends this.api.hap.Service {
            constructor (displayName, subtype) {
                super(displayName, uuid, subtype);
                for (const characteristic of characteristics) {
                    this.addCharacteristic(characteristic);
                }
                for (const characteristic of optionalCharacteristics) {
                    this.addOptionalCharacteristic(characteristic);
                }
            }
        };
        this.Service[key].UUID = uuid;
    }

    createCharacteristic(key, uuid, props, displayName = key) {
        this.Characteristic[key] = class extends this.api.hap.Characteristic {
            constructor () {
                super(displayName, uuid);
                this.setProps(props);
                this.value = this.getDefaultValue();
            }
        };
        this.Characteristic[key].UUID = uuid;
    }
}

module.exports = HomeKitCustom;
