const bus = require("fruster-bus");
const log = require("fruster-log");
const conf = require("../../conf");
const uuid = require("uuid");

class FrusterSSEManager {
	static get endpoints() {
		return {
			SEND_EVENT_TO_CLIENT: "sse.out.:userId.>",
			SEND_EVENT_TO_ALL_CLIENTS: "sse.out.*.>",
		};
	}

	constructor() {
		this._connections = {}; // userId -> { channelName -> [connections] }
		this._channelConnections = {}; // channelName -> [connections]

		// this._setupRoutes(app);
		// this._setupBusSubscriptions();

		// Setup heartbeat interval
		setInterval(() => this._sendHeartbeat(), conf.sseHeartbeatInterval);

		log.info("SSE Manager initialized");
	}

	setupRoutes(app) {
		app.get("/sse/:channelName", this._handleSSERequest.bind(this));
		log.debug("SSE routes registered");
	}

	setupBusSubscriptions() {
		log.debug(
			"Registering SSE bus subscriptions",
			FrusterSSEManager.endpoints.SEND_EVENT_TO_CLIENT,
			FrusterSSEManager.endpoints.SEND_EVENT_TO_ALL_CLIENTS
		);
		// Subscribe to user-specific events
		bus.subscribe({
			subject: FrusterSSEManager.endpoints.SEND_EVENT_TO_CLIENT,
			createQueueGroup: false, // No SSE endpoint should register queue groups since clients may be spread over several instances
			handle: (req, replyTo, actualSubject) => this._handleEventToClient(req, actualSubject),
		});

		// Subscribe to broadcast events
		bus.subscribe({
			subject: FrusterSSEManager.endpoints.SEND_EVENT_TO_ALL_CLIENTS,
			createQueueGroup: false, // No SSE endpoint should register queue groups since clients may be spread over several instances
			handle: (req, replyTo, actualSubject) => this._handleEventToAllClients(req, actualSubject),
		});

		log.debug("SSE bus subscriptions registered");
	}

	async _handleSSERequest(req, res) {
		log.debug("Handling SSE request...");
		const channelName = req.params.channelName;
		const reqId = req.reqId || uuid.v4();

		// The gateway-wide request timeout (connect-timeout, HTTP_TIMEOUT) must not
		// apply to a stream that is meant to stay open: when it fired, the error
		// handler tore the socket down, so every stream was rebuilt every
		// HTTP_TIMEOUT and each rebuild was a chance to miss a close.
		if (typeof req.clearTimeout === "function") req.clearTimeout();

		// Set SSE headers
		res.writeHead(200, {
			"Content-Type": "text/event-stream",
			"Cache-Control": "no-cache",
			Connection: "keep-alive",
		});

		// Send initial connection established message
		res.write(`data: ${JSON.stringify({ type: "connection_established" })}\n\n`);

		try {
			// Check if user is authenticated
			if (!req.user || !req.user.id) {
				// Reject unauthenticated connections
				log.warn(`Rejected unauthenticated SSE connection attempt for channel ${channelName}`);
				res.write(`data: ${JSON.stringify({ type: "error", message: "Authentication required" })}\n\n`);
				res.end();
				return;
			}

			const userId = req.user.id;
			log.debug(`Authenticated user ${userId} for SSE channel ${channelName}`);

			// Check connection limits, after dropping streams that are already dead
			// so that a missed close never locks a user out for the pod's lifetime.
			this._pruneDeadConnections(userId);

			if (this._countUserConnections(userId) >= conf.maxSSEConnectionsPerUser) {
				log.warn(`User ${userId} exceeded maximum SSE connections limit`);
				res.write(`data: ${JSON.stringify({ type: "error", message: "Maximum connections exceeded" })}\n\n`);
				res.end();
				return;
			}

			// Store connection
			this._addConnection(userId, channelName, res);

			// Release on whichever end goes away first. Removal is idempotent, so
			// listening on both request and response is safe; relying on the
			// request's close alone is what leaked streams behind the proxy.
			const release = (reason) => {
				if (this._removeConnection(userId, channelName, res)) {
					log.debug(`SSE connection closed (${reason}) for user ${userId} on channel ${channelName}`);
				}
			};

			req.on("close", () => release("request closed"));
			req.on("error", () => release("request error"));
			if (typeof res.on === "function") {
				res.on("close", () => release("response closed"));
				res.on("finish", () => release("response finished"));
				res.on("error", () => release("response error"));
			}

			// The client may already be gone by the time we get here.
			if (isDead(res)) {
				release("already closed");
				return;
			}

			log.info(`SSE connection established for user ${userId} on channel ${channelName}`);
		} catch (err) {
			log.error(`Error establishing SSE connection: ${err.message}`, err);
			res.write(`data: ${JSON.stringify({ type: "error", message: "Failed to establish connection" })}\n\n`);
			res.end();
		}
	}

