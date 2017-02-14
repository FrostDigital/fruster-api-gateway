const bus = require("fruster-bus");
const log = require("fruster-log");
const conf = require('../conf');
const WebSocket = require('ws');
const _ = require('lodash');
const uuid = require('uuid');
const util = require('util');
const apiGateway = require('../api-gateway');

class FrusterWebBus {

    constructor(server, options) {
        this._webSocketServer = new WebSocket.Server({
            server
        });
        this._connectedClients = {};
        this._registerConnectionHandler();
        this._registerWebsocketSubscriber();
        this._options = options || {};
    }

    /**	
     * Registers the connection handler.
     */
    _registerConnectionHandler() {
        this._webSocketServer.on('connection', (socket) => this._newConnection(socket));
    }

    /**	
     * Handles new connections. 
     * Looks in the cookies for a jwt token and decodes it, then checks if the logged in user has the correct permissions.
     * If everything checks out, the connection is added to the list of connected users accessed by the user's id.
     * 
     * @param {object} socket - websocket connection.
     * 
     * @return {object} - promise.
     */
    _newConnection(socket) {
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
            log.error(err);
            return this._close(socket);
        }

        let decodeTokenRequest = {
            cookies: {
                jwt: jwtToken
            }
        };

        return apiGateway.decodeToken(decodeTokenRequest, reqId)
            .then(loggedInUser => {
                if (!loggedInUser || _.size(loggedInUser) === 0)
                    return this._close(socket);

                if (this._validatePermissions(loggedInUser)) {
                    if (!this._connectedClients[loggedInUser.id])
                        this._connectedClients[loggedInUser.id] = {};

                    let connectionId = uuid.v4();
                    this._connectedClients[loggedInUser.id][connectionId] = socket;
                    log.debug("client", connectionId, "for user", loggedInUser.id, "connected");

                    socket.on('close', (reasonCode, description) => {
                        delete this._connectedClients[loggedInUser.id][connectionId];

                        if (_.size(this._connectedClients[loggedInUser.id]) === 0)
                            delete this._connectedClients[loggedInUser.id];

                        log.debug("client", connectionId, "for user", loggedInUser.id, "disconnected", reasonCode, description);
                    });

                    socket.resume();
                } else {
                    return this._close(socket);
                }
            })
            .catch(err => {
                log.error(err);
                return this._close(socket);
            });
    }

    /**	
     * Validates a user has the correct scopes configureds in conf.webSocketPermissionScope.
     * 
     * @param {object} loggedInUser - the logged in user.
     * 
     * @return {boolean} - whether or not the user has all the required scopes.
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
        let webSocketSubject = conf.webSocketSubject;

        return bus.subscribe(webSocketSubject, (req, replyTo, actualSubject) => {
            let userId = actualSubject.replace(webSocketSubject.replace(":userId", ""), "");

            if (this._connectedClients[userId]) {
                _.forIn(this._connectedClients[userId], (client, connectionId) => {

                    if (client.readyState !== WebSocket.CLOSED)
                        client.send(JSON.stringify(req));
                });
            }

            return {
                status: 200,
                reqId: req.reqId
            };
        });
    }

    /**	
     * Closes a connection to a client with a 1011 status code.
     * 
     * @param {object} socket - connection to a client.
     */
    _close(socket) {
        socket.close(1011);
    }

}

module.exports = FrusterWebBus;