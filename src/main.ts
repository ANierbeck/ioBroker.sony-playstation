/**
 * Created with @iobroker/create-adapter v2.1.1
 */

// The adapter-core module gives you access to the core ioBroker functions
// you need to create an adapter
import * as utils from "@iobroker/adapter-core";
import { throws } from "assert";

// Load your modules here, e.g.:
// import * as fs from "fs";

// const {Device} = require('ps4-waker');
//const {Detector} = require('ps4-waker').Detector;
const ps4waker = require('ps4-waker');

//import * as ps4waker from "ps4-waker";


//var ps4: typeof Device;
//var detector = new Detector();

interface PlaystationDevice {
	name: string;
	ip: string;
}

class SonyPlaystation extends utils.Adapter {

	private pollAPITimer: NodeJS.Timeout | undefined;
    private readonly pollAPIInterval: number;

	public constructor(options: Partial<utils.AdapterOptions> = {}) {
		super({
			...options,
			name: "sony-playstation",
		});

		// this.pollAPIInterval = 60_000 * 10;
		this.pollAPIInterval = 60000;

		this.on("ready", this.onReady.bind(this));
		this.on("stateChange", this.onStateChange.bind(this));
		this.on("objectChange", this.onObjectChange.bind(this));
		this.on("message", this.onMessage.bind(this));
		this.on("unload", this.onUnload.bind(this));
	}

	/**
	 * Is called when databases are connected and adapter received configuration.
	 */
	private async onReady(): Promise<void> {
		// Initialize your adapter here

		// The adapters config (in the instance object everything under the attribute "native") is accessible via
		// this.config:
		this.log.info("Search Timeout: " + this.config.searchTimeOut);

		/*
		For every state in the system there has to be also an object of type state
		Here a simple template for a boolean variable named "testVariable"
		Because every adapter instance uses its own unique namespace variable names can't collide with other adapters variables
		*/
		await this.setObjectNotExistsAsync("testVariable", {
			type: "state",
			common: {
				name: "testVariable",
				type: "boolean",
				role: "indicator",
				read: true,
				write: true,
			},
			native: {},
		});

		// In order to get state updates, you need to subscribe to them. The following line adds a subscription for our variable we have created above.
		this.subscribeStates("testVariable");
		// You can also add a subscription for multiple states. The following line watches all states starting with "lights."
		// this.subscribeStates("lights.*");
		// Or, if you really must, you can also watch all states. Don't do this if you don't need to. Otherwise this will cause a lot of unnecessary load on the system:
		// this.subscribeStates("*");

		/*
			setState examples
			you will notice that each setState will cause the stateChange event to fire (because of above subscribeStates cmd)
		*/
		// the variable testVariable is set to true as command (ack=false)
		await this.setStateAsync("testVariable", true);

		// same thing, but the value is flagged "ack"
		// ack should be always set to true if the value is received from or acknowledged from the target system
		await this.setStateAsync("testVariable", { val: true, ack: true });

		// same thing, but the state is deleted after 30s (getState will return null afterwards)
		await this.setStateAsync("testVariable", { val: true, ack: true, expire: 30 });

		// examples for the checkPassword/checkGroup functions
		let result = await this.checkPasswordAsync("admin", "iobroker");
		this.log.info("check user admin pw iobroker: " + result);

		result = await this.checkGroupAsync("admin", "admin");
		this.log.info("check group user admin group admin: " + result);

		this.log.debug("synchronizing configuration with state");

		await this.syncConfig();
		this.pollAPI();
	}

	/**
	 * Is called when adapter shuts down - callback has to be called under any circumstances!
	 */
	private onUnload(callback: () => void): void {
		try {
			// Here you must clear all timeouts or intervals that may still be active
			// clearTimeout(timeout1);
			// clearTimeout(timeout2);
			// ...
			// clearInterval(interval1);
			this.log.info("Shutting down Sony Playstation adapter");
			callback();
		} catch (e) {
			callback();
		}
	}

	// If you need to react to object changes, uncomment the following block and the corresponding line in the constructor.
	// You also need to subscribe to the objects with `this.subscribeObjects`, similar to `this.subscribeStates`.
	/**
	 * Is called if a subscribed object changes
	 */
	private onObjectChange(id: string, obj: ioBroker.Object | null | undefined): void {
		if (obj) {
			// The object was changed
			this.log.info(`object ${id} changed: ${JSON.stringify(obj)}`);
		} else {
			// The object was deleted
			this.log.info(`object ${id} deleted`);
		}
	}

