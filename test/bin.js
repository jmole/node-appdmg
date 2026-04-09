/* eslint-env mocha */

'use strict'

const pkg = require('../package.json')

const fs = require('fs')
const path = require('path')
const temp = require('fs-temp')
const assert = require('assert')
const spawnSync = require('child_process').spawnSync

const bin = path.join(__dirname, '..', 'bin', 'appdmg.js')

function bufferContains (buffer, needle) {
  return (buffer.toString().indexOf(needle) !== -1)
}

describe('bin', function () {
  it('should print version number', function () {
    const res = spawnSync(bin, ['--version'])

    assert.strictEqual(res.status, 0)
    assert.ok(bufferContains(res.stderr, pkg.version))
  })

  it('should print usage', function () {
    const res = spawnSync(bin, ['--help'])

    assert.strictEqual(res.status, 0)
    assert.ok(bufferContains(res.stderr, 'Usage:'))
  })

  it('should fail with missing arguments', function () {
    const res = spawnSync(bin, [])

    assert.strictEqual(res.status, 1)
    assert.ok(bufferContains(res.stderr, 'Usage:'))
  })

  it('should create dmg file', function () {
    this.timeout(60000)

    const source = path.join(__dirname, 'assets', 'appdmg.json')
    const targetDir = temp.mkdirSync()
    const targetPath = path.join(targetDir, 'Test.dmg')

    try {
      const res = spawnSync(bin, [source, targetPath])

      assert.strictEqual(res.status, 0)
      assert.ok(bufferContains(res.stderr, targetPath))
    } finally {
      try { fs.unlinkSync(targetPath) } catch (err) {}
      try { fs.rmdirSync(targetDir) } catch (err) {}
    }
  })

  it('should fail with too many arguments', function () {
    const res = spawnSync(bin, ['a.json', 'b.dmg', 'c.dmg'])

    assert.notStrictEqual(res.status, 0)
    assert.ok(bufferContains(res.stderr, 'Too many arguments'))
  })

  it('should fail for non-json input', function () {
    const res = spawnSync(bin, ['a.txt', 'b.dmg'])

    assert.notStrictEqual(res.status, 0)
    assert.ok(bufferContains(res.stderr, 'Input must have the .json file extension'))
  })

  it('should fail for non-dmg output', function () {
    const res = spawnSync(bin, ['a.json', 'b.txt'])

    assert.notStrictEqual(res.status, 0)
    assert.ok(bufferContains(res.stderr, 'Output must have the .dmg file extension'))
  })
})
