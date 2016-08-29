var uuid = require('uuid');

module.exports = {

  createSubject: req => {
    var method = req.method;
    var path = req.path.split('/');
    return ['http', method]
      .concat(path)
      .filter(function (val) {return val;})
      .join('.').toLowerCase();
  },

  createMessage: req => {  
    return {
      reqId: uuid.v1(),
      method: req.method,
      path: req.path,
      query: req.query,
      headers: req.headers,
      data: req.body
    };
  },

  sanitizeResponse: resp => {
    var clone = Object.assign(resp);
    delete clone.headers;    
    return clone;    
  }

};
