/**
 * tr064.js
 * homebridge-fritzbox
 *
 * @copyright 2025 Hendrik Meinl
 */

"use strict";

const crypto = require("node:crypto");
const SOAPRequest = require("./soap");
const { XMLParser } = require("fast-xml-parser");

class TR064 {

    constructor(log, config) {

        this.log = log;

        this.username = config.username || "";
        this.password = config.password || "";
        this.challenge = null;

        this.deviceURL  = null;
        this.deviceInfo = {};

        this.serviceList = null;
        this.services = [];

        const parserOptions = {
            ignoreDeclaration: true,
            parseTagValue: false,
            isArray: (name, jpath) => {
                // make sure lists are parsed as array, even if there's only 1 element
                return /(\.(?<name>[^.]+)List\.(\k<name>)|List\.Item)$/m.test(jpath);
            },
        };

        this.parser = new XMLParser(parserOptions);
    }

    /**
     * Initialize the TR-064 module
     * @param {URL} tr064descURL - TR-064 service description url
     * @public
     */
    async init(tr064descURL) {

        const serviceDescription = await this.get(tr064descURL);

        const displayName  = serviceDescription?.["root"]?.["device"]?.["friendlyName"];
        const manufacturer = serviceDescription?.["root"]?.["device"]?.["manufacturer"];
        const serialNo     = serviceDescription?.["root"]?.["device"]?.["serialNumber"];
        const model        = serviceDescription?.["root"]?.["device"]?.["modelName"];
        const fwversion    = serviceDescription?.["root"]?.["systemVersion"]?.["Display"];

        if (!manufacturer || !serialNo || !model || !fwversion) {
            throw new Error("[TR064] Error getting device info");
        }

        this.deviceInfo = {
            displayName  : displayName || model,
            manufacturer : manufacturer,
            serialNo     : serialNo,
            model        : model,
            fwversion    : fwversion,
        };

        const serviceList = serviceDescription["root"]?.["device"]?.["serviceList"]?.["service"];

        if (!serviceList || !Array.isArray(serviceList)) {
            throw new Error("[TR064] Error getting service list");
        }

        const deviceList = serviceDescription["root"]?.["device"]?.["deviceList"]?.["device"] || [];
        for (const device of deviceList) {
            const deviceServiceList = device["serviceList"]?.["service"];
            if (deviceServiceList && Array.isArray(deviceServiceList)) {
                serviceList.push(...deviceServiceList);
            }
        }

        this.deviceURL = new URL(`${tr064descURL.protocol}//${tr064descURL.hostname}:${tr064descURL.port}`);
        this.serviceList = serviceList;
    }

