var PSocket = require('./socket');

/*
 *  Layer a PSocket on top of a net.Socket
 */
exports.toPSocket = function(socket) {
  return new PSocket(socket);
}

/*
 *  Attaches events to bubble up to a PSocket
 */
exports.attachEvents = function(socket) {
  socket.on('error', function(e) {
    if (this._psocket) this._psocket.emit('error', e);
  });
  socket.on('close', function() {
    if (this._psocket) this._psocket.emit('close');
  });
  socket.on('timeout', function() {
    if (this._psocket) this._psocket.emit('timeout')
  });
  socket.on('end', function() {
    if (this._psocket) this._psocket.emit('end');
  });

  socket.on('data', function(data) {
    if (this._psocket) this._psocket.emit('data', data);
  });
}

/*
 *  Randomly generate ID, and ensures unique
 */
exports.generateId = function(dest) {
  var id = Math.random().toString(16).substr(2);
  if (dest[id]) return generateId(dest);
  return id;
}

/*
 *  Remove current events from the socket
 */
exports.removeEvents = function(socket) {
  if (socket && socket.removeAllListeners) {
    socket.removeAllListeners();
    return true;
  }
  return false;
}

/*
 *  Calculates which servers to avoid
 *  Returns back an array of server tags
 */
exports.calcAvoidServers = function(serverObjs) {
  var servertags = Object.keys(serverObjs);
  if (!servertags.length) return [];
  var results = servertags.filter(function(ele, idx, arr) {
    var lastTime = serverObjs[ele][0];
    var timeoutLen = serverObjs[ele][1];
    var timeElapsed = (Date.now() - lastTime) / 1000 / 60;
    if (timeElapsed >= timeoutLen) {
      return false;
    } else {
      return ele;
    }
  });
  return results;
}

/*
 *  Calculate avoid server times
 *  Expects and returns [Time Last Checked, Time out length]
 */
exports.calcServerTimeout = function(arr) {
  if (arr && arr.length) {
    var lastTime = arr[0];
    var timeoutLen = arr[1];
    var timeElapsed = (Date.now() - lastTime) / 1000 / 60;
      // time has passed, double timeout
    if (timeElapsed >= timeoutLen) {
      timeoutLen = timeoutLen * 2;
      if (timeoutLen >= 128) timeoutLen = 128;
      return [Date.now(), timeoutLen];
    } else {
      // elapsed time hasn't passed to do anything
      return arr;
    }
  } else {
    // new timeout
    return [Date.now(), 2];
  }
}

/*
 *  Example:
 *  [1,2,3] - [2] = [1,3]
 */
exports.arrayDiff = function(arr, arr2) {
  return arr.filter(function(ele, idx, a) {
    return (arr2.every(function(ele2, idx2, a2) {
      return (ele2 !== ele);
    }));
  });
}

/*
 *  Backwards compat setImmediate
 */
var delayFn;
if (typeof setImmediate !== 'undefined') {
  delayFn = setImmediate;
} else {
  delayFn = function(fn, arg) {
    setTimeout(function() {
      fn(arg);
    }, 0);
  }
}
exports.delayCall = function(fn, arg) {
  delayFn(fn, arg);
}