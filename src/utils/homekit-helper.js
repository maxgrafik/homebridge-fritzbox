/**
 * homekit-helper.js
 * homebridge-fritzbox
 *
 * @copyright 2025 Hendrik Meinl
 */

"use strict";

/**
 * Get HomeKit friendly name as suggested by Apple and implemented in
 * homebridge/HAP-NodeJS
 * @param   {string} name - Current accessory name to be "friendlyfied"
 * @returns {string}      - HomeKit friendly name
 */
function getHomeKitFriendlyName(name) {

    // Using regex from homebridge/HAP-NodeJS
    // /^[\p{L}\p{N}][\p{L}\p{N} ']*[\p{L}\p{N}]$/u
    //
    // https://github.com/homebridge/HAP-NodeJS/pull/1054#issuecomment-2254133907
    // https://developer.apple.com/design/human-interface-guidelines/homekit#Help-people-choose-useful-names
    //
    // Update 2025-02-07
    // https://github.com/homebridge/HAP-NodeJS/pull/1083
    //
    // /^[\p{L}\p{N}][\p{L}\p{N}\u2019 '.,-]*[\p{L}\p{N}\u2019]$/u
    //

    let HomeKitFriendlyName = "";

    const regex = /[\p{L}\p{N}\u2019 '.,-]*/gu;
    const matches = name.matchAll(regex);

    for (const match of matches) {
        HomeKitFriendlyName += match[0];
    }

    return HomeKitFriendlyName
        .replace(/^[^\p{L}\p{N}]*/u, "")
        .replace(/[^\p{L}\p{N}\u2019]*$/u, "");
}

/**
 * ColorTemperature in HomeKit:
 * Reciprocal megakelvin (mirek): M = 1000000/K
 * @see https://en.wikipedia.org/wiki/Mired
 */

/**
 * Convert Mired to Kelvin
 * @param   {number} M - Color temperature in Mired
 * @returns {number}   - Color temperature in Kelvin
 */
function MiredToKelvin(M) {
    return Math.round(1000000/M);
}

/**
 * Convert Kelvin to Mired
 * @param   {number} K - Color temperature in Kelvin
 * @returns {number}   - Color temperature in Mired
 */
function KelvinToMired(K) {
    return Math.round(1000000/K);
}


module.exports = {
    getHomeKitFriendlyName,
    MiredToKelvin,
    KelvinToMired,
};
