const bus = require("fruster-bus");
const log = require("fruster-log");
const conf = require("../../conf");
const uuid = require("uuid");
const AuthServiceClient = require("../clients/AuthServiceClient");

class FrusterSSEManager {
	static get endpoints() {
		return {
			SEND_EVENT_TO_CLIENT: "sse.out.:userId.>",
			SEND_EVENT_TO_ALL_CLIENTS: "sse.out.*.>",
		};
	}

	constructor(app) {
		this._connections = {}; // userId -> { channelName -> [connections] }
		this._channelConnections = {}; // channelName -> [connections]

		this._setupRoutes(app);
		this._setupBusSubscriptions();

		// Setup heartbeat interval
		setInterval(() => this._sendHeartbeat(), conf.sseHeartbeatInterval);

		log.info("SSE Manager initialized");
	}

	_setupRoutes(app) {
		app.get("/sse/:channelName", this._handleSSERequest.bind(this));
		log.debug("SSE routes registered");
	}

	_setupBusSubscriptions() {
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
		const channelName = req.params.channelName;
		const reqId = uuid.v4();

		// Set SSE headers
		res.writeHead(200, {
			"Content-Type": "text/event-stream",
			"Cache-Control": "no-cache",
			Connection: "keep-alive",
		});

		// Send initial connection established message
		res.write(`data: ${JSON.stringify({ type: "connection_established" })}\n\n`);

		try {
			// Get JWT token from request
			const jwtToken = this._getJwtFromRequest(req);
			let userId;

			if (jwtToken) {
				// Authenticate user
				const user = await AuthServiceClient.decodeToken(reqId, jwtToken);
				userId = user.id;

				log.debug(`Authenticated user ${userId} for SSE channel ${channelName}`);
			} else if (conf.allowPublicSSEConnections) {
				// Generate anonymous user ID for public connections if allowed
				userId = `public-${uuid.v4()}`;
				log.debug(`Created anonymous user ${userId} for SSE channel ${channelName}`);
			} else {
				// Reject unauthenticated connections if public connections not allowed
				log.warn(`Rejected unauthenticated SSE connection attempt for channel ${channelName}`);
				res.write(`data: ${JSON.stringify({ type: "error", message: "Authentication required" })}\n\n`);
				res.end();
				return;
			}

			// Check connection limits
			if (
				this._connections[userId] &&
				Object.values(this._connections[userId]).flat().length >= conf.maxSSEConnectionsPerUser
			) {
				log.warn(`User ${userId} exceeded maximum SSE connections limit`);
				res.write(`data: ${JSON.stringify({ type: "error", message: "Maximum connections exceeded" })}\n\n`);
				res.end();
				return;
			}

			// Store connection
			this._addConnection(userId, channelName, res);

			// Handle client disconnect
			req.on("close", () => {
				this._removeConnection(userId, channelName, res);
				log.debug(`SSE connection closed for user ${userId} on channel ${channelName}`);
			});

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

		// Iterate through all connections and send a comment to keep the connection alive
		Object.values(this._connections).forEach((userChannels) => {
			Object.values(userChannels).forEach((connections) => {
				connections.forEach((connection) => {
					try {
						connection.write(": heartbeat\n\n");
						totalConnections++;
					} catch (err) {
						// Connection might be closed, will be cleaned up on next client disconnect
					}
				});
			});
		});

		if (totalConnections > 0) {
			log.debug(`Sent heartbeat to ${totalConnections} SSE connections`);
		}
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

	_removeConnection(userId, channelName, connection) {
		// Remove from user's channel connections
		if (this._connections[userId] && this._connections[userId][channelName]) {
			this._connections[userId][channelName] = this._connections[userId][channelName].filter(
				(conn) => conn !== connection
			);

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
	}

	_getJwtFromRequest(req) {
		// Try to get JWT from cookie
		if (req.cookies && req.cookies[conf.authCookieName]) {
			return req.cookies[conf.authCookieName];
		}

		// Try to get JWT from Authorization header
		if (req.headers.authorization) {
			return req.headers.authorization.replace("Bearer ", "");
		}

		// Try to get JWT from query parameter
		if (req.query.token) {
			return req.query.token;
		}

		return null;
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

module.exports = FrusterSSEManager;
