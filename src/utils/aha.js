/**
 * aha.js
 * homebridge-fritzbox
 *
 * @copyright 2025 Hendrik Meinl
 */

"use strict";

const crypto = require("node:crypto");
const { Buffer } = require("node:buffer");
const { XMLParser } = require("fast-xml-parser");

/**
 * AHA HTTP Interface
 * @see https://avm.de/fileadmin/user_upload/Global/Service/Schnittstellen/AHA-HTTP-Interface.pdf
 */
class AHA {

    /**
     * Note: url is NOT a string!!
     * @param {URL} url - TR-064 service description url
     */
    constructor(log, config, url) {

        this.log = log;

        this.username = config.username || "";
        this.password = config.password || "";

        this.SID = "0000000000000000";
        this.timestamp = 0;

        this.loginURL   = new URL(`${url.protocol}//${url.hostname}/login_sid.lua`);
        this.serviceURL = new URL(`${url.protocol}//${url.hostname}/webservices/homeautoswitch.lua`);

        const parserOptions = {
            ignoreDeclaration: true,
            ignoreAttributes: false,
            attributeNamePrefix : "@",
            parseTagValue: false,
            isArray: (name, jpath) => {
                return /\.(?<name>[^.]+)list\.(\k<name>)$/m.test(jpath);
            }
        };

        this.parser = new XMLParser(parserOptions);
    }

    /**
     * Get session info containing the SID and/or challenge
     * @param {URL} url   - The url including searchParams
     * @returns {Promise} - The session info
     * @private
     */
    async getSessionInfo(url) {

        try {

            const response = await fetch(url);

            if (!response.ok) {
                throw new Error(`[AHA] Error getting session info: ${response.status} ${response.statusText}`);
            }

            const data = await response.text();
            const obj  = this.parser.parse(data, true);

            return obj;

        } catch (error) {
            if (
                error instanceof TypeError
                && error.message === "fetch failed"
                && error.cause instanceof Error
                && error.cause.message === "self-signed certificate"
            ) {
                throw new Error("Can not establish SSL connection to FRITZ!Box with self-signed certificate");
            } else {
                throw error;
            }
        }
    }

    /**
     * Check, if a current SID is valid or request a new one
     * @private
     */
    async getSID() {

        // According to AVM Technical Note - Session ID
        // session IDs are valid for 60 minutes and will
        // be renewed with each request

        const isValid = (Date.now() - this.timestamp) < (60 * 60 * 1000);
        if (this.SID !== "0000000000000000" && isValid) {
            this.timestamp = Date.now();
            return;
        }

        let url = new URL(`?sid=${this.SID}`, this.loginURL);

        let sessionInfo = await this.getSessionInfo(url);

        let SID = sessionInfo?.["SessionInfo"]?.["SID"];
        if (SID !== undefined && SID !== "0000000000000000") {
            this.SID = SID;
            this.timestamp = Date.now();
            return;
        }

        const challenge = sessionInfo?.["SessionInfo"]?.["Challenge"];
        if (!challenge) {
            throw new Error("[AHA] Session info contains no challenge");
        }

        const hash = crypto.createHash("MD5");
        const buffer = Buffer.from(challenge + "-" + this.password, "utf-16le");
        hash.update(buffer);

        const username = encodeURIComponent(this.username);
        const response = challenge + "-" + hash.digest("hex");

        url = new URL(`?username=${username}&response=${response}`, this.loginURL);

        sessionInfo = await this.getSessionInfo(url);

        SID = sessionInfo?.["SessionInfo"]?.["SID"];
        if (SID !== undefined && SID !== "0000000000000000") {
            this.SID = SID;
            this.timestamp = Date.now();
            return;
        }

        throw new Error("[AHA] Could not get SID");
    }

    /**
     * Send command
     * @param {string}    switchcmd - The command to send
     * @param {?Object}   params    - Command parameters as key/value
     * @returns {Promise}           - FRITZ!Box response
     * @public
     */
    async send(switchcmd, params = null) {

        try {

            await this.getSID();

            const url = this.getURLForSwitchcmd(switchcmd, params);

            let response = await fetch(url);

            if (!response.ok) {
                throw new Error(`[AHA] Error sending command ${switchcmd}: ${response.status} ${response.statusText}`);
            }

            const data = await response.text();

            // Response is the status text as "text/plain; charset=utf-8"
            // except for some switchcmd where it is "text/xml; charset=utf-8"

            const exceptions = [
                "getdevicelistinfos",
                "getbasicdevicestats",
                "gettriggerlistinfos",
                "gettemplatelistinfos",
                "getcolordefaults",
                "getsubscriptionstate",
                "getdeviceinfos"
            ];

            if (exceptions.includes(switchcmd)) {
                response  = this.parser.parse(data, true);
            } else {
                response = data;
            }

            return response;

        } catch (error) {
            if (
                error instanceof TypeError
                && error.message === "fetch failed"
                && error.cause instanceof Error
                && error.cause.message === "self-signed certificate"
            ) {
                throw new Error("Can not establish SSL connection to FRITZ!Box with self-signed certificate");
            } else {
                throw error;
            }
        }
    }

    /**
     * Compose the URL for a command
     * @param {string}  switchcmd - The command
     * @param {?Object} params    - Command parameters as key/value
     * @private
     */
    getURLForSwitchcmd(switchcmd, params = null) {

        let searchParams = `?sid=${this.SID}&switchcmd=${switchcmd}`;

        if (params !== null) {
            for (const key of Object.keys(params)) {
                searchParams = searchParams + `&${key}=${encodeURIComponent(params[key])}`;
            }
        }

        return new URL(searchParams, this.serviceURL);
    }

    /**
     * Sets the HTTPS port
     * @param {number} port - Port number
     * @public
     */
    setSecurityPort(port) {
        this.loginURL.protocol = "https:";
        this.loginURL.port = port;
        this.serviceURL.protocol = "https:";
        this.serviceURL.port = port;
    }

    /**
     * Sets the username used for authentication
     * @param {string} username
     * @public
     */
    setDefaultUser(username) {
        this.username = username;
    }
}

module.exports = AHA;
