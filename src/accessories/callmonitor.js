/**
 * callmonitor.js
 * homebridge-fritzbox
 *
 * @copyright 2025 Hendrik Meinl
 */

"use strict";

const net = require("node:net");

class CallMonitor {

    constructor(platform, accessory) {

        this.platform = platform;
        this.accessory = accessory;

        this.log = platform.log;
        this.api = platform.api;

        this.Service = platform.api.hap.Service;
        this.Characteristic = platform.api.hap.Characteristic;

        this.calls = new Map();
        this.lastError = null;


        // Accessory information

        this.accessoryInformation = this.accessory.getService(this.Service.AccessoryInformation);
        this.accessoryInformation
            .setCharacteristic(this.Characteristic.Manufacturer, this.accessory.context.device.manufacturer)
            .setCharacteristic(this.Characteristic.SerialNumber, this.accessory.context.device.serialNo)
            .setCharacteristic(this.Characteristic.Model, this.accessory.context.device.model)
            .setCharacteristic(this.Characteristic.FirmwareRevision, this.accessory.context.device.fwversion);


        // Motion sensor

        this.service = this.accessory.getService(this.Service.MotionSensor) || this.accessory.addService(this.Service.MotionSensor);

        this.service.setCharacteristic(this.Characteristic.Name, this.accessory.displayName);

        this.accessory.context.device.state.MotionDetected = false;
        this.service.getCharacteristic(this.Characteristic.MotionDetected)
            .onGet(this.onGet.bind(this));


        // Caller IDs to watch for

        this.callerIDs = null;

        if (platform.config.services?.CallMonitorCallerIDs) {
            if (/^[-0-9, ]+$/.test(platform.config.services.CallMonitorCallerIDs)) {
                this.callerIDs = platform.config.services.CallMonitorCallerIDs
                    .split(",")
                    .map(id => id.replaceAll(/[- ]/g, ""))
                    .filter(id => id !== "");
            } else {
                try {
                    this.callerIDs = new RegExp(platform.config.services.CallMonitorCallerIDs);
                } catch (error) {
                    this.log.error("[CallMonitor] Invalid Regular Expression. Not filtering caller IDs.");
                }
            }
        }
    }

    onGet() {
        if (this.lastError !== null) {
            throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.OUT_OF_RESOURCE);
        }
        return this.accessory.context.device.state.MotionDetected;
    }

    init(host) {

        this.socket = new net.Socket();

        this.socket.on("data", (data) => {
            this.parseData(data.toString());
        });

        this.socket.on("close", () => {

            if (this.lastError === null) {

                this.log.warn("[CallMonitor] FRITZ!Box closed connection. Trying to reconnect...");

                setTimeout(() => {
                    this.connect(host);
                }, 1000);

            } else if (this.lastError.code === "EHOSTUNREACH" || this.lastError.code === "ENETUNREACH") {

                this.log.error("[CallMonitor] Cannot reach FRITZ!Box. Trying again in 5 minutes.");

                setTimeout(() => {
                    this.connect(host);
                }, (5 * 60 * 1000));

            } else if (this.lastError.code === "ECONNREFUSED") {

                this.log.error("[CallMonitor] FRITZ!Box refused connection. Did you dial #96*5* to activate?");

                this.socket.destroy();

            } else {

                this.log.error("[CallMonitor] Error: %s", this.lastError.message);
                this.log.debug(this.lastError);

                this.socket.destroy();
            }
        });

        this.socket.on("error", (error) => {

            this.calls.clear();
            this.lastError = error;

            this.accessory.context.device.state.MotionDetected = false;
            this.service.updateCharacteristic(
                this.Characteristic.MotionDetected,
                new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.OUT_OF_RESOURCE)
            );
        });

        this.connect(host);
    }

    connect(host) {
        this.socket.connect(1012, host, () => {

            this.calls.clear();
            this.lastError = null;

            this.accessory.context.device.state.MotionDetected = false;
            this.service.updateCharacteristic(this.Characteristic.MotionDetected, this.accessory.context.device.state.MotionDetected);

            this.log.info("CallMonitor active");
        });
    }

    parseData(data) {

        const msg = data.split(";");

        const connectionType = msg[1];
        const connectionID   = msg[2];

        if (connectionType === "RING") {

            const callerID = msg[3];

            if (this.callerIDs !== null) {
                if (
                    (Array.isArray(this.callerIDs) && !this.callerIDs.includes(callerID)) ||
                    (this.callerIDs instanceof RegExp && !this.callerIDs.test(callerID))
                ) {
                    return;
                }
            }

            this.log.info("Incoming call: %s", callerID);

            this.calls.set(connectionID, callerID);
        }

        if (connectionType === "DISCONNECT") {
            this.calls.delete(connectionID);
        }

        this.accessory.context.device.state.MotionDetected = (this.calls.size > 0);
        this.service.updateCharacteristic(this.Characteristic.MotionDetected, this.accessory.context.device.state.MotionDetected);
    }
}

module.exports = CallMonitor;
