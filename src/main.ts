/**
 * Created with @iobroker/create-adapter v2.1.1
 */

// The adapter-core module gives you access to the core ioBroker functions
// you need to create an adapter
import * as utils from "@iobroker/adapter-core";

const ps4waker = require("ps4-waker");

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
		this.log.info("onMessage called with: " + obj.command);
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

	private async syncConfig(): Promise<void> {
		this.log.debug("sync State");
		const devices = await this.getDevicesAsync();

		const configDevices: PlaystationDevice[] = this.config.devices;

		this.log.debug("retrieved devices: " + JSON.stringify(devices));
		this.log.debug("configured devices: " + JSON.stringify(configDevices));

		if (devices && devices.length) {
			const missingDevices = [];
			const toRemoveDevices = [];
			for (let d = 0; d < devices.length; d++) {
				this.log.debug("Device to check: " + JSON.stringify(devices[d]));
				const states = await this.getStatesOfAsync(devices[d]._id);
				this.log.debug("States: " + JSON.stringify(states));
				for (let s = 0; s < states.length; s++) {
					this.log.debug("State: " + JSON.stringify(states[s]));
					if (states[s].common.role === "address") {
						this.log.debug("Verifying if the found device with the same address also exists in config");
						const state = await this.getStateAsync(states[s]._id);
						if (!state) {
							this.log.warn("No State found for given State Obj: " + JSON.stringify(states[s]));
							continue;
						}
						let foundExisting = false;
						for (let c = 0; c < this.config.devices.length; c++) {
							this.log.debug(
								"Config IP: " + this.config.devices[c].ip + " Device-State IP: " + state.val,
							);
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
					this.log.debug(
						"adding Device as found in config, but missing in devices: " + JSON.stringify(device),
					);
					this.createDeviceChannel(device.name, device.ip);
				});
			}
		} else {
			this.log.debug("only new config found, adding those");
			for (let r = 0; r < this.config.devices.length; r++) {
				if (!this.config.devices[r].ip) {
					this.log.debug(
						"Following device is missing an IP-Address: " + JSON.stringify(this.config.devices[r]),
					);
					continue;
				}
				this.log.debug("adding channel");
				//const obj = await this.createDeviceChannel(this.config.devices[r].name, this.config.devices[r].ip);
				//const _obj = await this.getObjectAsync(obj.id);
			}
		}
	}

	private async createDeviceChannel(name: any, ip: any): Promise<object> {
		this.log.debug("Create Device Channel with Name: " + name + " and IP: " + ip);
		const id = ip.replace(/[.\s]+/g, "_");

		const obj = await this.createDeviceAsync(id);

		this.log.debug("Created Channel Obj: " + JSON.stringify(obj));

		await this.createStateAsync(id, "", "state", {
			type: "string",
			read: true,
			write: true,
			role: "state",
			name: "Power Status Active",
		}, true);

		const nameState = await this.createStateAsync(id, "", "name", {
			type: "string",
			read: true,
			write: true,
			role: "name",
			name: "Name of Playstation",
		}, true);

		this.log.debug("created Name-State: " + JSON.stringify(nameState));

		const addressState = await this.createStateAsync(id, "", "address", {
			type: "string",
			read: true,
			write: true,
			role: "address",
			name: "IP address of Playstation",
		}, true);

		this.log.debug("created Address-State: " + JSON.stringify(addressState));

		await this.setStateAsync(id + ".name", name, true);

		await this.setStateAsync(id + ".address", ip, true);
		return obj;
	}

	private browse(callback: (res: any[]) => void): void {
		this.log.info("Browse function called");

		const deviceOptions = new Map();
		//deviceOptions.set("debug","true");
		deviceOptions.set("timeout", this.config.searchTimeOut);

		this.log.debug("Calling detector with options: " + deviceOptions);

		//discovery is a promise ...
		ps4waker.Detector.findAny(deviceOptions, (err: any, device: any) => {
			if (err === undefined) {
				this.log.error(err.message);
				callback(err);
			} else {
				this.log.debug("discovered: " + JSON.stringify(device, null, 2));
				this.log.debug("Name: " + device["host-name"]);
				this.log.debug("address: " + device["address"]);

				const result = [];
				if (device) {
					const x = {
						ip: device["address"] === undefined ? "" : device["address"],
						name: device["host-name"],
					};
					this.log.debug("adding to result: " + x);
					result.push(x);
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

		this.config.devices.forEach((device) => {
			try {
				const deviceOptions = {
					debug: true,
					timeout: parseInt(this.config.searchTimeOut) * 1000,
					address: device.ip,
				};
				this.log.debug("Device Options: " + JSON.stringify(deviceOptions));
				const ps4Device = new ps4waker.Device(deviceOptions);
				this.log.debug("retrieving device status for device with IP: " + device.ip);

				ps4Device
					.getDeviceStatus()
					.then(
						(element: any) => {
							this.log.debug(`PS4-Device: ${JSON.stringify(element)}`);
							const id = device.ip.replace(/[.\s]+/g, "_");
							this.setStateAsync(id + ".state", element["status"], true);
						},
						(error: Error) => {
							this.log.warn(`Could not poll API: ${this.errorToText(error)}`);
						},
					)
					.then(() => ps4Device.close());
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
