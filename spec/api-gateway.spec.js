var request = require('request'),
  fs = require('fs'),
  conf = require('../conf'),
  bus = require('fruster-bus'),
  nsc = require('nats-server-control'),
  apiGw = require('../api-gateway'),
  util = require('util'),
  multiparty = require('multiparty'),
  http = require('http'),
  express = require('express');


describe('API Gateway', function () {
  var natsServer;
  var baseUri;

  beforeEach(done => {
    var httpPort = Math.floor(Math.random() * 6000 + 2000);
    var busPort = Math.floor(Math.random() * 6000 + 2000);
    var busAddress = 'nats://localhost:' + busPort;

    baseUri = 'http://127.0.0.1:' + httpPort;

    nsc.startServer(busPort)
      .then(server => {
        natsServer = server;
      })
      .then(() => apiGw.start(httpPort, [busAddress]))
      .then(done)
      .catch(done.fail);
  });

  afterEach(() => {
    if (natsServer) {
      natsServer.kill();
    }
  });

  it('should returns status code 404 if gateway does not recieve a response', function (done) {
    get('/foo', function (error, response, body) {
      expect(response.statusCode).toBe(404);
      expect(body.status).toBe(404);
      done();
    });
  });

  it('should create and recieve bus message for HTTP GET', function (done) {
    bus.subscribe('http.get.foo', function (req) {
      expect(req.path).toBe('/foo');
      expect(req.method).toBe('GET');
      expect(req.reqId).toBeDefined();
      expect(req.query.foo).toBe('bar');

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

    get('/foo?foo=bar', function (error, response, body) {

      expect(response.statusCode).toBe(201);
      expect(response.headers['a-header']).toBe('foo');
      expect(body.data.foo).toBe('bar');
      expect(body.headers).toBeUndefined();

      done();
    });
  });

  it('should create and recieve bus message for HTTP GET in unwrapped mode', function (done) {
    conf.unwrapMessageData = true;

    bus.subscribe('http.get.foo', function (req) {
      return {
        status: 200,
        data: {
          foo: 'bar'
        }
      };
    });

    get('/foo', function (error, response, body) {
      expect(body.foo).toBe('bar');
      expect(response.statusCode).toBe(200);
      conf.unwrapMessageData = false;
      done();
    });
  });

  it('should return error status code from bus', function (done) {
    bus.subscribe('http.post.bar', function (req) {
      return {
        status: 420,
        headers: {
          'x-foo': 'bar'
        }
      };
    });

    post('/bar', function (error, response, body) {
      expect(response.statusCode).toBe(420);
      expect(response.headers['x-foo']).toBe('bar');
      done();
    });
  });

  it('should return 403 if validation of JWT cookie failed', function (done) {
    bus.subscribe('auth-service.decode-token', function (req) {
      return {
        status: 403,
        error: {
          code: 'auth-service.403.1'
        }
      };
    });

    get('/foo', {
      cookie: 'jwt=acookie'
    }, function (error, response, body) {
      expect(response.statusCode).toBe(403);
      expect(body.error.code).toBe('auth-service.403.1');
      done();
    });
  });

  it('should return 403 if validation of JWT in auth header failed', function (done) {
    bus.subscribe('auth-service.decode-token', function (req) {
      expect(req.data).toBe('a-token');
      return {
        status: 403,
        error: {
          code: 'auth-service.403.1'
        }
      };
    });

    get('/foo', {
      authorization: 'Bearer a-token'
    }, function (error, response, body) {
      expect(response.statusCode).toBe(403);
      expect(body.error.code).toBe('auth-service.403.1');
      done();
    });
  });

  it('should set user data with decoded jwt cookie', function (done) {
    bus.subscribe('auth-service.decode-token', function (req) {
      expect(req.data).toBe('acookie');
      return {
        status: 200,
        data: 'decoded-cookie'
      };
    });

    bus.subscribe('http.get.foo', function (req) {
      expect(req.user).toBe('decoded-cookie');
      return {
        status: 200,
        data: {
          foo: 'bar'
        }
      };
    });

    get('/foo', {
      cookie: 'jwt=acookie'
    }, function (error, response, body) {
      expect(response.statusCode).toBe(200);
      expect(body.user).toBeUndefined();
      done();
    });
  });

  it('should set user data with decoded jwt in auth header', function (done) {
    bus.subscribe('auth-service.decode-token', function (req) {
      expect(req.data).toBe('a-token');
      return {
        status: 200,
        data: 'decoded-cookie'
      };
    });

    bus.subscribe('http.get.foo', function (req) {
      expect(req.user).toBe('decoded-cookie');
      return {
        status: 200,
        data: {
          foo: 'bar'
        }
      };
    });

    get('/foo', {
      authorization: 'Bearer a-token'
    }, function (error, response, body) {
      expect(response.statusCode).toBe(200);
      expect(body.user).toBeUndefined();
      done();
    });
  });

  it('should not try to decode token if none is present', function (done) {
    bus.subscribe('http.get.foo', function (req) {
      return {
        status: 200,
        data: {
          foo: 'bar'
        }
      };
    });

    get('/foo', function (error, response, body) {
      expect(response.statusCode).toBe(200);
      expect(body.user).toBeUndefined();
      done();
    });
  });

  it('should set reqId in HTTP response even though none is returned from bus', function (done) {
    bus.subscribe('http.get.foo', function (req) {
      return {
        status: 200
      };
    });

    get('/foo', function (error, response, body) {
      expect(response.statusCode).toBe(200);
      expect(body.reqId).toBeDefined();
      done();
    });
  });

  /*
   * Using a bus.subscribe for the withHttpUrl-url is only for testing, 
   * it would defeat the purpose in a live situation.
   */
  it('should forward GET request via http to url specified by bus.subscribe', function (done) {

    bus.subscribe('http.get.foo').withHttpUrl(baseUri + "/foobar");

    bus.subscribe('http.get.foobar', function (req) {
      return {
        status: 200
      };
    });

    get('/foo', function (error, response, body) {
      expect(body.status).toBe(200);
      expect(body.reqId).toBeDefined();
      done();
    });
  });

  it('should forward POST request via http to url specified by bus.subscribe', function (done) {

    bus.subscribe('http.post.foo').withHttpUrl(baseUri + "/foobar");

    bus.subscribe('http.post.foobar', function (req) {
      return {
        status: 200,
        data: req.data.data
      };
    });

    post('/foo', {}, {
      shouldBe: "defined"
    }, function (error, response, body) {
      expect(body.status).toBe(200);
      expect(body.reqId).toBeDefined();
      expect(body.data.shouldBe).toBe("defined");
      done();
    });
  });

  it('should forward PUT request via http to url specified by bus.subscribe', function (done) {

    bus.subscribe('http.put.foo').withHttpUrl(baseUri + "/foobar");

    bus.subscribe('http.put.foobar', function (req) {
      return {
        status: 200,
        data: req.data.data
      };
    });

    put('/foo', {}, {
      shouldBe: "defined"
    }, function (error, response, body) {
      expect(body.status).toBe(200);
      expect(body.reqId).toBeDefined();
      expect(body.data.shouldBe).toBe("defined");
      done();
    });
  });

  it('should forward DELETE request via http to url specified by bus.subscribe', function (done) {

    bus.subscribe('http.delete.foo').withHttpUrl(baseUri + "/foobar");

    bus.subscribe('http.delete.foobar', function (req) {
      return {
        status: 200
      };
    });

    del('/foo', {}, function (error, response, body) {
      expect(body.status).toBe(200);
      expect(body.reqId).toBeDefined();
      done();
    });
  });

  it('should forward POST request with formdata via http to url specified by bus.subscribe', function (done) {
    let expressPort = Math.floor(Math.random() * 6000 + 3000);
    let app = express();
    let server = http.createServer(app);
    server.listen(expressPort);

    bus.subscribe('http.post.foo').withHttpUrl('http://127.0.0.1:' + expressPort + "/foobar");

    app.post("/foobar", (req, res) => {
      var form = new multiparty.Form();

      form.parse(req, function (err, fields, files) {
        expect(fields).toBeDefined();
        expect(fields.a.length).toBe(1);
        expect(fields.a[0]).toBe("a");
        expect(fields.b.length).toBe(1);
        expect(fields.b[0]).toBe("b");
        expect(fields.c.length).toBe(1);
        expect(fields.c[0]).toBe("c");

        res.send({
          reqId: JSON.parse(req.headers.data).reqId,
          status: 200
        });
      });
    });

    doFormDataRequest('/foo', function (error, response, respBody) {
      var body = JSON.parse(respBody);
      expect(body.status).toBe(200);
      expect(body.reqId).toBeDefined();

      server.close();

      done();
    });
  });

  it('should forward POST request with multipart via http to url specified by bus.subscribe', function (done) {
    let expressPort = Math.floor(Math.random() * 6000 + 3000);
    let app = express();
    let server = http.createServer(app);
    server.listen(expressPort);

    bus.subscribe('http.post.foo').withHttpUrl('http://127.0.0.1:' + expressPort + "/foobar");

    app.post("/foobar", (req, res) => {
      let form = new multiparty.Form();

      form.parse(req, function (err, fields, files) {
        expect(files.file[0].fieldName).toBe("file");
        expect(files.file[0].originalFilename).toBe("a-large-file.jpg");
        expect(files.file[0].size).toBe(86994);

        fs.unlink(files.file[0].path);

        res.send({
          reqId: JSON.parse(req.headers.data).reqId,
          status: 200
        });
      });
    });

    doMultipartRequest('/foo', function (error, response, respBody) {
      let body = JSON.parse(respBody);
      expect(body.status).toBe(200);
      expect(body.reqId).toBeDefined();

      server.close();

      done();
    });
  });

  it('should send additional data in headers when forwarding POST request with multipart/form-data via http to url specified by bus.subscribe', function (done) {
    let expressPort = Math.floor(Math.random() * 6000 + 3000);
    let app = express();
    let server = http.createServer(app);
    server.listen(expressPort);

    bus.subscribe('http.post.foo').withHttpUrl('http://127.0.0.1:' + expressPort + "/foobar");

    let checkForReqId;
    app.post("/foobar", (req, res) => {
      let additionaldata = JSON.parse(req.headers.data);

      expect(additionaldata.reqId).toBeDefined();
      expect(additionaldata.path).toBe("/foo");
      expect(additionaldata.query.hej).toBe("1");

      checkForReqId = additionaldata.reqId;

      res.send({
        reqId: additionaldata.reqId,
        status: 200
      });
    });

    doFormDataRequest('/foo?hej=1', function (error, response, respBody) {
      let body = JSON.parse(respBody);
      expect(body.status).toBe(200);
      expect(body.reqId).toBe(checkForReqId);

      server.close();

      done();
    });
  });

  function get(path, headers, cb) {
    if (typeof (headers) === 'function') {
      cb = headers;
    }
    doRequest('GET', path, headers, true, cb);
  }

  function post(path, headers, json, cb) {
    if (typeof (headers) === 'function') {
      cb = headers;
    }
    doRequest('POST', path, headers, json, cb);
  }

  function put(path, headers, json, cb) {
    if (typeof (headers) === 'function') {
      cb = headers;
    }
    doRequest('PUT', path, headers, json, cb);
  }

  function del(path, headers, cb) {
    if (typeof (headers) === 'function') {
      cb = headers;
    }
    doRequest('DELETE', path, {}, true, cb);
  }

  function doRequest(method, path, headers, json, cb) {
    request({
      uri: baseUri + path,
      method: method,
      headers: headers,
      json: json ||  true
    }, cb);
  }

  function doFormDataRequest(path, cb) {
    request({
      method: "post",
      uri: baseUri + path,
      formData: {
        a: "a",
        b: "b",
        c: "c"
      },
      headers: {
        "content-type": "multipart/form-data"
      }
    }, cb);
  }

  function doMultipartRequest(path, cb) {
    request({
      method: "post",
      uri: baseUri + path,
      formData: {
        file: fs.createReadStream('./spec/a-large-file.jpg')
      },
      headers: {
        "content-type": "multipart/form-data"
      }
    }, cb);
  }

});