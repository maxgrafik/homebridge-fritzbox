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


        // Optional characteristics

        // Brightness: 0-100
        if (this.accessory.context.device.characteristics.includes("Brightness")) {
            this.accessory.context.device.state.Brightness = 100;
            this.lightbulb.getCharacteristic(this.Characteristic.Brightness)
                .onGet(this.onGetBrightness.bind(this))
                .onSet(this.onSetBrightness.bind(this));
        }

        // ColorTemperature: 140-500
        if (this.accessory.context.device.characteristics.includes("ColorTemperature")) {
            this.accessory.context.device.state.ColorTemperature = 140;
            this.lightbulb.getCharacteristic(this.Characteristic.ColorTemperature)
                .onGet(this.onGetColorTemperature.bind(this))
                .onSet(this.onSetColorTemperature.bind(this));
        }

        // Hue: 0-360
        if (this.accessory.context.device.characteristics.includes("Hue")) {
            this.accessory.context.device.state.Hue = 0;
            this.lightbulb.getCharacteristic(this.Characteristic.Hue)
                .onGet(this.onGetHue.bind(this))
                .onSet(this.onSetHue.bind(this));
        }

        // Saturation: 0-100
        if (this.accessory.context.device.characteristics.includes("Saturation")) {
            this.accessory.context.device.state.Saturation = 0;
            this.lightbulb.getCharacteristic(this.Characteristic.Saturation)
                .onGet(this.onGetSaturation.bind(this))
                .onSet(this.onSetSaturation.bind(this));
        }


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

    onGetBrightness() {
        return this.accessory.context.device.state.Brightness;
    }

    onSetBrightness(value) {

        // Everything that is some kind of "level" should be defered
        // to avoid "flooding" the FRITZ!Box with intermediate values

        if (this.deferChange) {
            clearTimeout(this.deferChange);
        }

        this.deferChange = setTimeout(() => {

            // Get our own (internal) state in case we need to undo
            const currentValue = this.accessory.context.device.state.Brightness;

            try {

                // Set our own (internal) state
                this.accessory.context.device.state.Brightness = value;

                this.smarthome.send("setlevelpercentage", { ain: this.accessory.context.device.identifier, level: value }).then(() => {
                    this.log.info(`${this.accessory.displayName} was set to ${value}%`);
                });

            } catch (error) {

                // Revert internal state in case of error
                this.accessory.context.device.state.Brightness = currentValue;

                this.log.error(`${this.accessory.displayName}:`, error.message || error);
            }
        }, 250);
    }

    onGetColorTemperature() {
        return this.accessory.context.device.state.ColorTemperature;
    }

    onSetColorTemperature(value) {

        // Everything that is some kind of "level" should be defered
        // to avoid "flooding" the FRITZ!Box with intermediate values

        if (this.deferChange) {
            clearTimeout(this.deferChange);
        }

        this.deferChange = setTimeout(() => {

            // Get our own (internal) state in case we need to undo
            const currentValue = this.accessory.context.device.state.ColorTemperature;

            try {

                // Convert to FRITZ!Box value (Kelvin)
                let Kelvin = this.MiredToKelvin(value);
                if (this.accessory.context.device.characteristics.includes("UseMappedColor")) {
                    Kelvin = this.getClosestColorTemperature(value);
                }

                // Set our own (internal) state
                this.accessory.context.device.state.ColorTemperature = this.KelvinToMired(Kelvin);

                // There seems to be no command for setting an unmapped color temperature
                this.smarthome.send("setcolortemperature", { ain: this.accessory.context.device.identifier, temperature: Kelvin }).then(() => {
                    this.log.info(`Changed color temperature of ${this.accessory.displayName} to ${Kelvin}K`);
                });

            } catch (error) {

                // Revert internal state in case of error
                this.accessory.context.device.state.ColorTemperature = currentValue;

                this.log.error(`${this.accessory.displayName}:`, error.message || error);
            }
        }, 250);
    }

    onGetHue() {
        return this.accessory.context.device.state.Hue;
    }

    onSetHue(value) {

        // Everything that is some kind of "level" should be defered
        // to avoid "flooding" the FRITZ!Box with intermediate values

        // However, we need to register the change immediately
        // for onSetSaturation to have an up-to-date value
        this.accessory.context.device.state.Hue = value;

        if (this.deferChange) {
            clearTimeout(this.deferChange);
        }

        this.deferChange = setTimeout(() => {

            // Get our own (internal) state in case we need to undo
            const currentHue = this.accessory.context.device.state.Hue;
            const currentSaturation = this.accessory.context.device.state.Saturation;
            const currentBrightness = this.accessory.context.device.state.Brightness || 100;

            try {

                // Convert to FRITZ!Box HSV values ([0-359, 0-255, 0-255])
                let Hue = Math.min(359, value);
                let Saturation = Math.round(currentSaturation * 2.55);
                let Brightness = Math.round(currentBrightness * 2.55);

                if (this.accessory.context.device.characteristics.includes("UseMappedColor")) {
                    const HSV = this.getClosestColor([value, currentSaturation, currentBrightness]);
                    Hue = HSV[0];
                    Saturation = HSV[1];
                    Brightness = HSV[2];
                }

                // Set our own (internal) state
                this.accessory.context.device.state.Hue = Hue;
                this.accessory.context.device.state.Saturation = Math.round(Saturation / 2.55);
                if (this.accessory.context.device.state.Brightness !== undefined) {
                    this.accessory.context.device.state.Brightness = Math.round(Brightness / 2.55);
                }

                const switchcmd = this.accessory.context.device.characteristics.includes("UseMappedColor") ? "setcolor" : "setunmappedcolor";
                this.smarthome.send(switchcmd, { ain: this.accessory.context.device.identifier, hue: Hue, saturation: Saturation }).then(() => {
                    this.log.info(`Changed color of ${this.accessory.displayName}`);
                });

            } catch (error) {

                // Revert internal state in case of error
                this.accessory.context.device.state.Hue = currentHue;
                this.accessory.context.device.state.Saturation = currentSaturation;
                if (this.accessory.context.device.state.Brightness !== undefined) {
                    this.accessory.context.device.state.Brightness = currentBrightness;
                }

                this.log.error(`${this.accessory.displayName}:`, error.message || error);
            }
        }, 250);
    }

    onGetSaturation() {
        return this.accessory.context.device.state.Saturation;
    }

    onSetSaturation(value) {

        // Everything that is some kind of "level" should be defered
        // to avoid "flooding" the FRITZ!Box with intermediate values

        // However, we need to register the change immediately
        // for onSetHue to have an up-to-date value
        this.accessory.context.device.state.Saturation = value;

        if (this.deferChange) {
            clearTimeout(this.deferChange);
        }

        this.deferChange = setTimeout(() => {

            // Get our own (internal) state in case we need to undo
            const currentHue = this.accessory.context.device.state.Hue;
            const currentSaturation = this.accessory.context.device.state.Saturation;
            const currentBrightness = this.accessory.context.device.state.Brightness || 100;

            try {

                // Convert to FRITZ!Box HSV values ([0-359, 0-255, 0-255])
                let Hue = Math.min(359, currentHue);
                let Saturation = Math.round(value * 2.55);
                let Brightness = Math.round(currentBrightness * 2.55);

                if (this.accessory.context.device.characteristics.includes("UseMappedColor")) {
                    const HSV = this.getClosestColor([currentHue, value, currentBrightness]);
                    Hue = HSV[0];
                    Saturation = HSV[1];
                    Brightness = HSV[2];
                }

                // Set our own (internal) state
                this.accessory.context.device.state.Hue = Hue;
                this.accessory.context.device.state.Saturation = Math.round(Saturation / 2.55);
                if (this.accessory.context.device.state.Brightness !== undefined) {
                    this.accessory.context.device.state.Brightness = Math.round(Brightness / 2.55);
                }

                const switchcmd = this.accessory.context.device.characteristics.includes("UseMappedColor") ? "setcolor" : "setunmappedcolor";
                this.smarthome.send(switchcmd, { ain: this.accessory.context.device.identifier, hue: Hue, saturation: Saturation }).then(() => {
                    this.log.info(`Changed color of ${this.accessory.displayName}`);
                });

            } catch (error) {

                // Revert internal state in case of error
                this.accessory.context.device.state.Hue = currentHue;
                this.accessory.context.device.state.Saturation = currentSaturation;
                if (this.accessory.context.device.state.Brightness !== undefined) {
                    this.accessory.context.device.state.Brightness = currentBrightness;
                }

                this.log.error(`${this.accessory.displayName}:`, error.message || error);
            }
        }, 250);
    }


    // ColorTemperature in HomeKit
    // reciprocal megakelvin (mirek): M = 1000000/K
    // @see https://en.wikipedia.org/wiki/Mired

    MiredToKelvin(M) {
        return Math.round(1000000/M);
    }

    KelvinToMired(K) {
        return Math.round(1000000/K);
    }

    /**
     * Get closest FRITZ!Box HSV color
     * @param   {Array} colorHK - HomeKit HSV values ([0-360, 0-100, 0-100])
     * @returns {Array}         - FRITZ!Box HSV values ([0-359, 0-255, 0-255])
     */
    getClosestColor(colorHK) {

        // https://stackoverflow.com/questions/35113979/calculate-distance-between-colors-in-hsv-space#39113477

        // Normalize HomeKit values
        const hueHK = colorHK[0] * (Math.PI * 2) / 360;
        const satHK = colorHK[1] / 100;
        const valHK = colorHK[2] / 100;

        // Get squared cartesian distance
        const distanceHSV = (colorFB) => {
            // Normalize FRITZ!Box values
            const hueFB = colorFB[0] * (Math.PI * 2) / 360;
            const satFB = colorFB[1] / 255;
            const valFB = colorFB[2] /255;
            return (
                Math.pow((Math.sin(hueHK)*satHK*valHK)-(Math.sin(hueFB)*satFB*valFB), 2) +
                Math.pow((Math.cos(hueHK)*satHK*valHK)-(Math.cos(hueFB)*satFB*valFB), 2) +
                Math.pow(valHK-valFB, 2)
            );
        };

        // Find closest color
        const distances = [];
        this.smarthome.ColorDefaults.forEach((color, index) => {
            const distance = distanceHSV(color);
            distances.push({ distance: distance, index: index });
        });
        distances.sort((a, b) => a.distance - b.distance);

        // Return matching FRITZ!Box color default
        return this.smarthome.ColorDefaults[distances[0].index];
    }

    /**
     * Get closest FRITZ!Box color temperature
     * @param   {number} temp - Temperature in Mired
     * @returns {number}      - Temperature in Kelvin
     */
    getClosestColorTemperature(temp) {

        // Convert Mired to Kelvin
        const tempKelvin = this.MiredToKelvin(temp);

        // Find closest FRITZ!Box color temperature
        return this.smarthome.TemperatureDefaults.reduce((prev, curr) => {
            return (Math.abs(curr - tempKelvin) < Math.abs(prev - tempKelvin) ? curr : prev);
        });
    }

    /**
     * Update accessory characteristics
     * @param {Object} state - Current smart home device state
     * @see FritzBoxPlatform#updateDevices
     */
    update(state) {

        super.update(state);


        // On/Off state

        let isOn = this.accessory.context.device.state.On;
        if (state["switch"]?.["state"] !== undefined) {
            isOn = parseInt(state["switch"]["state"]);
        } else if (state["simpleonoff"]?.["state"] !== undefined) {
            isOn = parseInt(state["simpleonoff"]["state"]);
        } else {
            // oops!
        }

        this.accessory.context.device.state.On = (isOn === 1) ? true : false;
        this.lightbulb.updateCharacteristic(this.Characteristic.On, this.accessory.context.device.state.On);


        // ColorTemperature

        if (this.accessory.context.device.characteristics.includes("ColorTemperature")) {

            let ColorTemperature = this.accessory.context.device.state.ColorTemperature;
            if (state["colorcontrol"]?.["temperature"] !== undefined) {
                ColorTemperature = parseInt(state["colorcontrol"]["temperature"]);
                ColorTemperature = this.KelvinToMired(ColorTemperature);
            } else {
                // oops!
            }

            if (this.accessory.context.device.characteristics.includes("UseMappedColor")) {
                ColorTemperature = this.getClosestColorTemperature(ColorTemperature);
                ColorTemperature = this.KelvinToMired(ColorTemperature);
            }

            this.accessory.context.device.state.ColorTemperature = ColorTemperature;
            this.lightbulb.updateCharacteristic(this.Characteristic.ColorTemperature, this.accessory.context.device.state.ColorTemperature);
        }


        // Hue/Saturation

        // If there's Hue, is Saturation guaranteed to always exist?
        if (this.accessory.context.device.characteristics.includes("Hue")) {

            let Hue = this.accessory.context.device.state.Hue;
            if (state["colorcontrol"]?.["unmapped_hue"] !== undefined) {
                Hue = parseInt(state["colorcontrol"]["unmapped_hue"]);
            } else if (state["colorcontrol"]?.["hue"] !== undefined) {
                Hue = parseInt(state["colorcontrol"]["hue"]);
            } else {
                // oops!
            }

            let Saturation = this.accessory.context.device.state.Saturation;
            if (state["colorcontrol"]?.["unmapped_saturation"] !== undefined) {
                Saturation = Math.round(parseInt(state["colorcontrol"]["unmapped_saturation"]) / 2.55);
            } else if (state["colorcontrol"]?.["saturation"] !== undefined) {
                Saturation = Math.round(parseInt(state["colorcontrol"]["saturation"]) / 2.55);
            } else {
                // oops!
            }

            if (this.accessory.context.device.characteristics.includes("UseMappedColor")) {
                const HSV = this.getClosestColor([
                    Hue,
                    Saturation,
                    this.accessory.context.device.state.Brightness || 100
                ]);

                Hue = HSV[0];
                Saturation = Math.round(HSV[1] / 2.55);
            }

            this.accessory.context.device.state.Hue = Hue;
            this.accessory.context.device.state.Saturation = Saturation;

            this.lightbulb.updateCharacteristic(this.Characteristic.Hue, this.accessory.context.device.state.Hue);
            this.lightbulb.updateCharacteristic(this.Characteristic.Saturation, this.accessory.context.device.state.Saturation);
        }


        // Brightness

        if (this.accessory.context.device.characteristics.includes("Brightness")) {

            let Brightness = this.accessory.context.device.state.Brightness;
            if (state["levelcontrol"]?.["levelpercentage"] !== undefined) {
                Brightness = parseInt(state["levelcontrol"]["levelpercentage"]);
            } else if (state["levelcontrol"]?.["level"] !== undefined) {
                Brightness = Math.round(parseInt(state["levelcontrol"]["level"]) / 2.55);
            } else {
                // oops!
            }

            this.accessory.context.device.state.Brightness = Brightness;
            this.lightbulb.updateCharacteristic(this.Characteristic.Brightness, this.accessory.context.device.state.Brightness);
        }

        this.api.updatePlatformAccessories([this.accessory]);
    }
}

module.exports = Lightbulb;
