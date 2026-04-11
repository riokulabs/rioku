import type { Meta, StoryObj } from '@storybook/react'
import { useState } from 'react'
import {
  SearchableMultiSelect,
  SearchableSelect,
} from '@ui/components/searchable-select'
import type { SelectOption } from '@ui/components/searchable-select'

const roleOptions: SelectOption[] = [
  { value: 'admin', label: 'Admin', description: 'Full system access' },
  { value: 'editor', label: 'Editor', description: 'Can edit content' },
  {
    value: 'viewer',
    label: 'Viewer',
    description: 'Read-only access',
    badge: 'Default',
  },
  { value: 'moderator', label: 'Moderator', description: 'Can moderate users' },
]

const timezoneOptions: SelectOption[] = Array.from({ length: 60 }, (_, i) => {
  const offset = i - 12
  const sign = offset >= 0 ? '+' : ''
  return {
    value: `utc${sign}${offset}`,
    label: `UTC${sign}${offset}`,
    description: `${Math.abs(offset)} hours ${offset >= 0 ? 'ahead of' : 'behind'} UTC`,
  }
})

const meta: Meta<typeof SearchableSelect> = {
  title: 'Components/SearchableSelect',
  component: SearchableSelect,
  tags: ['autodocs'],
  decorators: [
    (Story) => (
      <div style={{ maxWidth: 360, padding: 24 }}>
        <Story />
      </div>
    ),
  ],
}

export default meta
type Story = StoryObj<typeof SearchableSelect>

function SingleSelectWrapper(props: {
  options: SelectOption[]
  placeholder?: string
  disabled?: boolean
  initialValue?: string
}) {
  const [value, setValue] = useState(props.initialValue ?? '')
  return (
    <SearchableSelect
      options={props.options}
      value={value}
      onChange={setValue}
      placeholder={props.placeholder}
      disabled={props.disabled}
    />
  )
}

function MultiSelectWrapper(props: {
  options: SelectOption[]
  placeholder?: string
  disabled?: boolean
  initialValue?: string[]
}) {
  const [value, setValue] = useState<string[]>(props.initialValue ?? [])
  return (
    <SearchableMultiSelect
      options={props.options}
      value={value}
      onChange={setValue}
      placeholder={props.placeholder}
      disabled={props.disabled}
    />
  )
}

export const Default: Story = {
  render: () => (
    <SingleSelectWrapper options={roleOptions} placeholder="Select a role..." />
  ),
}

export const WithSelection: Story = {
  render: () => (
    <SingleSelectWrapper
      options={roleOptions}
      placeholder="Select a role..."
      initialValue="editor"
    />
  ),
}

export const MultiSelectWithBadges: Story = {
  render: () => (
    <MultiSelectWrapper
      options={roleOptions}
      placeholder="Add roles..."
      initialValue={['admin', 'viewer']}
    />
  ),
}

export const LargeList: Story = {
  render: () => (
    <SingleSelectWrapper
      options={timezoneOptions}
      placeholder="Search timezone..."
    />
  ),
}

export const Disabled: Story = {
  render: () => (
    <SingleSelectWrapper
      options={roleOptions}
      placeholder="Disabled..."
      disabled
      initialValue="admin"
    />
  ),
}

export const WithDescriptions: Story = {
  render: () => (
    <SingleSelectWrapper
      options={[
        {
          value: 'rate-limit',
          label: 'Rate Limiting',
          description: 'Limit requests per time window',
          badge: 'Core',
        },
        {
          value: 'auth',
          label: 'Authentication',
          description: 'JWT and API key validation',
          badge: 'Core',
        },
        {
          value: 'llm-proxy',
          label: 'LLM Proxy',
          description: 'Route and rate-limit AI model calls',
          badge: 'AI',
        },
        {
          value: 'cache',
          label: 'Response Cache',
          description: 'Cache upstream responses with configurable TTL',
        },
        {
          value: 'transform',
          label: 'Request Transform',
          description: 'Modify headers, body, and query params',
          disabled: true,
        },
      ]}
      placeholder="Select a plugin..."
    />
  ),
}
