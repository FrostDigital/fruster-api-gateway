'use strict';

var express = require('express');
var logger = require('morgan');
var cookieParser = require('cookie-parser');
var bodyParser = require('body-parser');
var conf = require('./conf');
var bus = require('fruster-bus');
var cors = require('cors');
var http = require('http');
var timeout = require('connect-timeout');
var log = require('./log');
var ms = require('ms');
var utils = require('./utils');

const reqIdHeader = 'X-Fruster-Req-Id';

var app = express();

app.use(logger('dev'));
app.use(cors({ origin: conf.allowOrigin }));
app.use(timeout(conf.httpTimeout));
app.use(bodyParser.json({ limit: conf.maxRequestSize }));
app.use(bodyParser.urlencoded({ extended: false }));
app.use(cookieParser());

app.use(function(req, httpRes, next) {
  var subject = utils.createSubject(req);
  var message = utils.createMessage(req);
  
  log.debug('Sending to subject', subject, 'message', message);    

  bus.request(subject, message, ms(conf.busTimeout)).then(function(busRes) {

    log.debug('Got reply', busRes.data);    

    httpRes
      .status(busRes.status)
      .set(busRes.headers)
      .header(reqIdHeader, busRes.reqId)
      .json(conf.unwrapMessageData ? busRes.data : utils.sanitizeResponse(busRes));

  }).catch(function(err) {
    log.debug('Got error', err.status, err.title, err.detail);

    // Translate 408 timeout to 404 since timeout indicates that no one 
    // subscribed on subject
    if(err.status == 408) {
      err.status = 404;
      httpRes.status(404);
    } else {
      httpRes.status(err.status);
    }

    httpRes      
      .set(err.headers)
      .header(reqIdHeader, err.reqId)
      .json(err);    
  });

});

app.use(function(err, req, res, next) {  
  res.status(err.status || 500);
  
  var json = {
    message: err.message
  };

  if(conf.printStacktrace) {    
    json.stacktrace = err.stack;
  }
  
  res.json(json);

  if(res.status === 500) {
    console.error(err.stack);    
  }
});


module.exports = {
  start: function(httpServerPort, busAddress) {
    
    var startHttpServer = new Promise(function(resolve, reject) {      
      http.createServer(app)
        .listen(httpServerPort)
        .on('error', reject)
        .on('listening', resolve);
    });

    var connectToBus = function() {
      return bus.connect(busAddress);
    };  

    return startHttpServer.then(connectToBus);
  }
};

