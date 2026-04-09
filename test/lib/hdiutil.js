/* eslint-env mocha */

'use strict'

const assert = require('assert')

const hdiutil = require('../../lib/hdiutil')

describe('hdiutil', function () {
  describe('_parseMountPoint', function () {
    it('extracts the mounted path from plist output', function (done) {
      const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>system-entities</key>
  <array>
    <dict>
      <key>dev-entry</key>
      <string>/dev/disk4</string>
    </dict>
    <dict>
      <key>mount-point</key>
      <string>/Volumes/Test Title</string>
    </dict>
  </array>
</dict>
</plist>`

      hdiutil._parseMountPoint(plist, function (err, mountPoint) {
        if (err) return done(err)

        assert.strictEqual(mountPoint, '/Volumes/Test Title')
        done()
      })
    })

    it('fails when no mounted path is present', function (done) {
      const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>system-entities</key>
  <array>
    <dict>
      <key>dev-entry</key>
      <string>/dev/disk4</string>
    </dict>
  </array>
</dict>
</plist>`

      hdiutil._parseMountPoint(plist, function (err) {
        assert.ok(err)
        assert.match(err.message, /Failed to mount image/)
        done()
      })
    })
  })
})
