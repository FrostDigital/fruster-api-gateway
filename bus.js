var conf = require('./conf');
var nats = require('nats');
var ms = require('ms');
var log = require('./log');

var client, timeoutMs = ms(conf.busTimeout);

function init() {
  client = nats.connect({servers: conf.bus });
  log.info('Connecting to NATS bus', conf.bus);
  
  client.on('error', function(e) {
    log.error('Error [' + client.options.url + ']: ' + e);
  });
}

function publish(subject, json) {
  client.publish(subject, serializeMsg(json));
}

function request(subject, json, cb) {
  var id = client.request(subject, serializeMsg(json), null, function(response) {
    log.debug('Got response', response);
    cb(null, response);          
  }); 

  // Timeout
  client.timeout(id, timeoutMs, 1, function() {
    client.unsubscribe(id);    
    log.debug('Timeout after', timeoutMs, 'ms');
    cb(new Error('Bus timeout'));
  });
}

function serializeMsg(msg) {
  return JSON.stringify(msg);
}

module.exports = {
  init: init,
  publish: publish,
  request: request
};