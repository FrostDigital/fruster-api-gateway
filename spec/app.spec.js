//process.env.MAX_REQUEST_SIZE = '1kb';

var request = require('request');
var fs = require('fs');

require('../app');

var base_url = 'http://localhost:3000';

describe('API Gateway', function() {
  
  it('returns status code 404', function(done) {      
    request.get(base_url + '/foo', function(error, response, body) {
      expect(response.statusCode).toBe(404);
      done();      
    });      
  });

  // it('block large requests', function(done) { 
  //   var formData = {      
  //     my_file: fs.createReadStream(__dirname + '/a-large-file.jpg')
  //   };

  //   request.post(base_url, {formData: formData}, function(error, response, body) {      
  //     expect(response.statusCode).toBe(500);
  //     done();      
  //   });      
  // });

});