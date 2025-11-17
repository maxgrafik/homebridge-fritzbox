/**
 * fritzbox-api.js
 * homebridge-fritzbox
 *
 * @copyright 2025 Hendrik Meinl
 */

"use strict";

class FritzBoxAPI {

    constructor(tr064, log) {

        this.tr064 = tr064;
        this.log = log;

        this.deviceURL = `${tr064.deviceURL.protocol}//${tr064.deviceURL.hostname}`;
    }

    async getSID() {

        const serviceType = "urn:dslforum-org:service:DeviceConfig:1";
        const actionName = "X_AVM-DE_CreateUrlSID";

        const UrlSID = await this.tr064.send(serviceType, actionName);

        const SID = /(?<=sid=)[A-Fa-f0-9]+/.exec(UrlSID?.["NewX_AVM-DE_UrlSID"] || "");

        if (SID === null) {
            return null;
        }

        return SID[0];
    }

    async send(apiURL, payload) {

        const SID = await this.getSID();

        if (SID === null) {
            throw new Error("[API] Cannot get SID");
        }


        // Get current settings

        const headers = new Headers();
        headers.append("Authorization", `AVM-SID ${SID}`);
        headers.append("Content-Type", "application/json");

        let options = {
            method: "GET",
            headers: headers,
        };

        const url = new URL(apiURL, this.deviceURL);

        let response = await fetch(url, options);

        if (!response.ok) {
            throw new Error(`[API] GET ${apiURL} ${response.status} ${response.statusText}`);
        }

        const currentSettings = await response.json();


        // Cleanup payload
        // - Remove any key not present in current settings
        // - Replace null values with current settings

        for (const key of Object.keys(payload)) {
            if (!Object.hasOwn(currentSettings, key)) {
                delete payload[key];
            } else if (payload[key] === null) {
                payload[key] = currentSettings[key];
            }
        }


        // Update settings

        options = {
            method: "PUT",
            headers: headers,
            body: JSON.stringify(payload),
        };

        response = await fetch(url, options);

        if (!response.ok) {
            throw new Error(`[API] PUT ${apiURL} ${response.status} ${response.statusText}`);
        }
    }
}

module.exports = FritzBoxAPI;