    /**
     * Get SCPD XML
     * @param   {URL}     url - URL of the service description XML
     * @returns {Promise}     - Parsed XML as Object
     * @private
     */
    async get(url) {

        try {

            const response = await fetch(url);

            if (!response.ok) {
                throw new Error(`[TR064] GET ${url.pathname}: ${response.status} ${response.statusText}`);
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
     * Maka a SOAP request
     * @param   {URL}     url         - TR-064 controlURL
     * @param   {string}  serviceType - Service type (urn:...)
     * @param   {string}  actionName  - SOAP action
     * @param   {?Object} actionArgs  - Arguments for SOAP action as key/value
     * @returns {Promise}             - FRITZ!Box response
     * @private
     */
    async post(url, serviceType, actionName, actionArgs = null) {

        const soap = new SOAPRequest(serviceType, actionName, actionArgs);

        const headers = new Headers();
        headers.append("Content-Type", "text/xml; charset=\"utf-8\"");
        headers.append("Content-Length", soap.message.length);
        headers.append("SOAPaction", `"${serviceType}#${actionName}"`);

        // If we already have a challenge, we can reuse it
        if (this.challenge !== null) {
            const authHeader = this.getAuthorizationHeader(url.pathname);
            headers.set("Authorization", authHeader);
        }

        const options = {
            method: "POST",
            headers: headers,
            body: soap.message,
        };

        try {

            let response = await fetch(url, options);

            if (!response.ok && response.status === 401) {

                this.challenge = response.headers.get("www-authenticate");
                const authHeader = this.getAuthorizationHeader(url.pathname);

                if (authHeader !== null) {
                    options.headers.set("Authorization", authHeader);
                    response = await fetch(url, options);
                }
            }

            if (!response.ok) {
                throw new Error(`[TR064] POST ${url.pathname}: ${response.status} ${response.statusText}`);
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
     * Get our internal representaion of the service description
     * or request it from FRITZ!Box
     * @param   {string}  serviceType - Service type (urn:...)
     * @returns {Promise}             - Service description (or null)
     * @private
     */
    async getService(serviceType) {

        if (this.serviceList === null || this.serviceList.length === 0) {
            this.log.debug("[TR064] No service list");
            return null;
        }

        for (const service of this.services) {
            if (service.serviceType === serviceType) {
                return service;
            }
        }

        let service = null;

        for (const serviceListItem of this.serviceList) {
            if (Object.hasOwn(serviceListItem, "serviceType") && serviceListItem["serviceType"] === serviceType) {
                service = serviceListItem;
                break;
            }
        }

        if (service === null) {
            this.log.debug("[TR064] No such service: %s", serviceType);
            return null;
        }

        const SCPDURL = Object.hasOwn(service, "SCPDURL") && service["SCPDURL"];
        if (!SCPDURL) {
            this.log.debug("[TR064] No SCPDURL for service: %s", serviceType);
            return null;
        }

        const controlURL = Object.hasOwn(service, "controlURL") && service["controlURL"];
        if (!controlURL) {
            this.log.debug("[TR064] No controlURL for service: %s", serviceType);
            return null;
        }

        const SCPD = await this.get(new URL(SCPDURL, this.deviceURL));

        const actionList = SCPD["scpd"]?.["actionList"]?.["action"];
        if (!actionList) {
            this.log.debug("[TR064] Error getting action list");
            return null;
        }

        const actions = [];
        for (const action of actionList) {

            if (!Object.hasOwn(action, "name")) {
                continue;
            }

            const argumentList = action["argumentList"]?.["argument"];
            if (!argumentList) {
                continue;
            }

            const args = [];

            for (const argument of argumentList) {

                const name = argument["name"];
                const direction = argument["direction"];
                const relatedStateVariable = argument["relatedStateVariable"];

                if (name && direction && relatedStateVariable) {
                    args.push({ name: name, direction: direction, relatedStateVariable: relatedStateVariable });
                }
            }

            actions.push({
                name: action["name"],
                args: args,
            });
        }

        const serviceStateTable = SCPD["scpd"]?.["serviceStateTable"]?.["stateVariable"];
        if (!serviceStateTable) {
            this.log.debug("[TR064] Error getting service state table");
            return null;
        }

        const dataTypes = {};
        for (const stateVariable of serviceStateTable) {
            dataTypes[stateVariable["name"]] = stateVariable["dataType"];
        }

        service = {
            serviceType: serviceType,
            controlURL: controlURL,
            actions: actions,
            dataTypes: dataTypes,
        };

        this.services.push(service);

        return service;
    }

    /**
     * Check, if the given service exists on this FRITZ!Box
     * @param   {string}  serviceType - Service type (urn:...)
     * @returns {Promise}             - Boolean
     * @public
     */
    async hasService(serviceType) {
        if (this.serviceList === null || this.serviceList.length === 0) {
            return false;
        }
        for (const serviceListItem of this.serviceList) {
            if (Object.hasOwn(serviceListItem, "serviceType") && serviceListItem["serviceType"] === serviceType) {
                return true;
            }
        }
        return false;
    }

    /**
     * Public method for making SOAP requests
     * @param   {string}  serviceType - Service type (urn:...)
     * @param   {string}  actionName  - SOAP action
     * @param   {?Object} actionArgs  - Arguments for SOAP action as key/value
     * @returns {Promise}             - FRITZ!Box response (or null)
     */
    async send(serviceType, actionName, actionArgs = null) {

        const service = await this.getService(serviceType);
        if (service === null) {
            return null;
        }

        const action = service.actions.find(action => action.name === actionName);
        if (action === undefined) {
            this.log.debug("[TR064] No such action: %s", actionName);
            return null;
        }

        if (actionArgs !== null) {
            const requiredArgs = action.args.filter((arg) => arg.direction === "in");
            for (const arg of requiredArgs) {
                if (!Object.hasOwn(actionArgs, arg.name)) {
                    this.log.debug("[TR064] Required argument missing: %s", arg.name);
                    return null;
                }
                const dataType = service.dataTypes[arg.relatedStateVariable];
                actionArgs[arg.name] = this.convertToDataType(actionArgs[arg.name], dataType);
            }
            for (const key of Object.keys(actionArgs)) {
                if (requiredArgs.find((arg) => arg.name === key) === undefined) {
                    // this.log.debug("[TR064] Provided argument not required: %s", key);
                    delete actionArgs[key];
                }
            }
        }

        const data = await this.post(new URL(service.controlURL, this.deviceURL), serviceType, actionName, actionArgs);

        if (typeof data !== "object") {
            this.log.debug("[TR064] Invalid data returned for action: %s", actionName);
            return null;
        }

        const results = {};

        for (const argument of action.args) {
            let result = this.getValueByKey(data, argument.name);
            if (result !== undefined) {
                if (/^<(?<tag>[^>]+)>.+<\/(\k<tag>)>$/s.test(result)) {
                    result = this.parser.parse(result);
                    this.convertFromDataTypeObj(result, service.dataTypes);
                } else {
                    const dataType = service.dataTypes[argument.relatedStateVariable];
                    if (dataType !== undefined) {
                        result = this.convertFromDataType(result, dataType);
                    } else {
                        this.log.debug("[TR064] No data type for: %s", argument.relatedStateVariable);
                    }
                }
                results[argument.name] = result;
            }
        }

        return results;
    }

    /**
     * Converts a value from a SOAP response (usually string)
     * to the specified type e.g. a "true" int
     * @param {*}      value    - The value
     * @param {string} dataType - Data type from service state table
     * @returns {*}             - Converted value
     * @private
     */
    convertFromDataType(value, dataType) {
        switch (dataType) {
        case "i4":
        case "ui1":
        case "ui2":
        case "ui4":
            if (typeof value === "string") { return parseInt(value); }
            return value;
        case "string":
        case "uuid":
            return `${value}`;
        case "boolean":
            if (typeof value === "boolean") { return value; }
            if (typeof value === "number") { return value === 1; }
            if (typeof value === "string") { return value === "1"; }
            return value;
        case "dateTime":
            return new Date(value);
        default:
            return value;
        }
    }

    /**
     * Convert all values of the object to the specified type
     * @param {Object} obj      - The object
     * @param {string} dataType - Data type from service state table
     * @private
     */
    convertFromDataTypeObj(obj, dataTypes) {
        for (const key of Object.keys(obj)) {
            if (typeof obj[key] === "object" && !Array.isArray(obj[key]) && obj[key] !== null) {
                this.convertFromDataTypeObj(obj[key], dataTypes);
            } else if (Array.isArray(obj[key])) {
                for (const item of obj[key]) {
                    this.convertFromDataTypeObj(item, dataTypes);
                }
            } else {
                const dataType = dataTypes[key];
                if (dataType !== undefined) {
                    obj[key] = this.convertFromDataType(obj[key], dataType);
                } else {
                    this.log.debug("[TR064] No data type found for: %s", key);
                }
            }
        }
    }

    /**
     * Converts a value for a SOAP request into the expected type
     * @param {*}      value    - The value
     * @param {string} dataType - Data type from service state table
     * @returns {*}             - Converted value
     * @private
     */
    convertToDataType(value, dataType) {
        switch (dataType) {
        case "i4":
        case "ui1":
        case "ui2":
        case "ui4":
            // TODO: range check for int values
            if (typeof value === "string") { return parseInt(value); }
            if (typeof value === "number") { return value; }
            return value; // we're doomed :P
        case "string":
        case "uuid":
            return `${value}`;
        case "boolean":
            // FRITZ!Box actually doesn't really use true booleans
            if (typeof value === "boolean") { return value ? 1 : 0; }
            if (typeof value === "string") { return value === "1" ? 1 : 0; }
            return value;
        case "dateTime":
            if (value instanceof Date) { return value.toISOString(); }
            return value; // return as is and hope the best
        default:
            return value;
        }
    }

    /**
     * Find the value for a given key in the object
     * @param {Object} haystack - The object to search in
     * @param {string} needle   - The key for which we want the value
     */
    getValueByKey(haystack, needle) {
        for (const key of Object.keys(haystack)) {
            if (key === needle) {
                return haystack[key];
            } else if (typeof haystack[key] === "object" && !Array.isArray(haystack[key]) && haystack[key] !== null) {
                return this.getValueByKey(haystack[key], needle);
            }
        }
        return undefined;
    }

    /**
     * Creates an authorization header for Digest authentication
     * @param {string} uri - The uri (pathname) needed for the MD5 hash
     * @private
     */
    getAuthorizationHeader(uri) {

        const authScheme = /^[^\s]+/.exec(this.challenge);

        if (authScheme === null || authScheme[0] !== "Digest") {
            throw new Error("[TR064] Unexpected auth scheme: " + (authScheme || this.challenge));
        }

        const digestChallenge = this.challenge.replace(/^Digest /, "");

        const params = {};
        digestChallenge.split(",").forEach((p) => {
            p = p.split("=");
            params[p[0]] = p[1].replace(/"/g, "");
        });

        // FRITZ!Box Digest auth
        // response = MD5( H1 : nonce : H2 )
        // H1 = MD5( username : realm : password )
        // H2 = MD5( method : uri )

        const hash1 = crypto.createHash("MD5");
        hash1.update(this.username + ":" + params["realm"] + ":" + this.password);

        const hash2 = crypto.createHash("MD5");
        hash2.update("POST" + ":" + uri);

        const response = crypto.createHash("MD5");
        response.update(hash1.digest("hex") + ":" + params["nonce"] + ":" + hash2.digest("hex"));

        const username = encodeURIComponent(this.username);

        // Digest username="", realm="", nonce="", uri="", [algorithm=MD5,] response=""

        return `Digest username="${username}", realm="${params["realm"]}", nonce="${params["nonce"]}", uri="${uri}", response="${response.digest("hex")}"`;
    }

    /**
     * Sets the HTTPS port
     * @param {number} port - Port number
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
}

module.exports = TR064;
