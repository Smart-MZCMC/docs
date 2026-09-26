import { defineConfig } from 'vitepress'
import { withMermaid } from "vitepress-mermaid-plugin";

// export default defineConfig({
//   lang: 'zh-CN',
//   title: '绵中融媒体智汇导播系统',
//   titleTemplate: ':title | 操作文档',
//   description: '绵中融媒体智汇导播系统的部署、配置、使用与 API 参考文档',
//   cleanUrls: true,
//   lastUpdated: true,
//   head: [
//     ['meta', { name: 'theme-color', content: '#1677ff' }],
//     ['meta', { name: 'author', content: '绵阳中学融媒体中心' }]
//   ],
//   markdown: {
//     lineNumbers: true,
//     theme: {
//       light: 'github-light',
//       dark: 'github-dark'
//     }
//   },
//   vite: {
//     plugins: []
//   },
//   themeConfig: {
//     nav: [
//       { text: '首页', link: '/' },
//       { text: '使用指南', link: '/operation-manual' },
//       { text: '开发指南', link: '/development-guide' }
//     ],

//     sidebar: [
//       {
//         text: '操作手册',
//         collapsed: false,
//         items: [
//           { text: '系统概述', link: '/operation-manual#系统概述' },
//           { text: '安装与部署', link: '/operation-manual#安装与部署' },
//           { text: '配置说明', link: '/operation-manual#配置说明' },
//           { text: '系统初始化', link: '/operation-manual#系统初始化' },
//           { text: '各端操作指南', link: '/operation-manual#各端操作指南' },
//           { text: 'API 接口参考', link: '/operation-manual#api-接口参考' },
//           { text: '核心机制说明', link: '/operation-manual#核心机制说明' },
//           { text: '故障排查', link: '/operation-manual#故障排查' },
//           { text: '快速启动检查清单', link: '/operation-manual#快速启动检查清单' },
//           { text: '附录', link: '/operation-manual#附录' }
//         ]
//       },
//       {
//         text: '开发指南',
//         collapsed: false,
//         items: [
//           { text: '开发指南', link: '/development-guide' },
//           { text: '项目结构', link: '/development-guide#项目结构' },
//           { text: '后端开发', link: '/development-guide#后端本地开发' },
//           { text: '通信协议', link: '/development-guide#通信协议' },
//           { text: '测试与联调', link: '/development-guide#测试与联调' }
//         ]
//       }
//     ],

//     outline: {
//       level: [2, 3],
//       label: '本页目录'
//     },
//     search: {
//       provider: 'local'
//     },
//     docFooter: {
//       prev: '上一篇',
//       next: '下一篇'
//     },
//     lastUpdated: {
//       text: '最后更新于'
//     },
//     footer: {
//       message: '融聚绵中，媒传万象',
//       copyright: 'Copyright © 烧瑚烙饼 2026'
//     },
//     darkModeSwitchLabel: '外观',
//     sidebarMenuLabel: '目录',
//     returnToTopLabel: '返回顶部',
//     langMenuLabel: '选择语言'
//   },
// })

export default withMermaid({
  lang: 'zh-CN',
  // 挂载在 Go 后端的 /docs 前缀下（见 backend/routes/web.go）。
  // 必须是前后都带斜杠的形式，VitePress 会用它生成所有资源与页面链接。
  // 本地 `pnpm docs:dev` 时如需以根路径预览，可临时改为 '/'。
  base: '/docs/',
  title: '绵中融媒体智汇导播系统',
  titleTemplate: ':title | 操作文档',
  description: '绵中融媒体智汇导播系统的部署、配置、使用与 API 参考文档',
  cleanUrls: true,
  lastUpdated: true,
  head: [
    ['meta', { name: 'theme-color', content: '#1677ff' }],
    ['meta', { name: 'author', content: '绵阳中学融媒体中心' }]
  ],
  markdown: {
    lineNumbers: true,
    theme: {
      light: 'github-light',
      dark: 'github-dark'
    }
  },
  vite: {
    optimizeDeps: {
      include: [
        'mermaid',
        'dayjs',
        'debug',
        '@braintree/sanitize-url',
        'cytoscape',
        'cytoscape-cose-bilkent'
      ]
    },
    ssr: {
      noExternal: ['mermaid']
    },
    plugins: []
  },
  themeConfig: {
    nav: [
      { text: '首页', link: '/' },
      { text: '使用指南', link: '/operation-manual' },
      { text: '开发指南', link: '/development-guide' },
      { text: '插件开发', link: '/plugin-development' }
    ],

    sidebar: [
      {
        text: '操作手册',
        collapsed: false,
        items: [
          { text: '系统概述', link: '/operation-manual#系统概述' },
          { text: '安装与部署', link: '/operation-manual#安装与部署' },
          { text: '配置说明', link: '/operation-manual#配置说明' },
          { text: '系统初始化', link: '/operation-manual#系统初始化' },
          { text: '各端操作指南', link: '/operation-manual#各端操作指南' },
          { text: 'API 接口参考', link: '/operation-manual#api-接口参考' },
          { text: '核心机制说明', link: '/operation-manual#核心机制说明' },
          { text: '故障排查', link: '/operation-manual#故障排查' },
          { text: '快速启动检查清单', link: '/operation-manual#快速启动检查清单' },
          { text: '附录', link: '/operation-manual#附录' }
        ]
      },
      {
        text: '开发指南',
        collapsed: false,
        items: [
          { text: '开发指南', link: '/development-guide' },
          { text: '项目结构', link: '/development-guide#项目结构' },
          { text: '后端开发', link: '/development-guide#后端本地开发' },
          { text: '通信协议', link: '/development-guide#通信协议' },
          { text: '测试与联调', link: '/development-guide#测试与联调' }
        ]
      },
      {
        text: '插件开发',
        collapsed: false,
        items: [
          { text: '快速上手', link: '/plugin-development#快速上手' },
          { text: '接口定义', link: '/plugin-development#接口定义' },
          { text: '事件', link: '/plugin-development#事件' },
          { text: '并发约定', link: '/plugin-development#并发约定' },
          { text: '配置约定', link: '/plugin-development#配置约定' },
          { text: '后台展示', link: '/plugin-development#后台展示' },
          { text: '暴露 HTTP 接口', link: '/plugin-development#暴露-http-接口' },
          { text: '联调', link: '/plugin-development#联调' }
        ]
      }
    ],

    outline: {
      level: [2, 3],
      label: '本页目录'
    },
    search: {
      provider: 'local'
    },
    docFooter: {
      prev: '上一篇',
      next: '下一篇'
    },
    lastUpdated: {
      text: '最后更新于'
    },
    footer: {
      // message 支持 HTML。备案号与版权按《非经营性互联网信息服务备案管理办法》
      // 要求放在页面显著位置（页脚）。
      message:
        '融聚绵中，媒传万象<br>' +
        'Copyright © 2026 烧瑚烙饼 版权所有 · ' +
        '<a href="https://beian.miit.gov.cn/" target="_blank" rel="noopener nofollow">蜀ICP备2025120814号-1</a>',
      copyright: ''
    },
    darkModeSwitchLabel: '外观',
    sidebarMenuLabel: '目录',
    returnToTopLabel: '返回顶部',
    langMenuLabel: '选择语言'
  },
  mermaid: {
    // Mermaid 配置项，theme 在此处设置仅对亮色模式生效，深色模式会自动切换
  },
});