	_handleEventToClient(req, actualSubject) {
		// Extract userId and channelName from subject
		// Format: sse.out.userId.channelName
		const parts = actualSubject.split(".");
		const userId = parts[2];
		const channelName = parts.slice(3).join(".");

		log.debug(`Handling SSE event for user ${userId} on channel ${channelName}`);
		this._sendEventToUser(userId, channelName, req.data);

		return {
			status: 200,
			reqId: req.reqId,
		};
	}

	_handleEventToAllClients(req, actualSubject) {
		// Extract channelName from subject
		// Format: sse.out.*.channelName
		const parts = actualSubject.split(".");
		const channelName = parts.slice(3).join(".");

		log.debug(`Broadcasting SSE event to all users on channel ${channelName}`);
		this._broadcastToChannel(channelName, req.data);

		return {
			status: 200,
			reqId: req.reqId,
		};
	}

	_sendEventToUser(userId, channelName, data) {
		if (this._connections[userId] && this._connections[userId][channelName]) {
			const connections = this._connections[userId][channelName];
			log.debug(
				`Sending event to ${connections.length} connections for user ${userId} on channel ${channelName}`
			);

			connections.forEach((connection) => {
				try {
					connection.write(`data: ${JSON.stringify(data)}\n\n`);
				} catch (err) {
					log.error(`Error sending event to user ${userId} on channel ${channelName}: ${err.message}`);
					// Connection might be closed, will be cleaned up on next client disconnect
				}
			});
		}
	}

	_broadcastToChannel(channelName, data) {
		if (this._channelConnections[channelName]) {
			const connections = this._channelConnections[channelName];
			log.debug(`Broadcasting event to ${connections.length} connections on channel ${channelName}`);

			connections.forEach((connection) => {
				try {
					connection.write(`data: ${JSON.stringify(data)}\n\n`);
				} catch (err) {
					log.error(`Error broadcasting to channel ${channelName}: ${err.message}`);
					// Connection might be closed, will be cleaned up on next client disconnect
				}
			});
		}
	}

	_sendHeartbeat() {
		let totalConnections = 0;
		let pruned = 0;

		// Send a comment to keep every live stream open, and drop the ones that
		// are dead: writing to a closed response does not throw, so without this
		// check a stream whose close event was missed stayed registered forever.
		Object.keys(this._connections).forEach((userId) => {
			Object.keys(this._connections[userId] || {}).forEach((channelName) => {
				[...(this._connections[userId][channelName] || [])].forEach((connection) => {
					if (isDead(connection)) {
						this._removeConnection(userId, channelName, connection);
						pruned++;
						return;
					}

					try {
						connection.write(": heartbeat\n\n");
						totalConnections++;
					} catch (err) {
						this._removeConnection(userId, channelName, connection);
						pruned++;
					}
				});
			});
		});

		if (pruned > 0) {
			log.info(`Pruned ${pruned} dead SSE connections`);
		}

		if (totalConnections > 0) {
			log.debug(`Sent heartbeat to ${totalConnections} SSE connections`);
		}
	}

