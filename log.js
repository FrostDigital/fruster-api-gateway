var log = require('winston');
var conf = require('./conf');

log.level = conf.logLevel;

module.exports = log;