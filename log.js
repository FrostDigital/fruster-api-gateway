var winston = require('winston');
var conf = require('./conf');

module.exports = new winston.Logger({
  transports: [        
    new winston.transports.Console({
      level: conf.logLevel,
      handleExceptions: true,
      json: false,
      colorize: true
    })
  ],
  exitOnError: false
});
