/* eslint-env mocha */

'use strict'

const fs = require('fs')
const path = require('path')
const temp = require('fs-temp')
const assert = require('assert')

const appdmg = require('../')
const imageFormat = require('./lib/image-format')
const visuallyVerifyImage = require('./lib/visually-verify-image')

const STEPS = 22

function runAppdmg (opts, verify, cb) {
  let progressCalled = 0
  const ee = appdmg(opts)

  ee.on('progress', function () {
    progressCalled++
  })

  ee.on('error', function (err) {
    cb(err)
  })

  ee.on('finish', function () {
    try {
      assert.strictEqual(progressCalled, STEPS * 2)
      assert.strictEqual(imageFormat(opts.target), verify.format)
    } catch (err) {
      return cb(err)
    }

    if (process.env.APPDMG_SKIP_VISUAL === '1') {
      return cb(null)
    }

    const expected = path.join(__dirname, verify.visually)
    visuallyVerifyImage(opts.target, verify.title, expected, cb)
  })
}

function runAppdmgError (opts, expectedMessage, cb) {
  const ee = appdmg(opts)

  ee.on('finish', function () {
    cb(new Error('Expected image creation to fail'))
  })

  ee.on('error', function (err) {
    try {
      assert.match(err.message, expectedMessage)
      cb(null)
    } catch (assertErr) {
      cb(assertErr)
    }
  })
}

describe('api', function () {
  let targetDir, targetPath

  beforeEach(function () {
    targetDir = temp.mkdirSync()
    targetPath = path.join(targetDir, 'Test.dmg')
  })

  afterEach(function () {
    try { fs.rmSync(targetDir, { recursive: true, force: true }) } catch (err) {}
  })

  it('creates an image from a modern specification', function (done) {
    this.timeout(60000) // 1 minute

    const opts = {
      target: targetPath,
      source: path.join(__dirname, 'assets', 'appdmg.json')
    }

    const verify = {
      format: 'UDZO',
      title: 'Test Title',
      visually: 'accepted-1.png'
    }

    runAppdmg(opts, verify, done)
  })

  it('creates an image from a legacy specification', function (done) {
    this.timeout(60000) // 1 minute

    const opts = {
      target: targetPath,
      source: path.join(__dirname, 'assets', 'appdmg-legacy.json')
    }

    const verify = {
      format: 'UDZO',
      title: 'Test Title',
      visually: 'accepted-1.png'
    }

    runAppdmg(opts, verify, done)
  })

  it('creates an image from a passed options', function (done) {
    this.timeout(60000) // 1 minute

    const opts = {
      target: targetPath,
      basepath: path.join(__dirname, 'assets'),
      specification: {
        title: 'Test Title',
        icon: 'TestIcon.icns',
        background: 'TestBkg.png',
        contents: [
          { x: 448, y: 344, type: 'link', path: '/Applications' },
          { x: 192, y: 344, type: 'file', path: 'TestApp.app' },
          { x: 512, y: 128, type: 'file', path: 'TestDoc.txt' }
        ]
      }
    }

    const verify = {
      format: 'UDZO',
      title: 'Test Title',
      visually: 'accepted-1.png'
    }

    runAppdmg(opts, verify, done)
  })

  it('creates an image without compression', function (done) {
    this.timeout(60000) // 1 minute

    const opts = {
      target: targetPath,
      basepath: path.join(__dirname, 'assets'),
      specification: {
        title: 'Test Title',
        icon: 'TestIcon.icns',
        background: 'TestBkg.png',
        format: 'UDRO',
        contents: [
          { x: 448, y: 344, type: 'link', path: '/Applications' },
          { x: 192, y: 344, type: 'file', path: 'TestApp.app' },
          { x: 512, y: 128, type: 'file', path: 'TestDoc.txt' }
        ]
      }
    }

    const verify = {
      format: 'UDRO',
      title: 'Test Title',
      visually: 'accepted-1.png'
    }

    runAppdmg(opts, verify, done)
  })

  it('creates an image with a background color', function (done) {
    this.timeout(60000) // 1 minute

    const opts = {
      target: targetPath,
      source: path.join(__dirname, 'assets', 'appdmg-bg-color.json')
    }

    const verify = {
      format: 'UDZO',
      title: 'Test Title',
      visually: 'accepted-2.png'
    }

    runAppdmg(opts, verify, done)
  })

  it('creates an image with custom names', function (done) {
    this.timeout(60000) // 1 minute

    const opts = {
      target: targetPath,
      basepath: path.join(__dirname, 'assets'),
      specification: {
        title: 'Test Title',
        icon: 'TestIcon.icns',
        background: 'TestBkg.png',
        contents: [
          { x: 448, y: 344, type: 'link', path: '/Applications', name: 'System Apps' },
          { x: 192, y: 344, type: 'file', path: 'TestApp.app', name: 'My Nice App.app' },
          { x: 512, y: 128, type: 'file', path: 'TestDoc.txt', name: 'Documentation.txt' }
        ]
      }
    }

    const verify = {
      format: 'UDZO',
      title: 'Test Title',
      visually: 'accepted-3.png'
    }

    runAppdmg(opts, verify, done)
  })

  it('emits an error for malformed json input', function (done) {
    const sourcePath = path.join(targetDir, 'invalid.json')
    fs.writeFileSync(sourcePath, '{ invalid json')

    runAppdmgError({
      target: targetPath,
      source: sourcePath
    }, /Unexpected token|Expected property name/, done)
  })

  it('emits an error when a file in the spec is missing', function (done) {
    runAppdmgError({
      target: targetPath,
      basepath: path.join(__dirname, 'assets'),
      specification: {
        title: 'Test Title',
        background: 'TestBkg.png',
        contents: [
          { x: 192, y: 344, type: 'file', path: 'MissingApp.app' }
        ]
      }
    }, /not found at/, done)
  })

  it('emits an error for invalid specifications', function (done) {
    runAppdmgError({
      target: targetPath,
      basepath: path.join(__dirname, 'assets'),
      specification: {
        contents: [
          { x: 192, y: 344, type: 'file', path: 'TestApp.app' }
        ]
      }
    }, /title/, done)
  })

  it('emits an error when the target already exists', function (done) {
    fs.writeFileSync(targetPath, '')

    runAppdmgError({
      target: targetPath,
      source: path.join(__dirname, 'assets', 'appdmg.json')
    }, /Target already exists/, done)
  })
})
