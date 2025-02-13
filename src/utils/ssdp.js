/**
 * ssdp.js
 * homebridge-fritzbox
 *
 * @copyright 2025 Hendrik Meinl
 */

"use strict";

const dgram = require("node:dgram");
const { Buffer } = require("node:buffer");

class SSDP {

    constructor() {
        this.devices = [];
        this.socket = dgram.createSocket("udp4");
        // this.socket = dgram.createSocket({ type: "udp4", reuseAddr: true });
    }

    /**
     * Discover UPnP devices using ssdp protocol
     * @returns {Promise<string[]>} - Locations reported by devices
     * @public
     */
    discover() {
        return new Promise((resolve, reject) => {

            this.devices = [];

            this.socket.on("error", (error) => {
                this.socket.close();
                reject("[SSDP] Socket: " + (error.message || error));
            });

            this.socket.on("message", (msg) => {

                const message = msg.toString();

                // Ignore "M-SEARCH" messages
                if (message.startsWith("M-SEARCH")) { return; }

                // Ignore "NOTIFY" alive messages
                if (message.startsWith("NOTIFY")) { return; }

                // Everything else should be "HTTP/1.1 200 OK"

                // Only handle InternetGatewayDevices
                const searchTarget = new RegExp("^ST:\\s+urn:dslforum-org:device:InternetGatewayDevice:1$", "m");
                if (!searchTarget.test(message)) {
                    return;
                }

                // Get location header
                const regex = new RegExp("^Location:\\s+(.+)$", "m");
                const location = regex.exec(message);
                if (location) {
                    this.devices.push(location[1]);
                }
            });

            this.socket.bind(1900, () => {

                const message = Buffer.from([
                    "M-SEARCH * HTTP/1.1",
                    "HOST: 239.255.255.250:1900",
                    "MAN: \"ssdp:discover\"",
                    "MX: 5",                                                // Max seconds to delay response
                    "ST: urn:dslforum-org:device:InternetGatewayDevice:1",  // Search target
                    "", ""
                ].join("\r\n"));

                this.socket.send(message, 1900, "239.255.255.250", (error) => {
                    if (error) {
                        reject("[SSDP] Send: " + (error.message || error));
                    }
                });

                setTimeout(() => {
                    this.socket.close();
                    resolve(this.devices);
                }, 5000);
            });
        });
    }
}

module.exports = SSDP;
