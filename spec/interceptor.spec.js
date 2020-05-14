const request = require("request");
const bus = require("fruster-bus");
const testUtils = require("fruster-test-utils");
const conf = require("../conf");
const apiGw = require("../api-gateway");
const interceptorConfig = require("../lib/interceptor-config");

describe("Interceptors", function () {

	const httpPort = Math.floor(Math.random() * 6000 + 2000);
	const baseUri = "http://127.0.0.1:" + httpPort;
	const mongoUrl = `mongodb://localhost:27017/fruster-api-gateway-test`;

	testUtils.startBeforeEach({
		service: (connection) => apiGw.start(connection.natsUrl, mongoUrl, httpPort),
		mockNats: true,
		bus: bus
	});

	function setConfig() {
		conf.interceptors = interceptorConfig({
			INTERCEPTOR_1: "1;http.*,!http.post.auth;interceptor-1",
			INTERCEPTOR_2: "2;*;interceptor-2",
			INTERCEPTOR_3: "3;*;interceptor-response;response;allow-exceptions"
		});
	}

	afterEach(() => {
		conf.interceptors = interceptorConfig();
	});

	afterAll(() => {
		conf.interceptors = [];
	});

	it("should invoke interceptor", function (done) {
		setConfig();

		testUtils.mockService({
			subject: "interceptor-1",
			response: (req) => {
				expect(req.transactionId).toBeDefined("transactionId should be set");

				req.status = 200;
				req.interceptor1 = true;
				req.data.wasHere = "interceptor-1";

				return req;
			}
		});

		testUtils.mockService({
			subject: "interceptor-2",
			response: (req) => {
				expect(req.transactionId).toBeDefined("transactionId should be set");

				req.status = 200;
				req.interceptor2 = true;
				req.data.wasHere = "interceptor-2";

				return req;
			}
		});


		testUtils.mockService({
			subject: "interceptor-response",
			response: (req) => {
				req.status = 200;
				return req;
			}
		});

		testUtils.mockService({
			subject: "http.get.foo",
			response: (req) => {
				expect(req.reqId).toBeDefined();
				expect(req.data.wasHere).toBe("interceptor-2");
				expect(req.interceptor1).toBeTruthy("req.interceptor1");
				expect(req.interceptor2).toBeTruthy("req.interceptor2");
				expect(req.transactionId).toBeDefined();

				return req;
			}
		});

		get("/foo", function (error, response, body) {
			expect(response.statusCode).toBe(200);
			expect(body.status).toBe(200);
			done();
		});
	});

	it("should invoke response interceptor", function (done) {
		setConfig();

		testUtils.mockService({
			subject: "interceptor-1",
			response: (resp) => {
				return resp;
			}
		});

		testUtils.mockService({
			subject: "interceptor-2",
			response: (resp) => {
				return resp;
			}
		});

		testUtils.mockService({
			subject: "interceptor-response",
			response: (resp) => {
				expect(resp.query.hej).toBe("20", "should add query to intercept request");
				resp.data.wasHere = "interceptor-response";
				delete resp.data.helloThere;
				return resp;
			}
		});

		testUtils.mockService({
			subject: "http.get.foo",
			response: (req) => {
				req.data.helloThere = "should be removed";
				return req;
			}
		});

		get("/foo?hej=20", function (error, response, body) {
			expect(body.data.wasHere).toBe("interceptor-response");
			expect(body.data.helloThere).toBeUndefined();
			expect(response.statusCode).toBe(200);
			expect(body.status).toBe(200);
			done();
		});
	});

	it("should invoke response interceptor with exception if configured to allow exceptions", function (done) {
		setConfig();

		testUtils.mockService({
			subject: "interceptor-1",
			response: (resp) => {
				return resp;
			}
		});

		testUtils.mockService({
			subject: "interceptor-2",
			response: (resp) => {
				return resp;
			}
		});

		testUtils.mockService({
			subject: "interceptor-response",
			response: (resp) => {
				expect(resp.query.hej).toBe("20", "should add query to intercept request");
				resp.data.wasHere = "interceptor-response";
				resp.status = 200;
				delete resp.data.helloThere;
				delete resp.error;
				return resp;
			}
		});

		testUtils.mockService({
			subject: "http.get.foo",
			response: () => {
				throw {
					status: 500,
					error: {
						code: "IMAGINARY_ERROR",
						title: "very real error!"
					}
				}
			}
		});

		get("/foo?hej=20", function (error, response, body) {
			expect(body.data.wasHere).toBe("interceptor-response");
			expect(body.data.helloThere).toBeUndefined();
			expect(response.statusCode).toBe(200);
			expect(body.status).toBe(200);
			done();
		});
	});

	it("should not invoke response interceptor with exception if not configured to allow exceptions", function (done) {
		conf.interceptors = interceptorConfig({
			INTERCEPTOR_1: "4;*;interceptor-response;response"
		});

		testUtils.mockService({
			subject: "interceptor-response",
			response: (resp) => {
				// allow-exceptions is not defined so we should never reach this place!
				done.fail();
			}
		});

		const error = {
			status: 500,
			error: {
				code: "IMAGINARY_ERROR",
				title: "very real error!"
			}
		};

		testUtils.mockService({
			subject: "http.get.foo",
			response: () => { throw error; }
		});

		get("/foo?hej=20", (err, resp, body) => {
			expect(body.status).toBe(error.status);
			expect(body.error.code).toBe(error.error.code);
			expect(body.error.title).toBe(error.error.title);

			done();
		});
	});

	it("should return error from interceptor", function (done) {
		setConfig();

		testUtils.mockService({
			subject: "interceptor-1",
			response: (resp) => {
				resp.interceptor1 = true;
				return resp;
			}
		});

		testUtils.mockService({
			subject: "interceptor-2",
			response: {
				status: 400,
				error: {
					code: "BAD_REQUEST"
				}
			}
		});

		get("/foo", function (error, response, body) {
			expect(response.statusCode).toBe(400);
			expect(body.status).toBe(400);
			done();
		});
	});

	it("should respond directly from interceptor", function (done) {
		setConfig();

		testUtils.mockService({
			subject: "interceptor-1",
			response: {
				status: 200,
				interceptAction: "respond",
				data: {}
			}
		});

		get("/foo", function (error, response, body) {
			expect(response.statusCode).toBe(200);
			done();
		});
	});

	function get(path, headers, cb) {
		if (typeof (headers) === "function") {
			cb = headers;
		}
		doRequest("GET", path, headers, true, cb);
	}

	function doRequest(method, path, headers, json, cb) {
		request({
			uri: baseUri + path,
			method: method,
			headers: headers,
			json: json || true
		}, cb);
	}

});
