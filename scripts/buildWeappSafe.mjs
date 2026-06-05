import fs from 'node:fs'
import path from 'node:path'
import {spawnSync} from 'node:child_process'

const root = process.cwd()
const tempRoot = path.resolve(root, '.dist-weapp-tmp')
const distRoot = path.resolve(root, 'dist')
const taroBin = path.resolve(root, 'node_modules/@tarojs/cli/bin/taro')
const nodePathParts = [
  path.resolve(root, 'node_modules/.pnpm/@tarojs+cli@4.1.10_@types+node@24.3.1/node_modules/@tarojs/cli/node_modules'),
  path.resolve(root, 'node_modules/.pnpm/@tarojs+cli@4.1.10_@types+node@24.3.1/node_modules'),
  path.resolve(root, 'node_modules/.pnpm/node_modules'),
]

fs.rmSync(tempRoot, {recursive: true, force: true})

const build = spawnSync(process.execPath, [taroBin, 'build', '--type', 'weapp'], {
  cwd: root,
  stdio: 'inherit',
  env: {
    ...process.env,
    TARO_OUTPUT_ROOT: path.relative(root, tempRoot),
    NODE_PATH: nodePathParts.join(path.delimiter),
  },
})

if (build.status !== 0) {
  process.exit(build.status ?? 1)
}

const patch = spawnSync(process.execPath, [path.resolve(root, 'scripts/patchWeappDist.mjs'), tempRoot], {
  cwd: root,
  stdio: 'inherit',
})

if (patch.status !== 0) {
  process.exit(patch.status ?? 1)
}

fs.mkdirSync(distRoot, {recursive: true})
fs.cpSync(tempRoot, distRoot, {recursive: true, force: true})
console.log(`safe copied ${path.relative(root, tempRoot)} -> dist without clearing dist first`)
