import fs from 'node:fs'
import path from 'node:path'

const outputRoot = process.argv[2] || 'dist'
const baseWxml = path.resolve(outputRoot, 'base.wxml')

if (fs.existsSync(baseWxml)) {
  const source = fs.readFileSync(baseWxml, 'utf8')
  const patched = source.replace(/\s+padding="\{\{i\.p12\|\|\[0,0,0,0\]\}}"/g, '')

  if (patched !== source) {
    fs.writeFileSync(baseWxml, patched)
    console.log(`patched ${outputRoot}/base.wxml: removed unsupported scroll-view padding attribute`)
  }
}
