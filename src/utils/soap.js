/**
 * soap.js
 * homebridge-fritzbox
 *
 * @copyright 2025 Hendrik Meinl
 */

class SOAPRequest {

    constructor(serviceType, actionName, actionArgs) {

        const XMLversion  = "1.0";
        const XMLschema   = "http://schemas.xmlsoap.org/soap/envelope/";
        const XMLencoding = "http://schemas.xmlsoap.org/soap/encoding/";

        const args = [];
        if (typeof actionArgs === "object" && !Array.isArray(actionArgs) && actionArgs !== null) {
            for (const [key, value] of Object.entries(actionArgs)) {
                args.push(`<${key}>${value}</${key}>`);
            }
        }

        this.message = [
            `<?xml version="${XMLversion}"?>`,
            `<s:Envelope xmlns:s="${XMLschema}" s:encodingStyle="${XMLencoding}">`,
            "<s:Body>",
            `<u:${actionName} xmlns:u="${serviceType}">`,
            ...args,
            `</u:${actionName}>`,
            "</s:Body>",
            "</s:Envelope>"
        ].join("");
    }
}

module.exports = SOAPRequest;
