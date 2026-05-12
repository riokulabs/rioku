import {themes as prismThemes} from 'prism-react-renderer';
import type {Config} from '@docusaurus/types';
import type * as Preset from '@docusaurus/preset-classic';
import type * as Redocusaurus from 'redocusaurus';

const config: Config = {
  title: 'Rioku Contributors',
  tagline: 'Contributor documentation for the Rioku project',
  favicon: 'img/favicon.svg',

  url: 'https://contrib.rioku.dev',
  baseUrl: '/',

  organizationName: 'riokulabs',
  projectName: 'rioku',

  onBrokenLinks: 'warn',

  i18n: {
    defaultLocale: 'en',
    locales: ['en'],
  },

  markdown: {
    mermaid: true,
    format: 'md',
    hooks: {
      onBrokenMarkdownLinks: 'warn',
    },
  },

  themes: ['@docusaurus/theme-mermaid'],

  plugins: [
    'docusaurus-plugin-sass',
  ],

  presets: [
    [
      'classic',
      {
        docs: {
          sidebarPath: './sidebars.ts',
          editUrl: 'https://github.com/riokulabs/rioku/tree/main/contrib-docs/',
          routeBasePath: 'docs',
        },
        blog: false,
        theme: {
          customCss: './src/css/custom.scss',
        },
      } satisfies Preset.Options,
    ],
    [
      'redocusaurus',
      {
        specs: [
          {
            id: 'rioku-api',
            spec: '../packages/proto/gen/openapi/rioku/v1/api.full.json',
            route: '/docs/apis/reference',
          },
        ],
        theme: {
          primaryColor: '#6366f1',
          options: {
            disableSearch: false,
            hideDownloadButton: false,
          },
        },
      } satisfies Redocusaurus.PresetEntry,
    ],
  ],

  themeConfig: {
    colorMode: {
      defaultMode: 'dark',
      respectPrefersColorScheme: true,
    },
    navbar: {
      title: 'Rioku Contributors',
      logo: {
        alt: 'Rioku',
        src: 'img/logo.svg',
      },
      items: [
        {
          type: 'docSidebar',
          sidebarId: 'contribSidebar',
          position: 'left',
          label: 'Docs',
        },
        {
          href: 'https://docs.rioku.dev',
          label: 'User Docs',
          position: 'left',
        },
        {
          href: 'https://storybook.rioku.dev',
          label: 'Storybook',
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
          title: 'Contributor Docs',
          items: [
            {label: 'Getting Started', to: '/docs/getting-started'},
            {label: 'Architecture', to: '/docs/architecture/process-topology'},
            {label: 'Development', to: '/docs/development/coding-guidelines'},
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
            {label: 'User Docs', href: 'https://docs.rioku.dev'},
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
