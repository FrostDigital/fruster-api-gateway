const request = require("request");
const fs = require("fs");
const bus = require("fruster-bus");
const multiparty = require("multiparty");
const http = require("http");
const express = require("express");
const testUtils = require("fruster-test-utils");
const conf = require("../conf");
const apiGw = require("../api-gateway");
const FrusterWebBus = require("../lib/web-bus/FrusterWebBus");

describe("API Gateway", () => {
	let baseUri;
	let httpPort;
	let server;
	const mongoUrl = `mongodb://localhost:27017/fruster-api-gateway-test`;

	testUtils.startBeforeEach({
		service: connection => {
			httpPort = Math.floor(Math.random() * 6000 + 2000);
			baseUri = "http://127.0.0.1:" + httpPort;

			return apiGw.start(connection.natsUrl, mongoUrl, httpPort).then(_server => {
				server = _server;
			});
		},
		mockNats: true,
		afterStart: connection => {
			new FrusterWebBus(server, {
				test: true
			});
		}
	});

	it("should returns status code 404 if gateway does not recieve a response", async done => {
		const response = await get("/foo");

		expect(response.statusCode).toBe(404);
		expect(response.body.status).toBe(404);

		done();
	});

	it("should create and recieve bus message for HTTP GET", async done => {
		bus.subscribe("http.get.foo", req => {
			expect(req.path).toBe("/foo");
			expect(req.method).toBe("GET");
			expect(req.reqId).toBeDefined();
			expect(req.query.foo).toBe("bar");

			return {
				status: 201,
				headers: {
					"A-Header": "foo"
				},
				data: {
					foo: "bar"
				}
			};
		});

		const response = await get("/foo?foo=bar");

		expect(response.statusCode).toBe(201);
		expect(response.headers["a-header"]).toBe("foo");
		expect(response.headers["etag"]).toBeDefined();
		expect(response.headers["cache-control"]).toBeUndefined();
		expect(response.headers["x-fruster-req-id"]).toBeDefined();
		expect(response.body.data.foo).toBe("bar");
		expect(response.body.headers).toBeUndefined();

		done();
	});

	it("should create and recieve bus message for HTTP GET that includes dot in path", async done => {
		bus.subscribe("http.get.foo.:paramWithDot.foo", req => {
			expect(req.path).toBe("/foo/foo.bar/foo");
			expect(req.method).toBe("GET");
			expect(req.reqId).toBeDefined();
			expect(req.params.paramWithDot).toBe("foo.bar");

			return {
				status: 200,
				headers: {
					"A-Header": "foo"
				},
				data: {
					foo: "bar"
				}
			};
		});

		const response = await get("/foo/foo.bar/foo");

		expect(response.statusCode).toBe(200);
		expect(response.body.data.foo).toBe("bar");

		done();
	});

	it("should get no cache headers on HTTP response when NO_CACHE is true", async done => {
		conf.noCache = true;

		bus.subscribe("http.get.foo", req => {
			return {
				status: 201,
				data: {
					foo: "bar"
				}
			};
		});

		const response = await get("/foo?foo=bar");

		expect(response.headers["etag"]).toBeDefined();
		expect(response.headers["cache-control"]).toBe("max-age=0, no-cache, no-store, must-revalidate");
		expect(response.headers["pragma"]).toBe("no-cache");
		expect(response.headers["expires"]).toBe("0");

		conf.noCache = false;

		done();
	});

	it("should create and recieve bus message for HTTP GET in unwrapped mode", async done => {
		conf.unwrapMessageData = true;

		bus.subscribe("http.get.foo", req => {
			return {
				status: 200,
				data: {
					foo: "bar"
				}
			};
		});

		const response = await get("/foo");
		expect(response.body.foo).toBe("bar");
		expect(response.statusCode).toBe(200);

		conf.unwrapMessageData = false;

		done();
	});

	it("should return error status code from bus", async done => {
		bus.subscribe("http.post.bar", req => {
			return {
				status: 420,
				headers: {
					"x-foo": "bar"
				}
			};
		});

		const response = await post("/bar");

		expect(response.statusCode).toBe(420);
		expect(response.headers["x-foo"]).toBe("bar");

		done();
	});

	describe("Tokens", () => {
		it("should return 403 if validation of JWT cookie failed", async done => {
			bus.subscribe("auth-service.decode-token", req => {
				return {
					status: 403,
					error: {
						code: "auth-service.403.1"
					}
				};
			});

			const response = await get("/foo", { cookie: "jwt=acookie" });

			expect(response.statusCode).toBe(403);
			expect(response.body.error.code).toBe("auth-service.403.1");

			done();
		});

		it("should return 403 if validation of JWT in auth header failed", async done => {
			bus.subscribe("auth-service.decode-token", req => {
				expect(req.data).toBe("a-token");
				return {
					status: 403,
					error: {
						code: "auth-service.403.1"
					}
				};
			});

			const response = await get("/foo", { authorization: "Bearer a-token" });

			expect(response.statusCode).toBe(403);
			expect(response.body.error.code).toBe("auth-service.403.1");

			done();
		});

		it("should set user data with decoded jwt cookie", async done => {
			bus.subscribe("auth-service.decode-token", req => {
				expect(req.data).toBe("acookie");
				return {
					status: 200,
					data: "decoded-cookie"
				};
			});

			bus.subscribe("http.get.foo", req => {
				expect(req.user).toBe("decoded-cookie");
				return {
					status: 200,
					data: {
						foo: "bar"
					}
				};
			});

			const response = await get("/foo", { cookie: "jwt=acookie" });

			expect(response.statusCode).toBe(200);
			expect(response.body.user).toBeUndefined();

			done();
		});

		it("should not decode token if route is public", async done => {

			bus.subscribe("auth-service.decode-token", req => {
				done.fail("Auth service should not have been invoked");
				return {
					status: 200,
					data: "decoded-cookie"
				};
			});

			bus.subscribe("http.get.auth.cookie", req => {
				expect(req.user).toEqual({});
				return {
					status: 200,
					data: {
						foo: "bar"
					}
				};
			});

			const response = await get("/auth/cookie", { cookie: "jwt=acookie" });

			expect(response.statusCode).toBe(200);
			expect(response.body.user).toBeUndefined();

			done();
		});

		it("should not try to decode token if none is present", async done => {
			bus.subscribe("http.get.foo", req => {
				return {
					status: 200,
					data: {
						foo: "bar"
					}
				};
			});

			const response = await get("/foo");

			expect(response.statusCode).toBe(200);
			expect(response.body.user).toBeUndefined();

			done();
		});

		it("should set user data with decoded jwt cookie", async done => {
			bus.subscribe("auth-service.decode-token", req => {
				expect(req.data).toBe("acookie");
				return {
					status: 200,
					data: "decoded-cookie"
				};
			});

			bus.subscribe("http.get.foo", req => {
				expect(req.user).toBe("decoded-cookie");
				return {
					status: 200,
					data: {
						foo: "bar"
					}
				};
			});

			const response = await get("/foo", { cookie: "jwt=acookie" });

			expect(response.statusCode).toBe(200);
			expect(response.body.user).toBeUndefined();

			done();
		});
	});

	it("should set reqId in HTTP response even though none is returned from bus", async done => {
		bus.subscribe("http.get.foo", req => {
			return {
				status: 200
			};
		});

		const response = await get("/foo");

		expect(response.statusCode).toBe(200);
		expect(response.body.reqId).toBeDefined();

		done();
	});

	it("should be possible to send content type containing json", async done => {
		bus.subscribe("http.post.content-type-json", req => {
			expect(req.data.hello).toBe(1337);
			return {
				status: 200
			};
		});

		const res = await post(
			"/content-type-json",
			{
				"content-type": "application/vnd.contentful.management.v1+json"
			},
			{
				hello: 1337
			});

		expect(res.statusCode).toBe(200);
		expect(res.body.reqId).toBeDefined();

		done();
	});

	it("should forward POST request with multipart via http to url specified by bus.subscribe", done => {
		let expressPort = Math.floor(Math.random() * 6000 + 3000);
		let app = express();
		let server = http.createServer(app);
		server.listen(expressPort);

		bus.subscribe("http.post.foo").forwardToHttp("http://127.0.0.1:" + expressPort + "/foobar");

		app.post("/foobar", (req, res) => {
			let form = new multiparty.Form();

			form.parse(req, function (err, fields, files) {
				expect(files.file[0].fieldName).toBe("file");
				expect(files.file[0].originalFilename).toBe("a-large-file.jpg");
				expect(files.file[0].size).toBe(86994);

				fs.unlinkSync(files.file[0].path);

				console.log("sending");

				res.send({
					reqId: JSON.parse(req.headers.data).reqId,
					status: 200
				});
			});
		});

		doMultipartRequest("/foo", (error, response, respBody) => {
			let body = JSON.parse(respBody);

			expect(body.status).toBe(200);
			expect(body.reqId).toBeDefined();

			server.close();

			done();
		});
	});

	it("should send additional data in headers when forwarding POST request with multipart/form-data via http to url specified by bus.subscribe", done => {
		let expressPort = Math.floor(Math.random() * 6000 + 3000);
		let app = express();
		let server = http.createServer(app);
		server.listen(expressPort);

		bus.subscribe("http.post.foo").forwardToHttp("http://127.0.0.1:" + expressPort + "/foobar");

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

		doFormDataRequest("/foo?hej=1", function (error, response, respBody) {
			let body = JSON.parse(respBody);
			expect(body.status).toBe(200);
			expect(body.reqId).toBe(checkForReqId);

			server.close();

			done();
		});
	});

	it("should get error when multipart upload failed", done => {
		let expressPort = Math.floor(Math.random() * 6000 + 3000);
		let app = express();
		let server = http.createServer(app);
		server.listen(expressPort);

		bus.subscribe("http.post.foo").forwardToHttp("http://127.0.0.1:" + expressPort + "/foobar");

		app.post("/foobar", (req, res) => {
			res.send({
				reqId: "reqId",
				status: 500,
				error: {
					id: "8e97186c-4165-4d75-8293-92adead403db",
					title: "Upload totally failed"
				}
			});
		});

		doFormDataRequest("/foo", function (error, response, respBody) {
			let body = JSON.parse(respBody);

			expect(response.statusCode).toBe(500);
			expect(body.status).toBe(500);
			expect(body.error.title).toBe("Upload totally failed");
			expect(body.error.id).toBeDefined();

			server.close();

			done();
		});
	});

	describe("XML body support", () => {

		it("should POST XML body when content-type is text/xml", async (done) => {
			const xmlSnippet = "<Foo bar=\"1\" />";

			bus.subscribe("http.post.xml", req => {
				expect(req.headers["content-type"]).toBe("text/xml");
				expect(req.data).toBe(xmlSnippet);

				return {
					status: 200
				};
			});

			const response = await postXML("/xml", {}, xmlSnippet);

			expect(response.statusCode).toBe(200);
			expect(response.headers["x-fruster-req-id"]).toBeDefined();

			done();
		});

		it("should POST XML body when content-type is application/xml", async (done) => {
			const xmlSnippet = "<Foo bar=\"1\" />";

			bus.subscribe("http.post.xml", req => {
				expect(req.headers["content-type"]).toBe("application/xml");
				expect(req.data).toBe(xmlSnippet);

				return {
					status: 200
				};
			});

			const response = await postXML("/xml", { "Content-Type": "application/xml" }, xmlSnippet);

			expect(response.statusCode).toBe(200);
			expect(response.headers["x-fruster-req-id"]).toBeDefined();

			done();
		});

		it("should respond with XML", async (done) => {
			const xmlSnippet = "<Foo bar=\"1\" />";

			bus.subscribe("http.get.xml", req => {
				return {
					status: 200,
					headers: {
						"Content-Type": "text/xml"
					},
					data: xmlSnippet
				};
			});

			const response = await get("/xml");

			expect(response.statusCode).toBe(200);
			expect(response.headers["x-fruster-req-id"]).toBeDefined();
			expect(response.body).toBe(xmlSnippet);

			done();
		});
	});

	function get(path, headers) {
		return doRequest({ method: "GET", path, headers });
	}

	function post(path, headers, json) {
		return doRequest({ method: "POST", path, headers, json });
	}

	function postXML(path, headers, xmlString) {
		headers = { "Content-Type": "text/xml", ...headers };
		return doRequest({ method: "POST", path, headers, rawBody: xmlString });
	}

	function doRequest({ method, path, headers = {}, json = null, rawBody = null }) {
		return new Promise((resolve, reject) => {

			const reqOpts = {
				uri: baseUri + path,
				method: method,
				headers: headers
			};

			if (rawBody) {
				reqOpts.body = rawBody;
			} else {
				reqOpts.json = json || true;
			}

			request(reqOpts,
				(err, response, body) => {
					if (err) {
						return reject(err);
					}
					response.body = body;
					resolve(response);
				}
			);

		})
	}

	function doFormDataRequest(path, cb) {
		request(
			{
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
			},
			cb
		);
	}

	function doMultipartRequest(path, cb) {
		request(
			{
				method: "post",
				uri: baseUri + path,
				formData: {
					file: fs.createReadStream("./spec/a-large-file.jpg")
				},
				headers: {
					"content-type": "multipart/form-data"
				}
			},
			cb
		);
	}
});
