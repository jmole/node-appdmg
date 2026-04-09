'use strict'

const spawnSync = require('child_process').spawnSync

function imageFormat (imagePath) {
  const arg = ['imageinfo', '-format', imagePath]
  const res = spawnSync('hdiutil', arg)

  if (res.status !== 0) {
    const message = res.stderr.toString().trim() || `hdiutil imageinfo failed with status ${res.status}`
    throw new Error(message)
  }

  return res.stdout.toString().trim()
}

module.exports = imageFormat
