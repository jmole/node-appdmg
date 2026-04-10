'use strict'

const fs = require('fs')
const temp = require('fs-temp').template('%s.png')
const looksSame = require('looks-same')
const spawnSync = require('child_process').spawnSync
const captureWindow = require('capture-window')
const sizeOf = require('image-size')

const hdiutil = require('../../lib/hdiutil')

const toleranceOpts = { tolerance: 20 }

function retry (fn, cb) {
  let triesLeft = 8

  function runIteration () {
    fn(function (err) {
      if (!err) return cb(null)
      if (--triesLeft === 0) return cb(err)

      setTimeout(runIteration, 150)
    })
  }

  setTimeout(runIteration, 700)
}

function getExpectedImagePath (actualPath, expectedPath) {
  const actualSize = sizeOf(actualPath)
  const expectedSize = sizeOf(expectedPath)

  // If the actual size is scaled by two, use the retina image.
  if (actualSize.width === expectedSize.width * 2 && actualSize.height === expectedSize.height * 2) {
    return expectedPath.replace(/(\.[^.]*)$/, '@2x$1')
  }

  return expectedPath
}

function compareImage (actualPath, expectedPath, cb) {
  const resolvedExpectedPath = getExpectedImagePath(actualPath, expectedPath)

  looksSame(actualPath, resolvedExpectedPath, toleranceOpts, function (err, result) {
    if (err) return cb(err)
    if (result && result.equal) return cb(null)

    cb(Object.assign(new Error('Image looks visually incorrect'), {
      code: 'VISUALLY_INCORRECT',
      actualPath
    }))
  })
}

function saveDiff (actualPath, expectedPath, cb) {
  const resolvedExpectedPath = getExpectedImagePath(actualPath, expectedPath)
  const opts = Object.assign({
    reference: resolvedExpectedPath,
    current: actualPath,
    highlightColor: '#f0f'
  }, toleranceOpts)

  looksSame.createDiff(opts, function (err, data) {
    if (err) return cb(err)

    temp.writeFile(data, function (err2, diffPath) {
      if (err2) return cb(err2)

      cb(null, { diff: diffPath, actual: actualPath })
    })
  })
}

function captureAndVerify (title, expectedPath, cb) {
  captureWindow('Finder', title)
    .then(function (pngPath) {
      compareImage(pngPath, expectedPath, function (err1) {
        fs.unlink(pngPath, function (err2) {
          if (err1) return cb(err1)
          if (err2) return cb(err2)
          cb(null)
        })
      })
    })
    .catch(cb)
}

function captureAndSaveDiff (title, expectedPath, cb) {
  captureWindow('Finder', title)
    .then(function (pngPath) {
      saveDiff(pngPath, expectedPath, cb)
    })
    .catch(cb)
}

function visuallyVerifyImage (imagePath, title, expectedPath, cb) {
  hdiutil.attach(imagePath, function (err, mountPath) {
    if (err) return cb(err)

    function done (err1) {
      function detach (err3) {
        hdiutil.detach(mountPath, function (err2) {
          if (err1) return cb(err1)
          if (err2) return cb(err2)
          if (err3) return cb(err3)

          cb(null)
        })
      }

      if (!err1 || err1.code !== 'VISUALLY_INCORRECT') {
        return detach()
      }

      captureAndSaveDiff(title, expectedPath, function (err3, res) {
        if (err3) return detach(err3)

        console.error('A diff of the images has been saved to:', res.diff)
        console.error('The actual image has been saved to:', res.actual)
        detach()
      })
    }

    try {
      spawnSync('open', ['-a', 'Finder', mountPath])
    } catch (spawnErr) {
      return done(spawnErr)
    }

    retry(function (cb2) {
      captureAndVerify(title, expectedPath, cb2)
    }, done)
  })
}

module.exports = visuallyVerifyImage
