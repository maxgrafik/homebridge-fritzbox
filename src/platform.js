/**
 * platform.js
 * homebridge-fritzbox
 *
 * @copyright 2025 Hendrik Meinl
 */

"use strict";

const PLATFORM_NAME = "FRITZ!Box";
const PLUGIN_NAME = "homebridge-fritzbox";

const path = require("node:path");
const fsPromises = require("node:fs/promises");

const Network = require("./utils/network");
const TR064 = require("./utils/tr064");
const SmartHome = require("./utils/smarthome");
const HomeKitHelper = require("./utils/homekit-helper");

const FritzBox = require("./accessories/fritzbox");
const Accessories = require("./accessories");
const DeviceDB = require("./accessories/deviceDB.json");

class FritzBoxPlatform {

    constructor(log, config, api) {

        if (!api || !config) {
            return;
        }

        this.log = log;
        this.config = config;
        this.api = api;

        this.accessories = new Map();
        this.discoveredCacheUUIDs = [];

        this.FritzBox = null;
        this.SmartHome = null;
        this.SmartHomeAccessories = [];

        this.lastUpdate = 0;

        api.on("didFinishLaunching", () => {
            this.discoverDevices().then((isSetupOK) => {

                // clean up
                this.accessories.clear();
                this.discoveredCacheUUIDs = [];

                if (isSetupOK) {

                    this.updateDevices();

                } else {

                    this.FritzBox = null;
                    this.SmartHome = null;
                    this.SmartHomeAccessories = [];

                    this.log.error("Plugin stopped");
                }

            }).catch((error) => {

                // clean up
                this.accessories.clear();
                this.discoveredCacheUUIDs = [];
                this.FritzBox = null;
                this.SmartHome = null;
                this.SmartHomeAccessories = [];

                this.log.error(error.message || error);
                this.log.error("Plugin stopped");
            });
        });
    }

    configureAccessory(accessory) {
        this.accessories.set(accessory.UUID, accessory);
    }

