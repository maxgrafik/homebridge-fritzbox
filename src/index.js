/**
 * index.js
 * homebridge-fritzbox
 *
 * @copyright 2025 Hendrik Meinl
 */

"use strict";

const { FritzBoxPlatform } = require("./platform");

module.exports = function(homebridge) {
    homebridge.registerPlatform("FRITZ!Box", FritzBoxPlatform);
};
