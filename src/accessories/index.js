/**
 * index.js
 * homebridge-fritzbox
 *
 * @copyright 2025 Hendrik Meinl
 */

"use strict";

// TODO: ContactSensor, MotionSensor, LeakSensor

module.exports = {
    HumiditySensor: require("./humiditysensor"),
    Lightbulb: require("./lightbulb"),
    Outlet: require("./outlet"),
    Switch: require("./switch"),
    TemperatureSensor: require("./temperaturesensor"),
    Thermostat: require("./thermostat"),
    WindowCovering: require("./windowcovering"),
};