    async discoverDevices() {

        let fritzboxURL = null;

        if (this.config.advanced?.host && this.config.advanced?.host !== "") {

            fritzboxURL = new URL(`http://${this.config.advanced.host}:49000/tr64desc.xml`);

        } else {

            this.log.info("Searching devices...");

            const network = new Network();
            const deviceURLs = await network.discover();

            if (deviceURLs.length === 0) {
                this.log.info("No FRITZ!Box found");
                return;
            } else if (deviceURLs.length > 1) {
                this.log.info("%s devices found. Please configure the IP for the FRITZ!Box you would like to use", deviceURLs.length);
                this.log.info("Available options: %s", deviceURLs.map(url => url.hostname).join(", "));
                return;
            }

            fritzboxURL = deviceURLs[0];
        }

        const tr064 = new TR064(this.log, this.config);
        await tr064.init(fritzboxURL);

        this.log.info("Device found: %s", tr064.deviceInfo.displayName);
        this.log.info("Starting interview...");


        // This is where we actually make assumptions about the available services and actions.
        // These depend on FRITZ!OS version and possible changes to the TR-064 implementation.
        // Any changes to the TR-064 implementation could be adjusted here. The rest of the
        // code should pretty much be unaffected ... at least I hope ;)


        // Get security port if SSL enabled
        if (this.config.advanced?.SSL) {
            const securityPort = await tr064.send("urn:dslforum-org:service:DeviceInfo:1", "GetSecurityPort");
            if (securityPort?.["NewSecurityPort"] !== undefined) {
                tr064.setSecurityPort(securityPort["NewSecurityPort"]);
            }
        }

        // If no username and/or password given -> check if anonymous login is enabled
        if (!this.config.password) {
            const anonLogin = await tr064.send("urn:dslforum-org:service:LANConfigSecurity:1", "X_AVM-DE_GetAnonymousLogin");
            if (anonLogin?.["NewX_AVM-DE_AnonymousLoginEnabled"] !== true) {
                this.log.error("It seems this FRITZ!Box does not allow access without a username and/or at least a password");
                return;
            }
        }

        // If no username, but password given -> get default user
        // Use X_AVM-DE_GetCurrentUser as stated in "AVM TR-064 - First Steps", chapter 4.1 Authentication.
        // If anonymous login is enabled, we may use any username for authentication instead of a configured one.
        // If anonymous login is NOT enabled, we need a valid username since this action requires authentication.
        // According to TR-064 specification (chapter 4.2 Authentication) the default username is "dslf-config"

        let defaultUser = null;

        if (!this.config.username && this.config.password) {
            try {
                tr064.setDefaultUser("dslf-config");
                const currentUser = await tr064.send("urn:dslforum-org:service:LANConfigSecurity:1", "X_AVM-DE_GetCurrentUser");
                if (currentUser?.["NewX_AVM-DE_CurrentUsername"] === undefined) {
                    this.log.error("It seems this FRITZ!Box does not support retrieving a valid username");
                    return;
                }
                defaultUser = currentUser["NewX_AVM-DE_CurrentUsername"];
                tr064.setDefaultUser(defaultUser);
            } catch (error) {
                this.log.debug(error.message || error);
                this.log.error("Something went wrong. Are you sure this FRITZ!Box supports login without a username?");
                return;
            }
        }


        //! WLAN

        const wlan = [];

        if (this.config.services?.WLAN === "guest" || this.config.services?.WLAN === "all") {

            const serviceType = "urn:dslforum-org:service:WLANConfiguration:";
            const actionName = "GetInfo";

            let ver = 1;
            while (await tr064.hasService(`${serviceType}${ver}`)) {
                const wlanInfo = await tr064.send(`${serviceType}${ver}`, actionName);
                if (wlanInfo) {
                    wlan.push({
                        id      : ver,
                        name    : wlanInfo["NewSSID"],
                        subtype : `FritzBox-WLAN-${ver}`,
                        enabled : wlanInfo["NewEnable"],
                        service : `${serviceType}${ver}`,
                        actions : ["GetInfo", "SetEnable"],
                        args    : { "NewEnable": "enabled" },
                    });
                }
                ver++;
            }

            this.log.debug("[Interview] Found %s WLAN configuration(s)", wlan.length);

            if (this.config.services?.WLAN === "guest") {
                const guestWLAN = wlan.pop();
                this.log.debug("[Interview] Only adding guest WLAN: %s", guestWLAN.name);
                wlan.length = 0;
                wlan.push(guestWLAN);
            }
        }


        //! TAM (Telephone Answering Machine)

        const tam = [];

        if (this.config.services?.TAM) {

            const serviceType = "urn:dslforum-org:service:X_AVM-DE_TAM:1";
            const actionName = "GetList"; // X_AVM-DE_TAM:GetList added 2017-01-09

            if (await tr064.hasService(serviceType)) {
                const tamList = await tr064.send(serviceType, actionName);
                const items = tamList?.["NewTAMList"]?.["List"]?.["Item"] || [];
                for (const item of items) {

                    // As of this writing, the data type for "Display" is missing from x_tamSCPD.xml
                    // So we're not using a strict equality operator (===) here

                    // eslint-disable-next-line eqeqeq
                    if (item["Display"] == true) {
                        tam.push({
                            id      : item["Index"],
                            name    : item["Name"],
                            subtype : `FritzBox-TAM-${item["Index"]}`,
                            enabled : item["Enable"],
                            service : serviceType,
                            actions : ["GetInfo", "SetEnable"],
                            args    : { "NewIndex": "id", "NewEnable": "enabled" },
                        });
                    }
                }
            }
            this.log.debug("[Interview] Found %s configured answering machine(s)", tam.length);
        }


        //! Call deflection

        const deflection = [];

        if (this.config.services?.CallDeflection) {

            const serviceType = "urn:dslforum-org:service:X_AVM-DE_OnTel:1";
            const actionName = "GetDeflections";

            if (await tr064.hasService(serviceType)) {
                const deflectionList = await tr064.send(serviceType, actionName);
                const items = deflectionList?.["NewDeflectionList"]?.["List"]?.["Item"] || [];
                for (const item of items) {
                    if (item["DeflectionToNumber"] !== "") {
                        deflection.push({
                            id      : item["DeflectionId"],
                            name    : "Call Deflection",
                            subtype : `FritzBox-CD-${item["DeflectionId"]}`,
                            enabled : item["Enable"],
                            service : serviceType,
                            actions : ["GetDeflection", "SetDeflectionEnable"],
                            args    : { "NewDeflectionId": "id", "NewEnable": "enabled" },
                            configuredName : `Redirect to ${item["DeflectionToNumber"]}`,
                        });
                    }
                }
            }
            this.log.debug("[Interview] Found %s configured call deflection(s)", deflection.length);
        }


        //! SmartHome

        const smartHomeAccessories = [];

        if (this.config.services?.SmartHome) {

            const serviceType = "urn:dslforum-org:service:X_AVM-DE_Homeauto:1";

            if (await tr064.hasService(serviceType)) {

                this.Smarthome = new SmartHome(this.log, this.config, fritzboxURL);

                // Get security port if SSL enabled (AHA-HTTP-Interface, chapter 2)
                if (this.config.advanced?.SSL) {
                    const securityPort = await tr064.send("urn:dslforum-org:service:X_AVM-DE_RemoteAccess:1", "GetInfo");
                    if (securityPort?.["NewPort"] !== undefined) {
                        this.Smarthome.setSecurityPort(securityPort["NewPort"]);
                    }
                }

                if (defaultUser !== null) {
                    this.Smarthome.setDefaultUser(defaultUser);
                }

                const state = await this.Smarthome.getState();

                // Save device list for plugin support
                this.saveDeviceList(state);

                let useMappedColor = false;

                const deviceList = state?.["devicelist"]?.["device"] || [];
                for (const device of deviceList) {
                    if (device["present"] === "1") {

                        let services = [];
                        let characteristics = [];

                        let deviceDescription = DeviceDB[device["@productname"]];

                        if (deviceDescription === undefined) {
                            this.log.warn("Device not in database: %s", device["@productname"]);
                            deviceDescription = this.Smarthome.getServicesAndCharacteristics(device);
                        }

                        if (deviceDescription.services.length === 0) {
                            continue;
                        }

                        services = deviceDescription.services;
                        characteristics = deviceDescription.characteristics;

                        if (
                            (Object.hasOwn(device, "batterylow") || Object.hasOwn(device, "battery"))
                            && !services.includes("Battery")
                        ) {
                            services.push("Battery");
                            if (Object.hasOwn(device, "battery")) { characteristics.push("BatteryLevel"); }
                        }

                        if (services.includes("Lightbulb") && characteristics.includes("UseMappedColor")) {
                            useMappedColor = true;
                        }

                        smartHomeAccessories.push({
                            UUID        : this.api.hap.uuid.generate(`${device["@manufacturer"]} ${device["@identifier"]}`),
                            displayName : HomeKitHelper.getHomeKitFriendlyName(device["name"]),
                            device      : {
                                id             : device["@id"],            // Probably not needed
                                identifier     : device["@identifier"],
                                manufacturer   : device["@manufacturer"],  // TODO: Get manufacturer from code
                                serialNo       : device["@identifier"],
                                model          : device["@productname"] || "Generic Device",
                                fwversion      : device["@fwversion"],
                                services       : services,
                                characteristics: characteristics,
                                state          : {},
                            },
                        });
                    }
                }

                // If a lightbulb uses mapped colors, get ColorDefaults
                if (useMappedColor) {
                    await this.Smarthome.getColorDefaults();
                }

                this.log.debug("[Interview] Found %s connected smart home device(s)", smartHomeAccessories.length);
            }
        }


        // Configure Homebridge accessories

        this.log.info("Configuring accessories...");


        // Restore/Register FRITZ!Box

        const fritzbox = {
            UUID        : this.api.hap.uuid.generate(`${tr064.deviceInfo.model} ${tr064.deviceInfo.serialNo}`),
            displayName : HomeKitHelper.getHomeKitFriendlyName(tr064.deviceInfo.displayName),
            device : {
                manufacturer : tr064.deviceInfo.manufacturer,
                serialNo     : tr064.deviceInfo.serialNo,
                model        : tr064.deviceInfo.model,
                fwversion    : tr064.deviceInfo.fwversion,
                service      : "urn:dslforum-org:service:DeviceInfo:1",
                action       : "GetInfo",
                args         : { "NewSoftwareVersion": "fwversion" },
                switches     : [].concat(wlan, tam, deflection),
            }
        };

        if (fritzbox.device.switches.length > 0) {
            const existingFritzBox = this.accessories.get(fritzbox.UUID);
            if (existingFritzBox) {
                this.log.info("Restoring %s", existingFritzBox.displayName);

                // Restore configuredName (if any)
                for (const s of fritzbox.device.switches) {
                    const match = existingFritzBox.context.device.switches.find(e => e.subtype === s.subtype);
                    match && match.configuredName && (s.configuredName = match.configuredName);
                }

                existingFritzBox.context.device = fritzbox.device;
                this.api.updatePlatformAccessories([existingFritzBox]);
                this.FritzBox = new FritzBox(this, existingFritzBox, tr064);
            } else {
                this.log.info("Creating %s", fritzbox.displayName);
                const accessory = new this.api.platformAccessory(fritzbox.displayName, fritzbox.UUID);
                accessory.context.device = fritzbox.device;
                this.FritzBox = new FritzBox(this, accessory, tr064);
                this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
            }
            this.discoveredCacheUUIDs.push(fritzbox.UUID);
        }


        // Restore/Register smart home devices

        for (const smartHomeAccessory of smartHomeAccessories) {

            // Accessory Factory
            const AccessoryClass = Accessories[smartHomeAccessory.device.services[0]];
            if (AccessoryClass === undefined) {
                continue;
            }

            const existingAccessory = this.accessories.get(smartHomeAccessory.UUID);
            if (existingAccessory) {
                this.log.info("Restoring accessory %s", existingAccessory.displayName);
                existingAccessory.context.device = smartHomeAccessory.device;
                this.api.updatePlatformAccessories([existingAccessory]);
                this.SmartHomeAccessories.push(new(AccessoryClass)(this, existingAccessory, this.Smarthome));
            } else {
                this.log.info("Creating accessory %s", smartHomeAccessory.displayName);
                const accessory = new this.api.platformAccessory(smartHomeAccessory.displayName, smartHomeAccessory.UUID);
                accessory.context.device = smartHomeAccessory.device;
                this.SmartHomeAccessories.push(new(AccessoryClass)(this, accessory, this.Smarthome));
                this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
            }
            this.discoveredCacheUUIDs.push(smartHomeAccessory.UUID);
        }


        // Clean up

        for (const [uuid, accessory] of this.accessories) {
            if (!this.discoveredCacheUUIDs.includes(uuid)) {
                this.log.info("Removing accessory %s from cache", accessory.displayName);
                this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
            }
        }


        // We're done

        this.log.info("Ready");

        return true;
    }

