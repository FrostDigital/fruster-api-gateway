'use strict';

var conf = require('./conf');
var log = require('fruster-log');
var apiGateway = require('./api-gateway');

apiGateway.start(conf.port, conf.bus)
.then(function() {
  log.info('HTTP server started (listening on %s) and connected bus (%s)', conf.port, conf.bus);
})
.catch(function(err) {
  log.error('Failed to start API Gateway:', err);
});
