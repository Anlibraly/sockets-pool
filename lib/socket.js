var Socket = require('net').Socket
  , EventEmitter = require('events').EventEmitter
  , util = require('./util.js');

function defgetter(prop) {
  this.__defineGetter__(prop, function() { return this._socket[prop]; });
}

function defsetter(prop) {
  this[prop] = function() {
    if (this._socket && this._socket[prop]) {
      switch (arguments.length) {
        case 0:
          return this._socket[prop].call(this._socket);
        case 1:
          return this._socket[prop].call(this._socket, arguments[0]);
        case 2:
          return this._socket[prop].call(this._socket, arguments[0], arguments[1]);
        case 3:
          return this._socket[prop].call(this._socket, arguments[0], arguments[1], arguments[2]);
        default:
          return this._socket[prop].apply(this._socket, Array.prototype.slice.call(arguments));
      }
    }
  }
}

function delegate(obj) {
  var props = Object.getOwnPropertyNames(obj);
  for (var i = 0, l = props.length; i < l; i++) {
    var sockprop = props[i];

    if (!this[sockprop] && !EventEmitter.prototype[sockprop] && this._socket[sockprop]) {
      if (typeof this._socket[sockprop] === 'function') {
        defsetter.call(this, sockprop);
      } else {
        defgetter.call(this, sockprop);
      }
    }
  }
}

function PSocket(socket) {
  EventEmitter.call(this);
  this._socket = socket;
  this._socket._psocket = this;

  if (this._events === null) this._events = {}; // 0.8 compat

  delegate.call(this, this._socket);
  delegate.call(this, Socket.prototype);

  defsetter.call(this, 'on');
  defsetter.call(this, 'setEncoding');
  defgetter.call(this, 'bufferSize');
  defgetter.call(this, 'bytesRead');
}

PSocket.prototype = Object.create(EventEmitter.prototype);

PSocket.prototype.release = function() {
  var self = this;
  if (this._socket.bufferSize !== 0) {
    this._socket.once('drain', function() {
      self.release();
    });
    return;
  }
  
  self._socket.removeAllListeners();
  self._socket.on('close', function() {
    if(self._socket._pool) {
      self._socket._pool._remove(self._socket);
    }
  });
  
  this._socket._pool._available(self._socket);
  this._socket = {};
}

module.exports = PSocket;