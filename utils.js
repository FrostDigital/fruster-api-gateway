var uuid = require("uuid");

module.exports = {

  createSubject: req => {
    var method = req.method;
    var path = req.path.split("/");
    return ["http", method]
      .concat(path)
      .filter(function (val) {
        return val;
      })
      .join(".").toLowerCase();
  },

  createRequest: (req, reqId, user) => {
    var o = {
      reqId: reqId,
      method: req.method,
      path: req.path,
      query: req.query,
      headers: req.headers,
      data: req.body
    };

    if (user) {
      o.user = user;
    }

    return o;
  },

  sanitizeResponse: resp => {
    var clone = Object.assign(resp);
    delete clone.headers;
    delete clone.user;
    return clone;
  }

};