	/**
	 * Drops the user's streams whose response is already closed. Returns how many were dropped.
	 */
	_pruneDeadConnections(userId) {
		let pruned = 0;

		Object.keys(this._connections[userId] || {}).forEach((channelName) => {
			[...(this._connections[userId][channelName] || [])].forEach((connection) => {
				if (isDead(connection)) {
					this._removeConnection(userId, channelName, connection);
					pruned++;
				}
			});
		});

		if (pruned > 0) {
			log.info(`Pruned ${pruned} dead SSE connections for user ${userId}`);
		}

		return pruned;
	}

	_countUserConnections(userId) {
		return Object.values(this._connections[userId] || {}).flat().length;
	}

	_addConnection(userId, channelName, connection) {
		// Initialize user's connections if not exists
		if (!this._connections[userId]) {
			this._connections[userId] = {};
		}

		// Initialize user's channel connections if not exists
		if (!this._connections[userId][channelName]) {
			this._connections[userId][channelName] = [];
		}

		// Initialize channel connections if not exists
		if (!this._channelConnections[channelName]) {
			this._channelConnections[channelName] = [];
		}

		// Add connection to user's channel connections
		this._connections[userId][channelName].push(connection);

		// Add connection to channel connections
		this._channelConnections[channelName].push(connection);

		// Log connection stats
		const totalUserConnections = Object.values(this._connections[userId]).flat().length;
		const totalChannelConnections = this._channelConnections[channelName].length;

		log.debug(
			`User ${userId} now has ${totalUserConnections} total SSE connections (${this._connections[userId][channelName].length} on channel ${channelName})`
		);
		log.debug(`Channel ${channelName} now has ${totalChannelConnections} total connections`);
	}

	/**
	 * Removes a connection. Idempotent; returns true only the first time
	 * the connection is actually removed.
	 */
	_removeConnection(userId, channelName, connection) {
		let removed = false;

		// Remove from user's channel connections
		if (this._connections[userId] && this._connections[userId][channelName]) {
			const before = this._connections[userId][channelName].length;
			this._connections[userId][channelName] = this._connections[userId][channelName].filter(
				(conn) => conn !== connection
			);
			removed = this._connections[userId][channelName].length < before;

			// Clean up empty arrays
			if (this._connections[userId][channelName].length === 0) {
				delete this._connections[userId][channelName];
				log.debug(`Removed last connection for user ${userId} on channel ${channelName}`);
			}

			if (Object.keys(this._connections[userId]).length === 0) {
				delete this._connections[userId];
				log.debug(`Removed last connection for user ${userId}`);
			}
		}

		// Remove from channel connections
		if (this._channelConnections[channelName]) {
			this._channelConnections[channelName] = this._channelConnections[channelName].filter(
				(conn) => conn !== connection
			);

			if (this._channelConnections[channelName].length === 0) {
				delete this._channelConnections[channelName];
				log.debug(`Removed last connection for channel ${channelName}`);
			}
		}

		return removed;
	}

	// For testing and monitoring
	getStats() {
		const userCount = Object.keys(this._connections).length;
		const channelCount = Object.keys(this._channelConnections).length;

		let connectionCount = 0;
		Object.values(this._connections).forEach((userChannels) => {
			Object.values(userChannels).forEach((connections) => {
				connectionCount += connections.length;
			});
		});

		return {
			users: userCount,
			channels: channelCount,
			connections: connectionCount,
		};
	}
}

/**
 * Whether a response can no longer be written to: ended by us, destroyed,
 * or sitting on a socket that has gone away.
 */
function isDead(res) {
	if (!res) return true;
	if (res.destroyed || res.writableEnded || res.finished) return true;
	if (res.socket && res.socket.destroyed) return true;
	return false;
}

module.exports = FrusterSSEManager;
