# Interceptors

Interceptors are used to intercept requests and responses that flow in and out to/from the API gateway. 

The API gateway can via configuration define which subjects that will be routed to an interceptor. The actual interceptor is just a subject of another service endpoint. 

An interceptor can be invoked either during incoming request handling or for post processing the outgoing response. 

## Defining interceptors in configuration

Each interceptor needs to be defined in API gateway configuration. Naming of the env var is convention based so all configuration starting with `INTERCEPTOR_` will be parsed as an interceptor.

This means that one can define multiple interceptors with contextual namings such as:

    INTERCEPTOR_AUTH=...
    INTERCEPTOR_AUDIT_LOG=...

Configuration is set with the following syntax:

    <order>;<match pattern>;<interceptor target subject>;<type>

* `order` is order of when interceptor will be invoked in case more than one interceptor is defined
* `match pattern` is the pattern the needs to match the requests/response subject in order for the interceptor to be invoked, can be any glob style pattern
* `interceptor target subject` is the interceptors endpoint that the request/response will be routed of if pattern matches
* `type` is one of `request|response` which defines if interceptor is invoked during request handling or during response handling (optional, defaults to `request`)

Examples:

	# Math all POSTs and PUTs and send to endpoint log-service.time when incoming request arrives 
    INTERCEPTOR_PERF=1;http.post.*,http.put.*;log-service.time;request
	
	# Math all requests except auth and send to foo-service 
    INTERCEPTOR_FOO=2;*,!http.post.auth;foo-service;request

## Ordering

Interceptors are ordered using the `order` configuration. If same order the order will be random between those.

The invocation is sequential so any data that has been decorated by a previously invoked interceptor will be available down the chain.

## Implementing interceptors

Interceptors are implemented in each service that exposes an interceptor endpoint to which requests/reponses are routed.

Each interceptor can take _one_ of the following actions:

* `respond` to instruct API gateway to provide a response directly and not pass it further down the chain
* `next` to instruct API gateway to pass the message down the chain but using the (optionally) modified response returned by interceptor (default)

> Important: If interceptor responds with an error, the API gateway will not continue to process it and respond directly.

Example:
	
### Examples

#### Decorate message and continue processing

	# Message routed to interceptor
	{
		"reqId": "079e5e36-17ad-457e-8777-f998f34142cf",
		"user": { /* ... */ }
		"data": {
			"foo": "bar"
		}
	}

	# Interceptor modifies the response and instructs API gateway to continue

	{
		"reqId": "079e5e36-17ad-457e-8777-f998f34142cf",
		"status": 200,
		"interceptAction": "next",  // <-- 
		"data": {
			"foo": "bar",
			"hello": "world from interceptor"
		}
	}

#### Interceptor responds with error message

	# Message routed to interceptor
	{
		"reqId": "079e5e36-17ad-457e-8777-f998f34142cf",
		"user": { /* ... */ }
		"data": {
			"foo": "bar"
		}
	}

	# Interceptor answers with error which will be returned directly

	{
		"reqId": "079e5e36-17ad-457e-8777-f998f34142cf",
		"status": 400,
		"error": {
			"code": "BAD_REQUEST"
			// ...
		}
	}

#### Interceptor breaks the chain and returns custom message

	# Message routed to interceptor
	{
		"reqId": "079e5e36-17ad-457e-8777-f998f34142cf",
		"user": { /* ... */ }
		"data": {
			"foo": "bar"
		}
	}

	# Interceptor answers with error which will be returned directly

	{
		"reqId": "079e5e36-17ad-457e-8777-f998f34142cf",
		"status": 200,
		"interceptAction": "respond",
		"data": {
			"hey": "interceptor just provided the response"			
		}
	}