	/**
	 * Is called if a subscribed state changes
	 */
	private onStateChange(id: string, state: ioBroker.State | null | undefined): void {
		if (state) {
			// The state was changed
			this.log.info(`state ${id} changed: ${state.val} (ack = ${state.ack})`);
		} else {
			// The state was deleted
			this.log.info(`state ${id} deleted`);
		}
	}

	//If you need to accept messages in your adapter, uncomment the following block and the corresponding line in the constructor.
	/**
	 * Some message was sent to this instance over message box. Used by email, pushover, text2speech, ...
	 * Using this method requires "common.messagebox" property to be set to true in io-package.json
	 */
	private onMessage(obj: ioBroker.Message): void {
		this.log.info("onMessage called with: "+obj.command);
		let wait = false;
	
		switch (obj.command) {
			case "send":
				// e.g. send email or pushover or whatever
				this.log.info("send command");

				// Send response in callback if required
				if (obj.callback) this.sendTo(obj.from, obj.command, "Message received", obj.callback);

				break;
			
			case "browse":
				this.log.info("case 'browse' as command");
				this.browse(res => obj.callback && this.sendTo(obj.from, obj.command, res, obj.callback));
				wait = true;
				break;
			
			default:
				this.log.warn('Unknown command: ' + obj.command);
				break;
		}
		
		if (!wait && obj.callback) {
            this.sendTo(obj.from, obj.command, obj.message, obj.callback);
        }
	}

	private async syncConfig() {
		this.log.debug("sync State");
		const devices = await this.getDevicesAsync();

		let configDevices:PlaystationDevice[] = this.config.devices;
		
		/* for (let i = 0; i < devices.length; i++) {
			
		} */
		this.log.debug("retrieved devices: "+JSON.stringify(devices));
		this.log.debug("configured devices: "+JSON.stringify(configDevices));

		if (devices && devices.length) {
			let missingDevices = [];
			let toRemoveDevices = [];
			for (let d = 0; d < devices.length; d++) {
				this.log.debug("Device to check: "+ JSON.stringify(devices[d]));
				let states = await this.getStatesOfAsync(devices[d]._id);
				this.log.debug("States: "+JSON.stringify(states));
				for (let s = 0; s < states.length; s++) {
					this.log.debug("State: "+JSON.stringify(states[s]));
					if (states[s].common.role === "address") {
						this.log.debug("Verifying if the found device with the same address also exists in config");
						let state = await this.getStateAsync( states[s]._id);
						if (!state) {
							this.log.warn("No State found for given State Obj: "+JSON.stringify(states[s]));
							continue;
						}
						let foundExisting = false;
						for (let c = 0; c < this.config.devices.length; c++ ) {
							this.log.debug("Config IP: "+this.config.devices[c].ip+ " Device-State IP: "+state.val);
							if (this.config.devices[c].ip === state.val) {
								this.log.debug("Found Device with IP: "+this.config.devices[c].ip);
								foundExisting = true;
								continue;
							} 
							this.log.debug("Found missing Device with IP address: "+this.config.devices[c].ip);
							missingDevices.push(this.config.devices[c]);
						}
						if(!foundExisting) {
							this.log.debug("No config found for Device: "+ JSON.stringify(devices[d]));
							toRemoveDevices.push(devices[d]);
						}
					}
				}

				this.log.debug("Devices to be removed: "+toRemoveDevices.length);
				this.log.debug("Devices to be added: "+missingDevices.length);

				toRemoveDevices.forEach(device => {
					this.log.debug("remove Device, as it doesn't exist in Config: "+JSON.stringify(device))
					this.deleteDeviceAsync(device._id);
				});

				missingDevices.forEach(device => {
					this.log.debug("adding Device as found in config, but missing in devices: "+JSON.stringify(device));
					this.createDeviceChannel(device.name, device.ip);
				});
			}
			
		} else {
			this.log.debug("only new config found, adding those");
			for (let r = 0; r < this.config.devices.length; r++) {
				if (!this.config.devices[r].ip) {
					this.log.debug("Following device is missing an IP-Address: "+JSON.stringify(this.config.devices[r]));
					continue;
				}
				this.log.debug("adding channel");
				const obj = await this.createDeviceChannel(this.config.devices[r].name, this.config.devices[r].ip);
				const _obj = await this.getObjectAsync(obj.id);
			}
		}
	}

