/**
 * homekit-helper.js
 * homebridge-fritzbox
 *
 * @copyright 2025 Hendrik Meinl
 */

"use strict";

/**
 * Get HomeKit friendly name as suggested by Apple
 * and implemented in homebridge/HAP-NodeJS
 * @param {string} name - Current accessory name to be "friendlyfied"
 */
function getHomeKitFriendlyName(name) {

    // Using regex from homebridge/HAP-NodeJS
    // /^[\p{L}\p{N}][\p{L}\p{N} ']*[\p{L}\p{N}]$/u
    //
    // https://github.com/homebridge/HAP-NodeJS/pull/1054#issuecomment-2254133907
    // https://developer.apple.com/design/human-interface-guidelines/homekit#Help-people-choose-useful-names

    let HomeKitFriendlyName = "";

    const regex = /[\p{L}\p{N}][\p{L}\p{N} ']*/gu;
    const matches = name.matchAll(regex);

    for (const match of matches) {
        HomeKitFriendlyName += match[0];
    }

    return HomeKitFriendlyName.replace(/[^\p{L}\p{N}]*$/gu, "");
}

exports.getHomeKitFriendlyName = getHomeKitFriendlyName;
