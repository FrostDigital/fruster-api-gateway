# Fruster API Gateway

A convention based API Gateway that will handle incoming HTTP traffic, transform to bus message and publish on NATS bus.

## Run

Install dependencies:

    npm install

Start server:

    npm start

During development `nodemon` is handy, it will watch and restart server when files changes:

    # If you haven't already installed, do it:
    npm install nodemon -g
  
    # Start watch - any change to the project will now restart the server, or typ `rs` to trigger restart manually.
    nodemon ./app.js

## Configuration

Configuration is set with environment variables. All config defaults to values that makes sense for development.
  
    # Applications log level (error|warn|info|debug|trace)
    LOG_LEVEL = 'debug'

    # Port API gateway listens on
    PORT = 3000
    
    # Allow origin for CORS
    # Examples: `*`, `http://www.example.com`, `"http://www.example.com,http://localhost:9000"`
    ALLOW_ORIGIN = "*""

    # If stack traces should be included in error responses
    # This might leak private implementation details that should not be exposed to outsiders
    PRINT_STACKTRACE = true

    # NATS servers, set multiple if using cluster
    # Example: `"nats://10.23.45.1:4222,nats://10.23.41.8:4222"`
    BUS = "nats://localhost:4222"
    
    # Time we wait for reply from internal services.
    BUS_TIMEOUT = '1s'
    
    # Timeout before HTTP server returns 408. 
    # IMPORTANT: This must be more than `BUS_TIMEOUT`.
    HTTP_TIMEOUT = '2s'
    
    # Max size of requests that we can handle
    # Examples: `1mb`, `100kb`
    MAX_REQUEST_SIZE = '100kb'
    
    # If fruster bus message data should be sent directly in response or if
    # same JSON structure as internal bus messages should be kept    
    UNWRAP_MESSAGE_DATA = false

   # User scopes required to connect to the fruster web bus
   WEBSOCKET_PERMISSION_SCOPES = ["websocket.connect.id"],

   # Subject for web sockets
   WEBSOCKET_SUBJECT = "out.user.:userId"