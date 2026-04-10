'use strict'

const fs = require('fs')
const path = require('path')

const async = require('async')
const DSStore = require('./ds-store')
const sizeOf = require('image-size')
const validator = require('is-my-json-valid')
const parseColor = require('parse-color')

const util = require('./util')
const hdiutil = require('./hdiutil')
const Pipeline = require('./pipeline')
const schema = require('../schema')

const validateSpec = validator(schema, {
  formats: {
    'css-color': (text) => Boolean(parseColor(text).rgb)
  }
})

function hasKeys (obj, props) {
  function hasKey (key) { return Object.prototype.hasOwnProperty.call(obj, key) }

  return (props.filter(hasKey).length === props.length)
}

function validateEntryName (name) {
  if (typeof name !== 'string' || name.length === 0) {
    throw new Error('Entry name must be a non-empty string')
  }

  if (name === '.' || name === '..' || name.includes('/') || name.includes('\\')) {
    throw new Error(`Invalid entry name: ${name}`)
  }
}

function resolveMountTargetPath (mountPath, name) {
  validateEntryName(name)

  const resolvedMountPath = path.resolve(mountPath)
  const resolvedTargetPath = path.resolve(mountPath, name)

  if (resolvedTargetPath !== resolvedMountPath && !resolvedTargetPath.startsWith(`${resolvedMountPath}${path.sep}`)) {
    throw new Error(`Invalid entry name: ${name}`)
  }

  return resolvedTargetPath
}

function parseOptions (options) {
  if (typeof options !== 'object') {
    throw new Error('`options` must be an object')
  }

  if (hasKeys(options, ['target']) === false) {
    throw new Error('Missing option `target`')
  }

  const parsed = {}
  const hasSource = hasKeys(options, ['source'])
  const hasSpec = hasKeys(options, ['basepath', 'specification'])

  if (hasSource === hasSpec) {
    throw new Error('Supply one of `source` or `(basepath, specification)`')
  }

  if (hasSource) {
    parsed.hasSpec = false
    parsed.source = options.source
    parsed.target = options.target
    parsed.resolveBase = path.dirname(options.source)
  }

  if (hasSpec) {
    parsed.hasSpec = true
    parsed.target = options.target
    parsed.opts = options.specification
    parsed.resolveBase = options.basepath
  }

  return parsed
}

