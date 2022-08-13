"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var utils = __toESM(require("@iobroker/adapter-core"));
const ps4waker = require("ps4-waker");
class SonyPlaystation extends utils.Adapter {
  constructor(options = {}) {
    super({
      ...options,
      name: "sony-playstation"
    });
    this.pollAPIInterval = 6e4;
    this.on("ready", this.onReady.bind(this));
    this.on("stateChange", this.onStateChange.bind(this));
    this.on("objectChange", this.onObjectChange.bind(this));
    this.on("message", this.onMessage.bind(this));
    this.on("unload", this.onUnload.bind(this));
  }
  async onReady() {
    this.log.info("Search Timeout: " + this.config.searchTimeOut);
    await this.setObjectNotExistsAsync("testVariable", {
      type: "state",
      common: {
        name: "testVariable",
        type: "boolean",
        role: "indicator",
        read: true,
        write: true
      },
      native: {}
    });
    this.subscribeStates("testVariable");
    await this.setStateAsync("testVariable", true);
    await this.setStateAsync("testVariable", { val: true, ack: true });
    await this.setStateAsync("testVariable", { val: true, ack: true, expire: 30 });
    let result = await this.checkPasswordAsync("admin", "iobroker");
    this.log.info("check user admin pw iobroker: " + result);
    result = await this.checkGroupAsync("admin", "admin");
    this.log.info("check group user admin group admin: " + result);
    this.log.debug("synchronizing configuration with state");
    await this.syncConfig();
    this.pollAPI();
  }
  onUnload(callback) {
    try {
      this.log.info("Shutting down Sony Playstation adapter");
      callback();
    } catch (e) {
      callback();
    }
  }
  onObjectChange(id, obj) {
    if (obj) {
      this.log.info(`object ${id} changed: ${JSON.stringify(obj)}`);
    } else {
      this.log.info(`object ${id} deleted`);
    }
  }
  onStateChange(id, state) {
    if (state) {
      this.log.info(`state ${id} changed: ${state.val} (ack = ${state.ack})`);
    } else {
      this.log.info(`state ${id} deleted`);
    }
  }
  onMessage(obj) {
    this.log.info("onMessage called with: " + obj.command);
    let wait = false;
    switch (obj.command) {
      case "send":
        this.log.info("send command");
        if (obj.callback)
          this.sendTo(obj.from, obj.command, "Message received", obj.callback);
        break;
      case "browse":
        this.log.info("case 'browse' as command");
        this.browse((res) => obj.callback && this.sendTo(obj.from, obj.command, res, obj.callback));
        wait = true;
        break;
      default:
        this.log.warn("Unknown command: " + obj.command);
        break;
    }
    if (!wait && obj.callback) {
      this.sendTo(obj.from, obj.command, obj.message, obj.callback);
    }
  }
  async syncConfig() {
    this.log.debug("sync State");
    const devices = await this.getDevicesAsync();
    let configDevices = this.config.devices;
    this.log.debug("retrieved devices: " + JSON.stringify(devices));
    this.log.debug("configured devices: " + JSON.stringify(configDevices));
    if (devices && devices.length) {
      let missingDevices = [];
      let toRemoveDevices = [];
      for (let d = 0; d < devices.length; d++) {
        this.log.debug("Device to check: " + JSON.stringify(devices[d]));
        let states = await this.getStatesOfAsync(devices[d]._id);
        this.log.debug("States: " + JSON.stringify(states));
        for (let s = 0; s < states.length; s++) {
          this.log.debug("State: " + JSON.stringify(states[s]));
          if (states[s].common.role === "address") {
            this.log.debug("Verifying if the found device with the same address also exists in config");
            let state = await this.getStateAsync(states[s]._id);
            if (!state) {
              this.log.warn("No State found for given State Obj: " + JSON.stringify(states[s]));
              continue;
            }
            let foundExisting = false;
            for (let c = 0; c < this.config.devices.length; c++) {
              this.log.debug("Config IP: " + this.config.devices[c].ip + " Device-State IP: " + state.val);
              if (this.config.devices[c].ip === state.val) {
                this.log.debug("Found Device with IP: " + this.config.devices[c].ip);
                foundExisting = true;
                continue;
              }
              this.log.debug("Found missing Device with IP address: " + this.config.devices[c].ip);
              missingDevices.push(this.config.devices[c]);
            }
            if (!foundExisting) {
              this.log.debug("No config found for Device: " + JSON.stringify(devices[d]));
              toRemoveDevices.push(devices[d]);
            }
          }
        }
        this.log.debug("Devices to be removed: " + toRemoveDevices.length);
        this.log.debug("Devices to be added: " + missingDevices.length);
        toRemoveDevices.forEach((device) => {
          this.log.debug("remove Device, as it doesn't exist in Config: " + JSON.stringify(device));
          this.deleteDeviceAsync(device._id);
        });
        missingDevices.forEach((device) => {
          this.log.debug("adding Device as found in config, but missing in devices: " + JSON.stringify(device));
          this.createDeviceChannel(device.name, device.ip);
        });
      }
    } else {
      this.log.debug("only new config found, adding those");
      for (let r = 0; r < this.config.devices.length; r++) {
        if (!this.config.devices[r].ip) {
          this.log.debug("Following device is missing an IP-Address: " + JSON.stringify(this.config.devices[r]));
          continue;
        }
        this.log.debug("adding channel");
        const obj = await this.createDeviceChannel(this.config.devices[r].name, this.config.devices[r].ip);
        const _obj = await this.getObjectAsync(obj.id);
      }
    }
  }
  async createDeviceChannel(name, ip) {
    this.log.debug("Create Device Channel with Name: " + name + " and IP: " + ip);
    const id = ip.replace(/[.\s]+/g, "_");
    const statesList = [];
    const obj = await this.createDeviceAsync(id);
    this.log.debug("Created Channel Obj: " + JSON.stringify(obj));
    await this.createStateAsync(id, "", "state", {
      type: "string",
      read: true,
      write: true,
      role: "state",
      name: "Power Status Active"
    });
    let nameState = await this.createStateAsync(id, "", "name", {
      type: "string",
      read: true,
      write: true,
      role: "name",
      name: "Name of Playstation"
    });
    this.log.debug("created Name-State: " + JSON.stringify(nameState));
    let addressState = await this.createStateAsync(id, "", "address", {
      type: "string",
      read: true,
      write: true,
      role: "address",
      name: "IP address of Playstation"
    });
    this.log.debug("created Adress-State: " + JSON.stringify(addressState));
    await this.setStateAsync(id + ".name", name);
    await this.setStateAsync(id + ".address", ip);
    return obj;
  }
  browse(callback) {
    this.log.info("Browse function called");
    var deviceOptions = /* @__PURE__ */ new Map();
    deviceOptions.set("timeout", this.config.searchTimeOut);
    this.log.debug("Calling detector with options: " + deviceOptions);
    var detector = new ps4waker.Detector();
    var discovery = ps4waker.Detector.findAny(deviceOptions, (err, device, rinfo) => {
      if (err === void 0) {
        this.log.error(err.message);
        callback(err);
      } else {
        this.log.debug("discovered: " + JSON.stringify(device, null, 2));
        this.log.debug("Name: " + device["host-name"]);
        this.log.debug("address: " + device["address"]);
        let result = [];
        if (device) {
          var x = { ip: device["address"] === void 0 ? "" : device["address"], name: device["host-name"] };
          this.log.debug("adding to result: " + x);
          result.push(x);
        }
        this.log.info("calling callback");
        callback && callback(result);
      }
    });
  }
  async pollAPI() {
    this.log.info("Poll PS4 state");
    this.config.devices.forEach((device) => {
      try {
        let deviceOptions = {
          "debug": true,
          "timeout": parseInt(this.config.searchTimeOut) * 1e3,
          "address": device.ip
        };
        this.log.debug("Device Options: " + JSON.stringify(deviceOptions));
        let ps4Device = new ps4waker.Device(deviceOptions);
        this.log.debug("retrieving device status for device with IP: " + device.ip);
        ps4Device.getDeviceStatus().then(
          (element) => {
            this.log.debug(`PS4-Device: ${JSON.stringify(element)}`);
            const id = device.ip.replace(/[.\s]+/g, "_");
            this.setStateAsync(id + ".state", element["status"]);
          },
          (error) => {
            this.log.warn(`Could not poll API: ${this.errorToText(error)}`);
          }
        ).then(() => ps4Device.close());
      } catch (e) {
        this.log.warn(`Could not poll API: ${this.errorToText(e)}`);
      }
    });
    this.pollAPITimer = setTimeout(() => {
      this.pollAPI();
    }, this.pollAPIInterval);
  }
  errorToText(error) {
    if (error instanceof Error) {
      return error.message;
    } else {
      return JSON.stringify(error);
    }
  }
}
if (require.main !== module) {
  module.exports = (options) => new SonyPlaystation(options);
} else {
  (() => new SonyPlaystation())();
}
//# sourceMappingURL=main.js.map
