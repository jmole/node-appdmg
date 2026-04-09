'use strict'

const fs = require('fs')
const temp = require('fs-temp')
const execa = require('execa')
const util = require('./util')

function parseMountPoint (plist, cb) {
  execa('plutil', ['-convert', 'json', '-o', '-', '-'], { input: plist })
    .then(function (res) {
      let parsed

      try {
        parsed = JSON.parse(res.stdout)
      } catch (err) {
        return cb(err)
      }

      const entities = Array.isArray(parsed['system-entities']) ? parsed['system-entities'] : []
      const mountedEntity = entities.find(function (entity) {
        return typeof entity['mount-point'] === 'string'
      })

      if (!mountedEntity) {
        return cb(new Error('Failed to mount image'))
      }

      cb(null, mountedEntity['mount-point'])
    })
    .catch(cb)
}

exports.convert = function (source, format, target, cb) {
  const args = [
    'convert', source,
    '-ov',
    '-format', format,
    '-imagekey', 'zlib-level=9',
    '-o', target
  ]

  util.sh('hdiutil', args, function (err) {
    if (err) {
      fs.unlink(target, () => cb(err))
    } else {
      cb(null, target)
    }
  })
}

exports.create = function (volname, size, filesystem, cb) {
  temp.template('%s.dmg').writeFile('', function (err, outname) {
    if (err) return cb(err)

    const args = [
      'create', outname,
      '-ov',
      '-fs', filesystem || 'HFS+',
      '-size', size,
      '-volname', volname
    ]

    util.sh('hdiutil', args, function (err) {
      if (!err) return cb(null, outname)

      fs.unlink(outname, () => cb(err))
    })
  })
}

exports.attach = function (path, cb) {
  const args = [
    'attach', path,
    '-plist',
    '-nobrowse',
    '-noverify',
    '-noautoopen'
  ]

  util.sh('hdiutil', args, function (err, res) {
    if (err) return cb(err)
    parseMountPoint(res.stdout, cb)
  })
}

exports.detach = function (path, cb) {
  const args = ['detach', path]

  let attempts = 0
  function attemptDetach (err) {
    attempts += 1
    if (err && (err.exitCode === 16 || err.code === 16) && attempts <= 8) {
      setTimeout(function () {
        util.sh('hdiutil', args, attemptDetach)
      }, 1000 * Math.pow(2, attempts - 1))
    } else {
      cb(err)
    }
  }

  util.sh('hdiutil', args, attemptDetach)
}

exports._parseMountPoint = parseMountPoint