module.exports = exports = function (options) {
  if (process.platform !== 'darwin') {
    throw new Error(`Platform not supported: ${process.platform}`)
  }

  const ctx = parseOptions(options)
  const resolvePath = (to) => path.resolve(ctx.resolveBase, to)

  const pipeline = new Pipeline()

  /**
   **
   **/

  pipeline.addStep('Looking for target', function (next) {
    fs.writeFile(ctx.target, '', { flag: 'wx' }, function (err) {
      if (err && err.code === 'EEXIST') return next(new Error('Target already exists'))
      if (err) return next(err)

      pipeline.addCleanupStep('unlink-target', 'Removing target image', function (next, hasErrored) {
        if (hasErrored) {
          fs.unlink(ctx.target, next)
        } else {
          next(null)
        }
      })
      next(null)
    })
  })

  /**
   **
   **/

  pipeline.addStep('Reading JSON Specification', function (next) {
    if (ctx.hasSpec) return next.skip()

    fs.readFile(ctx.source, function (err, buffer) {
      if (err && err.code === 'ENOENT' && err.path) {
        next(new Error(`JSON Specification not found at: ${err.path}`))
      } else {
        ctx.specbuffer = buffer
        next(err)
      }
    })
  })

  /**
   **
   **/

  pipeline.addStep('Parsing JSON Specification', function (next) {
    if (ctx.hasSpec) return next.skip()

    try {
      const obj = JSON.parse(ctx.specbuffer.toString())

      if (obj.icons) {
        const legacy = require('./legacy')
        ctx.opts = legacy.convert(obj)
      } else {
        ctx.opts = obj
      }

      next(null)
    } catch (err) {
      next(err)
    }
  })

  /**
   **
   **/

  pipeline.addStep('Validating JSON Specification', function (next) {
    if (validateSpec(ctx.opts)) return next(null)

    function formatError (error) {
      return `${error.field} ${error.message}`
    }

    const message = validateSpec.errors.map(formatError).join(', ')

    next(new Error(message))
  })

  /**
   **
   **/

  pipeline.addStep('Looking for files', function (next) {
    function find (type) {
      return ctx.opts.contents.filter(function (e) {
        return (e.type === type)
      })
    }

    ctx.links = find('link')
    ctx.files = find('file')

    async.each(ctx.files, function (file, cb) {
      const resolvedPath = resolvePath(file.path)

      util.pathExists(resolvedPath, function (err, exists) {
        if (err) {
          cb(err)
        } else if (exists) {
          cb(null)
        } else {
          cb(new Error(`"${file.path}" not found at: ${resolvedPath}`))
        }
      })
    }, next)
  })

  /**
   **
   **/

  pipeline.addStep('Calculating size of image', function (next) {
    const dusm = util.dusm.bind(util)
    const paths = ctx.files.map((e) => resolvePath(e.path))

    async.map(paths, dusm, function (err, sizes) {
      if (err) return next(err)

      let megabytes = sizes.reduce((p, c) => p + c, 0)

      // FIXME: I think that this has something to do
      // with blocksize and minimum file size...
      // This should work for now but requires more
      // space than it should. Note that this does
      // not effect the final image.
      megabytes = megabytes * 1.5

      ctx.megabytes = (megabytes + 32)
      next(null)
    })
  })

  /**
   **
   **/

  pipeline.addStep('Creating temporary image', function (next) {
    hdiutil.create(ctx.opts.title, `${ctx.megabytes}m`, ctx.opts.filesystem, function (err, temporaryImagePath) {
      if (err) return next(err)

      pipeline.addCleanupStep('unlink-temporary-image', 'Removing temporary image', function (next) {
        fs.unlink(temporaryImagePath, next)
      })

      ctx.temporaryImagePath = temporaryImagePath
      next(null)
    })
  })

  /**
   **
   **/

  pipeline.addStep('Mounting temporary image', function (next) {
    hdiutil.attach(ctx.temporaryImagePath, function (err, temporaryMountPath) {
      if (err) return next(err)

      pipeline.addCleanupStep('unmount-temporary-image', 'Unmounting temporary image', function (next) {
        hdiutil.detach(temporaryMountPath, next)
      })

      ctx.temporaryMountPath = temporaryMountPath
      next(null)
    })
  })

  /**
   **
   **/

  pipeline.addStep('Making hidden background folder', function (next) {
    ctx.bkgdir = path.join(ctx.temporaryMountPath, '.background')
    fs.mkdir(ctx.bkgdir, next)
  })

  /**
   **
   **/

  pipeline.addStep('Copying background', function (next) {
    if (!ctx.opts.background) return next.skip()

    const absolutePath = resolvePath(ctx.opts.background)
    const retinaPath = absolutePath.replace(/\.([a-z]+)$/, '@2x.$1')

    function copyRetinaBackground (next) {
      const originalExt = path.extname(ctx.opts.background)
      const outputName = `${path.basename(ctx.opts.background, originalExt)}.tiff`
      const finalPath = path.join(ctx.bkgdir, outputName)
      ctx.bkgname = path.join('.background', outputName)
      util.tiffutil(absolutePath, retinaPath, finalPath, next)
    }

    function copyPlainBackground (next) {
      const finalPath = path.join(ctx.bkgdir, path.basename(ctx.opts.background))
      ctx.bkgname = path.join('.background', path.basename(ctx.opts.background))
      fs.copyFile(absolutePath, finalPath, next)
    }

    util.pathExists(retinaPath, function (err, exists) {
      if (err) {
        return next(err)
      } else if (exists) {
        copyRetinaBackground(next)
      } else {
        copyPlainBackground(next)
      }
    })
  })

  /**
   **
   **/

  pipeline.addStep('Reading background dimensions', function (next) {
    if (!ctx.opts.background) return next.skip()

    sizeOf(resolvePath(ctx.opts.background), function (err, value) {
      if (err) return next(err)

      ctx.bkgsize = [value.width, value.height]
      next(null)
    })
  })

  /**
   **
   **/

  pipeline.addStep('Copying icon', function (next) {
    if (ctx.opts.icon) {
      const finalPath = path.join(ctx.temporaryMountPath, '.VolumeIcon.icns')
      fs.copyFile(resolvePath(ctx.opts.icon), finalPath, next)
    } else {
      next.skip()
    }
  })

  /**
   **
   **/

  pipeline.addStep('Setting icon', function (next) {
    if (ctx.opts.icon) {
      util.seticonflag(ctx.temporaryMountPath, next)
    } else {
      next.skip()
    }
  })

  /**
   **
   **/

  pipeline.addStep('Creating links', function (next) {
    if (ctx.links.length === 0) {
      return next.skip()
    }

    async.each(ctx.links, function (entry, cb) {
      let finalPath

      try {
        const name = entry.name || path.basename(entry.path)
        finalPath = resolveMountTargetPath(ctx.temporaryMountPath, name)
      } catch (err) {
        return cb(err)
      }

      fs.symlink(entry.path, finalPath, cb)
    }, next)
  })

  /**
   **
   **/

  pipeline.addStep('Copying files', function (next) {
    if (ctx.files.length === 0) {
      return next.skip()
    }

    async.each(ctx.files, function (entry, cb) {
      let finalPath

      try {
        const name = entry.name || path.basename(entry.path)
        finalPath = resolveMountTargetPath(ctx.temporaryMountPath, name)
      } catch (err) {
        return cb(err)
      }

      util.sh('cp', ['-R', resolvePath(entry.path), finalPath], cb)
    }, next)
  })

  /**
   **
   **/

  pipeline.addStep('Making all the visuals', function (next) {
    const ds = new DSStore()

    ds.vSrn(1)
    ds.setIconSize(ctx.opts['icon-size'] || 80)

    if (ctx.opts['background-color']) {
      const rgb = parseColor(ctx.opts['background-color']).rgb
      ds.setBackgroundColor(rgb[0] / 255, rgb[1] / 255, rgb[2] / 255)
    }

    if (ctx.opts.background) {
      ds.setBackgroundPath(path.join(ctx.temporaryMountPath, ctx.bkgname))
    }

    if (ctx.opts.window && ctx.opts.window.size) {
      ds.setWindowSize(ctx.opts.window.size.width, ctx.opts.window.size.height)
    } else if (ctx.bkgsize) {
      ds.setWindowSize(ctx.bkgsize[0], ctx.bkgsize[1])
    } else {
      ds.setWindowSize(640, 480)
    }

    if (ctx.opts.window && ctx.opts.window.position) {
      ds.setWindowPos(ctx.opts.window.position.x, ctx.opts.window.position.y)
    }

    for (const e of ctx.opts.contents) {
      ds.setIconPos(e.name || path.basename(e.path), e.x, e.y)
    }

    ds.write(path.join(ctx.temporaryMountPath, '.DS_Store'), { volumeName: ctx.opts.title }, (err) => next(err))
  })

  /**
   **
   **/

  pipeline.addStep('Blessing image', function (next) {
    // Blessing does not work for APFS disk images
    if (ctx.opts.filesystem !== 'APFS') {
      const args = [
        '--folder', ctx.temporaryMountPath
      ]

      // Skip --openfolder because recent macOS behavior made it unreliable.

      util.sh('bless', args, next)
    } else {
      next.skip()
    }
  })

  /**
   **
   **/

  pipeline.addStep('Unmounting temporary image', function (next) {
    pipeline.runCleanup('unmount-temporary-image', next)
  })

  /**
   **
   **/

  pipeline.addStep('Finalizing image', function (next) {
    const format = (ctx.opts.format || 'UDZO')

    hdiutil.convert(ctx.temporaryImagePath, format, ctx.target, next)
  })

  /**
   **
   **/

  pipeline.addStep('Signing image', function (next) {
    const codeSignOptions = ctx.opts['code-sign']
    if (codeSignOptions && codeSignOptions['signing-identity']) {
      const codeSignIdentity = codeSignOptions['signing-identity']
      const codeSignIdentifier = codeSignOptions.identifier
      util.codesign(codeSignIdentity, codeSignIdentifier, ctx.target, next)
    } else {
      return next.skip()
    }
  })

  /**
   **
   **/

  pipeline.expectAdditional(2)

  return pipeline.run()
}
