import {themes as prismThemes} from 'prism-react-renderer';
import type {Config} from '@docusaurus/types';
import type * as Preset from '@docusaurus/preset-classic';

const config: Config = {
  title: 'Rioku Docs',
  tagline: 'Open-source, AI-native API gateway platform built on Caddy',
  favicon: 'img/favicon.svg',

  url: 'https://docs.rioku.dev',
  baseUrl: '/',

  organizationName: 'riokulabs',
  projectName: 'rioku',

  onBrokenLinks: 'throw',

  i18n: {
    defaultLocale: 'en',
    locales: ['en'],
  },

  markdown: {
    mermaid: true,
    hooks: {
      onBrokenMarkdownLinks: 'throw',
    },
  },

  themes: ['@docusaurus/theme-mermaid'],

  plugins: [
    'docusaurus-plugin-sass',
    'docusaurus-plugin-llms-txt',
  ],

  presets: [
    [
      'classic',
      {
        docs: {
          sidebarPath: './sidebars.ts',
          editUrl: 'https://github.com/riokulabs/rioku/tree/main/docs/',
        },
        blog: false,
        theme: {
          customCss: './src/css/custom.scss',
        },
      } satisfies Preset.Options,
    ],
  ],

  themeConfig: {
    colorMode: {
      defaultMode: 'dark',
      respectPrefersColorScheme: true,
    },
    navbar: {
      title: 'Rioku Docs',
      logo: {
        alt: 'Rioku',
        src: 'img/logo.svg',
      },
      items: [
        {
          type: 'docSidebar',
          sidebarId: 'docsSidebar',
          position: 'left',
          label: 'Documentation',
        },
        {
          href: 'https://contrib.rioku.dev',
          label: 'Contributors',
          position: 'left',
        },
        {
          href: 'https://github.com/riokulabs/rioku',
          label: 'GitHub',
          position: 'right',
        },
      ],
    },
    footer: {
      style: 'dark',
      links: [
        {
          title: 'Docs',
          items: [
            {label: 'Getting Started', to: '/docs/getting-started/introduction'},
            {label: 'CLI Reference', to: '/docs/cli-reference/overview'},
            {label: 'API Reference', to: '/docs/api-reference/overview'},
          ],
        },
        {
          title: 'Community',
          items: [
            {label: 'GitHub', href: 'https://github.com/riokulabs/rioku'},
            {label: 'Discord', href: '#'},
          ],
        },
        {
          title: 'More',
          items: [
            {label: 'Contributor Docs', href: 'https://contrib.rioku.dev'},
            {label: 'Storybook', href: 'https://storybook.rioku.dev'},
          ],
        },
      ],
      copyright: `Copyright ${new Date().getFullYear()} RiokuLabs. Built with Docusaurus.`,
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula,
      additionalLanguages: ['bash', 'json', 'yaml', 'go', 'protobuf', 'sql', 'toml'],
    },
    mermaid: {
      theme: {light: 'neutral', dark: 'dark'},
    },
  } satisfies Preset.ThemeConfig,
};

export default config;