	private async createDeviceChannel(name: any, ip: any) {
		this.log.debug("Create Device Channel with Name: "+name+" and IP: "+ip);
		const id = ip.replace(/[.\s]+/g, '_');
		const statesList: string[] = [];
		
		const obj = await this.createDeviceAsync(id);

		this.log.debug("Created Channel Obj: "+JSON.stringify(obj));

		await this.createStateAsync(id, '', 'state', { 
            type:   'string',
            read:   true,
            write:  true,
            role:   'state',
            name:   'Power Status Active'
        });

		let nameState = await this.createStateAsync(id, '', 'name', {
			type:   'string',
            read:   true,
            write:  true,
            role:   'name',
            name:   'Name of Playstation'
		});

		this.log.debug("created Name-State: "+JSON.stringify(nameState));

		let addressState = await this.createStateAsync(id, '', 'address', {
			type:   'string',
            read:   true,
            write:  true,
            role:   'address',
            name:   'IP address of Playstation'
		});

		this.log.debug("created Adress-State: "+JSON.stringify(addressState));

		await this.setStateAsync(id+".name", name);

		await this.setStateAsync(id+".address", ip);


		/* await this.setObjectNotExistsAsync(id, {
			type: "state",
			common: {
				name: "powerStatusActive",
				type: "string",
				role: "boolean",
				read: true,
				write: true,
			},
			native: {},
		}); */
		
		return obj;
	}

	private browse(callback: (res: any[]) => void) {

		this.log.info("Browse function called");

		//const result = [];
	
		var deviceOptions = new Map();
		//deviceOptions.set("debug","true");
		deviceOptions.set("timeout", this.config.searchTimeOut);
	
		// var ps4 = new Device(deviceOptions);
	
		// try {
		// 	let deviceStatus = ps4.getDeviceStatus();
		// 	this.log.debug("Device Status: "+deviceStatus.Status);
		// 	this.log.debug(JSON.stringify(deviceStatus, null, 2));
		// 	for (let i = 0; i < deviceStatus.)
		// 	result.push(deviceStatus);
		// } catch (e) {
		// 	this.log.debug("Failed to search for PS4");
		// }

		this.log.debug("Calling detector with options: "+deviceOptions);
		//var discovery = Detector.detect(deviceOptions)
		var detector = new ps4waker.Detector();
		// var discovery = detector.find(null, deviceOptions);

		//discovery is a promise ... 
		var discovery = ps4waker.Detector.findAny(deviceOptions, (err:any, device:any, rinfo:any) => {

			if (err === undefined) {
				this.log.error(err.message);
				callback(err);
			} else {
				this.log.debug("discovered: "+JSON.stringify(device, null, 2));
				
				//let obj = JSON.parse(device);

				//this.log.debug("as obj: "+ obj);
				this.log.debug("Name: "+device['host-name']);
				this.log.debug("address: " + device['address']);

				let result = [];
				if (device) {
					var x = {ip:device['address']===undefined ? '' : device['address'], name:device['host-name']};
					this.log.debug("adding to result: "+x);
					result.push(x)
				}
				
				this.log.info("calling callback");
				callback && callback(result);
			}

			
			
		});
	}
	
	/**
     * Poll states from API and syncs them to ioBroker states
     */
	 private async pollAPI(): Promise<void> {
		this.log.info("Poll PS4 state");

		this.config.devices.forEach(device => {
			try {
				let deviceOptions = {
					"debug":true,
					"timeout":parseInt(this.config.searchTimeOut)*1000,
					"address":device.ip,
				};
				this.log.debug("Device Options: "+JSON.stringify(deviceOptions));
				let ps4Device = new ps4waker.Device(deviceOptions);
				this.log.debug("retrieving device status for device with IP: "+device.ip);

				ps4Device.getDeviceStatus().then((element:any) => {
					this.log.debug(`PS4-Device: ${JSON.stringify(element)}`);
					const id = device.ip.replace(/[.\s]+/g, '_');
					this.setStateAsync(id+".state", element["status"]);
				}, 
				(error:Error) => {
					this.log.warn(`Could not poll API: ${this.errorToText(error)}`);
				}).then(() => ps4Device.close());

			} catch (e) {
				this.log.warn(`Could not poll API: ${this.errorToText(e)}`);
			}
		});

		

        this.pollAPITimer = setTimeout(() => {
            this.pollAPI();
        }, this.pollAPIInterval);
    }

	    /**
     * Checks if a real error was thrown and returns message then, else it stringifies
     *
     * @param error any kind of thrown error
     */
	private errorToText(error: unknown): string {
		if (error instanceof Error) {
			return error.message;
		} else {
			return JSON.stringify(error);
		}
	}	
}


if (require.main !== module) {
	// Export the constructor in compact mode
	module.exports = (options: Partial<utils.AdapterOptions> | undefined) => new SonyPlaystation(options);
} else {
	// otherwise start the instance directly
	(() => new SonyPlaystation())();
}
