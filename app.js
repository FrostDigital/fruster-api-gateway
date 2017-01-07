const conf = require("./conf");
const log = require("fruster-log");
const apiGateway = require("./api-gateway");

require("fruster-health").start();

apiGateway.start(conf.port, conf.bus)
.then(function() {
  log.info("HTTP server started (listening on %s) and connected bus (%s)", conf.port, conf.bus);
})
.catch(function(err) {
  log.error("Failed to start API Gateway:", err);
  process.exit(1);
});
