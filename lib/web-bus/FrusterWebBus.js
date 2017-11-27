const bus = require("fruster-bus");
const FrusterRequest = bus.FrusterRequest;
const log = require("fruster-log");
const conf = require("../../conf");
const WebSocket = require("ws");
const _ = require("lodash");
const uuid = require("uuid");
const util = require("util");
const apiGateway = require("../../api-gateway");
const webBusUtils = require("./../util/web-bus-utils");


class FrusterWebBus {

    constructor(server, options) {
        this._webSocketServer = new WebSocket.Server({ server });
        this._connectedClients = {};
        this._registerConnectionHandler();
        this._registerWebsocketSubscriber();
        this._options = options || {};

        this.endpoints = {

            UNREGISTER_CLIENT: "fruster-web-bus.unregister-client"

        };

        bus.subscribe({
            requestSchema: "UnregisterWebsocketClient",
            subject: this.endpoints.UNREGISTER_CLIENT,
            createQueueGroup: false, // No websocket endpoint should register queue groups since clients may be spread over several instances of api gateway. 
            handle: (req) => this.handleUnregister(req)
        });

    }

    /**
     * Endpoint for disconnecting a socket on logout
     * 
     * @param {FrusterRequest} req 
     */
    handleUnregister(req) {
        const that = this;
        const jwtToken = req.data.jwt;
        const userId = req.data.userId;

        let clientToClose;

        if (!!jwtToken) {
            unregisterClientByJwtToken();
        } else {
            unregisterClientByUserId();
        }

        return {
            status: 200
        };

        function unregisterClientByJwtToken() {
            const connectedClientByUserIdValues = Object.values(that._connectedClients);

            let x = connectedClientByUserIdValues.length - 1;

            if (connectedClientByUserIdValues[x]) {
                do {
                    const connectedClientsConnectionIdValues = Object.values(connectedClientByUserIdValues[x]);
                    let y = connectedClientsConnectionIdValues.length - 1;

                    do {
                        if (connectedClientsConnectionIdValues[y].jwtToken === jwtToken) {
                            clientToClose = connectedClientsConnectionIdValues[y];
                        }
                    } while (y-- > 0);

                } while (x-- > 0);
            }

            that._close(clientToClose);
        }

        function unregisterClientByUserId() {
            if (that._connectedClients[userId])
                Object.values(that._connectedClients[userId]).forEach(client => that._close(client));
        }
    }

    /**	
     * Registers the connection handler.
     */
    _registerConnectionHandler() {
        this._webSocketServer.on("connection", (socket) => this._newConnection(socket));
    }

    /**	
     * Handles new connections. 
     * Looks in the cookies for a jwt token and decodes it, then checks if the logged in user has the correct permissions.
     * If everything checks out, the connection is added to the list of connected users accessed by the user's id.
     * 
     * @param {Object} socket websocket connection.
     * 
     * @return {Promise} promise.
     */
    async  _newConnection(socket) {
        const reqId = uuid.v4();

        let jwtToken;

        try {
            if (this._options.test) {
                if (socket.upgradeReq.headers.cookie && socket.upgradeReq.headers.cookie.includes("jwt"))
                    jwtToken = "test-token";
                else
                    return this._close(socket);
            } else
                jwtToken = socket.upgradeReq.headers.cookie.jwt;
        } catch (err) {
            return this._close(socket);
        }

        const decodeTokenRequest = {
            cookies: {
                jwt: jwtToken
            }
        };

        socket.jwtToken = jwtToken;

        try {
            const loggedInUser = await apiGateway.decodeToken(decodeTokenRequest, reqId);

            if (!loggedInUser || _.size(loggedInUser) === 0)
                return this._close(socket);

            if (this._validatePermissions(loggedInUser)) {
                if (!this._connectedClients[loggedInUser.id])
                    this._connectedClients[loggedInUser.id] = {};

                let connectionId = uuid.v4();
                this._connectedClients[loggedInUser.id][connectionId] = socket;
                log.debug("client", connectionId, "for user", loggedInUser.id, "connected");

                socket.on("close", (reasonCode, description) => this._handleCloseEventForConnection(socket, loggedInUser, connectionId, reasonCode, description));
                socket.on("message", (msg) => this._handleIncomingWebsocketRequest(msg, socket));

                socket.resume();
            } else {
                return this._close(socket);
            }
        } catch (err) {
            log.error(err);
            return this._close(socket);
        }
    }

