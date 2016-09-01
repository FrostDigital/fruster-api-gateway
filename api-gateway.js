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
var uuid = require('uuid');
var bearerToken = require('express-bearer-token');

const reqIdHeader = 'X-Fruster-Req-Id';

var app = express();

app.use(logger('dev'));
app.use(cors({ origin: conf.allowOrigin }));
app.use(timeout(conf.httpTimeout));
app.use(bodyParser.json({ limit: conf.maxRequestSize }));
app.use(bodyParser.urlencoded({ extended: false }));
app.use(cookieParser());
app.use(bearerToken());

app.use(function(httpReq, httpRes, next) {
  const reqId = uuid.v4(); 
  
  log.debug(httpReq.statusCode, httpReq.path, reqId);

  decodeToken(httpReq, reqId)
    .then(decodedToken => proxyToBusRequest(httpReq, httpRes, reqId, decodedToken))
    .catch(err => handleError(err, httpRes));
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

function handleError(err, httpRes) {    
    log.debug('Got error', err.status, err.error);

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
}

function decodeToken(httpReq, reqId) {
  // Token comes either in cookie or in header Authorization: Bearer <token>

  var encodedToken = getToken(httpReq);

  if(encodedToken) {
    var decodeReq = {
      reqId: reqId, 
      data: encodedToken      
    };

    return bus
      .request('auth-service.decode-token', decodeReq)
      .then(resp => resp.data)
      .catch(err => {
        if(err.status == 401 || err.status == 403) {
          log.debug('Failed to decode token (got error ' + err.code + ') will expire cookie if present');
          err.headers = err.headers || {};
          err.headers['Set-Cookie'] = 'jwt=deleted; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT';          
        }
        throw err;
      });    
  }

  return Promise.resolve({});
}

function getToken(httpReq) {
  var token;

  if(httpReq.cookies[conf.authCookieName]) {
    token = httpReq.cookies[conf.authCookieName];
  }
  else if(httpReq.token) {
    token = httpReq.token;
  }

  return token;
}

function proxyToBusRequest(httpReq, httpRes, reqId, decodedToken) {
  var subject = utils.createSubject(httpReq);
  var message = utils.createResponse(httpReq, reqId, decodedToken);

  log.debug('Sending to subject', subject, 'message', message);    

  return bus.request(subject, message, ms(conf.busTimeout)).then(function(busRes) {
    log.debug('Got reply', busRes.data);    

    httpRes
      .status(busRes.status)
      .set(busRes.headers)
      .header(reqIdHeader, busRes.reqId)
      .json(conf.unwrapMessageData ? busRes.data : utils.sanitizeResponse(busRes));
  });
}

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

