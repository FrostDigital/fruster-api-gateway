'use strict';

var express = require('express');
var logger = require('morgan');
var cookieParser = require('cookie-parser');
var bodyParser = require('body-parser');
var conf = require('./conf');
var bus = require('./bus');
var cors = require('cors');
var http = require('http');
var timeout = require('connect-timeout');
var log = require('./log');

var app = express();

bus.init();

app.use(logger('dev'));

app.use(cors({
  origin: conf.allowOrigin
}));

app.use(timeout(conf.httpTimeout));

// TODO: Pre-flight 
//app.options('*', cors()); // include before other routes

app.use(bodyParser.json({ limit: conf.maxRequestSize }));
app.use(bodyParser.urlencoded({ extended: false }));
app.use(cookieParser());

app.use(function(req, res, next) {
  var subject = createSubject(req);
  var message = createMessage(req);
  
  log.debug('Sending message to', subject, message);    

  bus.request(subject, message, function(err, reply) {
    if(err) {
      // At the moment any error indicates timeout due to missing answer from bus
      var notFoundErr = new Error('Not found');
      notFoundErr.status = 404;
      next(notFoundErr);
    }
    
    log.debug('Got reply %j', reply);
  });

  //next();
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
    method: req.method,
    path: req.path,
    query: req.query,
    headers: req.headers
  };
}

// catch 404 and forward to error handler
app.use(function(req, res, next) {
  var err = new Error('Not Found');
  err.status = 404;
  next(err);
});

// error handlers  
app.use(function(err, req, res, next) {
  
  res.status(err.status || 500);
  
  res.json({
    message: err.message,    
    stacktrace: conf.printStacktrace ? err.stack : null
  });
  
  if(res.status === 500) {
    console.error(err.stack);    
  }
});

http.createServer(app)
  .listen(conf.port)
  .on('error', function(err) {
    log.error('Failed starting server:', err);
  })
  .on('listening', function() {
    log.info('HTTP server listening on', conf.port);
  });
