'use strict'

const assert = require('assert')
const fs = require('fs')
const path = require('path')
const util = require('util')
const bplist = require('bplist-creator')
const tn1150 = require('tn1150')

const Real = bplist.Real
const APPLE_EPOCH_MS = Date.UTC(1904, 0, 1)
const TEMPLATE_PATH = path.join(__dirname, '..', 'assets', 'DSStore-clean')

function utf16be (str) {
  const b = Buffer.from(str, 'ucs2')
  for (let i = 0; i < b.length; i += 2) {
    const a = b[i]
    b[i] = b[i + 1]
    b[i + 1] = a
  }
  return b
}

function Entry (filename, structureId, dataType, blob) {
  this.filename = tn1150.normalize(filename)
  this.structureId = structureId

  const filenameLength = this.filename.length
  const filenameBytes = filenameLength * 2
  this.buffer = Buffer.alloc(4 + filenameBytes + 4 + 4 + blob.length)

  this.buffer.writeUInt32BE(filenameLength, 0)
  utf16be(this.filename).copy(this.buffer, 4)
  this.buffer.write(structureId, 4 + filenameBytes, 'ascii')
  this.buffer.write(dataType, 8 + filenameBytes, 'ascii')
  blob.copy(this.buffer, 12 + filenameBytes)
}

Entry.sort = function (a, b) {
  const s1 = tn1150.compare(a.filename, b.filename)
  const s2 = a.structureId.localeCompare(b.structureId)
  return s1 || s2
}

Entry.construct = function (filename, structureId, opts) {
  function opt (key, def) {
    if (Object.prototype.hasOwnProperty.call(opts, key)) {
      return opts[key]
    } else if (def === undefined) {
      throw new TypeError('Missing option: ' + key)
    } else {
      return def
    }
  }

  let dataType
  let blob

  switch (structureId) {
    case 'Iloc':
      dataType = 'blob'
      blob = Buffer.alloc(20)
      blob.writeUInt32BE(blob.length - 4, 0)
      blob.writeUInt32BE(opts.x, 4)
      blob.writeUInt32BE(opts.y, 8)
      blob.write('FFFFFF00', 12, 'hex')
      break

    case 'bwsp':
      dataType = 'bplist'
      blob = bplist({
        ContainerShowSidebar: true,
        ShowPathbar: false,
        ShowSidebar: true,
        ShowStatusBar: false,
        ShowTabView: false,
        ShowToolbar: false,
        SidebarWidth: 0,
        WindowBounds:
          '{{' + opt('x') + ', ' + opt('y') + '},' +
          ' {' + opt('width') + ', ' + opt('height') + '}}'
      })
      break

    case 'icvp': {
      const plistObj = {
        backgroundType: 1,
        backgroundColorRed: new Real(1),
        backgroundColorGreen: new Real(1),
        backgroundColorBlue: new Real(1),
        showIconPreview: true,
        showItemInfo: false,
        textSize: new Real(12),
        iconSize: new Real(opt('iconSize')),
        viewOptionsVersion: 1,
        gridSpacing: new Real(100),
        gridOffsetX: new Real(0),
        gridOffsetY: new Real(0),
        labelOnBottom: true,
        arrangeBy: 'none'
      }

      if (opts.colorComponents) {
        plistObj.backgroundColorRed = new Real(opts.colorComponents[0])
        plistObj.backgroundColorGreen = new Real(opts.colorComponents[1])
        plistObj.backgroundColorBlue = new Real(opts.colorComponents[2])
      }

      if (opts.rawAlias) {
        plistObj.backgroundType = 2
        plistObj.backgroundImageAlias = opts.rawAlias
      }

      dataType = 'bplist'
      blob = bplist(plistObj)
      break
    }

    case 'vSrn':
      dataType = 'long'
      blob = Buffer.alloc(4)
      blob.writeUInt32BE(opt('value'), 0)
      break

    default:
      throw new Error('Unsupported DS_Store structure: ' + structureId)
  }

  if (dataType === 'bplist') {
    dataType = 'blob'
    const buf = blob
    blob = Buffer.alloc(buf.length + 4)
    blob.writeUInt32BE(buf.length, 0)
    buf.copy(blob, 4)
  }

  return new Entry(filename, structureId, dataType, blob)
}

function DSStoreFile () {
  this.entries = []
}

DSStoreFile.prototype.push = function (entry) {
  this.entries.push(entry)
}

