const interceptorConfig = require("../lib/interceptor-config");

describe("Interceptor config", () => {

	it("should parse config", () => {
		const env = {
			"INTERCEPTOR_1": "2;*;foo-service.interceptor-1;",
			"INTERCEPTOR_2": "1;*,!http.get.*;foo-service.interceptor-2;request",
			"INTERCEPTOR_3": "3;http.get.*;foo-service.interceptor-response-2;response;allow-exceptions,another-useless-option"
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

		expect(parsedConfig[2].order).toBe(3);
		expect(parsedConfig[2].pattern).toBe("http.get.*");
		expect(parsedConfig[2].targetSubject).toBe("foo-service.interceptor-response-2");
		expect(parsedConfig[2].type).toBe("response");
		expect(parsedConfig[2].options.allowExceptions).toBeTruthy();
		expect(parsedConfig[2].options.anotherUselessOption).toBeTruthy();
		expect(parsedConfig[2].match("http.get.foo")).toBeTruthy();
	});

});