const debug = require('debug')('extract-zip')
// eslint-disable-next-line node/no-unsupported-features/node-builtins
const { createWriteStream, promises: fs } = require('fs')
const getStream = require('get-stream')
const path = require('path')
const { promisify } = require('util')
const stream = require('stream')
const yauzl = require('yauzl')

const openZip = promisify(yauzl.open)
const pipeline = promisify(stream.pipeline)

class Extractor {
  constructor (zipPath, opts) {
    this.zipPath = zipPath
    this.opts = opts
  }

  async extract () {
    debug('opening', this.zipPath, 'with opts', this.opts)

    this.zipfile = await openZip(this.zipPath, { lazyEntries: true })
    this.canceled = false

    return new Promise((resolve, reject) => {
      this.zipfile.on('error', err => {
        this.canceled = true
        reject(err)
      })
      this.zipfile.readEntry()

      this.zipfile.on('close', () => {
        if (!this.canceled) {
          debug('zip extraction complete')
          resolve()
        }
      })

      this.zipfile.on('entry', async entry => {
        /* istanbul ignore if */
        if (this.canceled) {
          debug('skipping entry', entry.fileName, { cancelled: this.canceled })
          return
        }

        debug('zipfile entry', entry.fileName)

        if (entry.fileName.startsWith('__MACOSX/')) {
          this.zipfile.readEntry()
          return
        }

        try {
          await this.extractEntry(entry)
          debug('finished processing', entry.fileName)
          this.zipfile.readEntry()
        } catch (err) {
          this.canceled = true
          this.zipfile.close()
          reject(err)
        }
      })
    })
  }

  assertContained (dest) {
    const relative = path.relative(this.opts.dir, dest)
    if (path.isAbsolute(relative) || relative.split(path.sep).includes('..')) {
      throw new Error(`Out of bound path "${dest}"`)
    }
  }

  async checkExistingPath (dest) {
    this.assertContained(dest)
    try {
      // lstat distinguishes a dangling symlink from a missing path. Never
      // accept a dangling existing link whose eventual target is unknown.
      await fs.lstat(dest)
    } catch (err) {
      if (err.code !== 'ENOENT') throw err
      if (dest !== this.opts.dir) await this.checkExistingPath(path.dirname(dest))
      return
    }
    this.assertContained(await fs.realpath(dest))
  }

  async ensureDirectory (dest, mode) {
    this.assertContained(dest)
    if (dest === this.opts.dir) return
    await this.ensureDirectory(path.dirname(dest))
    // Validate before mkdir, including the final component, to avoid creating
    // directories through a link outside the extraction root.
    await this.checkExistingPath(dest)
    try {
      await fs.mkdir(dest, { mode })
    } catch (err) {
      if (err.code !== 'EEXIST') throw err
      if (!(await fs.stat(dest)).isDirectory()) throw err
    }
    await this.checkExistingPath(dest)
  }

  async checkLinkTarget (parent, link) {
    // Resolve existing links before processing each '..'. Lexically resolving
    // the full string first is unsafe when an earlier component is an alias
    // to a shallower directory (including a link to the extraction root).
    let current = await fs.realpath(parent)
    for (const part of link.split('/')) {
      if (!part || part === '.') continue
      current = path.resolve(current, part)
      this.assertContained(current)
      let existing
      try {
        existing = await fs.lstat(current)
      } catch (err) {
        if (err.code !== 'ENOENT') throw err
        continue
      }
      if (existing.isSymbolicLink()) current = await fs.realpath(current)
      this.assertContained(current)
    }
  }

  async extractEntry (entry) {
    /* istanbul ignore if */
    if (this.canceled) {
      debug('skipping entry extraction', entry.fileName, { cancelled: this.canceled })
      return
    }

    if (this.opts.onEntry) {
      this.opts.onEntry(entry, this.zipfile)
    }

    // Validate after onEntry, which may change fileName. Apply both platform
    // conventions so a ZIP cannot become dangerous when moved to Windows.
    const name = entry.fileName
    if (typeof name !== 'string' || !name || /[\\\x00:]/.test(name) ||
        path.posix.isAbsolute(name) || path.win32.isAbsolute(name) ||
        name.split('/').includes('..')) {
      throw new Error('Invalid archive entry path')
    }
    const dest = path.resolve(this.opts.dir, name)
    this.assertContained(dest)

    // convert external file attr int into a fs stat mode int
    const mode = (entry.externalFileAttributes >> 16) & 0xFFFF
    // check if it's a symlink or dir (using stat mode constants)
    const IFMT = 61440
    const IFDIR = 16384
    const IFLNK = 40960
    const symlink = (mode & IFMT) === IFLNK
    let isDir = (mode & IFMT) === IFDIR

    // Failsafe, borrowed from jsZip
    if (!isDir && entry.fileName.endsWith('/')) {
      isDir = true
    }

    // check for windows weird way of specifying a directory
    // https://github.com/maxogden/extract-zip/issues/13#issuecomment-154494566
    const madeBy = entry.versionMadeBy >> 8
    if (!isDir) isDir = (madeBy === 0 && entry.externalFileAttributes === 16)

    debug('extracting entry', { filename: entry.fileName, isDir: isDir, isSymlink: symlink })

    const procMode = this.getExtractedMode(mode, isDir) & 0o777

    // always ensure folders are created
    const destDir = isDir ? dest : path.dirname(dest)

    await this.ensureDirectory(destDir, isDir ? procMode : undefined)
    if (isDir) return

    debug('opening read stream', dest)
    const readStream = await promisify(this.zipfile.openReadStream.bind(this.zipfile))(entry)

    if (symlink) {
      const link = await getStream(readStream, { maxBuffer: 4096 })
      if (!link || /[\\\x00:]/.test(link) || path.posix.isAbsolute(link) || path.win32.isAbsolute(link)) {
        throw new Error('Invalid archive symlink target')
      }
      await this.checkLinkTarget(path.dirname(dest), link)
      debug('creating symlink', link, dest)
      await fs.symlink(link, dest)
    } else {
      try {
        const existing = await fs.lstat(dest)
        if (!existing.isFile()) throw new Error('Refusing to overwrite archive link or directory')
        // Replace regular files without following symlinks or modifying any
        // existing hard-link target. Exclusive creation also closes the final
        // component race between lstat/unlink and opening the output file.
        await fs.unlink(dest)
      } catch (err) {
        if (err.code !== 'ENOENT') throw err
      }
      await pipeline(readStream, createWriteStream(dest, { mode: procMode, flags: 'wx' }))
    }
  }

  getExtractedMode (entryMode, isDir) {
    let mode = entryMode
    // Set defaults, if necessary
    if (mode === 0) {
      if (isDir) {
        if (this.opts.defaultDirMode) {
          mode = parseInt(this.opts.defaultDirMode, 10)
        }

        if (!mode) {
          mode = 0o755
        }
      } else {
        if (this.opts.defaultFileMode) {
          mode = parseInt(this.opts.defaultFileMode, 10)
        }

        if (!mode) {
          mode = 0o644
        }
      }
    }

    return mode
  }
}

module.exports = async function (zipPath, opts) {
  debug('creating target directory', opts.dir)

  if (!path.isAbsolute(opts.dir)) {
    throw new Error('Target directory is expected to be absolute')
  }

  await fs.mkdir(opts.dir, { recursive: true })
  opts.dir = await fs.realpath(opts.dir)
  return new Extractor(zipPath, opts).extract()
}