DSStoreFile.prototype.write = function (filePath, cb) {
  const entries = this.entries.sort(Entry.sort)

  fs.readFile(TEMPLATE_PATH, function (err, buf) {
    if (err) return cb(err)

    const modified = Buffer.alloc(3840)
    modified.fill(0)

    let currentPos = 0
    modified.writeUInt32BE(0, currentPos)
    modified.writeUInt32BE(entries.length, currentPos + 4)
    currentPos += 8

    for (const entry of entries) {
      entry.buffer.copy(modified, currentPos)
      currentPos += entry.buffer.length
    }

    buf.writeUInt32BE(entries.length, 76)
    modified.copy(buf, 4100)

    fs.writeFile(filePath, buf, cb)
  })
}

function appleDate (value) {
  if (!(value instanceof Date)) {
    throw new TypeError('Not a date: ' + value)
  }

  return Math.round((value.getTime() - APPLE_EPOCH_MS) / 1000)
}

function encodeAlias (info) {
  assert.equal(info.version, 2)

  const baseLength = 150
  const extraLength = (info.extra || []).reduce(function (p, c) {
    assert.equal(c.data.length, c.length)
    const padding = (c.length % 2)
    return p + 4 + c.length + padding
  }, 0)
  const trailerLength = 4
  const buf = Buffer.alloc(baseLength + extraLength + trailerLength)

  buf.writeUInt32BE(0, 0)
  buf.writeUInt16BE(buf.length, 4)
  buf.writeUInt16BE(info.version, 6)

  const type = ['file', 'directory'].indexOf(info.target.type)
  assert(type === 0 || type === 1, 'Type is valid')
  buf.writeUInt16BE(type, 8)

  const volNameLength = info.volume.name.length
  assert(volNameLength <= 27, 'Volume name is not longer than 27 chars')
  buf.writeUInt8(volNameLength, 10)
  buf.fill(0, 11, 38)
  buf.write(info.volume.name, 11, 'utf8')

  buf.writeUInt32BE(appleDate(info.volume.created), 38)

  const volSig = info.volume.signature
  assert(volSig === 'BD' || volSig === 'H+' || volSig === 'HX', 'Volume signature is valid')
  buf.write(volSig, 42, 'ascii')

  const volType = ['local', 'network', 'floppy-400', 'floppy-800', 'floppy-1400', 'other'].indexOf(info.volume.type)
  assert(volType >= 0 && volType <= 5, 'Volume type is valid')
  buf.writeUInt16BE(volType, 44)

  buf.writeUInt32BE(info.parent.id, 46)

  const fileNameLength = info.target.filename.length
  assert(fileNameLength <= 63, 'File name is not longer than 63 chars')
  buf.writeUInt8(fileNameLength, 50)
  buf.fill(0, 51, 114)
  buf.write(info.target.filename, 51, 'utf8')

  buf.writeUInt32BE(info.target.id, 114)
  buf.writeUInt32BE(appleDate(info.target.created), 118)
  buf.write('\0\0\0\0', 122, 'binary')
  buf.write('\0\0\0\0', 126, 'binary')
  buf.writeInt16BE(-1, 130)
  buf.writeInt16BE(-1, 132)
  buf.writeUInt32BE(0x00000D02, 134)
  buf.writeUInt16BE(0x0000, 138)
  buf.fill(0, 140, 150)

  let pos = 150
  for (const e of info.extra) {
    assert(e.type >= 0, 'Type is valid')
    buf.writeInt16BE(e.type, pos)
    buf.writeUInt16BE(e.length, pos + 2)
    e.data.copy(buf, pos + 4)
    pos += 4 + e.length
    if (e.length % 2 === 1) {
      buf.writeUInt8(0, pos)
      pos += 1
    }
  }

  buf.writeInt16BE(-1, pos)
  buf.writeUInt16BE(0, pos + 2)
  pos += 4
  assert.equal(pos, buf.length)

  return buf
}

function findVolume (startPath, startStat) {
  let lastDev = startStat.dev
  let lastIno = startStat.ino
  let lastPath = startPath

  while (true) {
    const parentPath = path.resolve(lastPath, '..')
    const parentStat = fs.statSync(parentPath)

    if (parentStat.dev !== lastDev) {
      return lastPath
    }

    if (parentStat.ino === lastIno) {
      return lastPath
    }

    lastDev = parentStat.dev
    lastIno = parentStat.ino
    lastPath = parentPath
  }
}

