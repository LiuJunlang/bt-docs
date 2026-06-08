import { defineConfig } from 'vitepress'

export default defineConfig({
  base: '/bt-docs/',
  lang: 'zh-CN',
  title: 'BT Tech Notes',
  description: '蓝牙技术深度解析 - Profile 与协议栈分析笔记',

  themeConfig: {
    search: {
      provider: 'local'
    },

    nav: [
      { text: '首页', link: '/' },
      { text: 'Profile 解析', link: '/profiles/' },
      { text: 'A2DP 实战', link: '/a2dp/' }
    ],

    sidebar: {
      '/profiles/': [{ text: 'Profile 深度解析', items: [
        { text: '概览', link: '/profiles/' },
        { text: '3DSP — 3D 同步 Profile', link: '/profiles/3dsp' }
      ]}],
      '/a2dp/': [{ text: 'A2DP 实战分析', items: [
        { text: 'UART 波特率与音频传输带宽', link: '/a2dp/uart-baudrate-analysis' }
      ]}]
    },

    socialLinks: [
      { icon: 'github', link: 'https://github.com/LiuJunlang/bt-docs' }
    ],

    footer: {
      message: '蓝牙技术深度解析笔记',
      copyright: 'Copyright © 2026'
    }
  }
})
