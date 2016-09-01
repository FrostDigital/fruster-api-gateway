var request = require('request'),
    fs = require('fs'),
    conf = require('../conf'),
    bus = require('fruster-bus'),
    nsc = require('nats-server-control'),
    apiGw = require('../api-gateway');


describe('API Gateway', function() {
  var natsServer;
  var baseUri; 
  
  beforeEach(done => {    
    var httpPort = Math.floor(Math.random() * 6000 + 2000);
    var busPort = Math.floor(Math.random() * 6000 + 2000);
    var busAddress = 'nats://localhost:' + busPort;    
    
    baseUri = 'http://127.0.0.1:' + httpPort;

    nsc.startServer(busPort)    
      .then(server => { natsServer = server; })
      .then(() => apiGw.start(httpPort, [busAddress]))
      .then(done)
      .catch(done.fail);
  });

  afterEach(() => {  
    if(natsServer) {    
      natsServer.kill();
    }
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
      expect(body.headers).toBeUndefined();
      
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
      expect(response.statusCode).toBe(200);      
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

    post('/bar', function(error, response, body) {        
      expect(response.statusCode).toBe(420);      
      expect(response.headers['x-foo']).toBe('bar');      
      done();      
    });     
  });

  it('should return 403 if validation of JWT cookie failed', function(done) {
    bus.subscribe('auth-service.decode-token', function(req) {  
      return { status: 403, error: { code: 'auth-service.403.1' } };
    });

    get('/foo', { cookie: 'jwt=acookie' } ,function(error, response, body) {        
      expect(response.statusCode).toBe(403);      
      expect(body.error.code).toBe('auth-service.403.1');      
      done();      
    }); 
  });

  it('should return 403 if validation of JWT in auth header failed', function(done) {
    bus.subscribe('auth-service.decode-token', function(req) {        
      expect(req.data).toBe('a-token');   
      return { status: 403, error: { code: 'auth-service.403.1' } };
    });

    get('/foo', { authorization: 'Bearer a-token' } ,function(error, response, body) {        
      expect(response.statusCode).toBe(403);      
      expect(body.error.code).toBe('auth-service.403.1');      
      done();      
    }); 
  });

  it('should set user data with decoded jwt cookie', function(done) {
    bus.subscribe('auth-service.decode-token', function(req) {      
      expect(req.data).toBe('acookie');   
      return { status: 200, data: 'decoded-cookie' };
    });

    bus.subscribe('http.get.foo', function(req) {   
      expect(req.user).toBe('decoded-cookie');   
      return { status: 200, data: { foo: 'bar' }};
    });

    get('/foo', { cookie: 'jwt=acookie' },function(error, response, body) {        
      expect(response.statusCode).toBe(200); 
      expect(body.user).toBeUndefined();     
      done();      
    }); 
  });

  it('should set user data with decoded jwt in auth header', function(done) {
    bus.subscribe('auth-service.decode-token', function(req) {      
      expect(req.data).toBe('a-token');   
      return { status: 200, data: 'decoded-cookie' };
    });

    bus.subscribe('http.get.foo', function(req) { 
      expect(req.user).toBe('decoded-cookie');   
      return { status: 200, data: { foo: 'bar' }};
    });

    get('/foo', { authorization: 'Bearer a-token' },function(error, response, body) {        
      expect(response.statusCode).toBe(200);       
      expect(body.user).toBeUndefined();       
      done();      
    }); 
  });

  it('should not try to decode token if none is present', function(done) {    
    bus.subscribe('http.get.foo', function(req) {       
      return { status: 200, data: { foo: 'bar' }};
    });

    get('/foo', function(error, response, body) {        
      expect(response.statusCode).toBe(200);       
      expect(body.user).toBeUndefined();       
      done();      
    }); 
  });

  function get(path, headers, cb) {
    if(typeof(headers) === 'function') {
      cb = headers;
    }
    doRequest('GET', path, headers, true, cb);    
  }

  function post(path, headers, json, cb) {
    if(typeof(headers) === 'function') {
      cb = headers;
    }
    doRequest('POST', path, headers, json, cb);    
  }

  function put(path, headers, json, cb) {
    if(typeof(headers) === 'function') {
      cb = headers;
    }
    doRequest('PUT', path, headers, json, cb);    
  }

  function del(path, headers, cb) {
    if(typeof(headers) === 'function') {
      cb = headers;
    }
    doRequest('DELETE', path, {}, true, cb);    
  }

  function doRequest(method, path, headers, json, cb) {
    request({
      uri: baseUri + path,        
      method: method,
      headers: headers,
      json: json || true
    }, cb);    
  }
});