function createAlias (targetPath, volumeName) {
  const info = { version: 2, extra: [] }
  const parentPath = path.resolve(targetPath, '..')
  const targetStat = fs.statSync(targetPath)
  const parentStat = fs.statSync(parentPath)
  const volumePath = findVolume(targetPath, targetStat)
  const volumeStat = fs.statSync(volumePath)

  assert(targetStat.isFile() || targetStat.isDirectory(), 'Target is a file or directory')
  assert(typeof volumeName === 'string' && volumeName.length > 0, 'Volume name must be a non-empty string')

  info.target = {
    id: targetStat.ino,
    type: (targetStat.isDirectory() ? 'directory' : 'file'),
    filename: path.basename(targetPath),
    created: targetStat.ctime
  }

  info.parent = {
    id: parentStat.ino,
    name: path.basename(parentPath)
  }

  info.volume = {
    name: volumeName,
    created: volumeStat.ctime,
    signature: 'H+',
    type: (volumePath === '/' ? 'local' : 'other')
  }

  const parentName = Buffer.from(info.parent.name, 'utf8')
  info.extra.push({ type: 0, length: parentName.length, data: parentName })

  const parentId = Buffer.alloc(4)
  parentId.writeUInt32BE(info.parent.id, 0)
  info.extra.push({ type: 1, length: parentId.length, data: parentId })

  const targetNameLength = info.target.filename.length
  const targetName = Buffer.alloc(2 + (targetNameLength * 2))
  targetName.writeUInt16BE(targetNameLength, 0)
  utf16be(info.target.filename).copy(targetName, 2)
  info.extra.push({ type: 14, length: targetName.length, data: targetName })

  const volumeNameLength = info.volume.name.length
  const volumeNameData = Buffer.alloc(2 + (volumeNameLength * 2))
  volumeNameData.writeUInt16BE(volumeNameLength, 0)
  utf16be(info.volume.name).copy(volumeNameData, 2)
  info.extra.push({ type: 15, length: volumeNameData.length, data: volumeNameData })

  const volumePathLength = volumePath.length
  assert.equal(targetPath.slice(0, volumePathLength), volumePath)
  const localPath = Buffer.from(targetPath.slice(volumePathLength), 'utf8')
  info.extra.push({ type: 18, length: localPath.length, data: localPath })

  const volumePathData = Buffer.from(volumePath, 'utf8')
  info.extra.push({ type: 19, length: volumePathData.length, data: volumePathData })

  return encodeAlias(info)
}

function Helper () {
  this.file = new DSStoreFile()
  this.opts = {
    window: { x: 100, y: 100 }
  }
}

Helper.prototype.setBackgroundPath = function (backgroundPath) {
  this.opts.backgroundPath = backgroundPath
}

Helper.prototype.setBackgroundColor = function (red, green, blue) {
  this.opts.backgroundColor = [red, green, blue]
}

Helper.prototype.setIconSize = function (size) {
  this.opts.iconSize = size
}

Helper.prototype.setIconPos = function (name, x, y) {
  this.file.push(Entry.construct(name, 'Iloc', { x, y }))
}

Helper.prototype.setWindowPos = function (x, y) {
  this.opts.window.x = x
  this.opts.window.y = y
}

Helper.prototype.setWindowSize = function (w, h) {
  this.opts.window.width = w
  this.opts.window.height = h + 22
}

Helper.prototype.vSrn = function (value) {
  assert(value === 0 || value === 1)
  this.file.push(Entry.construct('.', 'vSrn', { value }))
}

Helper.prototype.write = function (filePath, options, cb) {
  if (typeof options === 'function') {
    cb = options
    options = {}
  }

  const opts = options || {}
  let rawAlias
  let colorComponents

  if (this.opts.backgroundPath) {
    if (typeof opts.volumeName !== 'string' || opts.volumeName.length === 0) {
      return cb(new Error('Missing DS_Store write option `volumeName`'))
    }
    rawAlias = createAlias(this.opts.backgroundPath, opts.volumeName)
  }

  if (this.opts.backgroundColor) {
    colorComponents = this.opts.backgroundColor
  }

  this.file.push(Entry.construct('.', 'bwsp', this.opts.window))
  this.file.push(Entry.construct('.', 'icvp', {
    iconSize: this.opts.iconSize,
    rawAlias,
    colorComponents
  }))

  this.file.write(filePath, cb)
}

Helper.prototype.setBackground = util.deprecate(
  Helper.prototype.setBackgroundPath,
  'setBackground is deprecated, please use setBackgroundPath'
)

module.exports = exports = Helper
