'use strict'

const fs = require('fs')
const execa = require('execa')
const util = require('util')

let xattrModulePromise

function getXattrModule () {
  if (!xattrModulePromise) {
    xattrModulePromise = import('fs-xattr')
  }

  return xattrModulePromise
}

exports.sh = function (prog, args, cb) {
  util.callbackify(() => execa(prog, args))(cb)
}

exports.dusm = function (path, cb) {
  exports.sh('du', ['-sm', path], (err, res) => {
    if (err) return cb(err)

    if (res.stderr.length > 0) {
      return cb(new Error(`du -sm: ${res.stderr}`))
    }

    const m = /^([0-9]+)\t/.exec(res.stdout)
    if (m === null) {
      return cb(new Error(`du -sm: Unexpected output: ${res.stdout}`))
    }

    return cb(null, parseInt(m[1], 10))
  })
}

exports.tiffutil = function (a, b, out, cb) {
  exports.sh('tiffutil', ['-cathidpicheck', a, b, '-out', out], (err) => cb(err))
}

exports.seticonflag = function (path, cb) {
  const buf = Buffer.alloc(32)
  buf.writeUInt8(4, 8)

  getXattrModule()
    .then(({ setAttribute }) => setAttribute(path, 'com.apple.FinderInfo', buf))
    .then(() => cb(null), cb)
}

exports.codesign = function (identity, identifier, path, cb) {
  const args = ['--verbose', '--sign', identity]
  if (identifier) {
    args.push('--identifier', identifier)
  }
  args.push(path)
  exports.sh('codesign', args, (err) => cb(err))
}

exports.pathExists = function (path, cb) {
  fs.access(path, fs.constants.F_OK, function (err) {
    if (!err) return cb(null, true)
    if (err.code === 'ENOENT') return cb(null, false)
    return cb(err)
  })
}
