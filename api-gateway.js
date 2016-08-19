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
var uuid = require('uuid');
var ms = require('ms');

var app = express();

app.use(logger('dev'));
app.use(cors({ origin: conf.allowOrigin }));
app.use(timeout(conf.httpTimeout));
app.use(bodyParser.json({ limit: conf.maxRequestSize }));
app.use(bodyParser.urlencoded({ extended: false }));
app.use(cookieParser());

app.use(function(req, httpRes, next) {
  var subject = createSubject(req);
  var message = createMessage(req);
  
  log.debug('Sending message to', subject, message);    

  bus.request(subject, message, ms(conf.busTimeout)).then(function(busRes) {

    log.debug('Got reply', busRes.data);
    
    httpRes
      .status(busRes.status)
      .header('X-Fruster-Req-Id', busRes.reqId)
      .json(conf.unwrapMessageData ? busRes.data : busRes);

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
      .header('X-Fruster-Req-Id', err.reqId)
      .json(err);    
  });

});

/**
 * Transforms request path to bus subject.
 * 
 * Examples:
 * `GET /cat/123 => http.get.cat.123`
 * `POST / => http.post`
 * 
 * @param  {Object} req to transform
 * @return {String} bus subject
 */
function createSubject(req) {
  var method = req.method;
  var path = req.path.split('/');
  return ['http', method]
    .concat(path)
    .filter(function (val) {return val;})
    .join('.').toLowerCase();
}

function createMessage(req) {  
  return {
    reqId: uuid.v1(),
    method: req.method,
    path: req.path,
    query: req.query,
    headers: req.headers,
    data: req.body
  };
}

function mergeResponses(httpResp, busResponse) {
  httpResp.status = busResponse.status;
}

// // catch 404 and forward to error handler
// app.use(function(req, res, next) {
//   var err = new Error('Not Found');
//   err.status = 404;
//   next(err);
// });

// error handlers  
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

