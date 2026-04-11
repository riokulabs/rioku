import type { Meta, StoryObj } from '@storybook/react'
import { useState } from 'react'
import { Checkbox } from '@ui/components/checkbox'
import type { CheckboxProps } from '@ui/components/checkbox'

const meta: Meta<typeof Checkbox> = {
  title: 'Components/Checkbox',
  component: Checkbox,
  tags: ['autodocs'],
  decorators: [
    (Story) => (
      <div style={{ padding: 24 }}>
        <Story />
      </div>
    ),
  ],
}

export default meta
type Story = StoryObj<typeof Checkbox>

function CheckboxWrapper(
  props: Omit<CheckboxProps, 'onChange'> & {
    initialChecked?: CheckboxProps['checked']
  },
) {
  const [checked, setChecked] = useState<CheckboxProps['checked']>(
    props.initialChecked ?? props.checked,
  )
  return (
    <Checkbox
      {...props}
      checked={checked}
      onChange={(val) => setChecked(val)}
    />
  )
}

export const Unchecked: Story = {
  render: () => (
    <CheckboxWrapper checked={false} aria-label="Accept terms" />
  ),
}

export const Checked: Story = {
  render: () => (
    <CheckboxWrapper checked={true} aria-label="Accept terms" />
  ),
}

export const Indeterminate: Story = {
  render: () => (
    <CheckboxWrapper checked="indeterminate" aria-label="Select all" />
  ),
}

export const Disabled: Story = {
  render: () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Checkbox checked={false} onChange={() => {}} disabled aria-label="Disabled unchecked" />
        <span>Disabled unchecked</span>
      </label>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Checkbox checked={true} onChange={() => {}} disabled aria-label="Disabled checked" />
        <span>Disabled checked</span>
      </label>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Checkbox checked="indeterminate" onChange={() => {}} disabled aria-label="Disabled indeterminate" />
        <span>Disabled indeterminate</span>
      </label>
    </div>
  ),
}

export const WithLabels: Story = {
  render: () => {
    function LabeledCheckboxes() {
      const [notifications, setNotifications] = useState(true)
      const [marketing, setMarketing] = useState(false)
      const [analytics, setAnalytics] = useState(false)

      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
            <Checkbox checked={notifications} onChange={setNotifications} aria-label="Notifications" />
            <span>Email notifications</span>
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
            <Checkbox checked={marketing} onChange={setMarketing} aria-label="Marketing" />
            <span>Marketing emails</span>
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
            <Checkbox checked={analytics} onChange={setAnalytics} aria-label="Analytics" />
            <span>Usage analytics</span>
          </label>
        </div>
      )
    }
    return <LabeledCheckboxes />
  },
}
