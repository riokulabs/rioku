import type { Meta, StoryObj } from '@storybook/react'
import { useState } from 'react'
import { YamlJsonEditor } from '@ui/components/yaml-json-editor'
import type { YamlJsonEditorProps } from '@ui/components/yaml-json-editor'

const sampleYaml = `routes:
  - match:
      host: api.example.com
      path: /v1/*
    upstream: http://localhost:3000
    plugins:
      - name: rate-limit
        config:
          requests_per_second: 100
      - name: auth
        config:
          type: jwt
          issuer: https://auth.example.com
`

const sampleJson = JSON.stringify(
  {
    routes: [
      {
        match: { host: 'api.example.com', path: '/v1/*' },
        upstream: 'http://localhost:3000',
        plugins: [
          { name: 'rate-limit', config: { requests_per_second: 100 } },
          { name: 'auth', config: { type: 'jwt', issuer: 'https://auth.example.com' } },
        ],
      },
    ],
  },
  null,
  2,
)

const invalidYaml = `routes:
  - match:
    host: api.example.com
    - broken: [indent
`

const largeYaml = Array.from(
  { length: 50 },
  (_, i) => `service_${i + 1}:\n  host: app${i + 1}.example.com\n  port: ${3000 + i}\n  health_check: /healthz\n  timeout: 30s\n`,
).join('\n')

const meta: Meta<typeof YamlJsonEditor> = {
  title: 'Components/YamlJsonEditor',
  component: YamlJsonEditor,
  tags: ['autodocs'],
  decorators: [
    (Story) => (
      <div style={{ maxWidth: 720, padding: 24 }}>
        <Story />
      </div>
    ),
  ],
}

export default meta
type Story = StoryObj<typeof YamlJsonEditor>

function EditorWrapper(
  props: Partial<YamlJsonEditorProps> & { initialValue: string },
) {
  const [value, setValue] = useState(props.initialValue)
  const [format, setFormat] = useState<'yaml' | 'json'>(
    props.format ?? 'yaml',
  )

  return (
    <YamlJsonEditor
      value={value}
      onChange={setValue}
      format={format}
      onFormatChange={setFormat}
      readOnly={props.readOnly}
      showDownload={props.showDownload}
      downloadFilename={props.downloadFilename}
      height={props.height}
      className={props.className}
    />
  )
}

export const DefaultYaml: Story = {
  name: 'Default (YAML)',
  render: () => <EditorWrapper initialValue={sampleYaml} />,
}

export const JsonMode: Story = {
  name: 'JSON Mode',
  render: () => <EditorWrapper initialValue={sampleJson} format="json" />,
}

export const ReadOnly: Story = {
  name: 'Read-only',
  render: () => <EditorWrapper initialValue={sampleYaml} readOnly />,
}

export const WithErrors: Story = {
  name: 'With Errors',
  render: () => <EditorWrapper initialValue={invalidYaml} />,
}

export const LargeContent: Story = {
  name: 'Large Content',
  render: () => (
    <EditorWrapper initialValue={largeYaml} height="500px" />
  ),
}

export const WithDownload: Story = {
  name: 'With Download Button',
  render: () => (
    <EditorWrapper
      initialValue={sampleYaml}
      showDownload
      downloadFilename="routes-config"
    />
  ),
}
