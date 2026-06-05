import type {UserConfigExport} from '@tarojs/cli'

export default {
  mini: {},
  h5: {},
  compiler: {
    type: 'vite',
    vitePlugins: []
  }
} satisfies UserConfigExport<'vite'>
