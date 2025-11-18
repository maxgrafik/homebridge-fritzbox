/**
 * openapi.js
 * homebridge-fritzbox
 *
 * @copyright 2025 Hendrik Meinl
 */

"use strict";

const crypto = require("node:crypto");
const { Buffer } = require("node:buffer");
const { XMLParser } = require("fast-xml-parser");

/**
 * OpenAPI
 * @since FRITZ!OS 8.20
 */

class OpenAPI {

    /**
     * @param          log
     * @param {Object} config - Plugin config
     * @param {URL}    url    - Device URL
     */
    constructor(log, config, url) {

        this.log = log;

        this.username = config.username || "";
        this.password = config.password || "";

        this.SID = "0000000000000000";
        this.timestamp = 0;

        this.deviceURL = new URL(`${url.protocol}//${url.hostname}`);
        this.basePath  = "/api/v0";

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
     * @param   {URL}             url - The loginURL including searchParams
     * @returns {Promise<Object>}     - The session info
     * @private
     */
    async getSessionInfo(url) {

        try {

            const response = await fetch(url);

            if (!response.ok) {
                throw new Error(`[OpenAPI] Error getting session info: ${response.status} ${response.statusText}`);
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

        // According to AVM Session-ID as of 2021-05-03
        // session IDs are valid for 20 minutes and will
        // be renewed with each request

        const isValid = (Date.now() - this.timestamp) < (20 * 60 * 1000);
        if (this.SID !== "0000000000000000" && isValid) {
            this.timestamp = Date.now();
            return;
        }

        let url = new URL(`/login_sid.lua?sid=${this.SID}`, this.deviceURL);

        let sessionInfo = await this.getSessionInfo(url);

        let SID = sessionInfo?.["SessionInfo"]?.["SID"];
        if (SID !== undefined && SID !== "0000000000000000") {
            this.SID = SID;
            this.timestamp = Date.now();
            return;
        }

        const challenge = sessionInfo?.["SessionInfo"]?.["Challenge"];
        if (!challenge) {
            throw new Error("[OpenAPI] Session info contains no challenge");
        }

        const hash = crypto.createHash("MD5");
        const buffer = Buffer.from(challenge + "-" + this.password, "utf-16le");
        hash.update(buffer);

        const username = encodeURIComponent(this.username);
        const response = challenge + "-" + hash.digest("hex");

        url = new URL(`/login_sid.lua?username=${username}&response=${response}`, this.deviceURL);

        sessionInfo = await this.getSessionInfo(url);

        SID = sessionInfo?.["SessionInfo"]?.["SID"];
        if (SID !== undefined && SID !== "0000000000000000") {
            this.SID = SID;
            this.timestamp = Date.now();
            return;
        }

        throw new Error("[OpenAPI] Could not get session ID");
    }

    /**
     * GET
     * @param   {string}          route - The API endpoint
     * @returns {Promise<Object>}       - FRITZ!Box response
     * @public
     */
    async getData(route) {

        try {

            await this.getSID();

            let headers = new Headers();
            headers.append("Authorization", `AVM-SID ${this.SID}`);
            headers.append("Content-Type", "application/json");

            let options = {
                method: "GET",
                headers: headers,
            };

            const url = new URL(`${this.basePath}${route}`, this.deviceURL);

            let response = await fetch(url, options);

            if (!response.ok) {

                const error = await this.getErrorDescription(response);

                if (error.code !== 3001) {
                    throw new Error(`[OpenAPI] ${error.message}`);
                }

                this.SID = "0000000000000000";
                this.timestamp = 0;

                await this.getSID();

                headers = new Headers();
                headers.append("Authorization", `AVM-SID ${this.SID}`);
                headers.append("Content-Type", "application/json");

                options = {
                    method: "GET",
                    headers: headers,
                };

                response = await fetch(url, options);
            }

            if (!response.ok) {
                const error = await this.getErrorDescription(response);
                throw new Error(`[OpenAPI] ${error.message}`);
            }

            const data = await response.json();

            return data;

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
     * SET
     * @param  {string} route   - The API endpoint
     * @param  {Object} payload - The settings to apply
     * @public
     */
    async setData(route, payload) {

        try {

            // Get current settings

            const currentSettings = await this.getData(route);


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


            // Apply new settings

            await this.getSID();

            const headers = new Headers();
            headers.append("Authorization", `AVM-SID ${this.SID}`);
            headers.append("Content-Type", "application/json");

            const options = {
                method: "PUT",
                headers: headers,
                body: JSON.stringify(payload),
            };

            const url = new URL(`${this.basePath}${route}`, this.deviceURL);

            const response = await fetch(url, options);

            if (!response.ok) {
                const error = await this.getErrorDescription(response);
                throw new Error(`[OpenAPI] ${error.message}`);
            }

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
     * Sets the HTTPS port
     * @param {number} port
     * @public
     */
    setSecurityPort(port) {
        this.deviceURL.protocol = "https:";
        this.deviceURL.port = port;
    }

    /**
     * Sets the username used for authentication
     * @param {string} username
     * @public
     */
    setDefaultUser(username) {
        this.username = username;
    }

    /**
     * API error handling
     * @param   {Response}        response - The API response to check
     * @returns {Promise<Object>}          - Error message & code
     * @private
     *
     * @example {"errors":[{"message":"permission denied: /api/v0/generic/box","code":3001}]}
     */
    async getErrorDescription(response) {

        const contentType = response.headers.get("content-type");
        if (!contentType || !contentType.includes("application/json")) {
            this.log.debug(await response.text());
            return { message: "Got error, but response is not JSON", code: null };
        }

        try {

            const errorMessage = await response.json();

            if (Object.hasOwn(errorMessage, "errors")) {
                const errors = errorMessage["errors"];
                if (
                    Array.isArray(errors)
                    && errors.length > 0
                    && typeof errors[0] === "object"
                    && !Array.isArray(errors[0])
                    && errors[0] !== null
                    && Object.hasOwn(errors[0], "message")
                ) {
                    return { message: errors[0].message, code: errors[0].code };
                }
            }

        } catch (error) {
            this.log.debug(error.message || error);
            return { message: "Error reading response", code: null };
        }

        return { message: response.statusText, code: response.status };
    }
}

module.exports = OpenAPI;
