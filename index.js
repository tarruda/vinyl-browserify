var util = require('util');
var EventEmitter = require('events');

var gulp = require('gulp');
var xtend = require('xtend');
var browserify = require('browserify');
var source = require('vinyl-source-stream');
var buffer = require('vinyl-buffer');
var through = require('through2');
var mold = require('mold-source-map');
var has = require('has');


function cacheDeps(bundler, cache) {
  bundler.pipeline.get('deps').push(through.obj(function(row, enc, next) {
    var file = row.expose ? bundler._expose[row.id] : row.file;
    cache[file] = { source: row.source, deps: xtend({}, row.deps) };
    this.push(row);
    next();
  }));
}

function init(bundler, entries, expose, external, callback) {
  var pending = 1;

  gulp.src(entries, {read: false, base: '.'})
    .pipe(through.obj(add, finish));

  if (external) {
    pending++;
    gulp.src(external, {read: false, base: '.'})
      .pipe(through.obj(externalize, finish));
  }

  function add(file, enc, cb) {
    bundler.add(file.relative, {expose: expose});
    if (expose) bundler.require('./' + file.relative);
    cb();
  }

  function externalize(file, enc, cb) {
    bundler.external(file.relative);
    cb();
  }

  function finish(cb) {
    if (!--pending) callback();
    cb();
  }
}

function Bundler(opts) {
  this._bundler = null;
  this._transform = null;
  this._resolved = null;
  this._updated = false;
  this._cache = {};
  this._packageCache = {};
  this._opts = opts = xtend({}, opts, {
    cache: this._cache,
    packageCache: this._packageCache
  });
  this._entries = opts.entries;
  this._expose = opts.expose;
  this._external = opts.external;
  delete opts.entries;
  delete opts.expose;
  delete opts.external;
}
util.inherits(Bundler, EventEmitter);

Bundler.prototype.update = function(file) {
  if (has(this._cache, file)) {
    this._updated = true;
    delete this._cache[file];
  }
};

Bundler.prototype.bundle = function(dest) {
  var _this = this;
  var rv = through.obj();
  if (!this._bundler) {
    this._bundler = browserify(this._opts);
    this._bundler.on('reset', cacheDeps.bind(null, this._bundler, this._cache));
    init(this._bundler, this._entries, this._expose, this._external, ready);
  } else if (this._updated) {
    resolve();
  } else {
    resolved();
  }
  return rv;

  function ready() {
    cacheDeps(_this._bundler, _this._cache);
    resolve();
  }

  function resolve() {
    _this.emit('before-bundle', _this._bundler);
    var sourceMap = null;
    var stream = _this._bundler.bundle()
    if (_this._opts.debug) {
      stream = stream.pipe(mold.transform(function(sourcemap, cb) {
        sourceMap = JSON.parse(sourcemap.toJSON());
        cb('');
      }))
    }
    stream = stream.pipe(source(dest))
      .pipe(buffer())
      .pipe(through.obj(function(file, enc, next) {
        if (sourceMap) file.sourceMap = sourceMap;
        _this._resolved = file;
        next(null, file);
      }))
      .pipe(rv);
  }

  function resolved() {
    rv.push(_this._resolved);
    rv.push(null);
  }
};

module.exports = function bundler(opts) {
  return new Bundler(opts);
};
