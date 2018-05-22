const conf = require("./conf");
const log = require("fruster-log");
const apiGateway = require("./api-gateway");
const FrusterWebBus = require("./lib/web-bus/FrusterWebBus");

require("fruster-health").start();

apiGateway.start(conf.bus, conf.mongoUrl, conf.port)
	.then(server => new FrusterWebBus(server))
	.then(() => {
		log.info("HTTP server started (listening on %s) and connected bus (%s)", conf.port, conf.bus);
	})
	.catch((err) => {
		log.error("Failed to start API Gateway:", err);
		process.exit(1);
	});