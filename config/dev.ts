import type {UserConfigExport} from '@tarojs/cli'

export default {
  mini: {
    debugReact: false
  },
  h5: {},
  compiler: {
    type: 'vite',
    vitePlugins: []
  }
} satisfies UserConfigExport<'vite'>
