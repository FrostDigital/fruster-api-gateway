const express = require('express');
const fs = require('fs');
const _ = require('lodash');
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
const request = require('request');

const reqIdHeader = 'X-Fruster-Req-Id';

const app = express();
const dateStarted = new Date();

var util = require('util');

app.use(cors({
  origin: conf.allowOrigin
}));
app.use(timeout(conf.httpTimeout));
app.use(bodyParser.json({
  limit: conf.maxRequestSize
}));
app.use(bodyParser.urlencoded({
  extended: false
}));
app.use(cookieParser());
app.use(bearerToken());

app.get('/health', function (req, res) {
  res.json({
    status: 'Alive since ' + dateStarted
  });
});

app.use(function (httpReq, httpRes, next) {
  const reqId = uuid.v4();
  log.debug(httpReq.method, httpReq.path, reqId);

  decodeToken(httpReq, reqId)
    .then(decodedToken => proxyToBusRequest(httpReq, httpRes, reqId, decodedToken))
    .catch(err => handleError(err, httpRes, reqId));
});

app.use(function (err, req, res, next) {
  res.status(err.status || 500);

  var json = {
    message: err.message
  };

  if (conf.printStacktrace) {
    json.stacktrace = err.stack;
  }

  res.json(json);

  if (res.status === 500) {
    console.error(err.stack);
  }
});

function handleError(err, httpRes, reqId) {
  log.debug('Got error', err.status, err.error, "for", reqId);

  /*
   * Translates 408 timeout to 404 since timeout indicates that no one 
   * subscribed on subject
   */
  if (err.status == 408) {
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

/*
 * Token comes either in cookie or in header Authorization: Bearer <token>
 */
function decodeToken(httpReq, reqId) {
  var encodedToken = getToken(httpReq);

  if (encodedToken) {
    var decodeReq = {
      reqId: reqId,
      data: encodedToken
    };

    return bus
      .request('auth-service.decode-token', decodeReq)
      .then(resp => resp.data)
      .catch(err => {
        if (err.status == 401 || err.status == 403) {
          log.debug('Failed to decode token (got error ' + err.code + ') will expire cookie if present');
          err.headers = err.headers ||  {};
          err.headers['Set-Cookie'] = 'jwt=deleted; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT';
        }
        throw err;
      });
  }

  return Promise.resolve({});
}

function getToken(httpReq) {
  var token;

  if (httpReq.token) {
    token = httpReq.token;
  } else if (httpReq.cookies[conf.authCookieName]) {
    token = httpReq.cookies[conf.authCookieName];
  }

  return token;
}

function proxyToBusRequest(httpReq, httpRes, reqId, decodedToken) {
  let subject = utils.createSubject(httpReq);
  let message = utils.createRequest(httpReq, reqId, decodedToken);

  return optionsCall()
    .then(checkProtocol);

  function optionsCall() {
    return bus.request("options." + subject, message, ms(conf.busTimeout));
  }

  function checkProtocol(resp) {
    log.debug("Request", reqId, "will use", resp.data.protocol, "protocol");
    log.silly(resp);

    switch (resp.data.protocol) {
    case "NATS":
      return busCall();
    case "HTTP":
      return httpCall(resp.data.http)
        .then(prepareResponse);
    }
  }

  function busCall() {
    log.debug('Sending to subject', subject);
    log.silly(message);

    return bus.request(subject, message, ms(conf.busTimeout))
      .then((busRes) => {
        log.debug('Got reply', busRes.status);
        log.silly(busRes.data);

        setRequestId(reqId, busRes);

        httpRes
          .status(busRes.status)
          .set(busRes.headers)
          .header(reqIdHeader, reqId)
          .json(conf.unwrapMessageData ? busRes.data : utils.sanitizeResponse(busRes));
      });
  }

  function httpCall(httpOptions) {
    log.debug(httpReq.method.toLowerCase() + ' to url ' + httpOptions.url);
    log.silly(message);

    if (httpReq.headers["content-type"] && httpReq.headers["content-type"].includes("multipart")) {
      let requestOptions = {
        uri: httpOptions.url
      };
      httpReq.headers.data = JSON.stringify(message);

      return new Promise(resolve => {
        httpReq
          .pipe(request[httpReq.method.toLowerCase()](requestOptions, (error, response, returnBody) => {
            if (!error) {
              var body = typeof returnBody === "string" ? JSON.parse(returnBody) : returnBody;
              body.headers = response.headers;
              resolve(body);
            } else {
              let errorObj = {
                status: 500,
                error: error
              };
              handleError(errorObj, httpRes, message.reqId);
            }
          }));
      });
    } else {
      let requestOptions = {
        uri: httpOptions.url,
        json: message,
        'content-type': message.headers['content-type']
      };

      return new Promise(resolve => {
        request[httpReq.method.toLowerCase()](requestOptions, (error, response, body) => {
          if (!error) {
              body.headers = response.headers;
            resolve(body);
          } else {
            let errorObj = {
              status: 500,
              error: error
            };
            handleError(errorObj, httpRes, message.reqId);
          }
        });
      });
    }
  }

  function prepareResponse(resp) {

    log.debug('Got reply', resp.status);
    log.silly(resp);

    setRequestId(reqId, resp);

    httpRes
      .status(resp.status)
      .set(resp.headers)
      .header(reqIdHeader, reqId)
      .header("status", resp.status)
      .json(conf.unwrapMessageData ? resp.data : utils.sanitizeResponse(resp));
  }
}

function setRequestId(reqId, resp) {
  if (resp.reqId != reqId) {
    log.warn('Request id in bus response (' + resp.reqId + ') does not match the one set by API gateway (' + reqId + ')');
    resp.reqId = reqId;
  }
}

module.exports = {
  start: function (httpServerPort, busAddress) {

    var startHttpServer = new Promise(function (resolve, reject) {
      http.createServer(app)
        .listen(httpServerPort)
        .on('error', reject)
        .on('listening', resolve);
    });

    var connectToBus = function () {
      return bus.connect(busAddress);
    };

    return startHttpServer.then(connectToBus);
  }
};