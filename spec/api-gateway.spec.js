var request = require('request'),
    fs = require('fs'),
    conf = require('../conf'),
    bus = require('fruster-bus'),
    nsc = require('./support/nats-server-control'),
    apiGw = require('../api-gateway');


describe('API Gateway', function() {
  var server;
  var httpPort = Math.floor(Math.random() * 6000 + 2000);
  var baseUri = 'http://127.0.0.1:' + httpPort;
  
  var busPort = Math.floor(Math.random() * 6000 + 2000);
  var busAddress = ['nats://localhost:' + busPort];

  beforeAll(function(done) {
    server = nsc.startServer(busPort, function(err) { 
      if(err) {
        done(err);
      }      
      
      function connectBus() {
        return bus.connect(busAddress);
      }

      apiGw
        .start(httpPort, busAddress)
        .then(connectBus)
        .then(done)
        .catch(done.fail);
    });
  });

  afterAll(function() {  
    server.kill();
  });

  
  it('should returns status code 404 if gateway does not recieve a response', function(done) {      
    get('/foo', function(error, response, body) {
      expect(response.statusCode).toBe(404);
      expect(body.status).toBe(404);
      done();      
    });      
  });

  it('should create and recieve bus message for HTTP GET', function(done) {
    bus.subscribe('http.get.foo', function(req) {            
      expect(req.path).toBe('/foo');      
      expect(req.method).toBe('GET');            
      expect(req.reqId).toBeDefined();            
      
      return { 
        status: 201,
        headers: {
          'A-Header': 'foo'
        },
        data: { 
          foo: 'bar' 
        } 
      };
    });

    get('/foo', function(error, response, body) {

      expect(response.statusCode).toBe(201);      
      expect(response.headers['a-header']).toBe('foo');
      expect(body.data.foo).toBe('bar');
      
      done();      
    }); 
  });

  it('should create and recieve bus message for HTTP GET in unwrapped mode', function(done) {
    conf.unwrapMessageData = true;

    bus.subscribe('http.get.foo', function(req) {      
      return { status: 200, data: { foo: 'bar' }};
    });

    get('/foo', function(error, response, body) {        
      expect(body.foo).toBe('bar');      
      conf.unwrapMessageData = false;
      done();      
    }); 
  });

  it('should return error status code from bus', function(done) {      
    bus.subscribe('http.post.bar', function(req) {      
      return { 
        status: 420,
        headers: {
          'x-foo': 'bar'
        }
      };
    });

    post('/bar', {}, function(error, response, body) {        
      expect(response.statusCode).toBe(420);      
      expect(response.headers['x-foo']).toBe('bar');      
      done();      
    });     
  });

  // it('block large requests', function(done) { 
  //   var formData = {      
  //     my_file: fs.createReadStream(__dirname + '/a-large-file.jpg')
  //   };

  //   request.post(baseUrl, {formData: formData}, function(error, response, body) {      
  //     expect(response.statusCode).toBe(500);
  //     done();      
  //   });      
  // });

  function get(path, cb) {
    doRequest('GET', path, true, cb);    
  }

  function post(path, json, cb) {
    doRequest('POST', path, json, cb);    
  }

  function put(path, json, cb) {
    doRequest('PUT', path, json, cb);    
  }

  function del(path, cb) {
    doRequest('DELETE', path, true, cb);    
  }

  function doRequest(method, path, json, cb) {
    request({
      uri: baseUri + path,        
      method: method,
      json: json || true
    }, cb);    
  }
});