const interceptorConfig = require("./lib/interceptor-config");

module.exports = {

  // Port API gateway listens on
  port: process.env.PORT || 3000,

  // Allow origin for CORS
  // Example: `*`, `http://www.example.com`,  `http://www.example.com,http://localhost:9000`
  allowOrigin: parseArray(process.env.ALLOW_ORIGIN) || '*',

  // Specify allowed headers for CORS, can be a comma separated string if multiple
  allowedHeaders: process.env.ALLOWED_HEADERS || "",

  // If stack traces should be leaked error responses
  printStacktrace: parseBool(process.env.PRINT_STACKTRACE, true),

  // NATS servers, set multiple if using cluster
  // Example: `['nats://10.23.45.1:4222', 'nats://10.23.41.8:4222']`
  bus: parseArray(process.env.BUS) || ['nats://localhost:4222'],

  // Max size of requests that we can handle
  // Examples: `1mb`, `100kb`
  maxRequestSize: process.env.MAX_REQUEST_SIZE ||  '100mb',

  httpTimeout: process.env.HTTP_TIMEOUT ||  '2s',

  busTimeout: process.env.BUS_TIMEOUT || '1s',

  unwrapMessageData: parseBool(process.env.UNWRAP_MESSAGE_DATA, false),

  authCookieName: process.env.AUTH_COOKIE_NAME ||  'jwt',

  // User scopes required to connect to the fruster web bus
  webSocketPermissionScope: parseArray(process.env.WEBSOCKET_PERMISSION_SCOPES) || ["websocket.connect.id"],

  // Subject for web sockets
  webSocketSubject: process.env.WEBSOCKET_SUBJECT || "ws.*.>",

  // Interceptor are named INTERCEPTOR_N where N is a number indicating in which 
  // order the interceptor will run. Is defined in syntax `<subject pattern to intercept>:<interceptor subject>`
  // Example: `INTERCEPTOR_1=http.post.auth.*:foo-service.intercept-login`
  interceptors: interceptorConfig()

};

function parseBool(str, defaultVal) {
  return !str ? defaultVal : str === 'true';
}

function parseArray(str) {
  if (str) {
    return str.split(',');
  }
  return null;
}