    /**
     * Handles close-event for websocket connection. 
     * Removes connected client from registers of connect clients.
     * 
     * @param {Object} socket socket connection
     * @param {Object} loggedInUser logged in user at connection
     * @param {String} connectionId connection id for the user
     */
    _handleCloseEventForConnection(socket, loggedInUser, connectionId, reasonCode, description) {
        delete this._connectedClients[loggedInUser.id][connectionId];

        if (_.size(this._connectedClients[loggedInUser.id]) === 0)
            delete this._connectedClients[loggedInUser.id];

        log.debug("client", connectionId, "for user", loggedInUser.id, "disconnected", reasonCode, description);
    }

    /**
     * Handles incoming websocket message.  
     * Sends request on bus to provided subject (only allowed subjects) and publishes the response back to the websocket connection.
     * Decodes token stored when connection is made so that the latest version of the user is provided with all requests. 
     * 
     * @param {Buffer} msg message sent by the client   
     * @param {Object} socket socket connection
     */
    async _handleIncomingWebsocketRequest(msg, socket) {
        const json = JSON.parse(msg.toString());
        const decodeTokenReq = { cookies: {} };
        decodeTokenReq.cookies[conf.authCookieName] = socket.jwtToken;

        apiGateway.decodeToken(decodeTokenReq, "reqId")
            .then(async loggedInUser => {
                const req = json.message;
                req.user = loggedInUser;
                req.headers = { method: json.subject.split(".")[1], jwt: socket.jwtToken }; // TODO: move this to utils

                if (!webBusUtils.isValidWebsocketSubject(json.subject))
                    bus.publish(`ws.${req.user.id}.${req.reqId}.resp`, { status: 404 });

                const responseForWebsocket = await bus.request({
                    subject: json.subject,
                    message: req
                });

                bus.publish(`ws.${req.user.id}.${json.message.reqId}.resp`, responseForWebsocket);
            });
    }

    /**	
     * Validates a user has the correct scopes configureds in conf.webSocketPermissionScope.
     * 
     * @param {Object} loggedInUser the logged in user.
     * 
     * @return {Boolean} whether or not the user has all the required scopes.
     */
    _validatePermissions(loggedInUser) {
        return conf.webSocketPermissionScope
            .filter(scope => loggedInUser.scopes.includes(scope)).length === conf.webSocketPermissionScope.length;
    }

    /**	
     * Registers the fruster bus handler for websocket messages. 
     * Picks out the user id from the subject of the message and sends it to all connections on that user id.
     */
    _registerWebsocketSubscriber() {
        return bus.subscribe({
            subject: conf.webSocketSubject,
            responseSchema: "",
            createQueueGroup: false,
            handle: (req, replyTo, actualSubject) => {
                const subjectWithoutWS = actualSubject.replace("ws.", "");
                const nextDot = subjectWithoutWS.indexOf(".");
                const userId = nextDot > 0 ? subjectWithoutWS.substring(0, nextDot) : subjectWithoutWS;
                const isPublish = userId === "*";

                if (isPublish)
                    this._publishToAllClients(req, actualSubject);
                else
                    this._sendToAllConnectionsForClient(userId, req, actualSubject);

                return {
                    status: 200,
                    reqId: req.reqId
                };
            }
        });
    }

    /** 
     * Sends a message to all connected users.
     * 
     * @param {Object} req request to send to all users.
     * @param {String} actualSubject the subject to send to. 
     */
    _publishToAllClients(req, actualSubject) {
        _.forIn(this._connectedClients, (clientObj, clientId) => {
            const subject = actualSubject.replace("*", clientId);
            this._sendToAllConnectionsForClient(clientId, req, subject);
        });
    }

    /** 
     * Sends a message to all connections of a user.
     * 
     * @param {String} userId id of the user to send to. 
     * @param {Object} req request to send to all clients.
     * @param {String} actualSubject the subject to send to. 
     */
    _sendToAllConnectionsForClient(userId, req, actualSubject) {
        if (this._connectedClients[userId]) {
            _.forIn(this._connectedClients[userId], (client, connectionId) => {
                this._sendToOneConnection(client, req, actualSubject);
            });
        }
    }

    /** 
     * Sends a message to one socket connection.
     * 
     * @param {Object} socket the socket to send message to.
     * @param {Object} req request to send to all clients.
     * @param {String} actualSubject the subject to send to. 
     */
    _sendToOneConnection(socket, req, actualSubject) {
        if (socket.readyState !== WebSocket.CLOSED) {
            req.subject = actualSubject;
            socket.send(JSON.stringify(req));
        }
    }

    /**	
     * Closes a connection to a client with a 1011 status code.
     * 
     * @param {Object} socket connection to a client.
     */
    _close(socket) {
        if (socket)
            socket.close(1011);
    }

}

module.exports = FrusterWebBus;