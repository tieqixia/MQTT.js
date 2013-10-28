var net = require('net')
  , events = require('events')
  , util = require('util')
  , protocol = require('./protocol')
  , generate = require('./generate')
  , parse = require('./parse');

var Connection = module.exports = function Connection(socket, server) {
  this.server = server;
  this.stream = socket;
  this.buffer = null;
  this.packet = {};
  this.skip = false;
  var that = this;

  this.stream.on('readable',function(){
    if (!that.skip){
      that.parse();
    }
    that.skip = false;
  })

  var evs = ['close','error'];
  for (var i = 0; i < evs.length; i++) {
    this.stream.on(evs[i], function(conn, event) {
      return function(evt) {
        //conn.stream.end();
        conn.emit(event, evt);
      }
    }(this, evs[i]));
  }

  events.EventEmitter.call(this);
};
util.inherits(Connection, events.EventEmitter);

Connection.prototype.generate = generate;

Connection.prototype.parse = function() {
  var byte = null, bytes = [], result;
  
  // Fresh packet - parse the header
  if (!this.packet.cmd) {
    byte = this.stream.read(1);
    if (byte === null) {
      return;
    }
    parse.header(byte, this.packet);
  }

  if (!this.packet.length) {
    var tmp = {mul: 1, length: 0};
    byte = this.stream.read(1);

    if (byte === null) {
      return;
    }

    bytes.push(byte);
    var pos = 1;

    while (pos++ < 4) {

      tmp.length += 
        tmp.mul * (byte[0] & protocol.LENGTH_MASK);
      tmp.mul *= 0x80;

      if ((byte[0] & protocol.LENGTH_FIN_MASK) === 0) {
        break;
      }

      byte = this.stream.read(1);
      if(byte === null) {
        this.skip = true;
        this.stream.unshift(Buffer.concat(bytes));
        return;
      }
      bytes.push(byte);
    }

    this.packet.length = tmp.length;
  }

  // Do we have a payload?
  if (this.packet.length > 0) {
    var payload = this.stream.read(this.packet.length);

    // Do we have enough data to complete the payload?
    if (payload === null) {
      // Nope, wait for more data 
      return;
    }
  }

  // 处理未使用的cmd
  if (!this.packet.cmd ) {this.stream.emit('close'); return}
  // Finally we can parse the payload
  result = parse[this.packet.cmd](
    payload,
    this.packet
  );

  // Emit packet or error
  if (result instanceof Error) {
    this.emit("error", result);
  } else {
    this.emit(this.packet.cmd, result);
  }

  this.packet = {};

  // there might be one more message
  // to parse.
  this.parse();
};

for (var k in protocol.types) {
  var v = protocol.types[k];

  Connection.prototype[v] = function(type) {
    return function(opts) {
      var p = generate[type](opts);

      if (p instanceof Error){
        this.emit('error',p)
      } else {
        if(this.stream.writable){
          return p ? this.stream.write(p) : false;
        }
        else{
          this.stream.end();
        }
      }
    }
  }(v);
}
