const uuid = require("uuid");

const ESCAPE_DOTS_REGEPX = /\./g; 

module.exports = {

  createSubject: req => {
    const method = req.method;
    const path = req.path.replace(ESCAPE_DOTS_REGEPX, "{dot}").split("/");
  
    return ["http", method]
      .concat(path)
      .filter(function (val) {
        return val;
      })
      .join(".").toLowerCase();
  },

  createRequest: (req, reqId, user) => {
    let o = {
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