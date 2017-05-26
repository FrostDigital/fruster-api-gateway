const request = require("request");
const bus = require("fruster-bus");
const conf = require("../conf");
const apiGw = require("../api-gateway");
const testUtils = require("fruster-test-utils");
const interceptorConfig = require("../lib/interceptor-config");


describe("Interceptors", function () {    

    const httpPort = Math.floor(Math.random() * 6000 + 2000);
    const baseUri = "http://127.0.0.1:" + httpPort;

    testUtils.startBeforeEach({
    	service: (connection) => apiGw.start(httpPort, connection.natsUrl), 
    	bus: bus    	
    });

    beforeAll(() => {
    	conf.interceptors = interceptorConfig({
    		INTERCEPTOR_1: "1;http.*,!http.post.auth;interceptor-1",
    		INTERCEPTOR_2: "2;*;interceptor-2"
		});
    });

    afterAll(() => {
    	conf.interceptors = []; 
    });

    it("should invoke interceptor", function (done) {
    	
    	testUtils.mockService({
    		subject: "interceptor-1",
    		resp: (resp) => {
    			resp.interceptor1 = true;    			
				resp.data.wasHere = "interceptor-1";
    			return resp;			
    		}
    	});

    	testUtils.mockService({
    		subject: "interceptor-2",
    		resp: (resp) => {    			
				resp.interceptor2 = true;
				resp.data.wasHere = "interceptor-2";
				return resp;
    		}
    	});

    	testUtils.mockService({
    		subject: "http.get.foo",
    		expectRequest: (req) => {    			
    			expect(req.reqId).toBeDefined();
    			expect(req.data.wasHere).toBe("interceptor-2");
    			expect(req.interceptor1).toBeTruthy();   
    			expect(req.interceptor2).toBeTruthy();   
    		}
    	});
        
        get("/foo", function (error, response, body) {        
            expect(response.statusCode).toBe(200);
            expect(body.status).toBe(200);
            done();
        });
    });


    it("should return error from interceptor", function (done) {    	   
    	testUtils.mockService({
    		subject: "interceptor-1",    		
    		resp: (resp) => {
    			resp.interceptor1 = true;				
    			return resp;			
    		}
    	});

    	testUtils.mockService({
    		subject: "interceptor-2",    		
    		resp: {
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
            json: json ||  true
        }, cb);
    }

});