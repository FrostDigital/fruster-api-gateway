const interceptorConfig = require("../lib/interceptor-config");

describe("Interceptor config", () => {
	
	it("should parse config", () => {
		const env = {
			"INTERCEPTOR_1": "2;*;foo-service.interceptor-1;",
			"INTERCEPTOR_2": "1;*,!http.get.*;foo-service.interceptor-2;request"
		};

		let parsedConfig = interceptorConfig(env);
		
		expect(parsedConfig[0].order).toBe(1);
		expect(parsedConfig[0].pattern).toBe("*,!http.get.*");
		expect(parsedConfig[0].targetSubject).toBe("foo-service.interceptor-2");
		expect(parsedConfig[0].type).toBe("request");
		expect(parsedConfig[0].match("http.post.foo")).toBeTruthy();		
		expect(parsedConfig[0].match("http.get.foo")).toBeFalsy();		

		expect(parsedConfig[1].order).toBe(2);
		expect(parsedConfig[1].pattern).toBe("*");
		expect(parsedConfig[1].targetSubject).toBe("foo-service.interceptor-1");
		expect(parsedConfig[1].type).toBe("request");
		expect(parsedConfig[1].match("http.get.foo")).toBeTruthy();		
	});

});