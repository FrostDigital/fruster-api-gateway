const conf = require("./conf");
const log = require("fruster-log");
const bus = require("fruster-bus");
const apiGateway = require("./api-gateway");
const FrusterWebBus = require("./lib/web-bus/FrusterWebBus");
const FrusterSSEManager = require("./lib/sse/FrusterSSEManager");

require("fruster-health").start(bus);

apiGateway
	.start(conf.bus, conf.mongoUrl, conf.port)
	.then((server) => {
		// Initialize WebBus for WebSocket connections
		new FrusterWebBus(server);

		// Initialize SSE Manager for Server-Sent Events
		// Get the Express app from the server
		const app = server._events.request;
		new FrusterSSEManager(app);

		return server;
	})
	.then(() => {
		log.info("HTTP server started (listening on %s) and connected bus (%s)", conf.port, conf.bus);
	})
	.catch((err) => {
		log.error("Failed to start API Gateway:", err);
		process.exit(1);
	});
