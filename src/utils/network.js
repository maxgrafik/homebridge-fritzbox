/**
 * network.js
 * homebridge-fritzbox
 *
 * @copyright 2025 Hendrik Meinl
 */

"use strict";

const SSDP = require("./ssdp");
const { XMLParser } = require("fast-xml-parser");

class Network {

    constructor() {
        this.ssdp = new SSDP();
        this.parser = new XMLParser();
    }

    /**
     * Discover FRITZ! devices on the network
     * @returns {Promise<URL[]>} - Device urls as returned from ssdp#discover
     * @public
     */
    async discover() {

        const deviceURLs = [];

        const locations = await this.ssdp.discover();

        for (const location of locations) {

            const url = new URL(location);

            if (await this.isMeshMaster(url)) {
                deviceURLs.push(url);
            }
        }

        return deviceURLs;
    }

    /**
     * Check, if device is mesh master or cable box
     * @param   {URL}              url - Location as returned from ssdp#discover
     * @returns {Promise<boolean>}     - true/false
     * @private
     */
    async isMeshMaster(url) {

        const boxInfo = await this.getBoxInfo(url);

        let flags = boxInfo?.["j:BoxInfo"]?.["j:Flag"];
        if (!flags) {
            return false;
        }

        if (!Array.isArray(flags)) {
            flags = [flags];
        }

        const allowedDeviceRoles = [
            "mesh_master",
            "mesh_master_no_trusted",
            "cable_retail"
        ];

        for (const flag of flags) {
            if (allowedDeviceRoles.includes(flag)) {
                return true;
            }
        }

        return false;
    }

    /**
     * Get jason_boxinfo.xml
     * @param   {URL}             url - Location as returned from ssdp#discover
     * @returns {Promise<Object>}     - Contents of jason_boxinfo.xml
     * @private
     */
    async getBoxInfo(url) {

        const response = await fetch(`http://${url.hostname}/jason_boxinfo.xml`);

        if (!response.ok) {
            throw new Error("[Network] Error getting jason_boxinfo.xml: " + response.status + " " + response.statusText);
        }

        const data = await response.text();
        const obj  = this.parser.parse(data, true);

        return obj;
    }
}

module.exports = Network;
