const express = require('express');
const logger = require('morgan');
const cookieParser = require('cookie-parser');
const bodyParser = require('body-parser');
const conf = require('./conf');
const bus = require('fruster-bus');
const cors = require('cors');
const http = require('http');
const timeout = require('connect-timeout');
const log = require('fruster-log');
const ms = require('ms');
const utils = require('./utils');
const uuid = require('uuid');
const bearerToken = require('express-bearer-token');

const reqIdHeader = 'X-Fruster-Req-Id';

const app = express();
const dateStarted = new Date();

app.use(logger('dev'));
app.use(cors({ origin: conf.allowOrigin }));
app.use(timeout(conf.httpTimeout));
app.use(bodyParser.json({ limit: conf.maxRequestSize }));
app.use(bodyParser.urlencoded({ extended: false }));
app.use(cookieParser());
app.use(bearerToken());

app.get('/health', function (req, res) {
  res.json({ status: 'Alive since ' + dateStarted });
});

app.use(function(httpReq, httpRes, next) {
  const reqId = uuid.v4(); 
  
  log.debug(httpReq.statusCode, httpReq.path, reqId);

  decodeToken(httpReq, reqId)
    .then(decodedToken => proxyToBusRequest(httpReq, httpRes, reqId, decodedToken))
    .catch(err => handleError(err, httpRes, reqId));
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

function handleError(err, httpRes, reqId) {    
    log.debug('Got error', err.status, err.error);

    // Translate 408 timeout to 404 since timeout indicates that no one 
    // subscribed on subject
    if(err.status == 408) {
      err.status = 404;
      httpRes.status(404);
    } else {
      httpRes.status(err.status);
    }

    setRequestId(reqId, err);
    
    httpRes      
      .set(err.headers)
      .header(reqIdHeader, reqId)
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

  if(httpReq.token) {
    token = httpReq.token;
  } else if(httpReq.cookies[conf.authCookieName]) {
    token = httpReq.cookies[conf.authCookieName];
  }

  return token;
}

function proxyToBusRequest(httpReq, httpRes, reqId, decodedToken) {
  var subject = utils.createSubject(httpReq);
  var message = utils.createRequest(httpReq, reqId, decodedToken);

  log.debug('Sending to subject', subject, 'message', message);    

  return bus.request(subject, message, ms(conf.busTimeout)).then(function(busRes) {
    log.debug('Got reply', busRes.data);    

    setRequestId(reqId, busRes);

    httpRes
      .status(busRes.status)
      .set(busRes.headers)
      .header(reqIdHeader, reqId)
      .json(conf.unwrapMessageData ? busRes.data : utils.sanitizeResponse(busRes));
  });
}

function setRequestId(reqId, resp) {
  if(resp.reqId != reqId) {
    log.warn('Request id in bus response (' + resp.reqId +') does not match the one set by API gateway (' + reqId + ')');
    resp.reqId = reqId;
  }  
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

