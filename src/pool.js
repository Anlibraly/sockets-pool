var Socket = require('net').Socket;
var util = require('./util');

function Pool(servers, opts) {
  if (!servers || !servers.length) return;

  this._sockets = {};
  this.servers = {};

  // avoid connecting to these servers
  this._avoid = {};

  var self = this;

  for (var i = 0, l = servers.length; i < l; i++) {
    var s = servers[i];
    var tag = s.tag || s.host + ':' + s.port;
    if (this.servers[tag] || this._sockets[tag]) throw new Error('non unique tag');
    this.servers[tag] = { host: s.host, port: s.port, weight: s.weight || 1 };
    this._sockets[tag] = {};
  }

  this.min = (opts && opts.min) || 5;
  this.max = (opts && opts.max) || 10;

  // available sockets
  this.available = [];

  // internally represents the queue
  this._queue = [];

  this._ensure();
}

Pool.prototype._sockets = {};

Pool.prototype.__defineGetter__('length', function() {
  var props = Object.keys(this._sockets);
  var len = 0;
  for (var i = 0, l = props.length; i < l; i++) {
    len += Object.keys(this._sockets[props[i]]).length;
  }
  return len;
});

/*
 *  Returns available socket from pool
 *  Otherwise undefined is none are available  
 */
Pool.prototype.acquire = function() {
  var sock = this.available.pop();
  this._ensure();
  if (sock) sock = util.toPSocket(sock);
  return sock;
};

/*
 *  Manually add a given socket into the pool
 *  Regardless of maximum
 *
 *  Interally the pool uses this to add sockets,
 *  but the maximum is checked via _ensure
 *
 *  Returns true if successful
 */
 Pool.prototype.add = function(socket) {
  // check its a socket & active
  if (!socket instanceof Socket || !socket._handle || socket._handle.fd <= 0 || !socket.remoteAddress || !socket.remotePort) {
    return false;
  }

  var tag = socket.remoteAddress + ':' + socket.remotePort;

  // check if this socket knows about this host
  if (!this.servers[tag]) return false;

  // strip previous listeners from the socket
  if (!util.removeEvents(socket)) return false;

  socket._pid = util.generateId(this._sockets[tag]);
  socket._pool = this;
  this._sockets[tag][socket._pid] = socket;

  util.attachEvents(socket);

  // internally notify pool
  this._available(socket);

  return true;
 }

/*
 *  Adds a function to the queue
 *  Will be processed on next available socket
 */
Pool.prototype.queue = function(fn) {
  var psocket = this.acquire(); // calls _ensure
  if (psocket) {
    util.delayCall(fn, psocket);
  } else {
    this._queue.unshift(fn);
  }
};

 /*
  * internally the pool gets notified when a socket
  * is available
  *
  * the pool then processes queue
  * if nothhing in queue, it emits the 'available'
  * event
  *
  * If the socket is still not claimed, then it releases
  * it back into the available pool
  */
Pool.prototype._available = function(socket) {
  // use socket to process queue
  if (this._queue.length) {
    var fn = this._queue.pop();
    util.delayCall(fn, util.toPSocket(socket));
    return;
  }

  // if still available emit the available event
  //this.emit('available', socket);

  // if still available, put it back into available pool
  this.available.unshift(socket);
}

/*
 *  Figures out what connections are more in need
 *  for the pool
 */
Pool.prototype._recommend = function() {
  var serverkeys = Object.keys(this.servers);

  // what servers should the pool avoid?
  var avoidservers = util.calcAvoidServers(this._avoid);
  if (avoidservers.length) serverkeys = util.arrayDiff(serverkeys, avoidservers);

  var serverlen = serverkeys.length;

  // get total weight
  var total_weight = 0;
  for (var i = 0; i < serverlen; i++) {
    total_weight += this.servers[serverkeys[i]].weight;
  }

  // keeps recommending after maxmium has met
  var totalsockets = this.length;
  var max = this.max;
  if (totalsockets > max) max = totalsockets + 1;

  // calculate proportion, ordering is based on Object.keys
  var ret;
  var proportionMet = 1.0;

  for (var i = 0; i < serverlen; i++) {
    var requirement = Math.round(max / (total_weight / this.servers[serverkeys[i]].weight));
    // requirement met?
    var sockLenForServer = Object.keys(this._sockets[serverkeys[i]]).length;
    var thisPropertion = sockLenForServer / requirement;

    // if 0 and in need we can return early
    if (sockLenForServer === 0 && sockLenForServer < requirement) {
      return this.servers[serverkeys[i]];
    } else if (thisPropertion < proportionMet) {
      proportionMet = thisPropertion;
      ret = this.servers[serverkeys[i]];
    }
  }
  return ret;
};

/*
 *  Ensures minimum sockets are available
 *  Ensures maximum sockets is respected
 */
Pool.prototype._ensure = function() {
  var socket_len = this.length
    , available_len = this.available.length;

  var self = this;
  if (this.min > available_len && socket_len < this.max) {
    var server = this._recommend();
    // this will happen if all the servers are blacklisted
    if (!server) return;
    var servertag = server.host + ':' + server.port;
    var sock = new Socket();
    sock.once('connect', function() {
      self.add(this);
      self._ensure();
      //remove from avoid list
      delete(self._avoid[servertag]);
    });
    // if one of these are triggered during connection
    // this host/port is blacklisted for a brief period
    sock.once('error', function(err) { 
      self._avoid[servertag] = util.calcServerTimeout(servertag); });
    sock.once('timeout', function() { 
      self._avoid[servertag] = util.calcServerTimeout(servertag); });
    sock.once('close', function() { 
      self._avoid[servertag] = util.calcServerTimeout(servertag); });
    sock.connect(server.port, server.host);
  }
};

Pool.prototype.close = function() {
  this._drained = true;

  this._recommend = function() {};
  this._ensure = function() {};
  
  var available = this.available;
  this.available = [];

  // close the free sockets first
  while(available.length) {
    var freeSock = available.pop();
    var tag = freeSock.remoteAddress + ':' + freeSock.remotePort;
    var sockpid = freeSock._pid;
    delete(this._sockets[tag][sockpid]);
    freeSock._pool = null;
    freeSock.end();
    if (freeSock.unref) freeSock.unref(); // 0.8 compat check
  }
}

module.exports = Pool;