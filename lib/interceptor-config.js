const Minimatch = require("minimatch").Minimatch;

const interceptorPrefix = "INTERCEPTOR_";

class InterceptorConfig {

	/**
	 * Entry point to parse interceptor config in process.env.
	 *
	 * Will return array of config objects that containts:
	 * 
	 * - `order` interceptor invocation order
	 * - `pattern` the match pattern as string, separated by comma if multiple
	 * - `matchers` matcher object - one for each pattern
	 * - `targetSubject` subject to where interceptor is handled
	 * - `type` can be either `request|response`
	 * 
	 * @param  {object} env
	 * @return {array} 
	 */
	parse(env) {
		env.INTERCEPTOR_FUNBEAT_MIGRATION = "1;http.post.auth.token;pu-funbeat-migrator-service.response-interceptor.migrate-user;response";
		const interceptorConfigs = this._getInterceptorsInEnv(env);


		return interceptorConfigs.map(interceptorConfig => {
			// <order>;<match pattern>;<interceptor target subject>;<type>
			const split = interceptorConfig.split(";");
			const order = parseInt(split[0]);
			const patterns = split[1].split(",");
			const targetSubject = split[2];
			const type = split[3] || "request";
			const matchers = patterns.map(pattern => new Minimatch(pattern));

			return {
				pattern: split[1],
				targetSubject: targetSubject,
				type: type,
				order: order,
				match: (subject) => {
					return matchers.every(matcher => matcher.match(subject));
				}
			}
		}).sort((ic1, ic2) => ic1.order - ic2.order);
	}

	/**
	 * Looks in env for variables starting with `INTERCEPTOR_`
	 * and return those as an array.
	 * 
	 * @param  {object} env
	 * @return {array}
	 */
	_getInterceptorsInEnv(env) {
		const interceptorKeys = Object.keys(env)
			.filter(k => k.includes(interceptorPrefix))
			.sort();

		return interceptorKeys.map(k => env[k]);
	}
}

module.exports = (env = process.env) => {
	return new InterceptorConfig().parse(env);
};
