/**
 * lightbulb.js
 * homebridge-fritzbox
 *
 * @copyright 2025 Hendrik Meinl
 */

"use strict";

const Accessory = require("./accessory");

const FritzBoxHelper = require("../utils/fritzbox-helper");
const HomeKitHelper = require("../utils/homekit-helper");

/**
 * Lightbulb
 * @extends Accessory
 */
class Lightbulb extends Accessory {

    constructor(platform, accessory, aha) {

        super(platform, accessory);

        this.aha = aha;


        // Lightbulb

        this.lightbulb = this.accessory.getService(this.Service.Lightbulb) || this.accessory.addService(this.Service.Lightbulb);

        this.lightbulb.setCharacteristic(this.Characteristic.Name, this.accessory.displayName);

        this.accessory.context.device.state.On = false;
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


        // Adaptive Lighting

        // Only if lightbulb supports Brightness AND ColorTemperature
        if (
            this.accessory.context.device.characteristics.includes("Brightness") &&
            this.accessory.context.device.characteristics.includes("ColorTemperature")
        ) {
            this.adaptiveLightingController = new this.api.hap.AdaptiveLightingController(this.lightbulb, {
                controllerMode: this.api.hap.AdaptiveLightingControllerMode.AUTOMATIC,
            });
            this.accessory.configureController(this.adaptiveLightingController);
        }


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
            this.lightbulb.updateCharacteristic(this.Characteristic.On, this.accessory.context.device.state.On);

            this.log.error(`${this.accessory.displayName}:`, error.message || error);
        });
    }

    onGetBrightness() {
        return this.accessory.context.device.state.Brightness;
    }

    onSetBrightness(value) {

        // Skip, if value doesn't change
        if (value === this.accessory.context.device.state.Brightness) {
            return;
        }

        // Everything that is some kind of "level" should be defered
        // to avoid "flooding" the FRITZ!Box with intermediate values

        if (this.deferChange) {
            clearTimeout(this.deferChange);
        }

        this.deferChange = setTimeout(() => {

            // Get our own (internal) state in case we need to undo
            const currentValue = this.accessory.context.device.state.Brightness;

            // Set our own (internal) state
            this.accessory.context.device.state.Brightness = value;

            // Send command
            this.aha.send("setlevelpercentage", { ain: this.accessory.context.device.identifier, level: value }).then(() => {

                this.log.info(`${this.accessory.displayName} was set to ${value}%`);

            }).catch((error) => {

                // Revert internal state in case of error
                this.accessory.context.device.state.Brightness = currentValue;
                this.lightbulb.updateCharacteristic(this.Characteristic.Brightness, currentValue);

                this.log.error(`${this.accessory.displayName}:`, error.message || error);
            });

        }, 400);
    }

    onGetColorTemperature() {
        return this.accessory.context.device.state.ColorTemperature;
    }

    onSetColorTemperature(value) {

        // Skip, if value doesn't change
        if (value === this.accessory.context.device.state.ColorTemperature) {
            return;
        }

        // Everything that is some kind of "level" should be defered
        // to avoid "flooding" the FRITZ!Box with intermediate values

        if (this.deferChange) {
            clearTimeout(this.deferChange);
        }

        this.deferChange = setTimeout(() => {

            // Get our own (internal) state in case we need to undo
            const currentValue = this.accessory.context.device.state.ColorTemperature;

            // Convert to FRITZ!Box value (Kelvin)
            let Kelvin = HomeKitHelper.MiredToKelvin(value);
            if (this.accessory.context.device.characteristics.includes("UseMappedColor")) {
                Kelvin = FritzBoxHelper.getClosestColorTemperature(value);
            }

            // Set our own (internal) state
            this.accessory.context.device.state.ColorTemperature = HomeKitHelper.KelvinToMired(Kelvin);

            // There seems to be no command for setting an unmapped color temperature
            this.aha.send("setcolortemperature", { ain: this.accessory.context.device.identifier, temperature: Kelvin }).then(() => {

                this.log.info(`Changed color temperature of ${this.accessory.displayName} to ${Kelvin}K`);

                // Adjust Hue/Saturation (if available)
                if (this.accessory.context.device.characteristics.includes("Hue")) {

                    // Convert from Mired to Hue/Saturation (optionally map)
                    const color = this.api.hap.ColorUtils.colorTemperatureToHueAndSaturation(value);
                    if (this.accessory.context.device.characteristics.includes("UseMappedColor")) {
                        const HSV = FritzBoxHelper.getClosestColor([color.hue, color.saturation, this.accessory.context.device.state.Brightness]);
                        color.hue = HSV[0];
                        color.saturation = Math.round(HSV[1] / 2.55);
                    }

                    this.accessory.context.device.state.Hue = color.hue;
                    this.accessory.context.device.state.Saturation = color.saturation;

                    if (this.adaptiveLightingController) {
                        this.lightbulb.updateCharacteristic(this.Characteristic.Hue, color.hue);
                        this.lightbulb.updateCharacteristic(this.Characteristic.Saturation, color.saturation);
                    }
                }

            }).catch((error) => {

                // Revert internal state in case of error
                this.accessory.context.device.state.ColorTemperature = currentValue;
                this.lightbulb.updateCharacteristic(this.Characteristic.ColorTemperature, currentValue);

                this.log.error(`${this.accessory.displayName}:`, error.message || error);
            });

        }, 400);
    }

    onGetHue() {
        return this.accessory.context.device.state.Hue;
    }

    onSetHue(value) {

        // Skip, if value doesn't change
        if (value === this.accessory.context.device.state.Hue) {
            return;
        }

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

            // Convert to FRITZ!Box HSV values ([0-359, 0-255, 0-255])
            let Hue = Math.min(359, value);
            let Saturation = Math.round(currentSaturation * 2.55);
            let Brightness = Math.round(currentBrightness * 2.55);

            if (this.accessory.context.device.characteristics.includes("UseMappedColor")) {
                const HSV = FritzBoxHelper.getClosestColor([value, currentSaturation, currentBrightness]);
                Hue = HSV[0];
                Saturation = HSV[1];
                Brightness = HSV[2];
            }

            // Set our own (internal) state
            this.accessory.context.device.state.Hue = Hue;
            this.accessory.context.device.state.Saturation = Math.round(Saturation / 2.55);
            if (this.accessory.context.device.characteristics.includes("Brightness")) {
                this.accessory.context.device.state.Brightness = Math.round(Brightness / 2.55);
            }

            // Send command
            const switchcmd = this.accessory.context.device.characteristics.includes("UseMappedColor") ? "setcolor" : "setunmappedcolor";
            this.aha.send(switchcmd, { ain: this.accessory.context.device.identifier, hue: Hue, saturation: Saturation }).then(() => {

                this.log.info(`Changed color of ${this.accessory.displayName}`);

                // When a write happens to Hue/Saturation characteristic it is advised
                // to set the internal value of the ColorTemperature to the minimal
                if (this.accessory.context.device.characteristics.includes("ColorTemperature")) {
                    this.accessory.context.device.state.ColorTemperature = 140;
                }

            }).catch((error) => {

                // Revert internal state in case of error
                this.accessory.context.device.state.Hue = currentHue;
                this.accessory.context.device.state.Saturation = currentSaturation;
                this.lightbulb.updateCharacteristic(this.Characteristic.Hue, currentHue);
                this.lightbulb.updateCharacteristic(this.Characteristic.Saturation, currentSaturation);

                if (this.accessory.context.device.characteristics.includes("Brightness")) {
                    this.accessory.context.device.state.Brightness = currentBrightness;
                    this.lightbulb.updateCharacteristic(this.Characteristic.Brightness, currentBrightness);
                }

                this.log.error(`${this.accessory.displayName}:`, error.message || error);
            });

        }, 400);
    }

    onGetSaturation() {
        return this.accessory.context.device.state.Saturation;
    }

    onSetSaturation(value) {

        // Skip, if value doesn't change
        if (value === this.accessory.context.device.state.Saturation) {
            return;
        }

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

            // Convert to FRITZ!Box HSV values ([0-359, 0-255, 0-255])
            let Hue = Math.min(359, currentHue);
            let Saturation = Math.round(value * 2.55);
            let Brightness = Math.round(currentBrightness * 2.55);

            if (this.accessory.context.device.characteristics.includes("UseMappedColor")) {
                const HSV = FritzBoxHelper.getClosestColor([currentHue, value, currentBrightness]);
                Hue = HSV[0];
                Saturation = HSV[1];
                Brightness = HSV[2];
            }

            // Set our own (internal) state
            this.accessory.context.device.state.Hue = Hue;
            this.accessory.context.device.state.Saturation = Math.round(Saturation / 2.55);
            if (this.accessory.context.device.characteristics.includes("Brightness")) {
                this.accessory.context.device.state.Brightness = Math.round(Brightness / 2.55);
            }

            // Send command
            const switchcmd = this.accessory.context.device.characteristics.includes("UseMappedColor") ? "setcolor" : "setunmappedcolor";
            this.aha.send(switchcmd, { ain: this.accessory.context.device.identifier, hue: Hue, saturation: Saturation }).then(() => {

                this.log.info(`Changed color of ${this.accessory.displayName}`);

                // When a write happens to Hue/Saturation characteristic it is advised
                // to set the internal value of the ColorTemperature to the minimal
                if (this.accessory.context.device.characteristics.includes("ColorTemperature")) {
                    this.accessory.context.device.state.ColorTemperature = 140;
                }

            }).catch((error) => {

                // Revert internal state in case of error
                this.accessory.context.device.state.Hue = currentHue;
                this.accessory.context.device.state.Saturation = currentSaturation;
                this.lightbulb.updateCharacteristic(this.Characteristic.Hue, currentHue);
                this.lightbulb.updateCharacteristic(this.Characteristic.Saturation, currentSaturation);

                if (this.accessory.context.device.characteristics.includes("Brightness")) {
                    this.accessory.context.device.state.Brightness = currentBrightness;
                    this.lightbulb.updateCharacteristic(this.Characteristic.Brightness, currentBrightness);
                }

                this.log.error(`${this.accessory.displayName}:`, error.message || error);
            });

        }, 400);
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
            isOn = parseInt(state["switch"]["state"]) === 1;
        } else if (state["simpleonoff"]?.["state"] !== undefined) {
            isOn = parseInt(state["simpleonoff"]["state"]) === 1;
        } else {
            // oops!
        }

        this.accessory.context.device.state.On = isOn;
        this.lightbulb.updateCharacteristic(this.Characteristic.On, this.accessory.context.device.state.On);


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


        // ColorTemperature

        if (this.accessory.context.device.characteristics.includes("ColorTemperature")) {

            let ColorTemperature = this.accessory.context.device.state.ColorTemperature;
            if (state["colorcontrol"]?.["temperature"] !== undefined) {
                ColorTemperature = parseInt(state["colorcontrol"]["temperature"]);
                ColorTemperature = HomeKitHelper.KelvinToMired(ColorTemperature);
            } else {
                // oops!
            }

            if (this.accessory.context.device.characteristics.includes("UseMappedColor")) {
                ColorTemperature = FritzBoxHelper.getClosestColorTemperature(ColorTemperature);
                ColorTemperature = HomeKitHelper.KelvinToMired(ColorTemperature);
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
                const HSV = FritzBoxHelper.getClosestColor([
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


        this.api.updatePlatformAccessories([this.accessory]);
    }
}

module.exports = Lightbulb;