    async updateDevices() {

        if (!this.Smarthome) {
            return;
        }

        const updateInterval = Math.max(5, (this.config.update?.smarthome || 15));

        const timeSinceLastUpdate = (Date.now() - this.lastUpdate) / 1000;
        if (timeSinceLastUpdate <= updateInterval) {
            return;
        }

        if (this.updateTimer) {
            clearInterval(this.updateTimer);
        }

        let state = null;

        try {
            state = await this.Smarthome.getState();
        } catch (error) {
            this.log.warn("An error occured while trying to update the state of smart home devices. Will try again");
            this.log.debug(error.message || error);
        }

        const deviceList = state?.["devicelist"]?.["device"] || [];
        for (const accessory of this.SmartHomeAccessories) {
            const identifier = accessory.accessory.context.device.identifier;
            for (const device of deviceList) {
                if (device["@identifier"] === identifier) {
                    accessory.update(device);
                    break;
                }
            }
        }

        this.updateTimer = setInterval(
            this.updateDevices.bind(this),
            updateInterval * 1000
        );
    }

    async saveDeviceList(deviceList) {

        const storagePath = this.api.user.storagePath();
        const filePath = path.join(storagePath, "fritzbox", "devicelist.json");

        try {
            await fsPromises.mkdir(path.dirname(filePath), { recursive: true });
            await fsPromises.writeFile(filePath, JSON.stringify(deviceList, null, 4), { encoding: "utf8" });
        } catch(error) {
            this.log.debug(error.message || error);
        }
    }
}

exports.FritzBoxPlatform = FritzBoxPlatform;
